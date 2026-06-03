"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const shortcuts = require("../chrome-extension/shortcut-utils.js");

function event(key, options = {}) {
  return {
    key,
    ctrlKey: Boolean(options.ctrlKey),
    metaKey: Boolean(options.metaKey),
    altKey: Boolean(options.altKey),
    shiftKey: Boolean(options.shiftKey),
    target: options.target || null,
    defaultPrevented: Boolean(options.defaultPrevented)
  };
}

test("shortcut normalization canonicalizes modifiers and mod keys", () => {
  assert.deepEqual(shortcuts.normalizeShortcut("Shift+Ctrl+k"), {
    key: "K",
    modifiers: ["Ctrl", "Shift"],
    id: "Ctrl+Shift+K",
    label: "Ctrl+Shift+K"
  });
  assert.equal(shortcuts.normalizeShortcut("Ctrl/Cmd+K").id, "Mod+K");
  assert.equal(shortcuts.normalizeShortcut("g a").id, "G A");
});

test("shortcut matching supports modifier aliases and punctuation", () => {
  assert.equal(shortcuts.matchShortcut(event("k", { ctrlKey: true }), "Ctrl+K"), true);
  assert.equal(shortcuts.matchShortcut(event("k", { metaKey: true }), "Mod+K"), true);
  assert.equal(shortcuts.matchShortcut(event("?", { shiftKey: true }), "?"), true);
  assert.equal(shortcuts.matchShortcut(event("/", { shiftKey: true }), "?"), true);
  assert.equal(shortcuts.matchShortcut(event("k", { ctrlKey: true, altKey: true }), "Ctrl+K"), false);
});

test("editable shortcut target detection covers form fields and editors", () => {
  const input = { nodeType: 1, matches: (selector) => selector.includes("input"), getAttribute: () => "text", closest: () => null };
  const buttonInput = { nodeType: 1, matches: (selector) => selector.includes("input"), getAttribute: () => "checkbox", closest: () => null };
  const contentEditable = { nodeType: 1, isContentEditable: true };
  const proseMirrorChild = { nodeType: 1, closest: (selector) => selector.includes(".ProseMirror") ? {} : null };

  assert.equal(shortcuts.isEditableShortcutTarget(input), true);
  assert.equal(shortcuts.isEditableShortcutTarget(buttonInput), false);
  assert.equal(shortcuts.isEditableShortcutTarget(contentEditable), true);
  assert.equal(shortcuts.isEditableShortcutTarget(proseMirrorChild), true);
});

test("panel shortcut rules ignore hidden panels, outside targets, and editable targets", () => {
  const panelRoot = {
    classList: { contains: (name) => name === "aaw-hidden" },
    contains: () => true
  };
  assert.equal(shortcuts.shouldHandlePanelShortcut({ event: event("1"), panelRoot }), false);
  assert.equal(shortcuts.shouldHandlePanelShortcut({ event: event("1"), panelRoot, allowWhenHidden: true }), true);

  const visiblePanel = {
    classList: { contains: () => false },
    contains: (target) => target && target.inside
  };
  assert.equal(shortcuts.shouldHandlePanelShortcut({ event: event("1", { target: { inside: false } }), panelRoot: visiblePanel }), false);
  assert.equal(shortcuts.shouldHandlePanelShortcut({ event: event("1", { target: { inside: true } }), panelRoot: visiblePanel }), true);
  assert.equal(shortcuts.shouldHandlePanelShortcut({
    event: event("1", { target: { inside: true, nodeType: 1, matches: (selector) => selector.includes("input"), getAttribute: () => "text", closest: () => null } }),
    panelRoot: visiblePanel
  }), false);
});

test("sequence buffer matches two-key shortcuts and times out", () => {
  let now = 1000;
  const buffer = shortcuts.createSequenceBuffer({ timeoutMs: 500, now: () => now });

  assert.deepEqual(buffer.push("g"), ["g"]);
  assert.deepEqual(buffer.push("a", 1200), ["g", "a"]);
  assert.equal(buffer.match(["g a"], 1200).id, "G A");
  buffer.reset();
  assert.deepEqual(buffer.push("g", 2000), ["g"]);
  assert.deepEqual(buffer.push("m", 2601), ["m"]);
  assert.equal(buffer.match(["g m"], 2601), null);
});

test("disabled commands do not match shortcuts", () => {
  assert.equal(shortcuts.commandMatchesShortcut({ shortcut: "1", disabled: true }, event("1")), false);
  assert.equal(shortcuts.commandMatchesShortcut({ shortcut: "1" }, event("1")), true);
});
