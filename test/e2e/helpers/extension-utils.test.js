"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  parseExtensionId,
  isExtensionServiceWorker,
  isValidExtensionId,
  fixtureUrl
} = require("./extension-utils");

const SAMPLE_ID = "abcdefghijklmnopabcdefghijklmnop"; // 32 chars, a-p only

test("parseExtensionId extracts the id from a service worker URL", () => {
  assert.equal(parseExtensionId(`chrome-extension://${SAMPLE_ID}/background.js`), SAMPLE_ID);
  assert.equal(parseExtensionId(`chrome-extension://${SAMPLE_ID}/content.js`), SAMPLE_ID);
});

test("parseExtensionId returns empty string for non-extension URLs", () => {
  assert.equal(parseExtensionId("https://example.com/background.js"), "");
  assert.equal(parseExtensionId(""), "");
  assert.equal(parseExtensionId(null), "");
  assert.equal(parseExtensionId(undefined), "");
});

test("isExtensionServiceWorker recognizes the MV3 background worker", () => {
  assert.equal(isExtensionServiceWorker(`chrome-extension://${SAMPLE_ID}/background.js`), true);
  assert.equal(isExtensionServiceWorker(`chrome-extension://${SAMPLE_ID}/content.js`), false);
  assert.equal(isExtensionServiceWorker("https://example.com/sw.js"), false);
});

test("isValidExtensionId enforces the 32-char a-p alphabet", () => {
  assert.equal(isValidExtensionId(SAMPLE_ID), true);
  assert.equal(isValidExtensionId("tooshort"), false);
  assert.equal(isValidExtensionId("ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP"), false); // uppercase
  assert.equal(isValidExtensionId(`${SAMPLE_ID}q`), false); // 'q' out of a-p range + too long
});

test("fixtureUrl appends .html and joins cleanly", () => {
  assert.equal(fixtureUrl("http://127.0.0.1:5000", "article"), "http://127.0.0.1:5000/article.html");
  assert.equal(fixtureUrl("http://127.0.0.1:5000/", "article.html"), "http://127.0.0.1:5000/article.html");
});

test("fixtureUrl rejects unsafe names and missing args", () => {
  assert.throws(() => fixtureUrl("http://x", "../secret"), /Unsafe fixture name/);
  assert.throws(() => fixtureUrl("http://x", "a/b"), /Unsafe fixture name/);
  assert.throws(() => fixtureUrl("", "article"), /baseUrl is required/);
  assert.throws(() => fixtureUrl("http://x", ""), /fixture name is required/);
});
