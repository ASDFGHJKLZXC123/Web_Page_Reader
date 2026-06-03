"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  applyReplacement,
  preserveReplacementWhitespace,
  snapshotFormControlSelection,
  validateEditableRoot
} = require("../chrome-extension/selection-replacement");

test("preserveReplacementWhitespace keeps surrounding selection whitespace", () => {
  assert.equal(preserveReplacementWhitespace("  rough text\n", "Clean text"), "  Clean text\n");
});

test("textarea replacement updates value and supports undo", () => {
  const events = [];
  const element = {
    tagName: "TEXTAREA",
    value: "hello rough world",
    selectionStart: 6,
    selectionEnd: 11,
    disabled: false,
    readOnly: false,
    setRangeText(text, start, end) {
      this.value = this.value.slice(0, start) + text + this.value.slice(end);
      this.selectionStart = this.selectionEnd = start + text.length;
    },
    setSelectionRange(start, end) {
      this.selectionStart = start;
      this.selectionEnd = end;
    },
    dispatchEvent(event) {
      events.push(event.type);
    }
  };
  const snapshot = {
    ok: true,
    root: element,
    metadata: { timestamp: 100, replaceability: "direct", selectedText: "rough" }
  };

  const result = applyReplacement(snapshot, "clear", 120);
  assert.equal(result.ok, true);
  assert.equal(element.value, "hello clear world");
  assert.ok(events.includes("input"));
  result.undo();
  assert.equal(element.value, "hello rough world");
});

test("readonly and stale selections are rejected", () => {
  assert.equal(validateEditableRoot({ tagName: "TEXTAREA", readOnly: true }).ok, false);
  const result = applyReplacement({
    ok: true,
    root: { tagName: "TEXTAREA", selectionStart: 0, selectionEnd: 4 },
    metadata: { timestamp: 0, replaceability: "direct" }
  }, "next", 200000);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "selection changed");
});

test("changed input selection is rejected before replacement", () => {
  const element = {
    tagName: "TEXTAREA",
    value: "alpha beta",
    selectionStart: 6,
    selectionEnd: 10,
    disabled: false,
    readOnly: false,
    setRangeText() {
      throw new Error("should not replace changed selection");
    },
    dispatchEvent() {}
  };
  const result = applyReplacement({
    ok: true,
    root: element,
    metadata: { timestamp: 1, replaceability: "direct", selectedText: "alpha" }
  }, "next", 2);

  assert.equal(result.ok, false);
  assert.equal(result.reason, "selection changed");
  assert.equal(element.value, "alpha beta");
});

test("form control snapshot captures serializable metadata", () => {
  const element = {
    tagName: "INPUT",
    type: "text",
    value: "hello selected text",
    selectionStart: 6,
    selectionEnd: 14,
    disabled: false,
    readOnly: false
  };
  const snapshot = snapshotFormControlSelection(element, 123);

  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.metadata.selectedText, "selected");
  assert.equal(snapshot.metadata.characterCount, 8);
  assert.equal(snapshot.metadata.replaceability, "direct");
  assert.equal(snapshot.metadata.targetType, "input");
  assert.equal(snapshot.metadata.timestamp, 123);
  assert.equal(snapshot.metadata.version, 1);
  assert.equal(snapshot.root, element);
});

test("form control snapshot rejects password fields", () => {
  const snapshot = snapshotFormControlSelection({
    tagName: "INPUT",
    type: "password",
    value: "secret",
    selectionStart: 0,
    selectionEnd: 6,
    disabled: false,
    readOnly: false
  });

  assert.equal(snapshot.ok, false);
  assert.equal(snapshot.metadata.replaceability, "copy-fallback");
});

test("broad contenteditable and notion roots fall back instead of direct apply", () => {
  const root = {
    isContentEditable: true,
    closest(selector) {
      return selector.includes("data-block-id") ? this : null;
    }
  };
  assert.equal(validateEditableRoot(root).ok, false);

  const unsupported = {
    isContentEditable: true,
    closest() {
      return null;
    }
  };
  assert.equal(validateEditableRoot(unsupported).ok, false);

  const plain = {
    isContentEditable: true,
    closest() {
      return null;
    },
    matches(selector) {
      return selector.includes("contenteditable");
    }
  };
  assert.equal(validateEditableRoot(plain).ok, false);
});

test("collapsed live contenteditable selection is rejected", () => {
  const previousWindow = global.window;
  global.window = {
    getSelection() {
      return { rangeCount: 1, isCollapsed: true, toString: () => "" };
    }
  };

  const result = applyReplacement({
    ok: true,
    root: { isContentEditable: true },
    range: { toString: () => "alpha", commonAncestorContainer: {} },
    metadata: { timestamp: 1, replaceability: "direct", selectedText: "alpha" }
  }, "beta", 2);

  assert.equal(result.ok, false);
  assert.equal(result.reason, "selection changed");
  global.window = previousWindow;
});
