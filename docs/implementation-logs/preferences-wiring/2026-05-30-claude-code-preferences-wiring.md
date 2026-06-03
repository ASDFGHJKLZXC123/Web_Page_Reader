# Preferences Wiring — Claude Code Implementation Log

Date: 2026-05-30
Milestone: preferences-wiring
Task: Appearance (theme) wiring + live shortcuts reference on the options page and injected panel

## What was done

Implemented the missing preference-page wiring, scoped strictly to appearance + shortcuts (no backup/settings scope creep).

1. **Appearance UI (`#appearance`)** — Added an Appearance section to the options page with Dark / Light / System radio choices and a matching sidebar nav link.
2. **Persistence + normalization** — Added shared helpers in `settings-utils.js` that read/write `chrome.storage.local` key `appearanceSettings` as `{ mode }`. `normalizeAppearanceSettings` clamps any unknown/missing value back to `"dark"`. Helpers: `defaultAppearanceSettings`, `normalizeAppearanceSettings`, `loadAppearanceSettings`, `saveAppearanceSettings`, `resolveAppearanceTheme`, `APPEARANCE_MODES`.
3. **Theme application** — Options page sets `:root[data-aaw-theme="light"|"dark"]`; injected panel sets `.aaw-root[data-aaw-theme="light"|"dark"]`. Light theme variables added to `options.css` (`:root[data-aaw-theme="light"]`) and `styles.css` (`.aaw-root[data-aaw-theme="light"]`, including panel background/box-shadow/header overrides). Dark remains the default (no attribute or `"dark"`).
4. **Live reaction without reload** — Options page and `content.js` panel both add `chrome.storage.onChanged` listeners (local area) for `appearanceSettings` and re-apply the theme. `content.js` extended its existing watched-keys list rather than adding a second listener.
5. **System color-scheme reactivity** — Both options and panel register a `matchMedia("(prefers-color-scheme: dark)")` change listener that re-resolves the theme only when the current mode is `System`.
6. **Shortcuts section rewrite** — Replaced the hard-coded `#shortcuts` rows with:
   - a "Browser commands" list built live from `chrome.commands.getAll()` (shows each command's current binding + description), and
   - an "In-panel shortcuts" list built from new shared `AssistantShortcuts.PANEL_SHORTCUTS` metadata in `shortcut-utils.js`.
   Both are read-only.
7. **Open Chrome shortcuts button** — Added a button that calls `chrome.tabs.create({ url: "chrome://extensions/shortcuts" })`; on failure / missing API it shows a fallback instruction in the section status line.

## Files changed

- `chrome-extension/settings-utils.js` — appearance helpers + exports.
- `chrome-extension/shortcut-utils.js` — `PANEL_SHORTCUTS` metadata + export.
- `chrome-extension/options.html` — Appearance nav link + section; rewrote `#shortcuts` markup.
- `chrome-extension/options.js` — appearance section (load/apply/persist/react), shortcuts section (commands + panel metadata + open-chrome button), storage.onChanged listener, init wiring.
- `chrome-extension/content.js` — `settingsTools` ref, panel theme load/apply, matchMedia listener, extended onChanged watched keys.
- `chrome-extension/options.css` — `:root[data-aaw-theme="light"]` vars; `.opt-appearance`, `.opt-radio`, `.opt-shortcut-keys`, `.opt-shortcut-sep` styles.
- `chrome-extension/styles.css` — `.aaw-root[data-aaw-theme="light"]` vars + surface overrides.
- `test/appearance-settings.test.js` — new unit tests (normalization, resolve, storage round-trip, panel metadata).

## Files inspected (not changed)

- `chrome-extension/manifest.json` — confirmed `commands` (`_execute_action` Alt+Shift+A, `open-command-palette` Alt+Shift+K) and that `settings-utils.js`/`shortcut-utils.js` load before `content.js`.
- `test/options-settings.test.js`, `test/shortcut-utils.test.js` — followed existing chrome-mock test patterns.

## Verification commands run

- `node --check chrome-extension/options.js chrome-extension/content.js chrome-extension/settings-utils.js chrome-extension/shortcut-utils.js` → all OK.
- `npm test` → 123 passing, 0 failing (includes 5 new appearance/metadata tests).
- `node --test test/appearance-settings.test.js` → 5 passing.

## Successful checks

- All four target files pass `node --check`.
- Full unit suite green (123/123).
- New tests assert: dark default, junk→dark normalization, mode→theme resolution (incl. deterministic system preference), storage round-trip, and well-formed shared panel metadata.

## Failed checks

- None.

## Not run

- Playwright e2e (`npm run test:e2e`) — not run. Existing specs are backend/built-in smoke tests with no appearance coverage, and a Chromium download/extension harness run was not practical in this environment. No new Playwright spec was added (would be out of the requested scope and require browser install).

## Suspected failure causes

- N/A (no failures).

## Known risks / notes

- `chrome.tabs.create` to a `chrome://` URL works from an extension options page without the `tabs` permission, but if a future Chrome policy blocks it the code falls back to a textual instruction (covered).
- Light-theme CSS overrides the panel root background/box-shadow and the header's hard-coded translucent fill; other deeply nested hard-coded dark rgba() colors in `styles.css` (if any) were not exhaustively audited and could need follow-up polish, but core surfaces/text use the CSS variables that the light theme overrides.
- `appearanceSettings` is intentionally separate from `privacySettings`/backup; backup import/export was not touched, so themes are device-local by design.

## Final status

Complete. Scope limited to appearance + shortcuts wiring. All requested checks that were feasible were run and pass; Playwright was deliberately skipped as noted above.

---

## Fix iteration 1 (2026-05-30)

Addressed the three acceptance-blocking defects from the independent verifier.

### What was done

1. **`#shortcuts` panel metadata not rendering** — `options.js` reads `window.AssistantShortcuts.PANEL_SHORTCUTS`, but `options.html` never loaded `shortcut-utils.js`, so the global was undefined and the in-panel shortcut list stayed empty. Added `<script src="shortcut-utils.js"></script>` before `options.js` (after `settings-utils.js`), preserving existing load order.
2. **Dynamic fallback injection omitted `settings-utils.js`** — `content.js` depends on `window.AssistantSettings` for appearance load/normalize/theme resolution, but `ensurePanelScripts` in `background.js` injected `["privacy-utils.js", "selection-replacement.js", "shortcut-utils.js", "content.js"]`. Added `settings-utils.js` immediately before `content.js`, preserving the order of the other dependencies.
3. **Open Chrome shortcuts fallback incomplete** — `openChromeShortcuts` called `chrome.tabs.create({ url })` with no callback, so an async `chrome.runtime.lastError` never surfaced the manual-instruction fallback. Added a callback that checks `chrome.runtime.lastError` and invokes the shared `fallback()`; the no-tabs/no-API path still calls `fallback()`. No `tabs` permission required.

### Files changed

- `chrome-extension/options.html` — load `shortcut-utils.js` before `options.js`.
- `chrome-extension/background.js` — include `settings-utils.js` in `ensurePanelScripts` injection list.
- `chrome-extension/options.js` — `openChromeShortcuts` callback-based `lastError` fallback.
- `test/background-foundation.test.js` — updated injection-list assertion to include `settings-utils.js` (matches the corrected behavior in defect #2).

### Verification commands / results

- `node --check chrome-extension/options.js chrome-extension/content.js chrome-extension/settings-utils.js chrome-extension/shortcut-utils.js chrome-extension/background.js` → all pass (`ALL CHECKS PASS`).
- `npm test` → 123 tests, 123 pass, 0 fail.

### Known risks

- The injection-list test assertion is now coupled to the exact file array; future dependency additions must update both `background.js` and the test in tandem.
- Playwright not run this iteration (same rationale as above).

### Final status

Fix iteration 1 complete. All three verifier defects resolved; syntax checks and full test suite green.
