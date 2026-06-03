"use strict";

// Pure, dependency-free helpers for the e2e harness. Kept separate from
// extension-harness.js (which imports Playwright) so they can be unit-tested
// with `node --test` without requiring Playwright to be installed.

const EXTENSION_ID_RE = /^[a-p]{32}$/;

// MV3 exposes the service worker as chrome-extension://<id>/background.js.
// Discover the extension ID from that URL.
function parseExtensionId(serviceWorkerUrl) {
  if (typeof serviceWorkerUrl !== "string") return "";
  const match = serviceWorkerUrl.match(/^chrome-extension:\/\/([a-p]{32})\//);
  return match ? match[1] : "";
}

function isExtensionServiceWorker(url) {
  if (typeof url !== "string") return false;
  return /^chrome-extension:\/\/[a-p]{32}\/.*background\.js/.test(url);
}

function isValidExtensionId(id) {
  return typeof id === "string" && EXTENSION_ID_RE.test(id);
}

// Build a fixture page URL from the local fixture server base + a fixture name.
// Accepts "article" or "article.html"; rejects path traversal.
function fixtureUrl(baseUrl, name) {
  if (typeof baseUrl !== "string" || !baseUrl) throw new Error("baseUrl is required");
  if (typeof name !== "string" || !name) throw new Error("fixture name is required");
  if (name.includes("..") || name.includes("/") || name.includes("\\")) {
    throw new Error(`Unsafe fixture name: ${name}`);
  }
  const file = name.endsWith(".html") ? name : `${name}.html`;
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${base}/${file}`;
}

module.exports = {
  parseExtensionId,
  isExtensionServiceWorker,
  isValidExtensionId,
  fixtureUrl
};
