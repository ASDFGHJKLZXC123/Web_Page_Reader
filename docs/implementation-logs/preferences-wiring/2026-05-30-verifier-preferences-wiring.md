# Preferences Wiring - Independent Verification Log

Date: 2026-05-30
Milestone: preferences-wiring
Task: Verify Claude Code implementation for appearance theme preferences and live shortcuts wiring.

## What was reviewed

Reviewed the implemented preferences wiring for:

- Appearance options section with Dark, Light, and System controls.
- `appearanceSettings` normalization and `chrome.storage.local` persistence.
- Theme application on the options root and injected panel root.
- Live reaction to `chrome.storage.onChanged`.
- System color-scheme change handling in System mode.
- Shortcuts options section using live `chrome.commands.getAll()` and shared panel shortcut metadata.
- Chrome shortcuts button behavior and fallback behavior.
- Scope creep around backup/settings features.
- Required Claude Code implementation log.

## Files changed or inspected

Changed:

- `docs/implementation-logs/preferences-wiring/2026-05-30-verifier-preferences-wiring.md` only.

Inspected:

- `chrome-extension/options.html`
- `chrome-extension/options.js`
- `chrome-extension/options.css`
- `chrome-extension/content.js`
- `chrome-extension/styles.css`
- `chrome-extension/settings-utils.js`
- `chrome-extension/shortcut-utils.js`
- `chrome-extension/background.js`
- `chrome-extension/manifest.json`
- `docs/implementation-logs/preferences-wiring/2026-05-30-claude-code-preferences-wiring.md`
- `test/appearance-settings.test.js`
- `test/e2e/specs/builtin.smoke.spec.js`
- `test/e2e/helpers/extension-harness.js`
- `playwright.config.js`

Worktree inspection showed broad pre-existing/unrelated changes. `git diff --name-only` listed:

- `.gitignore`
- `README.md`
- `backend/src/lib/analysis.js`
- `backend/src/lib/storage.js`
- `backend/src/server.js`
- `chrome-extension/background.js`
- `chrome-extension/content.js`
- `chrome-extension/manifest.json`
- `chrome-extension/options.css`
- `chrome-extension/options.html`
- `chrome-extension/options.js`
- `chrome-extension/styles.css`
- `package.json`

`git status --short` also showed many untracked project files, including `settings-utils.js`, `shortcut-utils.js`, tests, docs, and Playwright config. Verification was scoped to the requested preferences-wiring surface.

## Verification commands run

- `git status --short`
  - Result: broad dirty worktree with modified tracked files and many untracked files.
- `git diff --stat`
  - Result: 13 tracked files changed, 16244 insertions, 1497 deletions.
- `git diff --name-only`
  - Result: tracked changed files listed above.
- `find docs/implementation-logs -maxdepth 3 -type f | sort`
  - Result: implementation log exists at `docs/implementation-logs/preferences-wiring/2026-05-30-claude-code-preferences-wiring.md`.
- `rg -n "appearance|data-aaw-theme|prefers-color-scheme|matchMedia|shortcuts|getAll|extensions/shortcuts|commands|appearanceSettings|chrome\\.storage\\.onChanged|onChanged" ...`
  - Result: found the expected appearance and shortcut hooks in options, content, styles, settings utilities, shortcut utilities, manifest, and background.
- `rg -n "backup|export|import|settings" chrome-extension/options.html chrome-extension/options.js chrome-extension/content.js chrome-extension/settings-utils.js chrome-extension/shortcut-utils.js`
  - Result: backup/settings code is present in the broader worktree; no appearance/shortcuts code path was found altering backup behavior.
- `node --check chrome-extension/options.js chrome-extension/content.js chrome-extension/settings-utils.js chrome-extension/shortcut-utils.js`
  - Result: passed with no output.
- `npm test`
  - Result: passed, 123 tests, 123 passing, 0 failing.
- `node --test test/appearance-settings.test.js`
  - Result: passed, 5 tests, 5 passing, 0 failing.
- `npm run test:e2e -- --list`
  - Result: listed 17 tests; no existing Appearance or Shortcuts options spec exists.
- `AAW_E2E_HEADLESS=1 npm run test:e2e -- --grep "gear button|keyboard"`
  - Result: failed before target behavior ran. Playwright timed out waiting for the MV3 extension service worker in `test/e2e/helpers/extension-harness.js:41`; 1 test failed at setup and 1 did not run.
- `node -e 'const fs=require("fs"); const html=fs.readFileSync("chrome-extension/options.html","utf8"); console.log(html.includes("shortcut-utils.js") ? "options loads shortcut-utils" : "options missing shortcut-utils");'`
  - Result: `options missing shortcut-utils`.
- `node -e 'const fs=require("fs"); const bg=fs.readFileSync("chrome-extension/background.js","utf8"); const m=bg.match(/files: \\[(.*?)\\]/s); console.log(m ? m[1].replace(/\\s+/g," ").trim() : "no injection files found");'`
  - Result: `"privacy-utils.js", "selection-replacement.js", "shortcut-utils.js", "content.js"`.

## Successful checks

- `#appearance` exists in `options.html` with Dark, Light, and System radio controls.
- `settings-utils.js` defines `defaultAppearanceSettings`, `normalizeAppearanceSettings`, `loadAppearanceSettings`, `saveAppearanceSettings`, and `resolveAppearanceTheme`; storage uses the `appearanceSettings` key and normalization clamps invalid modes to dark.
- Options applies `data-aaw-theme` on `document.documentElement`.
- Panel applies `data-aaw-theme` on `.aaw-root`.
- Light theme selectors exist in `options.css` as `:root[data-aaw-theme="light"]` and in `styles.css` as `.aaw-root[data-aaw-theme="light"]`.
- Options and panel both register `chrome.storage.onChanged` handlers for `appearanceSettings`.
- Options and panel both register `matchMedia("(prefers-color-scheme: dark)")` change listeners and gate re-resolution on System mode.
- Browser command shortcuts are read with `chrome.commands.getAll()`.
- Claude Code implementation log exists under `docs/implementation-logs/preferences-wiring/`.
- Required syntax check passed.
- Required unit suite passed.
- Targeted appearance settings unit test passed.

## Failed checks

1. `#shortcuts` does not actually load the shared panel shortcut metadata at runtime.
   - `chrome-extension/options.js:1392` reads `window.AssistantShortcuts.PANEL_SHORTCUTS`.
   - `chrome-extension/options.html:332-335` loads `privacy-utils.js`, `mirror-utils.js`, `settings-utils.js`, and `options.js`, but does not load `shortcut-utils.js`.
   - The targeted static command confirmed: `options missing shortcut-utils`.
   - Expected result: the options page should load `shortcut-utils.js` before `options.js`, or otherwise import the shared metadata.

2. Dynamic panel injection omits `settings-utils.js`, so a fallback-injected panel cannot load saved appearance settings on initial build.
   - `chrome-extension/content.js:21-23` depends on `settingsTools.resolveAppearanceTheme`.
   - `chrome-extension/content.js:27-31` loads the saved appearance mode only when `settingsTools.loadAppearanceSettings` exists.
   - `chrome-extension/background.js:4317-4319` injects `privacy-utils.js`, `selection-replacement.js`, `shortcut-utils.js`, and `content.js`, but not `settings-utils.js`.
   - Expected result: every path that injects `content.js` should also inject `settings-utils.js` before it.

3. Chrome shortcuts fallback does not handle asynchronous `chrome.tabs.create` failures.
   - `chrome-extension/options.js:1362-1364` calls `chrome.tabs.create({ url })` and immediately returns.
   - `chrome-extension/options.js:1367` only shows fallback text after a synchronous throw or missing API.
   - Expected result: handle the callback/promise rejection or `chrome.runtime.lastError` path so the fallback appears when opening `chrome://extensions/shortcuts` is not possible.

4. Targeted Playwright verification was not completed.
   - `AAW_E2E_HEADLESS=1 npm run test:e2e -- --grep "gear button|keyboard"` failed in setup with `Timed out waiting for MV3 extension service worker`.
   - Existing Playwright specs do not include Appearance or Shortcuts options coverage, so no matching spec could be run for the requested acceptance criteria.

## Suspected causes for failures

- The options page markup was updated to consume shared shortcut metadata, but the page script list was not updated to include `shortcut-utils.js`.
- The manifest content script path includes `settings-utils.js`, but the background fallback injection list was not kept in sync after `content.js` started depending on `AssistantSettings`.
- The Chrome shortcuts button implementation treats `chrome.tabs.create` as a purely synchronous operation and does not observe callback/promise failure.
- Headless Playwright could not start the MV3 extension service worker in this environment; this prevented browser-level verification of appearance, panel live update, and shortcuts.

## Known risks

- Browser-level live update behavior was inspected statically and through unit coverage where available, but not validated in Playwright due the MV3 service worker setup failure.
- System color-scheme reactivity was inspected in source only; no browser media-query flip test was executed.
- Because the worktree contains broad unrelated changes, this review did not attempt to attribute all backup/settings code in the diff to the preferences-wiring implementation. No new appearance/shortcuts code path was found modifying backup behavior.

## Final status

Failed acceptance. The core appearance helpers and theme wiring are present and the required Node checks pass, but the shortcuts options page cannot render shared in-panel shortcut metadata because `shortcut-utils.js` is not loaded by `options.html`. There are also acceptance risks in the dynamic panel injection path and Chrome shortcuts fallback handling.
