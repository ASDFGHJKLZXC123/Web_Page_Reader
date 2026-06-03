"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium, expect } = require("@playwright/test");

const {
  isExtensionServiceWorker,
  parseExtensionId,
  fixtureUrl
} = require("./extension-utils");
const { startFixtureServer } = require("./fixture-server");

const PROJECT_ROOT = path.resolve(__dirname, "../../..");
const EXTENSION_DIR = path.join(PROJECT_ROOT, "chrome-extension");
const FIXTURE_DIR = path.join(__dirname, "../fixtures");
const trackedPages = new Set();

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function e2eHeadless() {
  if (process.env.AAW_E2E_HEADLESS === "1") return true;
  return false;
}

async function findExtensionWorker(context, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const existing = context.serviceWorkers().find((worker) => isExtensionServiceWorker(worker.url()));
    if (existing) return existing;
    try {
      const worker = await context.waitForEvent("serviceworker", { timeout: 1_000 });
      if (isExtensionServiceWorker(worker.url())) return worker;
    } catch {
      await wait(250);
    }
  }
  throw new Error("Timed out waiting for MV3 extension service worker");
}

async function chromeStorage(worker, operation, payload) {
  return worker.evaluate(({ operation: op, payload: data }) => new Promise((resolve, reject) => {
    try {
      if (op === "clear") {
        chrome.storage.local.clear(() => {
          const err = chrome.runtime.lastError;
          err ? reject(new Error(err.message)) : resolve(null);
        });
        return;
      }
      if (op === "set") {
        chrome.storage.local.set(data || {}, () => {
          const err = chrome.runtime.lastError;
          err ? reject(new Error(err.message)) : resolve(null);
        });
        return;
      }
      if (op === "get") {
        chrome.storage.local.get(data || null, (result) => {
          const err = chrome.runtime.lastError;
          err ? reject(new Error(err.message)) : resolve(result);
        });
        return;
      }
      reject(new Error(`Unsupported storage operation: ${op}`));
    } catch (error) {
      reject(error);
    }
  }), { operation, payload });
}

async function sendToActiveTab(worker, message) {
  return worker.evaluate((msg) => new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      const tab = tabs && tabs[0];
      if (!tab || !tab.id) {
        reject(new Error("No active tab found"));
        return;
      }
      chrome.tabs.sendMessage(tab.id, msg, (response) => {
        const sendErr = chrome.runtime.lastError;
        if (sendErr) {
          if (/message port closed/i.test(sendErr.message || "")) {
            resolve(null);
            return;
          }
          reject(new Error(sendErr.message));
          return;
        }
        resolve(response || null);
      });
    });
  }), message);
}

async function launchExtension({ backendUrl = "" } = {}) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aaw-e2e-profile-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: e2eHeadless(),
    viewport: { width: 1440, height: 1200 },
    args: [
      `--disable-extensions-except=${EXTENSION_DIR}`,
      `--load-extension=${EXTENSION_DIR}`,
      "--disable-features=DialMediaRouteProvider"
    ]
  });

  const worker = await findExtensionWorker(context);
  const extensionId = parseExtensionId(worker.url());
  await chromeStorage(worker, "clear");
  if (backendUrl) {
    await chromeStorage(worker, "set", { assistantBackendUrl: backendUrl });
  }

  async function close() {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }

  return { context, worker, extensionId, close };
}

async function openFixtureWithPanel(harness, fixtureServer, name) {
  const page = await harness.context.newPage();
  trackedPages.add(page);
  page.on("close", () => trackedPages.delete(page));
  await page.goto(fixtureUrl(fixtureServer.baseUrl, name), { waitUntil: "domcontentloaded" });
  await page.bringToFront();
  await sendToActiveTab(harness.worker, { type: "TOGGLE_ASSISTANT" });
  const panel = page.locator('[data-aaw-test="panel"]');
  await expect(panel).toBeVisible();
  return page;
}

async function withFixtureServer() {
  return startFixtureServer(FIXTURE_DIR);
}

async function attachFailurePageHtml(testInfo) {
  if (!testInfo || testInfo.status === testInfo.expectedStatus) return;
  let index = 0;
  for (const page of [...trackedPages]) {
    if (page.isClosed()) continue;
    try {
      const html = `<!-- ${page.url()} -->\n${await page.content()}`;
      await testInfo.attach(`page-html-${++index}`, {
        body: Buffer.from(html, "utf8"),
        contentType: "text/html"
      });
    } catch {
      /* best-effort failure artifact */
    }
  }
}

module.exports = {
  launchExtension,
  openFixtureWithPanel,
  withFixtureServer,
  attachFailurePageHtml,
  chromeStorage,
  sendToActiveTab,
  EXTENSION_DIR,
  FIXTURE_DIR
};
