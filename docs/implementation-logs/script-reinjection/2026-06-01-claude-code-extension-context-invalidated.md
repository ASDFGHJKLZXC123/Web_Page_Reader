# Claude Code Implementation Log — Helper script re-injection / duplicate-declaration fix

- Date: 2026-06-01
- Milestone: script-reinjection
- Task: Fix `[aaw] openOptionsPage threw: Extension context invalidated.` plus console
  `SyntaxError: Identifier 'PRIVACY_SCHEMA_VERSION' has already been declared` and
  `Identifier 'TEXT_INPUT_TYPES' has already been declared`.

## What was done

Wrapped the two content-script helper files that still declared top-level lexical
(`const`) bindings in the same browser/CommonJS-safe IIFE pattern already used by
`settings-utils.js` and `shortcut-utils.js`:

- `chrome-extension/privacy-utils.js` — body wrapped in `(function definePrivacyUtils(globalScope){ … })(self||window||globalThis)`.
  The trailing export block now uses `globalScope.AssistantPrivacy = API` instead of the
  top-level `const _global = …` resolution. `module.exports = API` is preserved for tests.
- `chrome-extension/selection-replacement.js` — body wrapped in
  `(function defineSelectionReplacement(globalScope){ … })(self||window||globalThis)`.
  The final exposure switched from `window.AssistantSelectionReplacement` to
  `globalScope.AssistantSelectionReplacement` (in a content script / page, `self === window`,
  so behavior is unchanged). `module.exports` is preserved.

### Root cause

`manifest.json` `content_scripts` inject `privacy-utils.js`, `selection-replacement.js`,
`shortcut-utils.js`, `settings-utils.js`, `content.js` on `<all_urls>`, and
`background.js` `ensurePanelScripts()` re-injects the same files via
`chrome.scripting.executeScript` as a fallback (from `sendPanelMessage`). Chrome
accumulates top-level lexical bindings across injections into one isolated world, so the
second run of a file containing a top-level `const` throws
`Identifier ... has already been declared`. That SyntaxError aborts the whole
`executeScript` batch, so `content.js` is not (re)injected and its `chrome.runtime`
message listener is not refreshed. The stale content script then surfaces
`Extension context invalidated` when `openOptionsPage()` calls
`chrome.runtime.sendMessage({ type: "OPEN_OPTIONS" })`.

Wrapping the two files in IIFEs makes their declarations function-scoped, so repeated
injection just re-runs the function (idempotent), matching the already-safe helpers and
`content.js` (which is wrapped in `initAssistant()` + a `window.__assistantAcrossWebsitesLoaded`
guard). No changes were needed to `manifest.json`, `background.js`, or `content.js`.

## Files changed

- `chrome-extension/privacy-utils.js` — IIFE wrap (open after header comment; close + global exposure at tail).
- `chrome-extension/selection-replacement.js` — IIFE wrap (open after `"use strict";`; close + global exposure at tail).
- `test/script-reinjection.test.js` — new regression test (added).

## Files inspected (not changed)

- `chrome-extension/manifest.json` (content_scripts list)
- `chrome-extension/background.js` (`ensurePanelScripts`, `sendPanelMessage`, `handleOpenOptions`, `importScripts("privacy-utils.js")`)
- `chrome-extension/content.js` (idempotency guard, `openOptionsPage`, `window.AssistantPrivacy`/`AssistantSelectionReplacement` consumers)
- `chrome-extension/settings-utils.js`, `chrome-extension/shortcut-utils.js` (reference IIFE pattern)
- `chrome-extension/options.html` (loads helpers as page scripts)
- `test/privacy-utils.test.js`, `test/selection-replacement.test.js`, `test/options-settings.test.js`, `test/background-foundation.test.js` (CommonJS consumers)

## Verification commands run

- `node --check chrome-extension/privacy-utils.js` → OK
- `node --check chrome-extension/selection-replacement.js` → OK
- `node --check chrome-extension/content.js` → OK
- `node --test test/script-reinjection.test.js test/privacy-utils.test.js test/selection-replacement.test.js test/options-settings.test.js test/background-foundation.test.js` → 50 pass / 0 fail
- `npm run test:unit` → 125 pass / 0 fail
- Sanity check that the regression test's doubled-source technique reproduces the bug:
  a top-level `const` evaluated twice in one `vm` program throws
  `SyntaxError: Identifier 'X' has already been declared`, while the IIFE form runs cleanly.

## Successful checks

- Both wrapped files parse and run twice in one shared scope without a duplicate-declaration SyntaxError.
- `AssistantPrivacy` / `AssistantSelectionReplacement` are still exposed on the global scope after a second injection; CommonJS `require()` interface unchanged.
- Full unit suite (125 tests) green; no regression in privacy, selection-replacement, options-settings, or background-foundation tests.

## Failed checks

- None.

## Suspected causes for failures

- N/A (no failing checks).

## Known risks

- The console `Extension context invalidated` message can still appear transiently for a
  tab that was open *before* an extension reload, until that tab is reloaded or
  `ensurePanelScripts()` successfully re-injects `content.js`. This fix removes the
  SyntaxError that was *blocking* that re-injection; it does not add a new runtime guard
  around the stale `chrome.runtime` reference in `openOptionsPage` (would be a separate,
  out-of-scope change). `openOptionsPage` already swallows the throw via try/catch.
- E2E (Playwright) injection was not exercised in this pass; verification was via Node
  syntax checks, unit tests, and a `vm`-based double-injection simulation.
- `selection-replacement.js` now also defines its API on `globalThis` under Node (previously
  `window`-guarded, so a no-op there). Harmless — tests use `require()`/`module.exports`.

## Final status

Complete. Duplicate top-level declaration SyntaxErrors on repeated helper-script injection
are resolved by IIFE-wrapping `privacy-utils.js` and `selection-replacement.js`; the
CommonJS/service-worker/content-script export contracts are preserved; a regression test
was added; all 125 unit tests pass.
