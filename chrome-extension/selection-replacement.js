"use strict";

// Wrapped in an IIFE so declarations are function-scoped, not top-level lexical
// bindings. The manifest injects this as a content script AND background.js
// re-injects it via chrome.scripting.executeScript as a fallback; without the
// IIFE the second run into the same isolated world would throw
// "Identifier TEXT_INPUT_TYPES has already been declared"
// (mirrors settings-utils.js / shortcut-utils.js).
(function defineSelectionReplacement(globalScope) {

const TEXT_INPUT_TYPES = new Set(["text", "search", "email", "url", "tel", "number"]);

function isTextInput(element) {
  return element &&
    element.tagName === "INPUT" &&
    TEXT_INPUT_TYPES.has(String(element.type || "text").toLowerCase());
}

function isTextarea(element) {
  return element && element.tagName === "TEXTAREA";
}

function isEditableElement(element) {
  return element &&
    (isTextarea(element) || isTextInput(element) || element.isContentEditable);
}

function elementMatches(element, selector) {
  return Boolean(element && typeof element.matches === "function" && element.matches(selector));
}

function editableRootFor(node) {
  const element = node && node.nodeType === 1 ? node : node && node.parentElement;
  if (!element) return null;
  if (isTextarea(element) || isTextInput(element)) return element;
  return element.closest("[contenteditable='true'],[contenteditable='plaintext-only']");
}

function targetTypeFor(root) {
  if (!root) return "unsupported";
  if (isTextarea(root)) return "textarea";
  if (isTextInput(root)) return "input";
  if (root.isContentEditable) {
    if (root.closest("[aria-label*='Message Body'],[role='textbox'][g_editable='true']")) return "gmail";
    if (root.closest("[data-block-id],[data-content-editable-root]")) return "notion";
    if (root.closest("[data-test-ql-editor-contenteditable='true'],.ql-editor,[role='textbox']")) return "contenteditable";
    if (elementMatches(root, "[contenteditable='true'],[contenteditable='plaintext-only']")) return "standard-contenteditable";
    if (typeof root.getAttribute === "function" && root.getAttribute("contenteditable")) return "standard-contenteditable";
    return "unsupported";
  }
  return "unsupported";
}

function isSimpleContenteditableSelection(range, root) {
  if (!range || !root) return false;
  const startBlock = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
  const endBlock = range.endContainer.nodeType === 1 ? range.endContainer : range.endContainer.parentElement;
  if (!startBlock || !endBlock) return false;
  const startContainer = startBlock.closest("p,div,li,h1,h2,h3,h4,h5,h6,span") || root;
  const endContainer = endBlock.closest("p,div,li,h1,h2,h3,h4,h5,h6,span") || root;
  return startContainer === endContainer || (startContainer === root && endContainer === root);
}

function validateEditableRoot(root, range) {
  if (!root) return { ok: false, reason: "not directly replaceable" };
  if (isTextarea(root) || isTextInput(root)) {
    if (root.type === "password" || root.type === "hidden") return { ok: false, reason: "unsupported input type" };
    if (root.disabled || root.readOnly) return { ok: false, reason: "field is disabled or readonly" };
    return { ok: true };
  }
  if (root.isContentEditable) {
    const targetType = targetTypeFor(root);
    if (targetType === "notion") {
      return isSimpleContenteditableSelection(range, root)
        ? { ok: true }
        : { ok: false, reason: "notion multi-block fallback" };
    }
    if (targetType === "standard-contenteditable") {
      return isSimpleContenteditableSelection(range, root)
        ? { ok: true }
        : { ok: false, reason: "not directly replaceable" };
    }
    if (targetType === "gmail" || targetType === "contenteditable") return { ok: true };
  }
  return { ok: false, reason: "not directly replaceable" };
}

function snapshotSelection(selection, now = Date.now()) {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return {
      ok: false,
      metadata: {
        selectedText: "",
        characterCount: 0,
        replaceability: "collapsed",
        targetType: "none",
        timestamp: now,
        version: 1
      },
      reason: "no selection"
    };
  }

  const range = selection.getRangeAt(0).cloneRange();
  const selectedText = String(selection).trim();
  const root = editableRootFor(range.commonAncestorContainer) ||
    editableRootFor(selection.anchorNode) ||
    editableRootFor(selection.focusNode);
  const validation = validateEditableRoot(root, range);
  const targetType = targetTypeFor(root);
  const sameRoot = !root || (
    root === editableRootFor(selection.anchorNode) &&
    root === editableRootFor(selection.focusNode)
  );
  const metadata = {
    selectedText,
    characterCount: selectedText.length,
    replaceability: validation.ok && sameRoot ? "direct" : "copy-fallback",
    targetType,
    timestamp: now,
    version: 1
  };

  if (!selectedText) return { ok: false, metadata, reason: "no selection" };
  if (!sameRoot) return { ok: false, metadata: { ...metadata, replaceability: "copy-fallback" }, reason: "cross-root selection" };

  return {
    ok: true,
    range,
    root,
    metadata,
    selectedText,
    reason: validation.ok ? "" : validation.reason
  };
}

function snapshotFormControlSelection(element, now = Date.now()) {
  const root = element;
  const validation = validateEditableRoot(root);
  const start = root && typeof root.selectionStart === "number" ? root.selectionStart : null;
  const end = root && typeof root.selectionEnd === "number" ? root.selectionEnd : null;
  const selectedText = start !== null && end !== null && end > start
    ? String(root.value || "").slice(start, end)
    : "";
  const metadata = {
    selectedText,
    characterCount: selectedText.length,
    replaceability: validation.ok && selectedText ? "direct" : "copy-fallback",
    targetType: targetTypeFor(root),
    timestamp: now,
    version: 1
  };

  if (!selectedText) return { ok: false, root, metadata, reason: "no selection" };
  return {
    ok: validation.ok,
    root,
    metadata,
    selectedText,
    reason: validation.ok ? "" : validation.reason
  };
}

function preserveReplacementWhitespace(original, replacement) {
  const leading = String(original || "").match(/^\s*/)[0];
  const trailing = String(original || "").match(/\s*$/)[0];
  const core = String(replacement || "").trim();
  return `${leading}${core}${trailing}`;
}

function dispatchEditEvents(element) {
  const InputCtor = typeof InputEvent !== "undefined" ? InputEvent : Event;
  element.dispatchEvent(new InputCtor("input", { bubbles: true, inputType: "insertText" }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function replaceInputSelection(element, replacement) {
  const start = element.selectionStart;
  const end = element.selectionEnd;
  if (start === null || end === null || start === end) return { ok: false, reason: "selection changed" };
  const before = element.value;
  const selected = before.slice(start, end);
  if (selected !== arguments[2]) return { ok: false, reason: "selection changed" };
  const next = preserveReplacementWhitespace(selected, replacement);
  element.setRangeText(next, start, end, "end");
  dispatchEditEvents(element);
  return {
    ok: true,
    undo() {
      element.value = before;
      element.setSelectionRange(start, end);
      dispatchEditEvents(element);
    }
  };
}

function replaceContenteditableRange(range, root, replacement, expectedText) {
  if (!root || !root.contains(range.commonAncestorContainer)) return { ok: false, reason: "selection changed" };
  const before = root.innerHTML;
  const selected = range.toString();
  if (!selected) return { ok: false, reason: "selection changed" };
  if (selected !== expectedText) return { ok: false, reason: "selection changed" };
  if (!isSimpleContenteditableSelection(range, root)) return { ok: false, reason: "not directly replaceable" };
  const next = preserveReplacementWhitespace(selected, replacement);
  range.deleteContents();
  range.insertNode(document.createTextNode(next));
  const InputCtor = typeof InputEvent !== "undefined" ? InputEvent : Event;
  root.dispatchEvent(new InputCtor("input", { bubbles: true, inputType: "insertText", data: next }));
  return {
    ok: true,
    undo() {
      root.innerHTML = before;
      const InputCtor = typeof InputEvent !== "undefined" ? InputEvent : Event;
      root.dispatchEvent(new InputCtor("input", { bubbles: true, inputType: "historyUndo" }));
    }
  };
}

function applyReplacement(snapshot, replacement, now = Date.now(), maxAgeMs = 120000) {
  if (!snapshot || !snapshot.ok) return { ok: false, reason: snapshot && snapshot.reason || "no selection" };
  if (now - snapshot.metadata.timestamp > maxAgeMs) return { ok: false, reason: "selection changed" };
  if (snapshot.metadata.replaceability !== "direct") return { ok: false, reason: snapshot.reason || "not directly replaceable" };
  if (snapshot.root && snapshot.root.isContentEditable && typeof window !== "undefined" && window.getSelection) {
    const selection = window.getSelection();
    const currentText = String(selection || "");
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed || currentText !== snapshot.metadata.selectedText) {
      return { ok: false, reason: "selection changed" };
    }
  }
  if (isTextarea(snapshot.root) || isTextInput(snapshot.root)) {
    return replaceInputSelection(snapshot.root, replacement, snapshot.metadata.selectedText);
  }
  if (snapshot.root && snapshot.root.isContentEditable) {
    return replaceContenteditableRange(snapshot.range, snapshot.root, replacement, snapshot.metadata.selectedText);
  }
  return { ok: false, reason: "not directly replaceable" };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    applyReplacement,
    editableRootFor,
    preserveReplacementWhitespace,
    snapshotFormControlSelection,
    snapshotSelection,
    targetTypeFor,
    validateEditableRoot
  };
}

if (globalScope) {
  globalScope.AssistantSelectionReplacement = {
    applyReplacement,
    editableRootFor,
    preserveReplacementWhitespace,
    snapshotFormControlSelection,
    snapshotSelection,
    targetTypeFor,
    validateEditableRoot
  };
}

})(typeof self !== "undefined" ? self : (typeof window !== "undefined" ? window : globalThis));
