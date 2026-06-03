"use strict";

(function initShortcutUtils(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.AssistantShortcuts = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function shortcutFactory() {
  const MODIFIER_ORDER = ["Ctrl", "Meta", "Mod", "Alt", "Shift"];
  const MODIFIER_ALIASES = {
    control: "Ctrl",
    ctrl: "Ctrl",
    command: "Meta",
    cmd: "Meta",
    meta: "Meta",
    win: "Meta",
    option: "Alt",
    alt: "Alt",
    shift: "Shift",
    mod: "Mod",
    "ctrl/cmd": "Mod",
    "cmd/ctrl": "Mod"
  };

  function normalizeKey(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const lower = raw.toLowerCase();
    const named = {
      esc: "Escape",
      escape: "Escape",
      enter: "Enter",
      return: "Enter",
      space: "Space",
      " ": "Space",
      slash: "/",
      question: "?",
      plus: "+",
      comma: ",",
      period: "."
    };
    if (named[lower]) return named[lower];
    if (raw.length === 1) return raw.toUpperCase();
    return raw[0].toUpperCase() + raw.slice(1);
  }

  function normalizeSingleShortcut(input) {
    if (typeof input === "object" && input && input.key) {
      const modifiers = [];
      if (input.ctrlKey) modifiers.push("Ctrl");
      if (input.metaKey) modifiers.push("Meta");
      if (input.altKey) modifiers.push("Alt");
      if (input.shiftKey) modifiers.push("Shift");
      const key = normalizeKey(input.key);
      return {
        key,
        modifiers,
        id: [...modifiers, key].join("+"),
        label: [...modifiers, key].join("+")
      };
    }

    const parts = String(input || "")
      .split("+")
      .map((part) => part.trim())
      .filter(Boolean);
    const modifiers = [];
    let key = "";
    for (const part of parts) {
      const alias = MODIFIER_ALIASES[part.toLowerCase()];
      if (alias) {
        if (!modifiers.includes(alias)) modifiers.push(alias);
      } else {
        key = normalizeKey(part);
      }
    }
    modifiers.sort((a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b));
    return {
      key,
      modifiers,
      id: [...modifiers, key].filter(Boolean).join("+"),
      label: [...modifiers, key].filter(Boolean).join("+")
    };
  }

  function normalizeShortcut(input) {
    const raw = String(input || "").trim();
    if (raw.includes(" ")) {
      const sequence = raw
        .split(/\s+/)
        .map((part) => normalizeSingleShortcut(part))
        .filter((part) => part.key);
      return {
        sequence,
        id: sequence.map((part) => part.id).join(" "),
        label: sequence.map((part) => part.label).join(" ")
      };
    }
    return normalizeSingleShortcut(input);
  }

  function eventModifierState(event) {
    return {
      Ctrl: Boolean(event && event.ctrlKey),
      Meta: Boolean(event && event.metaKey),
      Alt: Boolean(event && event.altKey),
      Shift: Boolean(event && event.shiftKey)
    };
  }

  function matchShortcut(event, shortcut) {
    const normalized = typeof shortcut === "string" ? normalizeShortcut(shortcut) : shortcut;
    if (!normalized || normalized.sequence) return false;
    const key = normalizeKey(event && event.key);
    const keyMatches = key === normalized.key || (normalized.key === "?" && key === "/" && event && event.shiftKey);
    if (!key || !keyMatches) return false;

    const wanted = new Set(normalized.modifiers || []);
    const state = eventModifierState(event);
    const modSatisfied = wanted.has("Mod") ? (state.Ctrl || state.Meta) : true;
    if (!modSatisfied) return false;

    for (const modifier of ["Ctrl", "Meta", "Alt", "Shift"]) {
      if (modifier === "Ctrl" || modifier === "Meta") {
        if (wanted.has("Mod")) continue;
      }
      const required = wanted.has(modifier);
      if (state[modifier] !== required) {
        if (normalized.key === "?" && modifier === "Shift") continue;
        return false;
      }
    }
    return true;
  }

  function isEditableShortcutTarget(target) {
    if (!target || target === target.ownerDocument) return false;
    const element = target.nodeType === 1 ? target : target.parentElement;
    if (!element) return false;
    if (element.isContentEditable) return true;
    const editableSelector = [
      "input",
      "textarea",
      "select",
      "[contenteditable='']",
      "[contenteditable='true']",
      "[role='textbox']",
      "[role='searchbox']",
      "[role='combobox']",
      ".ProseMirror",
      ".ql-editor",
      ".notion-page-content"
    ].join(",");
    const editable = element.matches && element.matches(editableSelector)
      ? element
      : (element.closest && element.closest(editableSelector));
    if (!editable) return false;
    if (editable.matches && editable.matches("input")) {
      const type = String(editable.getAttribute("type") || "text").toLowerCase();
      return !["button", "checkbox", "radio", "submit", "reset", "range", "color", "file"].includes(type);
    }
    return true;
  }

  function shouldHandlePanelShortcut({ event, panelRoot, allowWhenHidden = false, allowEditable = false } = {}) {
    if (!event || event.defaultPrevented) return false;
    if (!panelRoot) return false;
    const hidden = panelRoot.classList && panelRoot.classList.contains("aaw-hidden");
    if (hidden && !allowWhenHidden) return false;
    if (event.target && panelRoot.contains && !panelRoot.contains(event.target)) return false;
    if (!allowEditable && isEditableShortcutTarget(event.target)) return false;
    return true;
  }

  function sequenceKeyFromEvent(event) {
    if (!event || event.ctrlKey || event.metaKey || event.altKey) return "";
    const key = normalizeKey(event.key);
    if (!key || key.length !== 1) return "";
    return key.toLowerCase();
  }

  function createSequenceBuffer({ timeoutMs = 900, now = () => Date.now() } = {}) {
    let keys = [];
    let lastAt = 0;
    return {
      push(input, at = now()) {
        const key = typeof input === "string" ? input.toLowerCase() : sequenceKeyFromEvent(input);
        if (!key) {
          keys = [];
          lastAt = 0;
          return [];
        }
        if (lastAt && at - lastAt > timeoutMs) keys = [];
        keys.push(key);
        lastAt = at;
        if (keys.length > 2) keys = keys.slice(-2);
        return keys.slice();
      },
      current() {
        return keys.slice();
      },
      reset() {
        keys = [];
        lastAt = 0;
      },
      match(shortcuts, at = now()) {
        if (lastAt && at - lastAt > timeoutMs) {
          keys = [];
          lastAt = 0;
          return null;
        }
        const current = keys.join(" ");
        for (const shortcut of shortcuts || []) {
          const normalized = normalizeShortcut(shortcut);
          if (normalized.sequence && normalized.id.toLowerCase() === current) return normalized;
        }
        return null;
      }
    };
  }

  // Browser-side panel shortcuts that are handled in the content script rather
  // than registered as chrome.commands. Shared so the options page can show a
  // live reference without re-declaring the key map. chrome.commands.getAll()
  // covers the toggle/palette commands; this covers everything in-panel.
  const PANEL_SHORTCUTS = [
    { keys: ["Ctrl/⌘+K", "?"], description: "Open command palette" },
    { keys: ["1", "2", "3"], description: "Summarize, rewrite, extract" },
    { keys: ["Ctrl/⌘+S"], description: "Save page memory" },
    { keys: ["Ctrl/⌘+Enter"], description: "Run the focused section action" },
    { keys: ["/"], description: "Focus memory search" },
    { keys: ["g a", "g m", "g l", "g t", "g w"], description: "Jump between panel sections" },
    { keys: ["Esc"], description: "Close palette, then panel" }
  ];

  function commandMatchesShortcut(command, event) {
    if (!command || command.disabled) return false;
    const shortcuts = Array.isArray(command.shortcuts) ? command.shortcuts : [command.shortcut].filter(Boolean);
    return shortcuts.some((shortcut) => matchShortcut(event, normalizeShortcut(shortcut)));
  }

  return {
    PANEL_SHORTCUTS,
    commandMatchesShortcut,
    createSequenceBuffer,
    isEditableShortcutTarget,
    matchShortcut,
    normalizeKey,
    normalizeShortcut,
    sequenceKeyFromEvent,
    shouldHandlePanelShortcut
  };
});
