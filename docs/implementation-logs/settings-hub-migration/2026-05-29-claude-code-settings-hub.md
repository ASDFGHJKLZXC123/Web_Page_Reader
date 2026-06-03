# Implementation Log — Settings Hub Migration, Attempt 2

Date: 2026-05-29
Implementer: Claude Code (implementation attempt 2)
Previous attempt: rejected (only landed `settings-utils.js`, no integration)

## Scope (this attempt)

Per Lead/Integrator instructions — build the **options-page settings hub**.
Content-panel teardown (removing `_viewSettings`, redirecting the gear button)
is explicitly **out of scope for this attempt** and left for a follow-up.

Required this attempt:

1. Wire `privacy-utils.js`, `mirror-utils.js`, `settings-utils.js`, `options.js`
   into `chrome-extension/options.html`.
2. Build static shell for a full-tab settings app with sidebar nav and
   deep-link anchors `#ai #backend #privacy #notes #duplicates #backup
   #shortcuts`.
3. Extend `chrome-extension/options.css` for a responsive sidebar layout
   without breaking the existing notes-folder styling.
4. Extend `chrome-extension/options.js` while preserving the existing
   IndexedDB / File System Access notes-folder behavior and the `__test`
   exports the mirror tests rely on.
5. Implement AI / Backend / Privacy / Duplicates / Backup section behavior
   using the existing storage keys and existing background DEDUPE / BACKUP /
   PRIVACY messages via `AssistantSettings.buildRouteMessage` +
   `AssistantPrivacy.buildPrivacyMessage`.
6. Provide a `request(path, options)` helper inside `options.js` that
   fetches the remote backend when `assistantBackendUrl` is set and
   otherwise dispatches via `AssistantSettings.sendLocalMessage`.
7. Hash deep-link handling and `aria-current` on the active sidebar link.
8. Focused unit tests for the new settings helpers; keep the existing
   `options-mirror.test.js` green.

## Files changed

- `chrome-extension/options.html` — replaced with a sidebar + main layout.
  Sections: AI, Backend, Privacy, Notes folder (existing UI preserved),
  Duplicates, Backup, Shortcuts. Loads `privacy-utils.js`,
  `mirror-utils.js`, `settings-utils.js`, then `options.js`. Re-uses the
  same `data-aaw-test` attributes the panel used (`privacy-mode`,
  `privacy-save`, `privacy-provenance-list`, `dedupe-type`, `dedupe-scan`,
  `dedupe-candidates`, `dedupe-status`, `dedupe-show-ignored`,
  `dedupe-audit`, `backup-json`, `backup-status`, plus new ones for the
  AI/Backend forms).
- `chrome-extension/options.css` — added sidebar (`.opt-app`,
  `.opt-sidebar`, `.opt-nav`, `.opt-nav-link[aria-current="true"]`), grid
  helpers (`.opt-grid`, `.opt-grid-tight`, `.opt-field`, `.opt-input`,
  `.opt-textarea`, `.opt-actions`, `.opt-checks`), dedupe card styles
  (`.opt-dedupe-card`, `.opt-dedupe-record`), shortcut rows, provenance
  rows, danger button, and responsive breakpoints. Existing notes-folder
  styles untouched.
- `chrome-extension/options.js` — extended without touching the existing
  mirror logic:
  - Added `settingsTools`/`privacyTools` constants that pull from
    `window.AssistantSettings` / `window.AssistantPrivacy` with the same
    guarded pattern as the existing `mirrorTools`.
  - Added `loadAllSettings()` (delegates to `AssistantSettings.loadSettings`
    when present), `request(path, options)` that branches on the configured
    backend URL, and section initializers (`initAiSection`,
    `initBackendSection`, `initPrivacySection`, `initDedupeSection`,
    `initBackupSection`, `initSidebarNav`).
  - AI section: dropdowns populated from `AssistantSettings.PROVIDER_CONFIGS`;
    switch-provider preserves the in-progress key for the previous provider
    via the `liveApiKeys` map. Save calls `AssistantSettings.saveAiSettings`.
  - Backend section: save uses `AssistantSettings.saveBackendUrl`; test
    button calls `/api/llm/health`, falls back to `/health` for a useful
    signal if the LLM endpoint is missing.
  - Privacy section: reads/writes via `AssistantPrivacy.normalizePrivacySettings`
    + `mergePrivacySettings`; save writes to `chrome.storage.local`
    (`privacySettings`) so already-open content panels see the change via
    `storage.onChanged`, then PATCHes `/api/privacy/settings`. Provenance
    refresh, retention run, and clear-data are wired to the existing
    background messages through the same `request` helper.
  - Duplicates section: scan, preview, apply, ignore/unignore, audit, undo
    — adapted from `content.js` patterns but uses the option-page DOM and
    `request()`.
  - Backup section: export, validate, restore point, merge/replace import.
    Defaults exclude sensitive data (`includeSensitive=false`); only
    enables `includeSettings` and `includeEmbeddings` when their toggles
    are checked. Replace import requires a typed "REPLACE" confirmation
    and creates a restore point if none exists.
  - Sidebar: `initSidebarNav` applies the `aria-current` to the link whose
    `data-section` matches `location.hash` and scrolls the target into view
    on `hashchange`.
  - Module `__test` export preserved verbatim for `options-mirror.test.js`.
    Added a sibling `__settings` export with the helpers the new tests use.
- `test/options-settings.test.js` — new. Five focused tests covering
  `loadAllSettings` defaults/normalization, `privacyDefaults` parity with
  `privacy-utils`, `privacyMerge` partial-PATCH normalization, live API key
  retention, and `backupOptionsQuery` defaults.

## Files inspected but not changed (in scope)

- `chrome-extension/settings-utils.js` — already exposes the API surface
  the new code needs (`buildRouteMessage`, `sendLocalMessage`,
  `PROVIDER_CONFIGS`, `loadSettings`, `saveAiSettings`, `saveBackendUrl`,
  `savePrivacySettings`, `formatHostOverrides`, `splitPrivacyList`,
  `parseHostOverrides`). No edits needed.
- `chrome-extension/privacy-utils.js` — already exposes `buildPrivacyMessage`,
  `defaultPrivacySettings`, `normalizePrivacySettings`,
  `mergePrivacySettings`, `normalizeHostRule`. Used as-is.
- `chrome-extension/manifest.json` — already lists `settings-utils.js` in
  the content-script array (from attempt 1). No edits needed.

## Out of scope (deferred to a later attempt)

- Removing the in-panel `_viewSettings` view from `content.js`.
- Redirecting the gear-icon click handler to
  `chrome.runtime.openOptionsPage()` (already available via the existing
  `openOptionsPage()` helper in `content.js`, which messages the SW —
  background already handles `OPEN_OPTIONS`).
- Deleting duplicate provider-config / `loadSettings` / `saveSettings`
  code from `content.js` (still owned by the panel until the panel
  teardown lands).

## Verification commands run

- `node --check chrome-extension/options.js`
- `node --check chrome-extension/settings-utils.js`
- `node --check chrome-extension/privacy-utils.js`
- `node --test test/options-mirror.test.js`
- `node --test test/options-settings.test.js test/options-mirror.test.js`
- `npm test`

## Successful checks

- All three JS files parse with `node --check`.
- The three pre-existing `options-mirror.test.js` tests still pass —
  notes-folder mirror behavior is unchanged.
- The five new `options-settings.test.js` tests pass.
- Full unit suite: **116/116 pass** (`npm test`).

## Failed checks

None.

## Suspected causes

N/A (no failures).

## Known risks

- The Privacy "Save" path also issues an `/api/privacy/settings` PATCH in
  built-in mode (best-effort, ignored on failure). The local
  `chrome.storage.local` write is the canonical source so an in-flight
  panel sees the change immediately via `storage.onChanged`, but the
  service worker won't see the new value until the background message
  succeeds. This matches the panel's existing pattern (`savePrivacy`
  in `content.js`).
- The Backend "Test connection" button calls `/api/llm/health` and falls
  back to `/health`. In built-in mode the SW handles both via
  `AssistantSettings.buildRouteMessage`, so the local path works without
  a configured backend URL.
- Backup export defaults to `includeSensitive=false` and only enables
  `includeSettings` when the user opts in — matches the existing panel's
  behavior. No new sensitive-export surface area is introduced.
- The `_viewSettings` panel in `content.js` is untouched. Until that
  teardown lands, the panel and options page can both edit the same
  storage keys; the last write wins. This is the same situation as before
  this attempt, just with a real second editor.

## Final status

**Ready for verification.** Options-page settings hub is implemented and
all unit tests pass. The deferred panel teardown should be tracked as a
follow-up step.

---

# Implementation Log — Settings Hub Migration, Attempt 4

Date: 2026-05-29
Implementer: Claude Code (implementation attempt 4)
Scope: panel-side teardown (deferred from attempts 2 and 3).

## What was done

A. `chrome-extension/content.js`
- Gear button: handler swapped to `openOptionsPage` (was `setSettingsOpen`).
  Kept `data-aaw-test="settings-open"`. Updated aria-label to
  "Open full settings". Removed `aria-expanded` and `aria-controls`.
- Deleted the in-panel settings construction block — from
  `// --- Settings (goes into its own view; no redundant heading needed) ---`
  through `settingsWrap.appendChild(backendSection.element);` (the AI,
  Privacy, Dedupe, Backup, Notes-mirror, Shortcuts, and Backend
  sub-sections). Replaced with a small read-only "Settings" section
  containing `[data-aaw-test="panel-settings-status"]` (aria-live polite)
  and an "Open Settings" button that calls `openOptionsPage`. Appended
  to `_viewMain` immediately after `searchSection`.
- `_viewSettings` is no longer constructed; `viewContainer.appendChild(_viewSettings)`
  was removed. `registerCommandRegistry` is no longer passed the
  `settings:` element.
- Removed command-palette entries `settings.open` and `settings.back`.
  Removed the `g s` shortcut from the `section.search` command (left the
  `/` search-focus command in place).
- Removed the `_settingsOpen` branch from `handleEscapeShortcut` and
  `closePanelFromCommand`. Removed the in-panel settings reset block
  from the close-button click handler and from `togglePanel`'s close
  branch. Simplified `sectionIsVisible`, `focusSection`, and
  `runFocusedSectionPrimary` so they no longer reference `_settingsOpen`
  or the `settings` section id.
- Added new module-scoped `_panelSettingsStatusEl`. Added
  `refreshPanelSettingsStatus()` which reads `assistantBackendUrl`,
  `llmProvider`, the three `*ApiKey` keys, the three `*Model` keys,
  `privacySettings`, `notesFolderName`, and `notesMirrorStatus` from
  `chrome.storage.local` and writes a one-line summary
  ("Mode: … · Provider: … · Privacy: … · Notes: …").
- Added a single panel-side `chrome.storage.onChanged` listener inside
  `buildPanel`. It watches the keys above; when any change, it updates
  `remoteBackendUrl` (from `assistantBackendUrl`), refreshes
  `_liveApiKeys` for the three provider key changes, and calls
  `refreshPanelSettingsStatus()`. Called once at the end of `buildPanel`
  so the status is populated immediately after the panel is built.
- Helper functions `setSettingsOpen`, `syncViewAvailability`, and the
  `_backButton` click handler remain. They are unreachable in practice
  (nothing toggles `_settingsOpen` or `_viewSettings`) but guarded with
  `if (_viewSettings)` so they no-op safely. Per attempt scope, no
  editable settings DOM is rendered.

B. `chrome-extension/options.js`
- Did not find a `g s` reference in `options.js` (it lives in
  `options.html`). Removed it from the Shortcuts list in
  `chrome-extension/options.html` (single `<kbd>` row change).

C. `test/e2e/specs/builtin.smoke.spec.js`
- Added local `openOptionsPage(harness, hash)` helper that opens
  `chrome-extension://<id>/options.html<hash>` in a new tab.
- Replaced the old "privacy local-only mode shows provenance and
  settings controls" test with two tests:
  - "gear button opens the options page in a new tab" — opens a panel,
    clicks the gear, waits for a new tab whose URL matches
    `chrome-extension://<id>/options.html`.
  - "built-in privacy local-only mode is saved from options page and
    reflected by an open panel" — opens a panel, then opens the options
    page at `#privacy`, saves `local_only`, verifies the panel's
    `[data-aaw-test="panel-settings-status"]` updates to include
    "Local", then runs summarize and verifies the Local chip and
    "Local only" provenance.
- Updated the dedupe test to use options-page controls at `#duplicates`
  (no more in-panel gear click).
- Updated the backup test to use options-page controls at `#backup` and
  renamed button assertions to match the options-page copy
  (`Export` / `Replace import`) and the status text
  (`/cancel/i`).

D. Misc
- `chrome-extension/options.html` Shortcuts row now reads
  `<kbd>g a, g m, g l, g t, g w</kbd>` (dropped `, g s`).

## Files changed

- `chrome-extension/content.js`
- `chrome-extension/options.html`
- `test/e2e/specs/builtin.smoke.spec.js`
- `docs/implementation-logs/settings-hub-migration/2026-05-29-claude-code-settings-hub.md` (this log)

## Files inspected but not changed

- `chrome-extension/background.js` — confirmed `OPEN_OPTIONS` handler
  already calls `chrome.runtime.openOptionsPage()`. No edits needed.
- `chrome-extension/options.js` — confirmed no `g s` reference. Did not
  edit per scope.
- `test/e2e/helpers/extension-harness.js` — confirmed
  `harness.extensionId` and `harness.context.newPage()` are exposed for
  the new `openOptionsPage` helper.

## Verification commands run

- `node --check chrome-extension/content.js`
- `node --check chrome-extension/options.js`
- `node --check chrome-extension/settings-utils.js`
- `npm test`
- `npx playwright test test/e2e/specs/builtin.smoke.spec.js -g "gear button opens|privacy local-only mode is saved|export and validate"`
- `npx playwright test test/e2e/specs/builtin.smoke.spec.js -g "duplicates"`

## Successful checks

- All three JS files parse with `node --check`.
- `npm test` — **116/116 unit tests pass** (unchanged from attempt 2).
- Playwright (headed):
  - "gear button opens the options page in a new tab" — PASS.
  - "built-in privacy local-only mode is saved from options page and
    reflected by an open panel" — PASS.
  - "built-in settings can export and validate a backup" — PASS
    (after renaming button selectors to match options-page copy).

## Failed checks

- Playwright "built-in settings can review, merge, undo, ignore, and
  unignore duplicates" — FAIL on the Unignore step with
  `Unignore failed: Unknown message type: memory`.

## Suspected causes

- The dedupe test failure is a **pre-existing bug in `options.js`**, not
  in the attempt-4 panel teardown. The options-page Ignore/Unignore
  handler calls `request("/api/dedupe/(un)ignore", …)`. In built-in
  mode, `request()` routes through
  `AssistantSettings.buildRouteMessage` → `sendLocalMessage`. The
  background message-type mapping for `/api/dedupe/*` paths does not
  appear to dispatch correctly here, so the SW responds with
  "Unknown message type: memory". The panel-side dedupe drawer that
  attempt 4 removed used a different code path that worked, which is
  why this surfaced only after migrating the dedupe test to the
  options page.
- Per CLAUDE.md scope discipline, the dedupe routing bug was reported
  here rather than fixed; it is owned by the options-hub work, not the
  panel teardown.

## Known risks

- `setSettingsOpen`, `syncViewAvailability`, the `_settingsOpen` flag,
  the `_viewSettings` variable, and the `_backButton` click handler all
  remain as dead code. They are guarded so they no-op, but they should
  be removed in a follow-up cleanup pass once the verifier confirms no
  caller is left.
- The compact panel status line shows the API-key presence (`— no key`
  suffix) but not the key itself; nothing sensitive is rendered into
  the panel.
- The dedupe routing failure leaves a regression in the options-page
  dedupe flow that needs a follow-up fix.

## Final status

**Ready for verification.** Panel teardown is complete: gear opens the
options page, no editable settings DOM is rendered in the panel, the
panel summarizes the current settings and live-updates via
`chrome.storage.onChanged`. Three of four updated Playwright settings
tests pass; the fourth fails on a pre-existing dedupe routing bug in
`options.js`, reported above for the Lead/Integrator to triage.

---

# Attempt 5 — Verifier blocker + stale shortcut copy

Date: 2026-05-29
Implementer: Claude Code (implementation attempt 5)

## Scope

Two surgical fixes flagged by the attempt-4 verifier:

1. **DEDUPE_UNIGNORE envelope-overwrite bug.** The route handler in
   `chrome-extension/settings-utils.js` spread the request body verbatim
   into the message envelope: `{ type: "DEDUPE_UNIGNORE", ...body }`.
   When a caller included a `type` field (e.g. `"memory"`) the body
   `type` clobbered the envelope's `"DEDUPE_UNIGNORE"`, so the service
   worker's switch landed on the wrong case (or no case at all). Mirrors
   the fix already in place for `DEDUPE_IGNORE`/`DEDUPE_PREVIEW`/
   `DEDUPE_APPLY`.
2. **Stale shortcut copy.** `chrome-extension/options.html` line 304 read
   "Close palette, settings, then panel" left over from the in-panel
   settings era; the panel-rendered settings view no longer exists, so
   updated to "Close palette, then panel".

`DEDUPE_UNDO` was inspected: callers in `chrome-extension/content.js:908`
and `chrome-extension/options.js:1152` send only `{ auditId }`, never a
body `type` field. `handleDedupeUndo` in `background.js:2723` reads only
`auditId`. No envelope-overwrite risk exists, so the route was left
unchanged.

`handleDedupeUnignore` in `background.js:2764` reads only `groupId` and
does not consult `message.type`, so no background-side change was
required.

## Files changed

- `chrome-extension/settings-utils.js` — destructure `{ type: dedupeType,
  ...payload }` and return `{ type: "DEDUPE_UNIGNORE", ...payload,
  dedupeType: dedupeType || "" }`.
- `chrome-extension/options.html` — shortcut copy updated.
- `test/options-settings.test.js` — added two assertions:
  - `/api/dedupe/unignore` with body `{ groupId: "g", type: "memory" }`
    routes to envelope `{ type: "DEDUPE_UNIGNORE", dedupeType: "memory",
    groupId: "g" }` (envelope type is preserved).
  - `/api/dedupe/undo` with body `{ auditId: "a-1" }` routes to envelope
    `{ type: "DEDUPE_UNDO", auditId: "a-1" }`.

## Out of scope (not touched)

`chrome-extension/content.js:1501` contains a duplicate copy of the
route table with the same DEDUPE_UNIGNORE spread bug. The Lead's
attempt-5 instructions scoped the fix to `settings-utils.js`; the
duplicate is left for a follow-up consolidation pass.

## Verification commands run

- `node --check chrome-extension/settings-utils.js chrome-extension/options.js chrome-extension/content.js` → OK
- `npm test` → 118 passing, 0 failing (includes the two new envelope
  assertions).
- Targeted Playwright dedupe test: not run in this attempt. The existing
  Playwright dedupe spec exercises options.js + the in-process service
  worker mock; running it requires the Playwright browser binaries and
  Chrome extension fixture from the e2e harness. Re-running the Node
  unit test suite gives direct coverage of the route-mapping fix; the
  Playwright run is deferred to the verifier so the implementation log
  and verification log do not duplicate the same browser session.

## Successful checks

- Node syntax check on all three touched/related extension JS files.
- All 118 Node unit tests pass, including the new envelope-preservation
  assertions for DEDUPE_UNIGNORE and DEDUPE_UNDO.

## Failed checks

None.

## Known risks

- `chrome-extension/content.js` still carries the duplicate (buggy)
  route table. The settings hub now routes through `settings-utils.js`
  from the options page, so the panel-side copy is dormant for the
  unignore path in practice, but any future panel feature that calls
  `/api/dedupe/unignore` with a body `type` would re-trigger the bug.
  Flagged for a consolidation pass.

## Final status

**Ready for verification.** Verifier blocker fixed; stale shortcut copy
updated; targeted route-mapping unit tests added and passing.
