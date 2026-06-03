"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const settingsUtils = require("../chrome-extension/settings-utils.js");
const shortcuts = require("../chrome-extension/shortcut-utils.js");

test("appearance: defaults to dark", () => {
  assert.deepEqual(settingsUtils.defaultAppearanceSettings(), { mode: "dark" });
});

test("appearance: normalization accepts valid modes and rejects junk", () => {
  assert.deepEqual(settingsUtils.normalizeAppearanceSettings({ mode: "light" }), { mode: "light" });
  assert.deepEqual(settingsUtils.normalizeAppearanceSettings("system"), { mode: "system" });
  assert.deepEqual(settingsUtils.normalizeAppearanceSettings({ mode: "neon" }), { mode: "dark" });
  assert.deepEqual(settingsUtils.normalizeAppearanceSettings(null), { mode: "dark" });
  assert.deepEqual(settingsUtils.normalizeAppearanceSettings(undefined), { mode: "dark" });
});

test("appearance: resolveAppearanceTheme maps modes to concrete themes", () => {
  assert.equal(settingsUtils.resolveAppearanceTheme({ mode: "light" }), "light");
  assert.equal(settingsUtils.resolveAppearanceTheme({ mode: "dark" }), "dark");
  // System honours the supplied OS preference deterministically.
  assert.equal(settingsUtils.resolveAppearanceTheme({ mode: "system" }, true), "dark");
  assert.equal(settingsUtils.resolveAppearanceTheme({ mode: "system" }, false), "light");
  // Junk input falls back to the dark default.
  assert.equal(settingsUtils.resolveAppearanceTheme("bogus"), "dark");
});

test("appearance: load/save round-trips through chrome.storage.local with normalization", async () => {
  const state = {};
  global.chrome = {
    storage: {
      local: {
        get(keys, cb) { const out = {}; for (const k of keys) out[k] = state[k]; cb(out); },
        set(updates, cb) { Object.assign(state, updates); if (cb) cb(); }
      }
    }
  };
  const saved = await settingsUtils.saveAppearanceSettings({ mode: "light" });
  assert.deepEqual(saved, { mode: "light" });
  assert.deepEqual(state.appearanceSettings, { mode: "light" });
  const loaded = await settingsUtils.loadAppearanceSettings();
  assert.deepEqual(loaded, { mode: "light" });
  // A persisted junk value normalizes back to dark on load.
  state.appearanceSettings = { mode: "rainbow" };
  assert.deepEqual(await settingsUtils.loadAppearanceSettings(), { mode: "dark" });
  delete global.chrome;
});

test("panel shortcut metadata is shared and well-formed", () => {
  assert.ok(Array.isArray(shortcuts.PANEL_SHORTCUTS));
  assert.ok(shortcuts.PANEL_SHORTCUTS.length > 0);
  for (const entry of shortcuts.PANEL_SHORTCUTS) {
    assert.ok(Array.isArray(entry.keys) && entry.keys.length > 0);
    assert.equal(typeof entry.description, "string");
    assert.ok(entry.description.length > 0);
  }
});
