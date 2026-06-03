"use strict";

// Regression guard for the "Identifier ... has already been declared" SyntaxError
// reported when a content-script helper is injected by the manifest AND then
// re-injected by background.js via chrome.scripting.executeScript into the same
// isolated world. Chrome accumulates top-level lexical (const/let) bindings
// across injections into one execution context, so a second run of a file with
// top-level declarations throws. The fix wraps each helper in an IIFE.
//
// We reproduce the duplicate-declaration condition deterministically by
// evaluating the file source twice within a single program string in a fresh
// vm context. Top-level `const` would make this throw at compile time; an IIFE
// re-runs cleanly. The helper attaches its API to `globalScope` (globalThis in
// a bare vm context), which we assert survives the second injection.

const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

function injectTwice(relPath) {
  const file = path.join(__dirname, "..", "chrome-extension", relPath);
  const source = fs.readFileSync(file, "utf8");
  // Two back-to-back evaluations in one program = same lexical scope, the way
  // Chrome treats repeated injection into a single isolated world.
  const doubled = `${source}\n;${source}`;
  const context = vm.createContext({});
  vm.runInContext(doubled, context, { filename: relPath });
  return context;
}

test("privacy-utils.js can be injected twice without a duplicate-declaration SyntaxError", () => {
  let context;
  assert.doesNotThrow(() => { context = injectTwice("privacy-utils.js"); });
  assert.ok(context.AssistantPrivacy, "AssistantPrivacy should be exposed on the global scope");
  assert.equal(context.AssistantPrivacy.PRIVACY_SCHEMA_VERSION, 1);
  assert.equal(typeof context.AssistantPrivacy.normalizePrivacySettings, "function");
});

test("selection-replacement.js can be injected twice without a duplicate-declaration SyntaxError", () => {
  let context;
  assert.doesNotThrow(() => { context = injectTwice("selection-replacement.js"); });
  assert.ok(context.AssistantSelectionReplacement, "AssistantSelectionReplacement should be exposed on the global scope");
  assert.equal(typeof context.AssistantSelectionReplacement.applyReplacement, "function");
});
