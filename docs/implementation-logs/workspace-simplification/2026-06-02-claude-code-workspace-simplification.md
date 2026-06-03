# Workspace Simplification — Canonical workspaceId Normalization

Date: 2026-06-02
Attempt: 4 (normalization-only)
Implementer: Claude Code

## What was done

Introduced/completed canonical single-value `workspaceId` normalization for
memory, contact, and task items in `backend/src/lib/foundation.js`. A
`workspaceId` is a single canonical trimmed string; an empty string `""` means
the item is unassigned. This pass does not require knowing the set of existing
workspace IDs.

Specifics:

- `normalizeMemoryItem` already returned a canonical `workspaceId` plus
  compatibility arrays `workspaceIds`/`taskIds` as `[]` or `[workspaceId]`,
  derived via `pickWorkspaceId` → `normalizeWorkspaceIds` (input `workspaceId`
  wins; otherwise first compact string from `workspaceIds` then `taskIds`).
  Left unchanged.
- `normalizeTaskItem` previously read `task.workspaceId` directly with no
  fallback. Changed it to use `pickWorkspaceId(task)` so it derives the
  canonical id from `workspaceId`, else `workspaceIds`/`taskIds`. All other
  fields preserved.
- `normalizeContactItem` previously did not emit a `workspaceId` at all. Added
  `workspaceId: pickWorkspaceId(contact)`, preserving every existing field
  (object still spreads `...contact` and keeps all prior keys).
- `normalizeActions` and `normalizeDbShape` naturally pick up the change because
  they already map through `normalizeTaskItem`/`normalizeContactItem`/
  `normalizeMemoryItem`; no edits needed there.

## Files changed

- `backend/src/lib/foundation.js`
- `docs/implementation-logs/workspace-simplification/2026-06-02-claude-code-workspace-simplification.md` (this log)

## Verification commands run

- `node --check backend/src/lib/foundation.js` → passed (printed `CHECK_OK`).

## Successful checks

- `node --check` parses `foundation.js` with no syntax errors.
- `pickWorkspaceId` was already defined above all three normalizers, so the new
  call sites resolve correctly.

## Failed checks

- None.

## Suspected causes for failures

- N/A.

## Known risks

- Test suite was not run (scope limited to `foundation.js` + this log per
  instructions; tests not to be touched). Only `node --check` was run.
- `normalizeContactItem` now adds a `workspaceId` field to contact objects;
  downstream consumers that enumerate contact keys will see this new field.
  Existing fields are unchanged.

## Final status

Complete for attempt 4 (normalization-only). Syntax verified via
`node --check`; broader tests not run.

---

# Attempt 5 — Complete normalization + destructive workspace delete

Date: 2026-06-02
Attempt: 5
Implementer: Claude Code

## What was done

Completed the remaining workspace simplification across the backend, the
built-in extension service worker, and the test suite. UI control removal was
intentionally deferred (see Known risks).

Foundation (`backend/src/lib/foundation.js`):

- `normalizeTaskItem` and `normalizeContactItem` now emit the canonical
  `workspaceId` AND rewrite the compatibility arrays `workspaceIds`/`taskIds`
  to always be `[]` or `[workspaceId]` (previously the object spread leaked any
  legacy multi-value arrays). Memory already did this.
- `normalizeDbShape` now preserves/normalizes `deletedWorkspaces` (tombstones)
  via the existing `normalizeDeletedWorkspaces`, and derives a canonical
  contact/task `workspaceId` from linked/source memory using the existing
  partial helpers `deriveContactWorkspaceId`/`deriveTaskWorkspaceId` when the
  item has no explicit assignment.

Backend storage (`backend/src/lib/storage.js`):

- `ensureDefaultNoteWorkspaces` now passes tombstoned `deletedWorkspaces` ids to
  `seedDefaultWorkspaces`, so deleted default workspaces are not reseeded.
- New `deleteNoteWorkspace(id)`: destructively deletes that workspace's memory
  notes (+ embeddings), contacts, and tasks, and cleans up memory/contact/task
  cross-links. Refuses Inbox/Unassigned. Tombstones the id. Returns
  `{ deleted: true, workspaceId, counts: { notes, contacts, tasks } }`.
- New `restoreDeletedWorkspaceByName(name)`: clears a matching tombstone and
  returns its id so the workspace can be reused.

Backend server (`backend/src/server.js`):

- `createNoteWorkspace` reuses a tombstoned workspace id when a new workspace is
  created with a previously deleted name (restores it empty/open); duplicate
  active names still reject. Exported for tests.
- New `DELETE /api/note-workspaces/:id` route → `deleteNoteWorkspace`.

Built-in extension (`chrome-extension/background.js`):

- `normalizeWorkspaceIds`/new `pickWorkspaceId` mirror the backend so memory,
  contacts, and tasks expose canonical single-value `workspaceId` and
  `[]`/`[workspaceId]` arrays.
- `seedDefaultNoteWorkspaceItems`/`ensureDefaultNoteWorkspaces` honor tombstoned
  `deletedWorkspaces`.
- `handleNoteWorkspaceCreate` restores a tombstoned workspace by name.
- New `handleNoteWorkspaceDelete(id)` mirrors the backend destructive delete
  (memory + embeddings + contacts + tasks + cross-links + tombstone), wired to a
  new `NOTE_WORKSPACE_DELETE` route.

Extension content panel (`chrome-extension/content.js`):

- API shim maps `DELETE /api/note-workspaces/:id` → `NOTE_WORKSPACE_DELETE`.

## Files changed

- `backend/src/lib/foundation.js`
- `backend/src/lib/storage.js`
- `backend/src/server.js`
- `chrome-extension/background.js`
- `chrome-extension/content.js`
- `test/foundation.test.js`
- `test/workspace-storage.test.js`
- `test/server-routes.test.js`
- `test/background-foundation.test.js`
- `docs/implementation-logs/workspace-simplification/2026-06-02-claude-code-workspace-simplification.md`

## Verification commands run

- `node --check chrome-extension/content.js chrome-extension/background.js backend/src/server.js backend/src/lib/foundation.js backend/src/lib/storage.js` → `ALL_SYNTAX_OK`.
- `node --test test/foundation.test.js test/workspace-storage.test.js test/server-routes.test.js` → 32 pass, 0 fail.
- `node --test test/background-foundation.test.js` → 31 pass, 0 fail.
- `npm test` → 136 tests, 136 pass, 0 fail.

## Successful checks

- Updated `foundation.test.js` expectation for single-workspace arrays now
  passes (was the failing test at attempt 4).
- New focused tests pass: tombstone default seeding + destructive delete counts
  + restore by name (storage), backend `DELETE` route (server-routes), and the
  `NOTE_WORKSPACE_DELETE` route + create-restore (background).
- New tests assert compatibility single-value arrays for contacts and tasks.

## Failed checks

- None in `npm test`.
- `node --test` over the whole `test/` tree reports 2 failures for
  `test/e2e/specs/*.smoke.spec.js`. These are Playwright specs that throw under
  the Node test runner (`test.beforeAll() not expected here`); they are not part
  of `npm test`/`test:unit` (which globs `test/*.test.js test/e2e/helpers/*.test.js`)
  and are unrelated to this change. They run via `npm run test:e2e`.

## Suspected causes for failures

- N/A for unit tests. The e2e spec failures are a runner mismatch (Playwright,
  not `node --test`), pre-existing.

## Known risks

- Full Workspaces UI simplification was NOT completed. Only the API-layer wiring
  (`DELETE` mapping in `content.js`) was added. The archive/reopen/open/archived
  filter controls and the graph/dashboard metric/source/activity controls remain
  in `content.js`, and no delete button was added to the panel UI. This was
  deferred to stay within scope/budget and avoid risking the panel test surface.
- `deleteNoteWorkspace` relies on canonical `workspaceId` (memory direct,
  contacts/tasks derived in `normalizeDbShape`). Contacts/tasks linked only via
  memory that itself is unassigned will not be swept; only items whose canonical
  `workspaceId` resolves to the deleted workspace are removed.
- Playwright e2e (`npm run test:e2e`) was not run (no browser run in this pass).

## Final status

Backend + built-in extension API/storage + tests complete and green
(`npm test`: 136/136). UI control simplification deferred and documented.
