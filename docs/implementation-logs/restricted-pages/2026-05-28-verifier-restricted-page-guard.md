# Verifier log — Restricted-page guard for toolbar/command panel actions

Date: 2026-05-28
Verifier: Claude Code (independent verification subagent)
Implementer log under review: `docs/implementation-logs/restricted-pages/2026-05-28-claude-code-restricted-page-guard.md`

## What was reviewed

Independent verification of the upstream URL-scheme guard added to the
service worker so that toolbar clicks and the `open-command-palette` /
`_execute_action` keyboard commands short-circuit on restricted browser
pages (e.g. `chrome://extensions`, `devtools://`, `view-source:`, `data:`,
`about:blank`, `javascript:`, empty URLs) before any call to
`chrome.tabs.sendMessage` or `chrome.scripting.executeScript` /
`chrome.scripting.insertCSS`.

The review focused on:

- correctness of the new `isSupportedPageUrl` / `isInjectableTab` helpers,
- placement of the guard inside `sendPanelCommandToTab` so it precedes the
  `sendPanelMessage` call that performs the messaging/injection,
- coverage of both entry points (toolbar `chrome.action.onClicked` and
  `chrome.commands.onCommand` → `handleChromeCommand`),
- updated and added tests in `test/background-foundation.test.js`.

No implementation work was performed.

## Files inspected

- `chrome-extension/background.js`
  - `isSupportedPageUrl` at line 4292
  - `isInjectableTab` at line 4311
  - `sendPanelMessage` at line 4324
  - `sendPanelCommandToTab` at line 4350
  - `handleChromeCommand` at line 4364
  - `chrome.action.onClicked.addListener` at line 4373
  - `chrome.commands.onCommand.addListener` at line 4380
  - `module.exports` block at line 4402 (confirmed both helpers exported)
- `test/background-foundation.test.js`
  - chrome mock (records `tabMessages`, `scriptInjections`, `cssInjections`)
    at lines 6–96
  - "Chrome command opens command palette on active tab with injection
    fallback" at line 1014 (now provides an `https://example.com/page` URL
    on the active tab)
  - "Chrome command short-circuits on restricted `chrome://` tabs without
    messaging or injection" at line 1030
  - "isSupportedPageUrl gates schemes that content scripts cannot run on"
    at line 1046 (covers `https`, `http`, `file`, `chrome`,
    `chrome-untrusted`, `about:blank`, `edge`, `devtools`, `view-source`,
    `data`, `javascript`, empty string; plus `isInjectableTab` tab-shape
    cases)
- `docs/implementation-logs/restricted-pages/2026-05-28-claude-code-restricted-page-guard.md`

## Verification commands run

- `node --test test/background-foundation.test.js`

## Successful checks

- All 29 tests pass; 0 fail, 0 cancelled, 0 skipped, 0 todo (duration
  ~135 ms).
- Control-flow trace confirmed the guard is upstream of any messaging or
  injection:
  - `chrome.action.onClicked` → `sendPanelCommandToTab` → `isInjectableTab`
    short-circuit → return `{ ok: false, error: "Restricted page",
    reason: "unsupported_url" }`. `sendPanelMessage` (and therefore
    `chrome.tabs.sendMessage` / `chrome.scripting.*`) is never reached on
    unsupported URLs.
  - `chrome.commands.onCommand` → `handleChromeCommand` →
    `sendPanelCommandToTab` (same short-circuit). Both
    `open-command-palette` and `_execute_action` route through this path;
    any other command name returns `{ ok: false, ignored: true }` without
    touching the tab.
- The restricted-page test asserts empty `state.tabMessages`,
  `state.scriptInjections`, and `state.cssInjections` after dispatching
  `open-command-palette` on a `chrome://extensions` active tab, which
  directly verifies the requirement.
- The supported-scheme test independently exercises `isSupportedPageUrl`
  for the documented allowlist plus `isInjectableTab` for tabs missing
  `id`, missing `url`, restricted `url`, valid `url`, and `pendingUrl`
  fallback.
- The injection-fallback test now supplies an `https://example.com/page`
  URL on the active tab, confirming the guard does not regress the
  legitimate-injection path: the first `chrome.tabs.sendMessage` fails,
  `ensurePanelScripts` injects `privacy-utils.js`,
  `selection-replacement.js`, `shortcut-utils.js`, `content.js` and
  `styles.css`, and the second `chrome.tabs.sendMessage` succeeds.
- `isSupportedPageUrl` correctly rejects `chrome-extension://` URLs whose
  hostname does not match `chrome.runtime.id` (only the extension's own
  pages are allowed), matching the implementer's documented intent.
- Both helpers are exported from the CommonJS `module.exports` block,
  enabling the unit test to require them directly.

## Failed checks

None.

## Suspected causes for failures

N/A — no failures observed.

## Known risks

- `file://` URLs are accepted by `isSupportedPageUrl` even though the
  manifest does not request `file:///*` host permissions. In practice the
  injection will still fail at the Chrome layer; that failure is caught by
  the existing try/catch in `sendPanelMessage` and surfaced as
  `{ ok: false, error: <message> }`. This is consistent with the
  implementer's documented stance and does not regress the
  no-uncaught-rejection requirement.
- The guard depends on the tab object carrying `url` or `pendingUrl`. If
  Chrome dispatches a click with neither (e.g. very early in navigation),
  the action becomes a safe no-op returning `{ ok: false, error:
  "Restricted page", reason: "unsupported_url" }`. This is the safer
  failure mode but could be user-visible if it ever occurs in practice.
- The check uses `chrome.runtime.id` for the `chrome-extension://`
  allowance. In the test harness this property is undefined on the mock,
  so all `chrome-extension://` URLs are rejected during tests; production
  Chrome populates it, so the runtime behavior matches the documented
  intent. No test asserts the positive `chrome-extension://` case, but the
  negative case (other extensions' pages blocked) is implicitly covered.
- `_execute_action` is handled in `handleChromeCommand` but the manifest
  binding for that command was not inspected as part of this scope. The
  implementer's log states both `open-command-palette` and
  `_execute_action` are routed; the code confirms this. Whether
  `_execute_action` is bound in `manifest.json` is outside the verifier's
  reviewed scope.

## Final status

PASS. The restricted-page guard is correctly placed upstream of all
messaging and scripting calls on both the toolbar-click and keyboard-
command surfaces. The implementer log accurately describes the change.
All 29 Node tests pass, including the three tests added or updated for
this work. No defects identified.
