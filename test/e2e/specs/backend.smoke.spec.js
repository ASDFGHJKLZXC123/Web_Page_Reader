"use strict";

const { test, expect } = require("@playwright/test");
const { startBackend } = require("../../helpers/backend-harness");
const {
  attachFailurePageHtml,
  chromeStorage,
  launchExtension,
  openFixtureWithPanel,
  sendToActiveTab,
  withFixtureServer
} = require("../helpers/extension-harness");

let backend;
let fixtures;
let extension;

test.beforeAll(async () => {
  backend = await startBackend({ transport: "tcp" });
  fixtures = await withFixtureServer();
  extension = await launchExtension({ backendUrl: backend.baseUrl });
});

test.afterAll(async () => {
  if (extension) await extension.close();
  if (fixtures) await fixtures.close();
  if (backend) await backend.close();
});

test.afterEach(async ({}, testInfo) => {
  await attachFailurePageHtml(testInfo);
});

test("remote backend mode runs current core workflows without provider keys", async () => {
  const page = await openFixtureWithPanel(extension, fixtures, "extraction");

  await page.locator('[data-aaw-test="cmd-extract"]').click();
  await expect(page.locator('[data-aaw-test="result-chip"]')).toHaveText("Done");
  await expect(page.locator('[data-aaw-test="result-output"]')).toContainText("ada.rivera@example.com");
  await expect(page.locator('[data-aaw-test="result-output"]')).toContainText("2026-06-12");

  await page.locator('[data-aaw-test="memory-note-input"]').fill("Backend mode launch report note.");
  await page.locator('[data-aaw-test="save-memory"]').click();
  await expect(page.locator('[data-aaw-test="memory-status"]')).toContainText(/Saved:/);
  await page.locator('[data-aaw-test="page-graph"]').click();
  await expect(page.locator('[data-aaw-test="context-drawer"]')).toContainText(/nodes, .*links/);
  await expect(page.locator('[data-aaw-test="context-drawer"]')).toContainText("Launch Report");

  await page.locator('[data-aaw-test="search-input"]').fill("launch report");
  await page.locator('[data-aaw-test="search-input"]').press("Enter");
  await expect(page.locator('[data-aaw-test="search-status"]')).toContainText(/result/i);
  await expect(page.locator('[data-aaw-test="search-results"]')).toContainText("Backend mode launch report note");
});

test("remote backend mode sanitizes page URLs before memory save", async () => {
  await chromeStorage(extension.worker, "set", {
    privacySettings: {
      aiMode: "auto",
      redaction: { enabled: false, sendFullUrlToProvider: false }
    }
  });
  const page = await extension.context.newPage();
  await page.goto(`${fixtures.baseUrl}/article.html?secret=1#private`, { waitUntil: "domcontentloaded" });
  await page.bringToFront();
  await sendToActiveTab(extension.worker, { type: "TOGGLE_ASSISTANT" });
  await expect(page.locator('[data-aaw-test="panel"]')).toBeVisible();

  await page.locator('[data-aaw-test="memory-note-input"]').fill("Sanitized URL memory note.");
  await page.locator('[data-aaw-test="save-memory"]').click();
  await expect(page.locator('[data-aaw-test="memory-status"]')).toContainText(/Saved:/);

  const list = await backend.request("GET", "/api/memory/list?limit=50&offset=0");
  const saved = list.json.items.find((item) => item.note === "Sanitized URL memory note.");
  expect(saved).toBeTruthy();
  expect(saved.sourceUrl).not.toContain("secret=1");
  expect(saved.sourceUrl).not.toContain("#private");
});

test("remote backend mode local-only AI bypasses backend provenance", async () => {
  const before = await backend.request("GET", "/api/privacy/provenance");
  const memoryBefore = await backend.request("GET", "/api/memory/list");
  await chromeStorage(extension.worker, "set", {
    privacySettings: {
      aiMode: "local_only",
      redaction: { enabled: true }
    }
  });
  const page = await openFixtureWithPanel(extension, fixtures, "article");

  await page.locator('[data-aaw-test="cmd-summarize"]').click();
  await expect(page.locator('[data-aaw-test="result-chip"]')).toHaveText("Local");
  await expect(page.locator('[data-aaw-test="result-provenance"]')).toContainText("Local only");

  await page.locator('[data-aaw-test="memory-note-input"]').fill("Local-only memory must not reach the remote backend.");
  await page.locator('[data-aaw-test="save-memory"]').click();
  await expect(page.locator('[data-aaw-test="memory-status"]')).toContainText(/Saved:/);

  const after = await backend.request("GET", "/api/privacy/provenance");
  const memoryAfter = await backend.request("GET", "/api/memory/list");
  expect(after.json.total).toBe(before.json.total);
  expect(memoryAfter.json.total).toBe(memoryBefore.json.total);
});
