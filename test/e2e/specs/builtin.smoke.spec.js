"use strict";

const { test, expect } = require("@playwright/test");
const {
  attachFailurePageHtml,
  chromeStorage,
  launchExtension,
  openFixtureWithPanel,
  sendToActiveTab,
  withFixtureServer
} = require("../helpers/extension-harness");

async function openOptionsPage(harness, hash = "") {
  const page = await harness.context.newPage();
  const url = `chrome-extension://${harness.extensionId}/options.html${hash}`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  return page;
}

// Pick an option from the custom dropdown that replaces a native <select>.
// `selectTestId` is the native select's data-aaw-test value.
async function selectFromDropdown(page, selectTestId, optionName) {
  await page.locator(`[data-aaw-test="${selectTestId}-dropdown"]`).click();
  const listbox = page.locator(`[data-aaw-test="${selectTestId}-opt-listbox"]`);
  await listbox.getByRole("option", { name: optionName, exact: true }).click();
}

// Pick an option from a custom dropdown whose stable hook lives on the wrapper
// element itself (e.g. memory-move-select, task-priority) rather than following
// the `${id}-dropdown` trigger naming convention.
async function selectFromCustomDropdown(scope, wrapperTestId, optionName) {
  const dropdown = scope.locator(`[data-aaw-test="${wrapperTestId}"]`);
  await dropdown.locator(".aaw-dropdown__trigger").click();
  await dropdown.getByRole("option", { name: optionName, exact: true }).click();
}

// The Tasks section ships collapsed; expand it before touching task fields.
async function expandTasks(page) {
  const toggle = page.locator('[data-aaw-test="task-section-toggle"]');
  if ((await toggle.getAttribute("aria-expanded")) === "false") {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

// --- Light/dark theme computed-style helpers ---------------------------------
// These let the theme specs assert readable contrast and visible borders from
// resolved colors instead of brittle exact-hex matches.

// Parse a computed "rgb(...)"/"rgba(...)" string into {r,g,b,a}. Alpha defaults
// to 1 when absent; non-color keywords resolve to fully transparent.
function parseColor(value) {
  if (!value || value === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  const match = String(value).match(/rgba?\(([^)]+)\)/);
  if (!match) return { r: 0, g: 0, b: 0, a: 1 };
  const parts = match[1].split(",").map((part) => parseFloat(part.trim()));
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
}

// Composite a (possibly translucent) top color over an opaque bottom color.
function flatten(top, bottom) {
  if (top.a >= 1) return { r: top.r, g: top.g, b: top.b, a: 1 };
  return {
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1
  };
}

// WCAG relative luminance (0 = black, 1 = white) for an opaque color.
function luminance({ r, g, b }) {
  const channel = (value) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

// WCAG contrast ratio (1..21) between a foreground and an opaque background.
// Translucent foregrounds are flattened over the background first.
function contrastRatio(fg, bg) {
  const top = flatten(fg, bg);
  const l1 = luminance(top);
  const l2 = luminance(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

// Euclidean RGB distance (0..441).
function colorDistance(a, b) {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

// A border is visible when it has non-zero alpha and is meaningfully distinct
// from both its own element background and the surrounding page background.
function borderVisible(borderStr, elementBgStr, pageBgStr, minDistance = 12) {
  const border = parseColor(borderStr);
  if (border.a <= 0) return false;
  const elementBg = parseColor(elementBgStr);
  const pageBg = parseColor(pageBgStr);
  return colorDistance(border, elementBg) >= minDistance
    && colorDistance(border, pageBg) >= minDistance;
}

// Read named computed-style properties (kebab-case) off a locator's element.
function readStyles(locator, props) {
  return locator.evaluate((el, names) => {
    const cs = getComputedStyle(el);
    const out = {};
    for (const name of names) out[name] = cs.getPropertyValue(name);
    return out;
  }, props);
}

let fixtures;
let extension;

test.beforeAll(async () => {
  fixtures = await withFixtureServer();
  extension = await launchExtension();
});

test.afterAll(async () => {
  if (extension) await extension.close();
  if (fixtures) await fixtures.close();
});

test.afterEach(async ({}, testInfo) => {
  await attachFailurePageHtml(testInfo);
});

test("built-in mode summarizes, saves, and searches memory", async () => {
  const page = await openFixtureWithPanel(extension, fixtures, "article");

  await page.locator('[data-aaw-test="cmd-summarize"]').click();
  await expect(page.locator('[data-aaw-test="result-chip"]')).toHaveText("Done");
  await expect(page.locator('[data-aaw-test="result-output"]')).toContainText("TL;DR");
  await expect(page.locator('[data-aaw-test="result-output"]')).toContainText("Autonomous");

  await page.locator('[data-aaw-test="memory-note-input"]').fill("Research note for browser QA automation.");
  await page.locator('[data-aaw-test="save-memory"]').click();
  await expect(page.locator('[data-aaw-test="memory-status"]')).toContainText(/Saved:/);
  await page.locator('[data-aaw-test="page-graph"]').click();
  await expect(page.locator('[data-aaw-test="context-drawer"]')).toContainText(/nodes, .*links/);
  await expect(page.locator('[data-aaw-test="context-drawer"]')).toContainText("Autonomous");

  await page.locator('[data-aaw-test="search-input"]').fill("browser QA automation");
  await page.locator('[data-aaw-test="search-input"]').press("Enter");
  await expect(page.locator('[data-aaw-test="search-status"]')).toContainText(/result/i);
  await expect(page.locator('[data-aaw-test="search-results"]')).toContainText("Research note");

  // Clear control resets the query/results, restores the idle state, and returns
  // focus to the input without changing the existing Escape behavior.
  await page.locator('[data-aaw-test="search-clear"]').click();
  await expect(page.locator('[data-aaw-test="search-input"]')).toHaveValue("");
  await expect(page.locator('[data-aaw-test="search-status"]')).toContainText(/Search saved notes/i);
  await expect(page.locator('[data-aaw-test="search-input"]')).toBeFocused();
});

test("built-in mode rewrites selected textarea text with local fallback preview", async () => {
  const page = await openFixtureWithPanel(extension, fixtures, "rewrite");

  await page.locator("#rough").selectText();
  await expect(page.locator('[data-aaw-test="rewrite-status"]')).toContainText(/chars selected|textarea/i);
  await page.locator('[data-aaw-test="cmd-rewrite"]').click();
  await expect(page.locator('[data-aaw-test="result-chip"]')).toHaveText("Done");
  await expect(page.locator('[data-aaw-test="rewrite-status"]')).toContainText(/Local fallback|Preview ready|copy-only/i);
  await expect(page.locator('[data-aaw-test="rewrite-preview"]')).toContainText("Rewrite goal");
});

test("built-in mode covers contenteditable rewrite and unsupported copy fallback", async () => {
  const contenteditablePage = await openFixtureWithPanel(extension, fixtures, "rewrite");
  await contenteditablePage.locator("#editable").evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await expect(contenteditablePage.locator('[data-aaw-test="rewrite-status"]')).toContainText(/copy fallback|chars selected/i);
  await contenteditablePage.locator('[data-aaw-test="cmd-rewrite"]').click();
  await expect(contenteditablePage.locator('[data-aaw-test="result-chip"]')).toHaveText("Done");
  await expect(contenteditablePage.locator('[data-aaw-test="rewrite-status"]')).toContainText(/copy fallback|copy-only/i);

  const unsupportedPage = await openFixtureWithPanel(extension, fixtures, "unsupported-editor");
  await unsupportedPage.locator("#static-copy").evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await expect(unsupportedPage.locator('[data-aaw-test="rewrite-status"]')).toContainText(/copy fallback|chars selected/i);
  await unsupportedPage.locator('[data-aaw-test="cmd-rewrite"]').click();
  await expect(unsupportedPage.locator('[data-aaw-test="result-chip"]')).toHaveText("Done");
  await expect(unsupportedPage.locator('[data-aaw-test="rewrite-status"]')).toContainText(/copy fallback|copy-only/i);
});

test("built-in mode extracts structured info, captures a lead, and creates a task", async () => {
  const page = await openFixtureWithPanel(extension, fixtures, "lead");

  await page.locator('[data-aaw-test="cmd-extract"]').click();
  await expect(page.locator('[data-aaw-test="result-chip"]')).toHaveText("Done");
  await expect(page.locator('[data-aaw-test="result-output"]')).toContainText("ada.rivera@example.com");

  await page.locator('[data-aaw-test="lead-capture"]').click();
  await expect(page.locator('[data-aaw-test="lead-status"]')).toContainText(/lead draft/i);
  await expect(page.locator('[data-aaw-test="lead-drafts"]')).toContainText("ada.rivera@example.com");

  // Lead/contact and move surfaces use custom dropdowns, not native selects.
  await expect(page.locator('.aaw-section--leads select')).toHaveCount(0);

  // Tasks ships collapsed; its fields are hidden until expanded.
  await expect(page.locator('[data-aaw-test="task-section-toggle"]')).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator('[data-aaw-test="task-title"]')).toBeHidden();
  await expandTasks(page);
  await expect(page.locator('.aaw-section--tasks select')).toHaveCount(0);

  await page.locator('[data-aaw-test="task-title"]').fill("Follow up with Ada Rivera");
  await page.locator('[data-aaw-test="task-notes"]').fill("Send partnership workflow notes.");
  await page.locator('[data-aaw-test="task-create"]').click();
  await expect(page.locator('[data-aaw-test="task-status"]')).toContainText(/Task created|Task already exists/);
  await expect(page.locator('[data-aaw-test="task-list"]')).toContainText("Follow up with Ada Rivera");
});

// Select the workspace list row whose label matches `name` and make it the
// active write target by clicking its select button.
async function selectWorkspaceRow(list, name) {
  const row = list.locator('[data-aaw-test="workspace-row"]', { hasText: name });
  await row.locator('[data-aaw-test="workspace-active-select"]').click();
  return row;
}

// Create an open project via the Workspaces section create controls, which sit
// behind a collapsed toggle by default.
async function createProject(page, name) {
  await page.locator('[data-aaw-test="workspace-create-toggle"]').click();
  await page.locator('[data-aaw-test="workspace-section-create-input"]').fill(name);
  await page.locator('[data-aaw-test="workspace-section-create"]').click();
  await expect(page.locator('[data-aaw-test="workspace-status"]')).toContainText(`Workspace created: ${name}`);
  await expect(page.locator('[data-aaw-test="workspace-list"]')).toContainText(name);
}

async function triggerWorkspaceDelete(page) {
  const button = page.locator('[data-aaw-test="workspace-delete"]');
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  await button.evaluate((element) => element.click());
}

test("built-in mode keeps a saved workspace note scoped to its active project", async () => {
  const page = await openFixtureWithPanel(extension, fixtures, "task");
  const list = page.locator('[data-aaw-test="workspace-list"]');
  const body = page.locator('[data-aaw-test="workspace-body"]');

  await createProject(page, "Iso Project A");
  await createProject(page, "Iso Project B");

  // Save a note while Project A is the active workspace.
  await selectWorkspaceRow(list, "Iso Project A");
  await page.locator('[data-aaw-test="memory-note-input"]').fill("Note that belongs only to Iso Project A.");
  await page.locator('[data-aaw-test="save-memory"]').click();
  await expect(page.locator('[data-aaw-test="memory-status"]')).toContainText(/Saved:/);

  // It renders in Project A's Notes tab/body as a card.
  await expect(page.locator('[data-aaw-test="workspace-detail-tabs"]')).toBeVisible();
  await page.locator('[data-aaw-test="workspace-tab-notes"]').click();
  await expect(body).toContainText("Note that belongs only to Iso Project A.");
  await expect(body.locator('.aaw-memory-result')).toContainText("Note that belongs only to Iso Project A.");

  // It does not leak into Project B.
  await selectWorkspaceRow(list, "Iso Project B");
  await expect(body).not.toContainText("Note that belongs only to Iso Project A.");

  // Nor into the Unassigned bucket.
  await list.locator('[data-aaw-test="workspace-row-inbox"]').click();
  await expect(body).not.toContainText("Note that belongs only to Iso Project A.");
});

test("built-in mode workspace UI drops archive/filter/graph controls and keeps stable hooks", async () => {
  const page = await openFixtureWithPanel(extension, fixtures, "task");
  const list = page.locator('[data-aaw-test="workspace-list"]');

  // Page Memory no longer carries the inline workspace-create controls.
  await expect(page.locator('.aaw-section--memory [data-aaw-test="workspace-create-input"]')).toHaveCount(0);
  await expect(page.locator('.aaw-section--memory [data-aaw-test="workspace-create"]')).toHaveCount(0);

  // The Workspaces create input/button stay hidden until the toggle opens them.
  await expect(page.locator('[data-aaw-test="workspace-create-toggle"]')).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator('[data-aaw-test="workspace-section-create-input"]')).toBeHidden();
  await expect(page.locator('[data-aaw-test="workspace-section-create"]')).toBeHidden();

  // The create toggle lives in the Workspaces section header and is wired to the
  // collapsed create panel via aria-controls.
  const createToggle = page.locator('.aaw-section--workspaces .aaw-section-head [data-aaw-test="workspace-create-toggle"]');
  await expect(createToggle).toBeVisible();
  await expect(createToggle).toHaveAttribute("aria-controls", "aaw-workspace-create-panel");
  await expect(page.locator('#aaw-workspace-create-panel')).toHaveAttribute("data-aaw-test", "workspace-create-panel");

  // Panel sections render in order: Page Memory -> Workspaces -> Lead Capture.
  const sectionOrder = await page.evaluate(() => {
    const main = document.querySelector(".aaw-view--main");
    const after = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    return after(main.querySelector(".aaw-section--memory"), main.querySelector(".aaw-section--workspaces"))
      && after(main.querySelector(".aaw-section--workspaces"), main.querySelector(".aaw-section--leads"));
  });
  expect(sectionOrder).toBe(true);

  await createProject(page, "Hooks Project");
  await selectWorkspaceRow(list, "Hooks Project");

  // Removed controls must be absent from the simplified workspace UI.
  const removableRoots = [
    page.locator('[data-aaw-test="workspace-list"]'),
    page.locator('[data-aaw-test="workspace-dashboard"]'),
    page.locator('[data-aaw-test="workspace-body"]')
  ];
  await expect(list.locator('.aaw-workspace-tabs')).toHaveCount(0);
  await expect(list.locator('.aaw-workspace-row-actions')).toHaveCount(0);
  for (const root of removableRoots) {
    for (const label of ["Graph", "Archive", "Reopen", "Overview", "Sources", "Activity"]) {
      await expect(root.locator('button', { hasText: label })).toHaveCount(0);
    }
  }
  await expect(page.locator(".aaw-section--memory")).not.toContainText("one or more workspaces");

  // Stable hooks the simplified UI still exposes.
  await expect(page.locator('[data-aaw-test="active-workspace-selector"]')).toBeVisible();

  // The active-workspace selector now shares the primary save row with the
  // Save Memory button (both hooks live inside .aaw-memory-save-row).
  const saveRow = page.locator('.aaw-section--memory .aaw-memory-save-row');
  await expect(saveRow.locator('[data-aaw-test="active-workspace-selector"]')).toHaveCount(1);
  await expect(saveRow.locator('[data-aaw-test="save-memory"]')).toHaveCount(1);
  await expect(page.locator('[data-aaw-test="workspace-detail-tabs"]')).toBeVisible();
  // The dashboard exposes only Notes and Contacts — no Tasks tab.
  for (const tab of ["notes", "contacts"]) {
    await expect(page.locator(`[data-aaw-test="workspace-tab-${tab}"]`)).toBeVisible();
  }
  await expect(page.locator('[data-aaw-test="workspace-tab-tasks"]')).toHaveCount(0);
  // Workspaces never surfaces page-save, task-create, lead-capture, or Tasks actions.
  const workspaceRoot = page.locator('.aaw-section--workspaces');
  for (const label of ["Save Current Page", "Create Task", "Capture Lead", "Tasks"]) {
    await expect(workspaceRoot.locator('button', { hasText: label })).toHaveCount(0);
  }
  // The built-in no-project bucket keeps its stable hook but reads "Unassigned".
  await expect(list.locator('[data-aaw-test="workspace-row-inbox"]')).toBeVisible();
  await expect(list.locator('[data-aaw-test="workspace-row-inbox"]')).toContainText("Unassigned");
  const row = list.locator('[data-aaw-test="workspace-row"]', { hasText: "Hooks Project" });
  await expect(row).toBeVisible();
  await expect(row.locator('[data-aaw-test="workspace-active-select"]')).toBeVisible();
  await expect(page.locator('[data-aaw-test="workspace-delete"]')).toBeVisible();

  // Refresh + Delete utility actions live inside the dashboard header row next
  // to the selected workspace title, not as a separate sibling row under the
  // dashboard.
  const dashboardHeader = page.locator('.aaw-workspace-dashboard-header');
  await expect(dashboardHeader.getByRole("button", { name: "Refresh", exact: true })).toBeVisible();
  await expect(dashboardHeader.locator('[data-aaw-test="workspace-delete"]')).toBeVisible();
  await expect(page.locator('[data-aaw-test="workspace-dashboard"] > .aaw-workspace-utility-actions')).toHaveCount(0);
});

test("built-in mode moves a workspace note between projects and back to Unassigned", async () => {
  const page = await openFixtureWithPanel(extension, fixtures, "task");
  const list = page.locator('[data-aaw-test="workspace-list"]');
  const body = page.locator('[data-aaw-test="workspace-body"]');

  await createProject(page, "Move Project A");
  await createProject(page, "Move Project B");

  await selectWorkspaceRow(list, "Move Project A");
  await page.locator('[data-aaw-test="memory-note-input"]').fill("Movable note across projects.");
  await page.locator('[data-aaw-test="save-memory"]').click();
  await expect(page.locator('[data-aaw-test="memory-status"]')).toContainText(/Saved:/);
  await expect(body).toContainText("Movable note across projects.");

  // Move the note from Project A to Project B.
  await body.locator('[data-aaw-test="memory-move"]').click();
  // The move target is a custom dropdown, not a native select.
  await expect(body.locator('[data-aaw-test="memory-move-select"]')).toHaveClass(/aaw-dropdown/);
  await expect(body.locator('select')).toHaveCount(0);
  await selectFromCustomDropdown(body, "memory-move-select", "Move Project B");
  await body.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator('[data-aaw-test="memory-status"]')).toContainText("Note moved.");
  await expect(body).not.toContainText("Movable note across projects.");
  await selectWorkspaceRow(list, "Move Project B");
  await expect(body).toContainText("Movable note across projects.");

  // Move it again, this time to the Unassigned bucket.
  await body.locator('[data-aaw-test="memory-move"]').click();
  await selectFromCustomDropdown(body, "memory-move-select", "Unassigned");
  await body.getByRole("button", { name: "Save", exact: true }).click();
  await expect(body).not.toContainText("Movable note across projects.");
  await list.locator('[data-aaw-test="workspace-row-inbox"]').click();
  await expect(body).toContainText("Movable note across projects.");
});

test("built-in mode deletes a workspace project with a confirm guard and destructive copy", async () => {
  const page = await openFixtureWithPanel(extension, fixtures, "task");
  const list = page.locator('[data-aaw-test="workspace-list"]');
  const body = page.locator('[data-aaw-test="workspace-body"]');

  await createProject(page, "Delete Project");
  await selectWorkspaceRow(list, "Delete Project");
  await page.locator('[data-aaw-test="memory-note-input"]').fill("Note inside the project being deleted.");
  await page.locator('[data-aaw-test="save-memory"]').click();
  await expect(page.locator('[data-aaw-test="memory-status"]')).toContainText(/Saved:/);
  await expect(body).toContainText("Note inside the project being deleted.");

  // Dismissing the confirm keeps the project (and its contents) in place.
  const dismissDialogPromise = page.waitForEvent("dialog");
  await triggerWorkspaceDelete(page);
  await (await dismissDialogPromise).dismiss();
  await expect(list).toContainText("Delete Project");

  // Accepting deletes the project; the confirm states it is permanent.
  const acceptDialogPromise = page.waitForEvent("dialog");
  await triggerWorkspaceDelete(page);
  const dialog = await acceptDialogPromise;
  const dialogMessage = dialog.message();
  await dialog.accept();
  await expect(list).not.toContainText("Delete Project");
  expect(dialogMessage).toContain("permanently deletes the project");
  expect(dialogMessage).toContain("contained notes, contacts, and tasks");

  // Its contents are gone and the Unassigned bucket is the active selection.
  await expect(body).not.toContainText("Note inside the project being deleted.");
  await expect(list.locator('[data-aaw-test="workspace-row-inbox"]')).toHaveAttribute("aria-current", "true");
});

test("gear button opens the options page in a new tab", async () => {
  const page = await openFixtureWithPanel(extension, fixtures, "article");
  const [optionsPage] = await Promise.all([
    extension.context.waitForEvent("page"),
    page.locator('[data-aaw-test="settings-open"]').click()
  ]);
  await optionsPage.waitForLoadState("domcontentloaded");
  expect(optionsPage.url()).toMatch(new RegExp(`^chrome-extension://${extension.extensionId}/options\\.html`));
  await optionsPage.close();
});

test("built-in privacy local-only mode is saved from options page and reflected by an open panel", async () => {
  const page = await openFixtureWithPanel(extension, fixtures, "article");

  const optionsPage = await openOptionsPage(extension, "#privacy");
  await selectFromDropdown(optionsPage, "privacy-mode", "Local only");
  await optionsPage.locator('[data-aaw-test="privacy-save"]').click();
  await expect(optionsPage.locator('[data-aaw-test="privacy-mode"]')).toHaveValue("local_only");
  // Allow chrome.storage.onChanged to propagate to the already-open panel.
  await expect(page.locator('[data-aaw-test="panel-settings-status"]')).toContainText(/Local/);
  await optionsPage.close();

  await page.bringToFront();
  await page.locator('[data-aaw-test="cmd-summarize"]').click();
  await expect(page.locator('[data-aaw-test="result-chip"]')).toHaveText("Local");
  await expect(page.locator('[data-aaw-test="result-provenance"]')).toContainText("Local only");
});

test("settings custom dropdowns drive the hidden native selects", async () => {
  const page = await openOptionsPage(extension, "#privacy");

  // The native select is kept in the DOM (enhanced + sr-only) while the custom
  // dropdown is the visible control.
  await expect(page.locator('[data-aaw-test="privacy-mode"]')).toHaveClass(/opt-select-hidden/);
  await expect(page.locator('[data-aaw-test="privacy-mode-dropdown"]')).toBeVisible();

  // Privacy mode: picking via the custom dropdown updates the native value.
  await selectFromDropdown(page, "privacy-mode", "Ask every time");
  await expect(page.locator('[data-aaw-test="privacy-mode"]')).toHaveValue("ask");
  await expect(page.locator('[data-aaw-test="privacy-mode-dropdown"]')).toContainText("Ask every time");

  // Dedupe type: picking a record type updates the native value and triggers a scan.
  await selectFromDropdown(page, "dedupe-type", "Contacts");
  await expect(page.locator('[data-aaw-test="dedupe-type"]')).toHaveValue("contact");
  await expect(page.locator('[data-aaw-test="dedupe-status"]')).toContainText(/group|scan/i);

  // AI provider: switching providers rebuilds the model dropdown options + label.
  await selectFromDropdown(page, "ai-provider", "OpenAI");
  await expect(page.locator('[data-aaw-test="ai-provider"]')).toHaveValue("openai");
  await expect(page.locator('[data-aaw-test="ai-model-dropdown"]')).toContainText("GPT-5.5");
  await page.locator('[data-aaw-test="ai-model-dropdown"]').click();
  await expect(
    page.locator('[data-aaw-test="ai-model-opt-listbox"]').getByRole("option", { name: "GPT-5.4 Mini" })
  ).toBeVisible();

  await page.close();
});

test("collapsed settings controls share one visual height", async () => {
  async function boxHeight(locator) {
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();
    return box.height;
  }

  const aiPage = await openOptionsPage(extension, "#ai");
  const providerTrigger = aiPage.locator('[data-aaw-test="ai-provider-dropdown"]');
  const apiKeyInput = aiPage.locator('[data-aaw-test="ai-api-key"]');
  const modelTrigger = aiPage.locator('[data-aaw-test="ai-model-dropdown"]');
  await expect(providerTrigger).toBeVisible();
  await expect(apiKeyInput).toBeVisible();
  await expect(modelTrigger).toBeVisible();

  const providerH = await boxHeight(providerTrigger);
  const apiKeyH = await boxHeight(apiKeyInput);
  const modelH = await boxHeight(modelTrigger);
  expect(Math.abs(providerH - apiKeyH)).toBeLessThanOrEqual(1);
  expect(Math.abs(providerH - modelH)).toBeLessThanOrEqual(1);
  await aiPage.close();

  // A number input matches the same height while a textarea stays taller.
  const privacyPage = await openOptionsPage(extension, "#privacy");
  const numberInput = privacyPage.locator('[data-aaw-test="privacy-retention-memory"]');
  const textarea = privacyPage.locator('[data-aaw-test="privacy-excluded-hosts"]');
  await expect(numberInput).toBeVisible();
  await expect(textarea).toBeVisible();

  const numberH = await boxHeight(numberInput);
  const textareaH = await boxHeight(textarea);
  expect(Math.abs(numberH - apiKeyH)).toBeLessThanOrEqual(1);
  expect(textareaH).toBeGreaterThan(numberH + 1);
  await privacyPage.close();
});

test("appearance theme is selectable via the visible card labels and persists", async () => {
  const page = await openOptionsPage(extension, "#appearance");

  const root = page.locator(":root");
  const dark = page.locator('label.opt-radio', { hasText: "Dark" });
  const light = page.locator('label.opt-radio', { hasText: "Light" });
  const system = page.locator('label.opt-radio', { hasText: "System" });

  async function storedMode() {
    const result = await chromeStorage(extension.worker, "get", "appearanceSettings");
    return result && result.appearanceSettings ? result.appearanceSettings.mode : null;
  }

  // Click the full visible card label (not the visually-hidden input).
  await light.click();
  await expect(page.locator('[data-aaw-test="appearance-light"]')).toBeChecked();
  await expect(root).toHaveAttribute("data-aaw-theme", "light");
  await expect.poll(storedMode).toBe("light");

  await dark.click();
  await expect(page.locator('[data-aaw-test="appearance-dark"]')).toBeChecked();
  await expect(root).toHaveAttribute("data-aaw-theme", "dark");
  await expect.poll(storedMode).toBe("dark");

  await system.click();
  await expect(page.locator('[data-aaw-test="appearance-system"]')).toBeChecked();
  await expect.poll(storedMode).toBe("system");

  await page.close();
});

test("built-in settings can review, merge, undo, ignore, and unignore duplicates", async () => {
  await chromeStorage(extension.worker, "set", {
    memory: [{
      id: "mem_keep",
      title: "Acme report",
      sourceUrl: "https://example.com/report?keep=1",
      note: "Follow up with Acme",
      workspaceIds: [],
      taskIds: [],
      linkedTaskIds: []
    }, {
      id: "mem_dup",
      title: "Acme report",
      sourceUrl: "https://example.com/report?utm_source=x&keep=1",
      note: "Follow up with Acme",
      workspaceIds: ["nw_default_research"],
      taskIds: ["nw_default_research"],
      linkedTaskIds: []
    }],
    actions: { tasks: [], tableRows: [], contacts: [], drafts: [] },
    embeddings: {
      mem_keep: { embedding: [0.1], meta: { provider: "test", model: "m", dimensions: 1 } },
      mem_dup: { embedding: [0.2], meta: { provider: "test", model: "m", dimensions: 1 } }
    },
    dedupeAudit: [],
    dedupeIgnored: []
  });
  const page = await openOptionsPage(extension, "#duplicates");

  await selectFromDropdown(page, "dedupe-type", "Memory");
  await page.locator('[data-aaw-test="dedupe-scan"]').click();
  await expect(page.locator('[data-aaw-test="dedupe-candidates"]')).toContainText("Acme report");

  await page.getByRole("button", { name: "Ignore" }).click();
  await expect(page.locator('[data-aaw-test="dedupe-status"]')).toContainText("ignored");
  await page.locator('[data-aaw-test="dedupe-show-ignored"]').check();
  await expect(page.locator('[data-aaw-test="dedupe-candidates"]')).toContainText("ignored");
  await page.getByRole("button", { name: "Unignore" }).click();
  await expect(page.locator('[data-aaw-test="dedupe-status"]')).toContainText("restored");

  await page.getByRole("button", { name: "Preview Merge" }).click();
  await expect(page.locator('[data-aaw-test="dedupe-candidates"]')).toContainText(/Keep mem_/);
  await page.getByRole("button", { name: "Apply Merge" }).click();
  await expect(page.locator('[data-aaw-test="dedupe-status"]')).toContainText("merged");
  await expect(page.locator('[data-aaw-test="dedupe-audit"]')).toContainText("memory merge");

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator('[data-aaw-test="dedupe-status"]')).toContainText("undone");
  await expect(page.locator('[data-aaw-test="dedupe-candidates"]')).toContainText("Acme report");
});

test("built-in settings can export and validate a backup", async () => {
  await chromeStorage(extension.worker, "set", {
    memory: [{
      id: "mem_backup_ui",
      title: "Backup UI note",
      sourceUrl: "https://example.com/backup-ui",
      note: "Backup UI smoke note"
    }],
    actions: { tasks: [], tableRows: [], contacts: [], drafts: [] },
    embeddings: {},
    geminiApiKey: "secret-key"
  });
  const page = await openOptionsPage(extension, "#backup");

  await page.getByRole("button", { name: "Export", exact: true }).click();
  await expect(page.locator('[data-aaw-test="backup-json"]')).toHaveValue(/aaw\.backup\.v1/);
  await expect(page.locator('[data-aaw-test="backup-json"]')).not.toHaveValue(/secret-key/);
  await page.getByRole("button", { name: "Validate" }).click();
  await expect(page.locator('[data-aaw-test="backup-status"]')).toContainText("Valid backup");
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("REPLACE");
    await dialog.dismiss();
  });
  await page.getByRole("button", { name: "Replace import" }).click();
  await expect(page.locator('[data-aaw-test="backup-status"]')).toContainText(/cancel/i);
});

test("empty status live regions stay hidden while default-populated statuses show", async () => {
  const page = await openOptionsPage(extension);

  // Initially-empty .opt-status regions must not draw an empty bordered box,
  // but must remain in the DOM so their aria-live region is preserved.
  for (const id of ["#ai-status", "#backend-status", "#privacy-status", "#status", "#shortcut-status"]) {
    await expect(page.locator(id)).toBeHidden();
    await expect(page.locator(id)).toHaveCount(1);
  }

  // Statuses that ship with default text must still be visible.
  await expect(page.locator('[data-aaw-test="dedupe-status"]')).toBeVisible();
  await expect(page.locator('[data-aaw-test="backup-status"]')).toBeVisible();

  // Clearing a populated status to "" should hide it again.
  await page.locator('[data-aaw-test="dedupe-status"]').evaluate((el) => { el.textContent = ""; });
  await expect(page.locator('[data-aaw-test="dedupe-status"]')).toBeHidden();
});

test("status feedback window adopts theme-aware colors across light and system themes", async () => {
  const page = await openOptionsPage(extension, "#duplicates");

  // A visible, default-populated feedback window (no error/success variant).
  const status = page.locator('[data-aaw-test="dedupe-status"]');
  await expect(status).toBeVisible();

  const root = page.locator(":root");
  const dark = page.locator('label.opt-radio', { hasText: "Dark" });
  const light = page.locator('label.opt-radio', { hasText: "Light" });
  const system = page.locator('label.opt-radio', { hasText: "System" });

  async function statusColors() {
    return status.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, border: cs.borderTopColor, text: cs.color };
    });
  }

  // Establish a known dark baseline.
  await dark.click();
  await expect(root).toHaveAttribute("data-aaw-theme", "dark");
  const darkColors = await statusColors();

  // Switching to Light must repaint the feedback window without a reload:
  // background, border, and text all move off the dark styling.
  await light.click();
  await expect(root).toHaveAttribute("data-aaw-theme", "light");
  const lightColors = await statusColors();
  expect(lightColors.bg).not.toBe(darkColors.bg);
  expect(lightColors.border).not.toBe(darkColors.border);
  expect(lightColors.text).not.toBe(darkColors.text);

  // System mode follows the resolved OS scheme. Flipping prefers-color-scheme
  // to light keeps the feedback window on the light styling, and back to dark
  // restores the dark styling — all live, no reload.
  await system.click();
  await page.emulateMedia({ colorScheme: "light" });
  await expect(root).toHaveAttribute("data-aaw-theme", "light");
  expect((await statusColors()).bg).toBe(lightColors.bg);

  await page.emulateMedia({ colorScheme: "dark" });
  await expect(root).toHaveAttribute("data-aaw-theme", "dark");
  expect((await statusColors()).bg).toBe(darkColors.bg);

  await page.emulateMedia({ colorScheme: null });
  await page.close();
});

test("built-in keyboard palette runs commands and leaves page editors alone", async () => {
  const page = await openFixtureWithPanel(extension, fixtures, "article");

  await page.locator('[data-aaw-test="cmd-summarize"]').focus();
  await page.keyboard.press("Shift+/");
  await expect(page.locator('[data-aaw-test="command-palette"]')).toBeVisible();
  await expect(page.locator('[data-aaw-test="command-palette"]')).toHaveAttribute("role", "dialog");
  await expect(page.locator('[data-aaw-test="command-palette-input"]')).toBeFocused();
  await page.locator('[data-aaw-test="command-palette-input"]').fill("summarize");
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-aaw-test="result-chip"]')).toHaveText(/Done|Local/);
  await expect(page.locator('[data-aaw-test="cmd-summarize"]')).toHaveAttribute("aria-keyshortcuts", "1");

  const editorPage = await openFixtureWithPanel(extension, fixtures, "rewrite");
  await editorPage.locator("#rough").fill("draft");
  await editorPage.locator("#rough").focus();
  await editorPage.keyboard.press("1");
  await expect(editorPage.locator("#rough")).toHaveValue("draft1");
});

test("page memory cards expose card class, edit disclosure semantics, and confirm-guarded delete", async () => {
  const page = await openFixtureWithPanel(extension, fixtures, "article");

  await page.locator('[data-aaw-test="memory-note-input"]').fill("Page memory polish note.");
  await page.locator('[data-aaw-test="save-memory"]').click();
  await expect(page.locator('[data-aaw-test="memory-status"]')).toContainText(/Saved:/);

  const card = page.locator('[data-aaw-test="page-memory-list"] .aaw-page-memory-card').first();
  await expect(card).toBeVisible();

  const editNote = card.getByRole("button", { name: "Edit Note" });
  await expect(editNote).toHaveAttribute("aria-expanded", "false");
  await editNote.click();
  await expect(editNote).toHaveAttribute("aria-expanded", "true");
  const editor = page.locator(`#${(await editNote.getAttribute("aria-controls"))}`);
  await expect(editor).toBeVisible();
  await expect(editor.locator("textarea")).toBeFocused();
  // Saving a note edit reports through the memory-status line, not workspace-status.
  await editor.locator("textarea").fill("Page memory polish note, edited.");
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(page.locator('[data-aaw-test="memory-status"]')).toContainText("Note updated.");
  await expect(page.locator('[data-aaw-test="workspace-status"]')).not.toContainText("Note updated.");

  // Cancel returns focus to the trigger and collapses the disclosure.
  await editNote.click();
  await expect(editNote).toHaveAttribute("aria-expanded", "true");
  const reopenedEditor = page.locator(`#${(await editNote.getAttribute("aria-controls"))}`);
  await reopenedEditor.getByRole("button", { name: "Cancel" }).click();
  await expect(editNote).toHaveAttribute("aria-expanded", "false");
  await expect(editNote).toBeFocused();

  // Cancelling the native confirm keeps the note in place.
  page.once("dialog", (dialog) => dialog.dismiss());
  await card.getByRole("button", { name: "Delete" }).click();
  await expect(page.locator('[data-aaw-test="page-memory-list"] .aaw-page-memory-card')).toHaveCount(1);

  // Confirming removes it and reports through the memory-status line.
  page.once("dialog", (dialog) => dialog.accept());
  await card.getByRole("button", { name: "Delete" }).click();
  await expect(page.locator('[data-aaw-test="page-memory-list"]')).toContainText("No saved notes on this page.");
  await expect(page.locator('[data-aaw-test="memory-status"]')).toContainText("Note deleted.");
});

test("lead drafts use draft-card class, renamed checkbox copy, and a per-draft save guard", async () => {
  const page = await openFixtureWithPanel(extension, fixtures, "lead");

  await expect(page.locator('[data-aaw-test="lead-capture"]')).toBeVisible();
  await expect(page.locator('.aaw-section--leads .aaw-checkbox-row')).toContainText("Create linked memory on save");

  await page.locator('[data-aaw-test="lead-capture"]').click();
  await expect(page.locator('[data-aaw-test="lead-status"]')).toContainText(/lead draft/i);
  const draftCard = page.locator('[data-aaw-test="lead-drafts"] .aaw-lead-draft-card').first();
  await expect(draftCard).toBeVisible();
  await expect(draftCard).toHaveAttribute("data-aaw-test", "lead-draft-card");

  const saveLead = draftCard.locator('[data-aaw-test="lead-save"]');
  await saveLead.click();
  await expect(page.locator('[data-aaw-test="lead-status"]')).toContainText(/Saved lead|Saving lead/);
});

test("lead drafts can be deleted per-draft and report deletion in status", async () => {
  const page = await openFixtureWithPanel(extension, fixtures, "lead");

  await page.locator('[data-aaw-test="lead-capture"]').click();
  await expect(page.locator('[data-aaw-test="lead-status"]')).toContainText(/lead draft/i);

  const draftCards = page.locator('[data-aaw-test="lead-drafts"] .aaw-lead-draft-card');
  await expect(draftCards.first()).toBeVisible();

  // Delete every draft so the list empties regardless of how many were extracted.
  let remaining = await draftCards.count();
  while (remaining > 0) {
    await draftCards.first().locator('[data-aaw-test="lead-delete"]').click();
    remaining -= 1;
    await expect(draftCards).toHaveCount(remaining);
  }

  await expect(page.locator('[data-aaw-test="lead-status"]')).toContainText("Lead draft deleted.");
  await expect(page.locator('[data-aaw-test="lead-drafts"] .aaw-empty-note')).toBeVisible();
});

test("tasks sync filter aria-pressed, group card controls, and confirm-guard delete", async () => {
  const page = await openFixtureWithPanel(extension, fixtures, "task");

  // Tasks ships collapsed; expand it before exercising the task fields.
  await expect(page.locator('[data-aaw-test="task-section-toggle"]')).toHaveAttribute("aria-expanded", "false");
  await expandTasks(page);

  // Create a task so the list has a card to exercise.
  await page.locator('[data-aaw-test="task-title"]').fill("Polish task card controls");
  await page.locator('[data-aaw-test="task-create"]').click();
  await expect(page.locator('[data-aaw-test="task-status"]')).toContainText(/Task created|Task already exists/);
  const card = page.locator('[data-aaw-test="task-list"] .aaw-task-card').first();
  await expect(card).toContainText("Polish task card controls");

  // Filter tabs keep aria-pressed synced with .is-active.
  const tabs = page.locator('.aaw-task-tabs .aaw-btn');
  const openTab = tabs.filter({ hasText: "Open" }).first();
  const allTab = tabs.filter({ hasText: "All" }).first();
  await expect(openTab).toHaveAttribute("aria-pressed", "true");
  await expect(allTab).toHaveAttribute("aria-pressed", "false");
  await allTab.click();
  await expect(allTab).toHaveAttribute("aria-pressed", "true");
  await expect(allTab).toHaveClass(/is-active/);
  await expect(openTab).toHaveAttribute("aria-pressed", "false");

  // Controls render in the expected grouped clusters. Status/priority are now
  // custom dropdowns (no native selects remain in the task surface).
  const cardNow = page.locator('[data-aaw-test="task-list"] .aaw-task-card').first();
  await expect(cardNow.locator('.aaw-task-control-group--meta .aaw-dropdown')).toHaveCount(2);
  await expect(cardNow.locator('.aaw-task-control-group--meta input[type="date"]')).toHaveCount(1);
  await expect(page.locator('.aaw-section--tasks select')).toHaveCount(0);
  await expect(cardNow.locator('.aaw-task-control-group--primary')).toContainText(/Mark Done|Reopen/);
  await expect(cardNow.locator('.aaw-task-control-group--context')).toContainText("View Context");
  await expect(cardNow.locator('.aaw-task-control-group--danger [data-aaw-test="task-delete"]')).toBeVisible();

  // After updating a control, focus returns to that same control on the
  // re-rendered card rather than jumping to the first focusable element.
  await cardNow.locator('[data-aaw-control="priority"]').click();
  await cardNow.locator('.aaw-dropdown--open').getByRole("option", { name: "High", exact: true }).click();
  await expect(page.locator('[data-aaw-test="task-status"]')).toContainText("Task updated.");
  await expect(page.locator('[data-aaw-test="task-list"] .aaw-task-card').first()
    .locator('[data-aaw-control="priority"]')).toBeFocused();

  // Cancelling the native confirm keeps the task in place.
  const beforeCount = await page.locator('[data-aaw-test="task-list"] .aaw-task-card').count();
  page.once("dialog", (dialog) => dialog.dismiss());
  await cardNow.locator('[data-aaw-test="task-delete"]').click();
  await expect(page.locator('[data-aaw-test="task-list"] .aaw-task-card')).toHaveCount(beforeCount);

  // Confirming deletes it.
  page.once("dialog", (dialog) => dialog.accept());
  await cardNow.locator('[data-aaw-test="task-delete"]').click();
  await expect(page.locator('[data-aaw-test="task-status"]')).toContainText("Task deleted.");
});

test("options page light theme tokenizes dark surfaces and keeps borders visible", async () => {
  await chromeStorage(extension.worker, "set", { appearanceSettings: { mode: "light" } });
  try {
    const page = await openOptionsPage(extension, "#duplicates");
    await expect(page.locator(":root")).toHaveAttribute("data-aaw-theme", "light");

    const pageBg = (await readStyles(page.locator("body"), ["background-color"]))["background-color"];

    // Surfaces that hard-coded dark fills (or invisible translucent-white
    // borders) must now read as light surfaces with a visible border.
    const surfaces = {
      section: page.locator(".opt-section").first(),
      folderRow: page.locator(".opt-folder-row").first(),
      log: page.locator("#log"),
      dedupeList: page.locator("#dedupe-candidates")
    };
    for (const [name, locator] of Object.entries(surfaces)) {
      const styles = await readStyles(locator, ["background-color", "border-top-color"]);
      const lum = luminance(parseColor(styles["background-color"]));
      expect(lum, `${name} background should read as a light surface`).toBeGreaterThan(0.5);
      expect(
        borderVisible(styles["border-top-color"], styles["background-color"], pageBg),
        `${name} border should be visible against its surface and the page`
      ).toBe(true);
    }

    // A newly-tokenized surface must repaint live on Dark -> Light, no reload.
    const dark = page.locator("label.opt-radio", { hasText: "Dark" });
    const light = page.locator("label.opt-radio", { hasText: "Light" });
    const log = surfaces.log;

    await dark.click();
    await expect(page.locator(":root")).toHaveAttribute("data-aaw-theme", "dark");
    const darkLogBg = (await readStyles(log, ["background-color"]))["background-color"];
    expect(luminance(parseColor(darkLogBg))).toBeLessThan(0.2);

    await light.click();
    await expect(page.locator(":root")).toHaveAttribute("data-aaw-theme", "light");
    const lightLogBg = (await readStyles(log, ["background-color"]))["background-color"];
    expect(luminance(parseColor(lightLogBg))).toBeGreaterThan(0.5);
    expect(lightLogBg).not.toBe(darkLogBg);

    await page.close();
  } finally {
    // Don't leak light theme into the shared extension harness.
    await chromeStorage(extension.worker, "set", { appearanceSettings: { mode: "dark" } });
  }
});

test("panel light theme keeps result, command palette, and highlight readable", async () => {
  await chromeStorage(extension.worker, "set", { appearanceSettings: { mode: "light" } });
  try {
    const page = await openFixtureWithPanel(extension, fixtures, "article");
    const panel = page.locator('[data-aaw-test="panel"]');
    await expect(panel).toHaveAttribute("data-aaw-theme", "light");

    // Result surface: was a hard-coded dark fill; must now contrast its text.
    await page.locator('[data-aaw-test="cmd-summarize"]').click();
    await expect(page.locator('[data-aaw-test="result-chip"]')).toHaveText(/Done|Local/);
    const result = page.locator('[data-aaw-test="result-output"]');
    const resultStyles = await readStyles(result, ["background-color", "color"]);
    expect(luminance(parseColor(resultStyles["background-color"]))).toBeGreaterThan(0.5);
    expect(
      contrastRatio(parseColor(resultStyles.color), parseColor(resultStyles["background-color"]))
    ).toBeGreaterThanOrEqual(4.5);

    // Highlight state: save a note then search so matched terms wrap in
    // .aaw-highlight, then assert the mark text contrasts its tinted fill.
    await page.locator('[data-aaw-test="memory-note-input"]').fill("Research note for browser QA automation.");
    await page.locator('[data-aaw-test="save-memory"]').click();
    await expect(page.locator('[data-aaw-test="memory-status"]')).toContainText(/Saved:/);
    await page.locator('[data-aaw-test="search-input"]').fill("browser QA automation");
    await page.locator('[data-aaw-test="search-input"]').press("Enter");
    const highlight = page.locator(".aaw-highlight").first();
    await expect(highlight).toBeVisible();
    const highlightStyles = await highlight.evaluate((el) => {
      const cs = getComputedStyle(el);
      const card = el.closest(".aaw-memory-result") || el.parentElement;
      return {
        color: cs.color,
        background: cs.backgroundColor,
        cardBackground: getComputedStyle(card).backgroundColor
      };
    });
    const highlightBg = flatten(parseColor(highlightStyles.background), parseColor(highlightStyles.cardBackground));
    expect(contrastRatio(parseColor(highlightStyles.color), highlightBg)).toBeGreaterThanOrEqual(4.5);

    // Command palette is not in the DOM until opened — open it via the existing
    // message handler before reading its styles.
    await sendToActiveTab(extension.worker, { type: "AAW_OPEN_COMMAND_PALETTE" });
    const palette = page.locator('[data-aaw-test="command-palette"]');
    await expect(palette).toBeVisible();
    const paletteBg = (await readStyles(palette, ["background-color"]))["background-color"];
    expect(luminance(parseColor(paletteBg))).toBeGreaterThan(0.5);

    const label = page.locator(".aaw-command-palette__label").first();
    await expect(label).toBeVisible();
    const labelColor = (await readStyles(label, ["color"])).color;
    // The label paints over the palette surface; require body-text contrast.
    expect(contrastRatio(parseColor(labelColor), parseColor(paletteBg))).toBeGreaterThanOrEqual(4.5);

    await page.close();
  } finally {
    await chromeStorage(extension.worker, "set", { appearanceSettings: { mode: "dark" } });
  }
});

test("notes folder settings render a read-only export preview", async () => {
  await chromeStorage(extension.worker, "set", {
    memory: [{
      id: "mem_preview_ui",
      title: "Preview UI note",
      sourceUrl: "https://example.com/preview-ui",
      note: "Preview smoke note",
      workspaceIds: ["nw_preview"],
      taskIds: ["nw_preview"]
    }],
    noteWorkspaces: [{ id: "nw_preview", name: "Preview Workspace", status: "open" }],
    actions: { tasks: [], tableRows: [], contacts: [], drafts: [] },
    notesMirrorConfig: { includeContacts: false, includeTasks: false }
  });
  const page = await openOptionsPage(extension, "#notes");

  await page.locator('[data-aaw-test="mirror-preview-run"]').click();

  // Counts summarize the plan; the generated files list is populated.
  await expect(page.locator('[data-aaw-test="mirror-preview-counts"]')).toContainText("Notes");
  await expect(page.locator('[data-aaw-test="mirror-preview-files"]')).toContainText("mem_preview_ui.json");
  await expect(page.locator('[data-aaw-test="mirror-preview-files"]')).toContainText("aaw_mirror_manifest.json");

  // Selecting a file reveals its kind/summary plus pretty JSON.
  await page.locator('[data-aaw-test="mirror-preview-files"] .opt-preview-file', { hasText: "mem_preview_ui.json" }).click();
  await expect(page.locator('[data-aaw-test="mirror-preview-detail"]')).toContainText("memory");
  await expect(page.locator('[data-aaw-test="mirror-preview-json"]')).toContainText("Preview UI note");

  // Searching filters the generated paths down.
  await page.locator('[data-aaw-test="mirror-preview-search"]').fill("manifest");
  await expect(page.locator('[data-aaw-test="mirror-preview-files"]')).toContainText("aaw_mirror_manifest.json");
  await expect(page.locator('[data-aaw-test="mirror-preview-files"]')).not.toContainText("mem_preview_ui.json");

  // No folder is connected in this context, so deletion preview is unavailable.
  await expect(page.locator('[data-aaw-test="mirror-preview-deletions"]')).toContainText(/folder|access|one-way sync/i);

  await page.close();
});

test("panel orders Workspaces before Tasks and flags Tasks as a dev feature", async () => {
  const page = await openFixtureWithPanel(extension, fixtures, "task");

  // Workspaces section appears before Tasks in the main view DOM order.
  const order = await page.evaluate(() => {
    const main = document.querySelector(".aaw-view--main");
    const workspaces = main.querySelector(".aaw-section--workspaces");
    const tasks = main.querySelector(".aaw-section--tasks");
    // DOCUMENT_POSITION_FOLLOWING (4) => tasks comes after workspaces.
    return Boolean(workspaces.compareDocumentPosition(tasks) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(order).toBe(true);

  // Tasks keeps its title and dev badge visible even while collapsed by default.
  const badge = page.locator('[data-aaw-test="task-dev-badge"]');
  await expect(badge).toBeVisible();
  await expect(badge).toContainText(/dev/i);
  await expect(page.locator('.aaw-section--tasks .aaw-section-subtitle')).toContainText(/experimental|developer/i);

  // Task creation still works with the existing controls once expanded.
  await expandTasks(page);
  await page.locator('[data-aaw-test="task-title"]').fill("Dev badge smoke task");
  await page.locator('[data-aaw-test="task-create"]').click();
  await expect(page.locator('[data-aaw-test="task-status"]')).toContainText(/Task created|Task already exists/);
  await expect(page.locator('[data-aaw-test="task-list"]')).toContainText("Dev badge smoke task");

  await page.close();
});

// --- Injected panel height cap -----------------------------------------------
// The desktop panel caps at min(720px, calc(100dvh - 24px)); a <=390px viewport
// switches to the mobile override of calc(100dvh - 16px) with no 720px cap.
// These specs assert the cap from resolved layout (computed max-height plus box
// metrics) rather than from the stylesheet text. The harness shares one
// persistent context, so each test opens its own page, drives that page's
// viewport, and closes it — which leaves the launch-default 1440x1200 viewport
// in place for every other spec.

// Resolve the panel's computed max-height alongside box/scroll metrics. With
// box-sizing: border-box, offsetHeight equals the resolved max-height once the
// content overflows, and scrollHeight > clientHeight proves it scrolls inside.
async function readPanelMetrics(page) {
  return page.locator('[data-aaw-test="panel"]').evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      maxHeight: cs.maxHeight,
      offsetHeight: el.offsetHeight,
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight
    };
  });
}

test("injected panel caps near 720px and scrolls internally on a tall desktop viewport", async () => {
  const page = await openFixtureWithPanel(extension, fixtures, "article");
  try {
    await page.setViewportSize({ width: 1440, height: 1200 });
    const m = await readPanelMetrics(page);

    // calc(100dvh - 24px) = 1176px, so the 720px cap is the binding limit.
    expect(m.maxHeight).toBe("720px");
    expect(m.offsetHeight).toBeLessThanOrEqual(720);
    expect(m.offsetHeight).toBeGreaterThan(600);
    // Content exceeds the cap, so the panel scrolls internally instead of growing.
    expect(m.scrollHeight).toBeGreaterThan(m.clientHeight);
  } finally {
    await page.close();
  }
});

test("injected panel follows the 24px viewport gutter, not the 720px cap, when the viewport is short", async () => {
  const page = await openFixtureWithPanel(extension, fixtures, "article");
  try {
    const viewport = { width: 1440, height: 500 };
    await page.setViewportSize(viewport);
    const m = await readPanelMetrics(page);

    // calc(100dvh - 24px) = 476px < 720px, so the viewport gutter wins over the cap.
    const expected = viewport.height - 24;
    expect(m.maxHeight).toBe(`${expected}px`);
    expect(Math.abs(m.offsetHeight - expected)).toBeLessThanOrEqual(2);
    expect(m.offsetHeight).toBeLessThan(720);
    expect(m.scrollHeight).toBeGreaterThan(m.clientHeight);
  } finally {
    await page.close();
  }
});

test("injected panel ignores the 720px cap and keeps the 16px mobile gutter at a narrow viewport", async () => {
  const page = await openFixtureWithPanel(extension, fixtures, "article");
  try {
    const viewport = { width: 380, height: 900 };
    await page.setViewportSize(viewport);
    const m = await readPanelMetrics(page);

    // <=390px hits the mobile override: calc(100dvh - 16px) with no 720px cap.
    const expected = viewport.height - 16;
    expect(m.maxHeight).toBe(`${expected}px`);
    expect(m.offsetHeight).toBeGreaterThan(720);
    expect(Math.abs(m.offsetHeight - expected)).toBeLessThanOrEqual(2);
    expect(m.scrollHeight).toBeGreaterThan(m.clientHeight);
  } finally {
    await page.close();
  }
});

test("dark theme keeps result, log, and command palette as dark surfaces", async () => {
  await chromeStorage(extension.worker, "set", { appearanceSettings: { mode: "dark" } });

  const optionsPage = await openOptionsPage(extension, "#duplicates");
  await expect(optionsPage.locator(":root")).toHaveAttribute("data-aaw-theme", "dark");
  for (const locator of [optionsPage.locator("#log"), optionsPage.locator("#dedupe-candidates")]) {
    const bg = (await readStyles(locator, ["background-color"]))["background-color"];
    expect(luminance(parseColor(bg))).toBeLessThan(0.2);
  }
  await optionsPage.close();

  const page = await openFixtureWithPanel(extension, fixtures, "article");
  await expect(page.locator('[data-aaw-test="panel"]')).toHaveAttribute("data-aaw-theme", "dark");

  await page.locator('[data-aaw-test="cmd-summarize"]').click();
  await expect(page.locator('[data-aaw-test="result-chip"]')).toHaveText(/Done|Local/);
  const resultBg = (await readStyles(page.locator('[data-aaw-test="result-output"]'), ["background-color"]))["background-color"];
  expect(luminance(parseColor(resultBg))).toBeLessThan(0.2);

  await sendToActiveTab(extension.worker, { type: "AAW_OPEN_COMMAND_PALETTE" });
  const palette = page.locator('[data-aaw-test="command-palette"]');
  await expect(palette).toBeVisible();
  const paletteBg = (await readStyles(palette, ["background-color"]))["background-color"];
  expect(luminance(parseColor(paletteBg))).toBeLessThan(0.2);
});
