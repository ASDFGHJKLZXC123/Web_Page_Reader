# Restricted-page guard for toolbar/command panel actions

Date: 2026-05-28
Implementer: Claude Code

## What was done

Added an upstream URL-scheme guard to the extension's service-worker
command/toggle path so that clicking the toolbar action or firing the
`open-command-palette` / `_execute_action` keyboard command on a restricted
browser/internal URL (e.g. `chrome://extensions`) no longer attempts content
script messaging or scripting injection, and no longer surfaces an uncaught
`Cannot access a chrome:// URL` promise rejection.

New helpers in `chrome-extension/background.js`:

- `isSupportedPageUrl(value)` — parses a URL and allows only `http:`,
  `https:`, `file:`, and the extension's own `chrome-extension://<id>/*`
  pages. Everything else is rejected, including malformed/empty inputs.
- `isInjectableTab(tab)` — convenience wrapper that requires a tab id and a
  supported `tab.url` (falls back to `tab.pendingUrl`).

`sendPanelCommandToTab` now calls `isInjectableTab(tab)` before invoking
`sendPanelMessage`. On an unsupported tab it returns
`{ ok: false, error: "Restricted page", reason: "unsupported_url" }` and
never touches `chrome.tabs.sendMessage` or `chrome.scripting.executeScript`.
The toolbar `chrome.action.onClicked` listener and `handleChromeCommand`
both flow through `sendPanelCommandToTab`, so both surfaces are covered.

Both helpers are added to the CommonJS `module.exports` block so they can be
unit-tested.

## Files changed

- `chrome-extension/background.js` — added `isSupportedPageUrl` /
  `isInjectableTab`, guarded `sendPanelCommandToTab`, exported the helpers.
- `test/background-foundation.test.js` — updated the existing
  "injection fallback" test to attach an `https://example.com/page` URL to
  the active tab; replaced the previous restricted-page test with one that
  drives a `chrome://extensions` active tab and asserts no `tabMessages` /
  `scriptInjections` / `cssInjections` are recorded; added a focused unit
  test covering the new helpers across `http`, `https`, `file`, `chrome`,
  `chrome-untrusted`, `about`, `edge`, `devtools`, `view-source`, `data`,
  `javascript`, and empty inputs.

## Files inspected (not changed)

- `chrome-extension/manifest.json` — confirmed `<all_urls>` content-script
  matches plus `http://*/*` and `https://*/*` host permissions; the allow
  list intentionally mirrors what the manifest can actually inject into.

## Verification commands run

- `node --test test/background-foundation.test.js`

## Successful checks

- 29 / 29 tests pass, including:
  - `service-worker Chrome command opens command palette on active tab with injection fallback`
  - `service-worker Chrome command short-circuits on restricted chrome:// tabs without messaging or injection`
  - `service-worker isSupportedPageUrl gates schemes that content scripts cannot run on`

## Failed checks

None.

## Suspected causes for failures

N/A.

## Known risks

- `file://` is allowed by the helper even though the manifest does not
  request `file:///*` host permissions; injection will still fail in
  practice on such tabs and is caught by the existing try/catch in
  `sendPanelMessage`. Returning `{ ok: false }` here matches existing
  behavior for failed messaging.
- `chrome-extension://` is only allowed when `chrome.runtime.id` matches
  the URL hostname, so other extensions' pages are still blocked.
- The guard relies on the tab object carrying `url` or `pendingUrl`. If
  Chrome ever surfaces a clicked tab without either (e.g. very early in
  navigation), the action becomes a no-op returning `ok: false`. That is
  the safer failure mode than risking an injection error.

## Final status

Implementation complete; awaiting independent verification per
`CLAUDE.md`'s required-logs workflow.
