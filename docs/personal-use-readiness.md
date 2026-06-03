# Personal-Use Readiness

Scope: repeatable personal use of this project as a locally loaded-unpacked Chrome
extension (built-in mode) with an optional local Node backend. This document records
the wrap-up boundary, an MV3 manifest audit, mode parity, privacy/secrets behavior, and
the backup/restore expectations, plus what is covered by automated tests versus what is
still pending manual QA.

Date: 2026-06-03.

## Wrap-up boundary

- **Ship (in scope for personal use).** The Chrome extension under `chrome-extension/`
  (built-in service-worker mode) and the optional Node backend under `backend/`. Both
  expose the same API surface (see README "API overview"). Documentation: this file,
  `docs/personal-use-backlog.md`, README updates, and implementation logs.
- **Defer (tracked, not blocking personal use).** Items in
  `docs/personal-use-backlog.md`: real-site manual QA, storage scale/stress beyond the
  representative e2e fixtures, service-worker idle/restart manual confirmation, and
  periodic provider/model freshness review.
- **Out of scope.** Chrome Web Store packaging/hardening (CSP tightening,
  permission minimization for public distribution, store listing/review). This build
  targets personal loaded-unpacked use, not public distribution.
- **Unrelated / preserved — `react 2/`.** The top-level `react 2/` directory is an
  unrelated work tree carried in the dirty worktree. It is **not** part of this project
  and was deliberately left untouched. Do not build, test, edit, or revert it as part of
  this milestone.

## Manifest audit (`chrome-extension/manifest.json`)

Manifest V3. Each declared permission and capability with its rationale:

- **`activeTab`** — lets the toggle action operate on the current tab without a broad
  tabs grant; supports the user-invoked panel toggle.
- **`alarms`** — schedules background work (e.g. retention/maintenance ticks) in the
  service worker, which cannot rely on always-on timers.
- **`scripting`** — used by `background.js` to (re)inject content/utility scripts via
  `chrome.scripting.executeScript`, including the re-injection fallback after the
  service worker restarts or the extension context is invalidated.
- **`storage`** — `chrome.storage.local` is the source of truth for built-in mode:
  memory notes, contacts, tasks, drafts, privacy settings, provider/model selection, and
  API keys.
- **`unlimitedStorage`** — removes the default `chrome.storage.local` quota so saved
  memory, embeddings, and backups can grow without hitting the standard cap.
- **`host_permissions: http://*/* , https://*/*`** — required so the assistant can run on
  any webpage the user opens and so built-in mode can reach the configured AI provider's
  HTTPS endpoint directly from the service worker.
- **`content_scripts` matches `<all_urls>`** — the panel and its shared utilities
  (`privacy-utils.js`, `selection-replacement.js`, `shortcut-utils.js`,
  `settings-utils.js`, `content.js` + `styles.css`) inject on every page at
  `document_idle` so the assistant is available anywhere. This is the broadest match and
  the main reason this build is personal-use rather than store-distribution ready.
- **`commands`** — keyboard entry points: `_execute_action` (`Alt+Shift+A`, toggle
  panel) and `open-command-palette` (`Alt+Shift+K`).
- **`icons` / `action.default_icon`** — 16/32/48/128 PNGs under `chrome-extension/icons/`
  for the toolbar action and extension listing.
- **`options_ui`** — `options.html` opened in a tab (`open_in_tab: true`); hosts the
  notes-folder mirror configuration and the backup/restore UI.
- **No `web_accessible_resources` and no explicit `content_security_policy`.** The
  manifest declares neither key. Nothing is exposed to page contexts as a web-accessible
  resource, and the extension relies on the MV3 default CSP. For personal loaded-unpacked
  use this is acceptable; a Web Store submission would revisit CSP hardening (see backlog).

## MV3 lifecycle / reload expectations

The background is an MV3 service worker (`background.js`), which Chrome may terminate when
idle and restart on demand. Expectations:

- The service worker is **event-driven**: it spins up to handle messages/alarms and is
  torn down when idle. State must live in `chrome.storage.local` / IndexedDB, not in
  worker memory. Content scripts re-establish messaging on demand.
- After **editing extension files**, reload from `chrome://extensions` → this extension →
  reload. Content scripts only take effect on pages loaded/reloaded after the reload, so
  refresh any open tab where you want the new panel code.
- The **re-injection fallback** (see `docs/implementation-logs/script-reinjection/`) lets
  `background.js` re-inject content scripts if a page's context was invalidated by a
  reload, reducing "Extension context invalidated" failures.

Manual check procedure:

1. Load unpacked, open a normal http/https page, toggle the panel with `Alt+Shift+A`.
2. In `chrome://extensions`, open the service-worker console; confirm it shows "inactive"
   after ~30s idle, then click the extension action and confirm the worker wakes and the
   panel responds.
3. Reload the extension, return to the already-open tab, and confirm the panel still
   toggles (re-injection) or after a tab refresh.

## Mode parity and backend-down behavior

Two modes, selected by the backend URL saved in Settings (`assistantBackendUrl`):

- **Built-in mode (default, empty URL).** `content.js` routes API calls to the service
  worker via `chrome.runtime.sendMessage`; the worker fulfills them against
  `chrome.storage.local`. AI calls go directly to the provider with the stored key.
- **Local/remote backend mode (URL set).** `content.js` `fetch`es the same routes from
  the Node backend, which persists JSON under `NOTES_DIR` or `backend/data/` and uses
  `GEMINI_API_KEY` from `.env`.
- **Parity.** Both modes implement the same route set (analyze, memory, workspaces,
  contacts, tasks, privacy, backup), so feature behavior is intended to match. Storage
  location and the AI key source differ by mode.
- **Backend-down behavior.** In backend mode, if the backend is unreachable, requests
  fail (non-JSON/`fetch` error surfaced in the panel) until the backend is restarted or
  the user clears the backend URL to fall back to built-in mode. Built-in mode has no
  such external dependency.

## Privacy mode expectations

Privacy decisions are centralized in `chrome-extension/privacy-utils.js` (re-exported by
`backend/src/lib/privacy.js`), so content script, service worker, and backend share one
AI-send policy. Effective mode is `host override > excluded host (local_only) > global aiMode`.

- **`local_only`** — no page content is sent to any provider or backend-AI endpoint; the
  request is blocked from provider send and falls back to deterministic local analysis.
- **`ask`** — the operation requires per-request confirmation; unconfirmed requests are
  blocked, confirmed requests proceed once (`model_once`).
- **`auto`** — page content may be sent to the provider, subject to redaction and
  per-site rules.
- **Site rules** — excluded hosts force `local_only`; host overrides set the mode for a
  host or wildcard (`*.example.com`). Redaction (when enabled) strips emails/phones/
  token-like secrets from outbound payloads, and provider URLs are reduced to host unless
  `sendFullUrlToProvider` is set.
- **Redaction is off by default.** `defaultPrivacySettings()` ships
  `redaction.enabled = false`. Combined with the default `auto` mode, this means page
  content — including any emails, phone numbers, or token-like secrets on the page — is
  sent to the provider **unredacted** unless the user enables redaction or switches the
  request/host to `ask`/`local_only` (globally or via a per-site rule). Tracked as backlog
  P2 "Redaction disabled by default".

## Secrets / API key handling

- **`.env`** (and `backend/.env`) are git-ignored; they hold `GEMINI_API_KEY` and model
  config for backend mode. Never commit them.
- **`chrome.storage.local`** holds built-in-mode settings, including `geminiApiKey`,
  `openaiApiKey`, `anthropicApiKey`, provider/model selection, backend URL, and the
  privacy settings. Clear-data preserves these keys
  (`PRESERVED_STORAGE_KEYS` in `privacy-utils.js`).
- **Backup export — accurate behavior:**
  - **Backend** (`/api/backup/export`, `exportBackup` in `backend/src/lib/storage.js`):
    defaults `includeSettings=false` and `includeSensitive=false`. Even with
    `includeSettings=true`, the `settings` section is emitted empty and **no API keys are
    ever included** — the backend does not store provider API keys.
  - **Built-in** (`handleBackupExport` in `background.js`): supports `includeSensitive`,
    which *would* embed `geminiApiKey`/`openaiApiKey`/`anthropicApiKey` from
    `chrome.storage.local`. However, the **options backup UI** (`options.js`
    `backupOptionsQuery`, mirrored in the panel's `content.js`) exposes only
    `includeSettings`, `includeEmbeddings`, and `includeAudit`; it hardcodes
    `includeSensitive=false`. So through normal UI use, exports never contain API keys.

## Backup / restore, destructive operations, storage scale

- **Backup format** `aaw.backup.v1`; envelopes are validated before import
  (`validateBackupEnvelope`). Import supports `merge` and `replace` modes; `replace`
  requires a server-created restore point first.
- **Destructive operations** — clear-data buckets (`memory`, `embeddings`, `contacts`,
  `tasks`, `drafts`, `tableRows`, `privacyEvents`) and replace-mode import are guarded by
  validation and (for replace) a restore point; preserved storage keys are never removed
  by clear-data.
- **Storage scale** — `unlimitedStorage` lifts the local quota; retention settings can
  cap bucket growth by age. Automated coverage exercises representative volumes via the
  e2e fixtures, but high-volume scale/stress is **not** automated (see backlog).
- **Automated coverage vs manual QA.** Backup/restore, clear-data, retention, and route
  behavior are covered by the unit suite and e2e harness below. Real-site manual QA
  across diverse pages is **still pending** (see backlog and README manual QA checklist).

## Observed automated checks (from prior logs)

From `docs/implementation-logs/personal-use-wrap-up/` (2026-06-03):

- Baseline: `npm test` → **137 pass**; `npm run test:e2e` → **33 pass**.
- Cleanup verifier independently confirmed: `node --check` on `content.js`,
  `background.js`, and `backend/src/lib/storage.js` → OK; focused
  `test/workspace-storage.test.js` + `test/background-foundation.test.js` → **42 pass**;
  `npm test` → **137 pass**; `npm run test:e2e` → **33 pass** (matching baseline).

These figures are quoted from prior logs; this documentation pass did not re-run them
(see the implementation log). **Real-site manual QA on live external pages is pending**
and has not been performed.
