# Implementation Log — Personal-Use Documentation Pass

- Date: 2026-06-03
- Implementer: Claude Code
- Milestone: personal-use-wrap-up
- Type: documentation only (no application code changed)

## What was done

Scoped, docs-only pass to make the project repeatable for personal loaded-unpacked use:

1. **`README.md` — targeted edits** (consistent with existing README voice/structure):
   - Added an `npm ci` (install from lockfile) step to "Run locally".
   - Added a "Modes" section clarifying built-in service-worker mode (default, blank
     backend URL, `chrome.storage.local`) vs local/remote backend mode (URL set, Node
     backend, `NOTES_DIR`/`backend/data/`, `.env` key), route parity, and backend-down
     behavior.
   - Added a "Privacy and secrets" section: privacy modes (`auto`/`ask`/`local_only`) and
     site rules, redaction/URL-host reduction, where API keys live, `.env` ignored, and
     accurate backup-export defaults (backend `includeSettings=false`/`includeSensitive=false`
     and never exports keys; built-in supports `includeSensitive` but no UI enables it).
   - Existing Node 18+, `.env` from `.env.example`, `npm start` at `http://127.0.0.1:8787`,
     load-unpacked steps, test commands, limitations, and manual QA checklist were already
     present and were left intact.

2. **`docs/personal-use-readiness.md` — added.** Wrap-up boundary (ship/defer/out-of-scope,
   with `react 2/` documented as unrelated/preserved), MV3 manifest audit with per-permission
   rationale (activeTab, alarms, scripting, storage, unlimitedStorage, host permissions,
   `<all_urls>` content scripts, commands, icons, options page, and the absence of
   `web_accessible_resources`/explicit CSP), MV3 lifecycle/reload expectations + manual check
   procedure, built-in vs backend parity and backend-down behavior, privacy mode expectations,
   secrets/API-key handling, backup/restore + destructive ops + storage scale, and observed
   automated checks quoted from prior logs.

3. **`docs/personal-use-backlog.md` — added.** Severity-tagged backlog: real-site manual QA
   (P1), storage scale/stress (P2), service-worker idle/restart manual check (P2), redaction
   disabled by default (P2, discovered by inspection), Web Store hardening out of scope (P3),
   provider/model freshness review (P3), built-in `includeSensitive` reachable outside the UI
   (P3, discovered), lead-extraction mis-pairing (P3), and commit hygiene re: `react 2/` (P3,
   discovered).

4. **This implementation log — added.**

## Files changed

- `README.md` — three targeted additions (npm ci step, Modes section, Privacy and secrets section).
- `docs/personal-use-readiness.md` — new.
- `docs/personal-use-backlog.md` — new.
- `docs/implementation-logs/personal-use-wrap-up/2026-06-03-claude-code-personal-use-docs.md` — this log.

No application code (extension or backend) was changed.

## Files inspected (not changed)

- `chrome-extension/manifest.json` — permissions, host permissions, content scripts,
  commands, icons, options_ui; confirmed no `web_accessible_resources` / no explicit CSP.
- `chrome-extension/privacy-utils.js` (and `backend/src/lib/privacy.js` re-export) —
  AI modes, default settings (`redaction.enabled = false`), site-rule precedence,
  `PRESERVED_STORAGE_KEYS`.
- `chrome-extension/content.js` — `request()` routing (built-in vs backend), `isLocalMode`,
  backup options query (`includeSensitive` hardcoded false).
- `chrome-extension/background.js` — `handleBackupExport` (`includeSensitive` support),
  built-in export source/mode.
- `chrome-extension/options.js` / `options.html` — backup UI exposes
  settings/embeddings/audit only; `includeSensitive=false`.
- `backend/src/lib/storage.js` — `exportBackup`/`importBackup`/restore-point/validation,
  backup defaults (`includeSettings=false`, `includeSensitive=false`, settings emitted empty).
- `backend/src/server.js` — `/api/backup/export` query defaults.
- `.env.example`, `.gitignore`, `package.json`, `README.md`.
- Prior logs in `docs/implementation-logs/personal-use-wrap-up/` for cited test results.

## Verification commands run

- None. This pass is documentation-only and changes no executable code. Per CLAUDE.md,
  `npm ci` / `npm test` / `npm run test:e2e` were **intentionally deferred** to the
  orchestrating agent's independent verification / final gate. The automated figures cited
  in the docs (npm test 137, e2e 33; cleanup verifier node --check, focused 42, npm test 137,
  e2e 33) are quoted from the prior 2026-06-03 personal-use-wrap-up logs, not re-run here.

## Successful checks

- Documented claims were cross-checked against source before writing:
  manifest permissions/keys; privacy modes and `redaction.enabled = false` default; mode
  routing (`content.js request()`); backup export defaults in backend (`storage.js`) and
  built-in (`background.js`); options UI exposing settings/embeddings/audit but not
  `includeSensitive`; `.env`/`backend/.env` git-ignored.
- README additions follow existing headings/style and do not renumber the "Run locally" steps.

## Failed checks

- None.

## Suspected causes for failures

- N/A — no failures.

## Known risks

- Automated suites were not re-run in this pass; the cited 137/33 figures rely on the prior
  logs being current. The final gate should re-run them.
- Real-site manual QA remains pending (tracked P1 in the backlog); docs explicitly mark it
  as not performed.
- The broad dirty worktree (including unrelated `react 2/`) was preserved untouched; commit
  hygiene to exclude it is tracked in the backlog.

## Final status

Complete (docs-only). README updated; `docs/personal-use-readiness.md` and
`docs/personal-use-backlog.md` added; this log written. No application code changed, no
commit made. Tests intentionally deferred to the orchestrating agent's verification/final gate.
