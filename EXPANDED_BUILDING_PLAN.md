# Expanded Building Plan

Project: AI Assistant Across Websites

Date: 2026-05-26

This plan expands the current Chrome extension frontend/backend so the product fully covers research assistance, selected-text rewriting, structured extraction, page memory, workspace organization, saved-memory search, CRM/lead capture, and task creation from webpages.

The plan is organized as sequential milestones. They are not independent feature branches. Each milestone must preserve all earlier behavior and must support both storage modes unless explicitly scoped to the options page or browser-only behavior:

- Remote backend mode: `backend/src/server.js` plus storage helpers.
- Built-in mode: MV3 `chrome-extension/background.js` service worker using `chrome.storage.local`.
- Frontend panel: `chrome-extension/content.js`.
- Options/folder mirror: `chrome-extension/options.js`, `options.html`, and `options.css`.

## Implementation Protocol

Each milestone should be implemented with this loop:

1. Call Claude Code to implement exactly one milestone.
2. Inspect the actual diff and changed files.
3. Run relevant tests:
   - `npm test`
   - milestone-specific unit tests
   - e2e tests after Milestone 1 lands
4. Call a verifier sub-agent with the milestone spec, changed files, and test output.
5. Fix verified issues before starting the next milestone.

No milestone is complete until implementation, local tests, and independent verification all pass.

## Global Requirements

- Preserve current user workflows and existing API compatibility unless a change is explicitly additive.
- Every new backend route must have a matching service-worker message and `content.js` built-in route mapping unless the feature is backend-only by design.
- Destructive operations must run through the existing write queues and must be covered by invalid-input, rollback/undo, stale-state, and storage-consistency tests.
- No raw prompts, raw provider responses, raw page HTML, or unbounded page text should be persisted in new metadata/audit logs.
- API keys must not be exported, cleared, or mirrored unless the user chooses an explicit advanced action.
- Folder mirror remains a one-way export. It is never an import source or authoritative data store.
- Privacy controls own all AI send decisions. Later model features must call into the privacy preflight path instead of creating their own AI gating.
- The context graph is read-derived in v1. Do not add a generic stored edge table or generic link-write endpoint in the first implementation.
- `memory.taskIds` is a legacy alias for workspace membership, not a task relationship. Treat it only as `workspaceIds` fallback. Memory-to-task relationships come from `memory.linkedTaskIds` and `task.sourceMemoryIds`.
- `memory.contactId` is an existing ad-hoc legacy field and may not be part of the normalized memory shape. Any memory normalization, backup import, dedupe rewrite, or remap must explicitly preserve it unless intentionally clearing a deleted contact reference.

## Claude Review Corrections Already Incorporated

The combined roadmap was reviewed with Claude Code in read-only mode. These corrections are already built into this plan:

- Reframed browser e2e as harness plus current baseline; later milestones add their own e2e specs.
- Made privacy the single owner of AI send decisions.
- Removed the conflicting generic `POST /api/context/links` from the context graph v1 plan.
- Made backup forward-extensible and explicit about privacy/dedupe state.
- Added missing route/message parity requirements.
- Added manifest permission additions:
  - `unlimitedStorage` for backup.
  - `alarms` for privacy retention.
  - `commands` for keyboard shortcuts.
- Made write-queue serialization explicit for backup, dedupe, retention, and clear-data operations.
- Clarified that local-only remote-mode AI behavior must be visible to the user, not silent.

## Milestone 1: Browser-Level QA Automation

### Goal

Add a reliable browser automation harness for the MV3 extension so future frontend work can be verified against real extension behavior.

### Key Changes

- Add Playwright as the e2e test runner.
- Launch Chromium with a persistent profile and load the unpacked extension using:
  - `--disable-extensions-except`
  - `--load-extension`
- Discover the extension ID from the MV3 service worker URL when available.
- Wake or retry MV3 service-worker access because the worker can be idle or terminated on launch.
- Support two e2e modes:
  - Built-in mode using `chrome.storage.local`.
  - Remote backend mode using an ephemeral backend with temporary `NOTES_DIR`.
- Add deterministic fixture pages for:
  - Article summarization.
  - Textarea/contenteditable rewrite.
  - Unsupported editor fallback.
  - Structured extraction.
  - Company/contact lead capture.
  - Task creation from page context.
- Add stable `data-aaw-test` selectors for current surfaces only. Later milestones add selectors for their own new UI.
- Capture screenshot and page HTML artifacts on failure.
- Add a lightweight backend HTTP route-test harness for `server.js` contract tests. Current tests mostly cover imported modules, so later route-family milestones need a reusable request helper rather than only e2e coverage.

### Scripts

- Keep `npm test` and `npm run test:unit` as `node --test`.
- Add:
  - `npm run test:e2e`
  - `npm run test:all`
  - `npm run playwright:install`

### Tests

- Baseline e2e smoke for current summarize, rewrite, extract, save memory, workspace, search, lead capture, and task creation flows.
- Unit tests for any new e2e helper utilities.
- Manual QA remains for browser file picker behavior until it can be automated safely.

### Acceptance Criteria

- E2e tests can load the unpacked MV3 extension locally.
- Built-in and backend modes are both testable.
- The harness is stable enough for later milestones to add focused specs.
- Existing `npm test` still passes.

### Verification Focus

- Confirm test scripts do not replace existing unit-test behavior.
- Confirm e2e runs do not require real provider API keys.
- Confirm fixture pages are local and deterministic.

## Milestone 2: Privacy Controls Foundation

### Goal

Prevent accidental model/provider transmission, make storage behavior visible, and give users clear cleanup controls.

### Key Changes

- Add `privacySettings` with backward-compatible defaults:
  - `schemaVersion: 1`
  - `aiMode: "auto" | "ask" | "local_only"`; default `auto`
  - `redaction.enabled`
  - `redaction.applyToModelPayload`
  - `redaction.redactEmails`
  - `redaction.redactPhones`
  - `redaction.redactTokenLikeSecrets`
  - `redaction.sendFullUrlToProvider`; default `false`
  - `siteRules.excludedHosts`
  - `siteRules.hostOverrides`
  - `retention.enabled`
  - `retention.memoryDays`
  - `retention.contactsDays`
  - `retention.tasksDays`
  - `retention.draftsDays`
  - `retention.tableRowsDays`
  - `retention.privacyEventsDays`; default `90`
  - `retention.embeddingsPolicy: "with_memory"`
- Store built-in settings in `chrome.storage.local`.
- Add backend `privacySettings` and `privacyEvents` to the normalized local JSON shape.
- Add client-side privacy preflight in `content.js` before outbound requests that include page or selected content.
- Compute effective privacy mode from:
  - host override
  - excluded host
  - global AI mode
- Site matching supports normalized exact hosts and `*.example.com`.
- Redaction preview runs locally before any backend/model call.
- Apply redaction to outbound model payloads, including recursive string fields in `pageMeta`.
- Strip query/hash from URLs sent to providers unless `sendFullUrlToProvider` is enabled.
- Ask mode shows a one-operation confirmation with:
  - provider/model or backend destination
  - content source
  - original/submitted character counts
  - redaction counts
  - current site rule
- Ask mode passes request-scoped `aiMode: "model_once"` only for that operation.
- Local-only AI in remote backend mode must bypass remote AI endpoints and show a visible local fallback/provenance state.
- Local-only rewrite returns a copy-only local fallback and does not directly replace selected text.
- Add compact provenance indicators on result cards, memory cards, contacts, and tasks.
- Add Settings UI for:
  - privacy mode
  - site rules
  - redaction
  - retention
  - clear data
  - recent provenance

### Interfaces

Backend routes and matching service-worker messages:

- `GET /api/privacy/settings` -> `PRIVACY_SETTINGS_GET`
- `PATCH /api/privacy/settings` -> `PRIVACY_SETTINGS_PATCH`
- `POST /api/privacy/clear-data` -> `PRIVACY_CLEAR_DATA`
- `GET /api/privacy/provenance` -> `PRIVACY_PROVENANCE_LIST`
- `POST /api/privacy/retention/run` -> `PRIVACY_RETENTION_RUN`

Clear-data body:

```json
{
  "buckets": ["memory", "embeddings", "contacts", "tasks", "drafts", "tableRows", "privacyEvents"],
  "before": "2026-05-26T00:00:00.000Z",
  "confirmationToken": "required-for-destructive-clear"
}
```

Provenance metadata shape:

```json
{
  "operation": "summarize",
  "effectiveAiMode": "local_only",
  "provider": "",
  "model": "",
  "sentToProvider": false,
  "sentToBackend": false,
  "contentSource": "selection",
  "originalCharCount": 0,
  "submittedCharCount": 0,
  "redactionCounts": {},
  "siteRule": "",
  "storedBuckets": [],
  "timestamp": "2026-05-26T00:00:00.000Z"
}
```

### Manifest

- Add `alarms` permission for built-in retention scheduling.

### Tests

- Privacy settings normalization.
- Host and wildcard matching.
- Precedence: host override, excluded host, global mode.
- Request-scoped `model_once`.
- Redaction counts and URL sanitization.
- Provenance sanitization.
- `content.js` request tests proving local-only and excluded-site AI operations do not call remote backend AI or provider fetches.
- `buildMessage` coverage for all `/api/privacy/*` routes.
- Backend tests for privacy routes, retention, clear-data atomic writes, and embeddings compaction.
- Service-worker tests for `PRIVACY_*`, alarms, local-only gating, and memory mirror events.
- Backup compatibility tests confirming privacy settings export only with settings enabled and privacy events are excluded by default.

### Acceptance Criteria

- Local-only and excluded-site AI operations never send page or selected content to providers.
- In remote mode, local-only AI payloads do not go to backend AI endpoints.
- Ask mode prompts before content leaves the browser for AI processing.
- Redacted payloads, not originals, are sent when redaction is enabled.
- Clear-data does not remove provider settings or API keys by default.
- Retention cleanup works in backend and built-in modes.
- Existing installs behave as they do today until privacy settings are changed.

### Verification Focus

- Confirm privacy preflight is truly client-side.
- Confirm no remote redaction-preview route sends raw page content to a backend.
- Confirm all new privacy routes have built-in route mapping.

## Milestone 3: Model-Backed Extraction Upgrades

### Goal

Upgrade extraction into a validated pipeline for page info, lead capture, and task drafting while preserving local fallback and privacy controls.

### Key Changes

- Build local deterministic fallback first for every extraction.
- Use the configured model only when privacy preflight allows it.
- Merge model output into fallback without overwriting trusted local metadata:
  - source URL
  - canonical URL
  - safe links
  - emails
  - phones
  - submitted/original character counts
  - page metadata timestamps
- Add extraction contracts:
  - `page_info` v2
  - `lead_capture`
  - `task_draft`
- Add provider-backed structured generation:
  - Built-in mode uses active extension provider settings.
  - Backend mode uses environment/provider config.
  - No cross-provider retry by default.
  - Provider errors, timeouts, malformed JSON, or validation failures fall back locally.
- Add UI provenance labels:
  - Local fallback
  - Model
  - Model plus local validated
- Add "Draft From Page" for tasks:
  - editable title
  - editable notes
  - due date
  - priority
  - linked source memory

### Interfaces

Keep `POST /api/assist/analyze` backward-compatible:

```json
{
  "mode": "extract",
  "content": "",
  "title": "",
  "url": "",
  "pageMeta": {},
  "instruction": "",
  "aiMode": "auto"
}
```

Response remains:

```json
{
  "mode": "extract",
  "output": {}
}
```

Add additive v2 extraction fields:

- `schemaVersion: 2`
- `confidence`
- `fieldConfidence`
- `extractionMeta.engine`
- `extractionMeta.provider`
- `extractionMeta.model`
- `extractionMeta.promptVersion`
- `extractionMeta.fallbackReason`
- `extractionMeta.validationWarnings`
- `extractionMeta.provenance`

Keep `POST /api/contacts/extract` backward-compatible:

- Response remains `{ "contacts": [] }`
- Add `extractionMeta`
- Add optional per-contact confidence/provenance

Add task draft:

- `POST /api/actions/tasks/draft`
- `TASK_DRAFT`

Response:

```json
{
  "draft": {
    "title": "",
    "notes": "",
    "dueDate": "",
    "priority": "none",
    "sourceUrl": "",
    "sourceTitle": "",
    "sourceMemoryIds": []
  },
  "extractionMeta": {}
}
```

### Tests

- Page extraction v2 validation and normalization.
- Stored v1 extraction rendering/back-compat.
- Invalid JSON fallback.
- Unsafe link stripping.
- Oversized array clamping.
- Wrong field type sanitization.
- Local fallback with no provider key.
- Model merge cannot overwrite trusted fallback fields.
- Lead extraction creates editable drafts.
- Task draft creates editable fields and falls back on provider failure.
- Backend route tests for `/api/assist/analyze`, `/api/contacts/extract`, and `/api/actions/tasks/draft`.
- Service-worker parity tests for `ANALYZE`, `CONTACT_EXTRACT`, and `TASK_DRAFT`.
- Privacy mode tests for `auto`, `local_only`, and `model_once`.

### Acceptance Criteria

- Page extract, lead capture, and task draft work with no API key.
- Model output enriches extraction only when privacy allows.
- Invalid model output never breaks the UI.
- Backend and built-in modes return the same schema shape.
- Existing v1 saved extractions still render.

### Verification Focus

- Confirm no second AI-gating path is introduced.
- Confirm local fallback is always available.
- Confirm privacy provenance is included but raw content is not persisted.

## Milestone 4: Better Task and Contact Management

### Goal

Expand contacts and tasks into usable list-management surfaces with filtering, sorting, pagination, batch operations, and safe cleanup.

### Key Changes

- Add shared list helpers:
  - query normalization
  - enum validation
  - `limit` clamp to `1..200`
  - `offset >= 0`
  - full-text search
  - stable sorting
  - pagination after filtering/sorting
  - derived non-persistent `listMeta`
- Contacts:
  - filters by statuses, workspace, source host, source URL key, and query
  - sorting by updated, created, name, company, lead status, source
  - delete clears legacy `memory.contactId`
- Tasks:
  - filters by statuses, priorities, due bucket/range, workspace, source host, source URL key, and query
  - sorting by updated, created, due date, priority, status, title, source
  - delete removes task ID from memory `linkedTaskIds`
- Batch operations:
  - update and delete contacts/tasks
  - write-lock protected
  - per-ID success/failure response
- Frontend:
  - filter rows
  - multi-select filters
  - select-all-current-page
  - bulk toolbar
  - per-card pending state
  - stale response sequence tokens

### Interfaces

Extend:

- `GET /api/contacts`
- `GET /api/actions/tasks`

Add:

- `DELETE /api/actions/tasks/:id`
- `POST /api/contacts/batch`
- `POST /api/actions/tasks/batch`

Service-worker messages:

- Extend existing `CONTACT_LIST`
- `CONTACT_BATCH`
- Extend existing `TASK_LIST`
- `TASK_DELETE`
- `TASK_BATCH`

List response:

```json
{
  "contacts": [],
  "tasks": [],
  "total": 0,
  "limit": 20,
  "offset": 0,
  "filters": {},
  "sort": { "field": "updatedAt", "dir": "desc" },
  "facets": {
    "statuses": {},
    "priorities": {},
    "workspaces": [],
    "sources": []
  }
}
```

Batch response:

```json
{
  "changed": 2,
  "failed": 1,
  "results": [
    { "id": "id_1", "ok": true, "item": {} },
    { "id": "id_2", "ok": false, "error": "Not found" }
  ]
}
```

### Tests

- Contact filtering, sorting, search, pagination, facets.
- Task filtering, sorting, search, pagination, facets.
- Invalid filters/sorts/dates return client errors.
- Contact delete clears legacy memory references.
- Task delete removes `linkedTaskIds`.
- Batch partial success.
- Backend and service-worker parity.
- Frontend smoke/e2e for list filters, pagination, inline edit, and batch operations.

### Acceptance Criteria

- Existing contact/task APIs stay backward-compatible.
- Contacts/tasks can be searched, filtered, sorted, paged, edited, and batch-managed.
- Deletes clean references without deleting linked memory.
- Built-in and backend modes match.

### Verification Focus

- Confirm no linked memory is accidentally deleted.
- Confirm page selection is cleared when filters/sort/page changes.
- Confirm stale responses cannot overwrite newer filter results.

## Milestone 5: Unified Saved Context Graph

### Goal

Add a read-only context graph that lets users inspect relationships between notes, sources, workspaces, contacts, tasks, and extractions.

### Key Changes

- Build a derived graph. Do not add a stored edge table in v1.
- Derive nodes/edges from:
  - `memory.workspaceIds`
  - legacy `memory.taskIds` only as workspace membership fallback
  - `memory.linkedTaskIds`
  - `task.sourceMemoryIds`
  - `contact.memoryIds`
  - legacy `memory.contactId`
  - normalized source URL/source key
  - `memory.structuredExtraction`
- Do not interpret `memory.taskIds` as task references. Emitting `task:<workspaceId>` edges from that field would be incorrect.
- Node IDs:
  - `memory:<id>`
  - `workspace:<id>`
  - `contact:<id>`
  - `task:<id>`
  - `source:<urlKey>`
  - `extraction:<memoryId>`
- Add a context drawer for memory, search, contact, task, workspace, and source cards.
- Show direct vs inferred relationship labels.
- Missing linked records produce warnings, not crashes.

### Interfaces

Backend routes and service-worker messages:

- `GET /api/context/source?urlKey=...` -> `CONTEXT_SOURCE`
- `GET /api/context/memory/:id` -> `CONTEXT_MEMORY`
- `GET /api/context/contact/:id` -> `CONTEXT_CONTACT`
- `GET /api/context/task/:id` -> `CONTEXT_TASK`
- `GET /api/context/workspace/:id` -> `CONTEXT_WORKSPACE`
- `GET /api/context/search?...` -> `CONTEXT_SEARCH`

No generic `POST /api/context/links` in v1. Link edits must use existing entity update APIs.

Response:

```json
{
  "subject": {},
  "nodes": [],
  "edges": [],
  "groups": [],
  "counts": {},
  "warnings": []
}
```

### Tests

- Graph builder tests for every relationship type.
- Missing record warnings.
- Exact source matching and URL-less records.
- Backend route tests.
- Service-worker parity tests.
- UI/e2e smoke for context drawer from memory/search/contact/task/workspace cards.

### Acceptance Criteria

- Users can inspect related context without a migration.
- No stored context edge table is introduced.
- Existing entity update routes remain the only way to change links.

### Verification Focus

- Confirm graph is read-only in v1.
- Confirm no over-linking by host-only matching.
- Confirm context drawer works in backend and built-in modes.

## Milestone 6: Workspace Dashboard

### Goal

Turn workspaces into a useful dashboard showing notes, sources, contacts, tasks, activity, metrics, and quick actions.

### Key Changes

- Add a pure dashboard builder for backend and service-worker mode.
- Do not add a persisted dashboard schema.
- Derive membership from:
  - `memory.workspaceIds`
  - legacy `memory.taskIds` only as workspace membership fallback
  - `contact.memoryIds`
  - legacy `memory.contactId`
  - `task.sourceMemoryIds`
  - exact normalized `sourceUrl`/`urlKey`
- Do not interpret `memory.taskIds` as task references. Dashboard task relations come from `memory.linkedTaskIds`, `task.sourceMemoryIds`, and exact source matching.
- Group source pages by normalized URL key.
- Group URL-less notes under `source:missing`.
- Build activity from existing dates/status fields:
  - `createdAt`
  - `updatedAt`
  - `completedAt`
- Replace notes-only workspace body with:
  - workspace selector
  - dashboard header
  - metric chips
  - tabs
  - quick actions
  - status line
- Tabs:
  - Overview
  - Notes
  - Sources
  - Contacts
  - Tasks
  - Activity
- Quick actions:
  - Save Current Page
  - Create Task
  - Capture Lead
  - Archive/Reopen
  - Refresh

### Interfaces

Routes and messages:

- `GET /api/note-workspaces/:id/dashboard` -> `NOTE_WORKSPACE_DASHBOARD`
- `GET /api/note-workspaces/unassigned/dashboard` -> `NOTE_WORKSPACE_UNASSIGNED_DASHBOARD`

Query params:

- `memoryLimit`
- `sourceLimit`
- `contactLimit`
- `taskLimit`
- `activityLimit`
- `taskStatus`

Response:

```json
{
  "workspace": {},
  "permissions": {},
  "metrics": {},
  "memory": { "items": [], "total": 0, "limit": 12 },
  "sources": [],
  "contacts": { "items": [], "total": 0, "limit": 10 },
  "tasks": { "items": [], "total": 0, "limit": 10 },
  "activity": [],
  "warnings": []
}
```

### Tests

- Dashboard builder:
  - workspace membership
  - legacy membership
  - unassigned dashboard
  - source grouping
  - URL-less bucket
  - contact relation
  - task relation
  - status filtering
  - caps/sorting/metrics/warnings
- Backend route tests.
- Service-worker parity tests.
- E2e smoke:
  - open workspace dashboard
  - switch open/archived/unassigned
  - edit/delete note and see metrics refresh
  - save page into selected workspace
  - create linked task
  - capture linked lead

### Acceptance Criteria

- Every workspace has notes, sources, contacts, tasks, activity, and metrics.
- Quick actions link records to the selected workspace context.
- Archived workspaces are viewable but write actions are disabled.
- Unassigned workspace state does not show invalid archive/reopen actions.

### Verification Focus

- Confirm quick actions do not mutate the global workspace picker unexpectedly.
- Confirm dashboard data remains derived, not persisted.
- Confirm missing links are warnings, not UI failures.

## Milestone 7: Deduplication Controls

### Goal

Add safe duplicate detection and merge controls for contacts, tasks, memory notes, and derived source pages.

### Key Changes

- Add deterministic duplicate detection. No model calls.
- Candidate types:
  - contacts
  - tasks
  - memory
  - source pages
- Detection rules:
  - contacts by email, LinkedIn URL, phone, probable name plus company/domain
  - tasks by `clientRequestId`, normalized title plus source, title plus due date plus source
  - memory by fingerprint, content hash, URL key plus note/snippet, title plus URL key
  - sources by normalized URL key, canonical URL, host/path normalization, matching titles
- Add safe summaries:
  - render text with `textContent`
  - truncate preview to 280 characters
  - do not show full `pageExcerpt`, raw extraction JSON, or raw HTML
- Add merge preview with deterministic `planHash`.
- Apply rejects stale `planHash` with `409`.
- Add audit/undo for merges created by this feature.
- Add ignored duplicate groups.
- Existing automatic contact merge remains but should produce audit metadata going forward.

### Interfaces

Routes and messages:

- `GET /api/dedupe/candidates` -> `DEDUPE_CANDIDATES`
- `POST /api/dedupe/preview` -> `DEDUPE_PREVIEW`
- `POST /api/dedupe/apply` -> `DEDUPE_APPLY`
- `GET /api/dedupe/audit` -> `DEDUPE_AUDIT`
- `POST /api/dedupe/undo` -> `DEDUPE_UNDO`
- `POST /api/dedupe/ignore` -> `DEDUPE_IGNORE`
- `POST /api/dedupe/unignore` -> `DEDUPE_UNIGNORE`

New local storage:

- `dedupeAudit`
- `dedupeIgnored`

### Tests

- Candidate grouping for contacts, tasks, memory, and sources.
- Safe summary constraints.
- Deterministic conflict policy.
- Stable `planHash`.
- Stale hash rejection.
- Merge idempotency.
- Contact/task/memory/source link rewriting.
- Undo restores exact prior state for records affected by the merge.
- Ignored group persistence.
- Backend and service-worker parity.
- E2e smoke for scan, preview, merge, undo, ignore, and unignore.

### Acceptance Criteria

- Users can find duplicate contacts, tasks, memory notes, and source pages.
- Every merge has a safe preview before apply.
- Every feature-created merge has an undoable audit record.
- Undo restores prior local state.
- Dedupe scans/previews never send content to providers.

### Verification Focus

- Confirm destructive operations run through write queues.
- Confirm audit records stay local and capped.
- Confirm pre-existing auto-merges are labeled as not exactly undoable if no audit exists.

## Milestone 8: Import, Export, and Backup

### Goal

Add a full local backup and restore system for both backend and built-in modes.

### Key Changes

- Add canonical backup export, validation, import planning, ID remapping, conflict detection, merge import, replace import, and restore points.
- Use a forward-extensible envelope with section versions.
- Include by default:
  - memory
  - note workspaces
  - actions/tasks/contacts/drafts/table rows
  - embeddings
  - non-secret settings when requested
  - privacy settings when settings are requested
  - dedupe ignored groups
- Exclude by default:
  - API keys
  - provider secrets
  - privacy events
  - dedupe audit snapshots unless an explicit sensitive/audit option is enabled
- Backend import writes `db.json` and `embeddings.ndjson` atomically under the write queue.
- Built-in import writes `memory`, `noteWorkspaces`, `actions`, and `embeddings` through the service-worker write queue.
- Replace mode requires:
  - successful validation
  - restore point
  - confirmation token
- Merge mode remaps IDs before writing links.
- Folder mirror is downstream only. Backup import should emit `BACKUP_IMPORTED` so the options page can resync when available.

### Backup Envelope

```json
{
  "format": "aaw.backup.v1",
  "exportedAt": "2026-05-26T00:00:00.000Z",
  "app": { "name": "AI Assistant Across Websites", "version": "0.1.0" },
  "source": { "mode": "backend", "notesDir": "", "extensionVersion": "" },
  "options": {
    "includeEmbeddings": true,
    "includeSettings": true,
    "includeSensitive": false,
    "includeAudit": false
  },
  "sections": {
    "memory": { "version": 1, "items": [] },
    "noteWorkspaces": { "version": 1, "items": [] },
    "actions": { "version": 1, "tasks": [], "contacts": [], "drafts": [], "tableRows": [] },
    "embeddings": { "version": 1, "items": [] },
    "settings": { "version": 1, "items": {} },
    "privacy": { "version": 1, "settings": {} },
    "dedupe": { "version": 1, "ignored": [], "audit": [] }
  }
}
```

### Interfaces

Routes and messages:

- `GET /api/backup/export` -> `BACKUP_EXPORT`
- `POST /api/backup/validate` -> `BACKUP_VALIDATE`
- `POST /api/backup/restore-point` -> `BACKUP_RESTORE_POINT`
- `POST /api/backup/import` -> `BACKUP_IMPORT`

Import body:

```json
{
  "backup": {},
  "mode": "merge",
  "includeSettings": true,
  "includeEmbeddings": true,
  "restorePointId": "",
  "confirmationToken": ""
}
```

### Manifest

- Add `unlimitedStorage` permission to reduce built-in restore quota failures.

### Tests

- Envelope creation and validation.
- Malformed backup rejection.
- Unknown format/version rejection.
- Export/import round-trip equality.
- Merge import with ID remapping.
- Replace import with restore point.
- Restore-point rollback behavior where supported.
- Embedding vector dimension validation.
- Prototype pollution protections.
- API keys excluded by default.
- Privacy settings included only with settings enabled.
- Dedupe ignored groups included; dedupe audit excluded unless explicit audit option.
- Backend and service-worker parity.
- Folder mirror `BACKUP_IMPORTED` smoke.

### Acceptance Criteria

- Users can export one JSON backup and restore it into either storage mode.
- Merge import avoids duplicates and preserves links.
- Replace import cannot run without validation, restore point, and confirmation.
- Invalid backups fail without mutating storage.
- Backups never include API keys by default.

### Verification Focus

- Confirm all imports run through write queues.
- Confirm large built-in backup errors surface clearly.
- Confirm File System Access directory handles are not exported/restored.

## Milestone 9: Folder Mirror Expansion

### Goal

Expand the existing built-in-mode notes folder mirror into a versioned one-way local export with workspace/source indexes and optional contact/task summaries.

### Key Changes

- Keep current root memory files backward-compatible:
  - `mem_<id>.json`
- Add a pure mirror helper that builds a file plan from:
  - memory
  - note workspaces
  - actions
  - mirror config
- Normalize safe relative paths and reject traversal.
- Add `aaw_mirror_manifest.json`.
- Add generated files:
  - `indexes/workspaces.json`
  - `indexes/sources.json`
  - `workspaces/<workspaceId>/index.json`
  - `workspaces/unassigned/index.json`
  - optional `contacts/contact_<id>.json`
  - optional `tasks/task_<id>.json`
- Add built-in settings:
  - `notesMirrorConfig`
  - `notesMirrorStatus`
- Preserve existing `notesFolderName`.
- Update `options.js` full sync to load memory, workspaces, and actions.
- Read prior manifest to identify generated stale files.
- Delete stale generated files only when `deleteOrphans` is enabled and the file is known generated output.
- Treat external edits as overwritten mirror output, not merge conflicts.
- Add live sync:
  - existing `MEMORY_SAVED`
  - existing `MEMORY_UPDATED`
  - existing `MEMORY_DELETED`
  - new `MIRROR_DATA_CHANGED`
  - new `BACKUP_IMPORTED`
- Backend compatibility:
  - do not use File System Access in backend mode
  - preserve existing backend `NOTES_DIR` semantics

### Tests

- Mirror helper file plan.
- Backward-compatible memory filenames.
- Workspace/source indexes.
- Optional contact/task exports disabled by default and enabled by config.
- Unsafe IDs/names cannot escape mirror folder.
- Orphan planning targets only known generated files.
- Service-worker broadcasts for workspace/contact/task changes.
- Options-page mocked directory handle sync.
- Permission denied/prompt states.
- Backup import broadcast and full resync intent.

### Acceptance Criteria

- Existing memory mirror behavior still works.
- Workspace and source indexes are generated.
- Contact/task exports are opt-in.
- Sync status is visible in options and panel settings.
- Stale files are never deleted without explicit orphan cleanup.
- The mirror is never treated as import source or source of truth.

### Verification Focus

- Confirm no backend `NOTES_DIR` behavior is mixed with built-in File System Access mirror.
- Confirm privacy-sensitive contact/task summaries are opt-in.
- Confirm generated-file deletion is constrained by manifest/pattern.

## Milestone 10: Keyboard Shortcuts

### Goal

Add a keyboard-first command layer with a command palette, panel-scoped shortcuts, Chrome command integration, and accessible focus handling.

### Key Changes

- Add `chrome-extension/shortcut-utils.js` using the same browser/CommonJS export pattern as existing testable utilities.
- Add helpers:
  - `normalizeShortcut`
  - `matchShortcut`
  - `isEditableShortcutTarget`
  - `shouldHandlePanelShortcut`
  - two-key sequence buffering
- Add content-script command registry with stable IDs:
  - `panel.openPalette`
  - `panel.close`
  - `settings.open`
  - `settings.back`
  - `analyze.summarize`
  - `analyze.rewrite`
  - `analyze.extract`
  - `memory.save`
  - `lead.capture`
  - `task.create`
  - `search.focus`
  - `section.analyze`
  - `section.memory`
  - `section.leads`
  - `section.tasks`
  - `section.workspaces`
  - `section.search`
- Add `data-aaw-command-id` and `data-aaw-section` attributes.
- Add `aria-keyshortcuts` and shortcut-aware `title` text to primary controls.
- Add command palette dialog:
  - `role="dialog"`
  - `aria-modal="true"`
  - labeled search input
  - `role="listbox"`
  - `aria-activedescendant`
  - `role="option"`
- Shortcut defaults:
  - `Alt+Shift+A`: `_execute_action`, toggles panel
  - `Alt+Shift+K`: opens panel and command palette
  - `Ctrl/Cmd+K`: open command palette
  - `?`: shortcuts/help
  - `1`: summarize
  - `2`: rewrite
  - `3`: extract
  - `Ctrl/Cmd+S`: save memory
  - `Ctrl/Cmd+Enter`: run primary focused section action
  - `/`: focus search
  - `g a`: analyze
  - `g m`: memory
  - `g l`: leads
  - `g t`: tasks
  - `g w`: workspaces
  - `g s`: search
  - `Escape`: close palette, dropdown, settings, then panel
- Do not add user-remappable panel shortcuts in v1.

### Manifest and Service Worker

- Add `commands` to `chrome-extension/manifest.json`:
  - `_execute_action`
  - `open-command-palette`
- Add `chrome.commands.onCommand` in `background.js`.
- Refactor action-click injection/retry into shared helpers:
  - `ensurePanelScripts(tabId)`
  - `sendPanelMessage(tabId, message)`
- Send `{ "type": "AAW_OPEN_COMMAND_PALETTE" }` for command palette opening.

### Tests

- `shortcut-utils` unit tests:
  - modifier normalization
  - editable target detection
  - hidden-panel ignore rules
  - outside-panel ignore rules
  - command matching
  - sequence buffering and timeout
  - disabled-command blocking
- Background tests:
  - mock `chrome.commands.onCommand`
  - verify `open-command-palette` sends message to active tab
  - verify injection fallback and errors are caught
- E2e/manual:
  - Chrome command toggles panel
  - Chrome command opens palette
  - palette runs core commands
  - page editors are not interrupted
  - Escape closes in order
  - ARIA labels and `aria-keyshortcuts` exist

### Acceptance Criteria

- Keyboard users can open the panel, open the palette, run core commands, navigate sections, and close predictably.
- Page/site shortcuts are not hijacked when focus is outside the assistant panel.
- Text entry in Gmail, Notion, LinkedIn, Google Docs, page inputs, and panel fields remains safe.
- Chrome-level shortcuts work through MV3 commands.
- Shortcut behavior is documented in settings and README.

### Verification Focus

- Confirm shortcuts are panel-scoped except Chrome-level commands.
- Confirm restricted pages fail gracefully.
- Confirm focus is restored when possible.

## Cross-Milestone Dependency Map

- Milestone 1 supports all later verification.
- Milestone 2 privacy preflight must exist before Milestone 3 extraction and must be reused by later AI workflows.
- Milestone 3 task draft improves Milestone 4 task management and Milestone 6 workspace quick actions.
- Milestone 4 task/contact list APIs support Milestone 6 dashboard and Milestone 7 dedupe UI.
- Milestone 5 context graph supports richer task/contact/workspace navigation but should remain read-only.
- Milestone 6 dashboard consumes Milestones 3, 4, and 5.
- Milestone 7 dedupe must be complete before Milestone 8 backup if backups include dedupe state.
- Milestone 8 backup emits `BACKUP_IMPORTED`, consumed by Milestone 9 folder mirror.
- Milestone 10 can be implemented last because it wraps stable commands and UI sections.

## Final Acceptance Checklist

- The extension can summarize, rewrite, extract, save memory, organize into workspaces, search saved memory, capture leads, and create tasks from webpages.
- All workflows work in backend and built-in modes.
- Privacy controls clearly govern provider/backend content transmission.
- Workspace dashboards and context views make saved memory navigable.
- Contacts/tasks are manageable at list scale.
- Backup/restore protects local data.
- Folder mirror makes saved notes and indexes inspectable outside the browser.
- Keyboard users can operate core flows without relying on the mouse.
- `npm test` passes.
- E2e baseline and milestone-specific e2e tests pass.
- Every completed milestone has independent sub-agent verification.
