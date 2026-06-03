# Verifier Log — workspace-simplification — attempt 5

Date: 2026-06-02
Role: Independent verification sub-agent (inspection + tests only; no source edits)
Milestone: workspace-simplification (implementation attempt 5)

## What was reviewed

Verified the claimed attempt-5 changes for the workspace-simplification milestone:

1. Canonical single-value `workspaceId` on tasks/contacts, with `workspaceIds`/`taskIds`
   rewritten to `[]` or `[workspaceId]`.
2. `normalizeDbShape` preserving/normalizing `deletedWorkspaces` and deriving
   contact/task `workspaceId` from linked/source memory.
3. Storage: `ensureDefaultNoteWorkspaces` passing tombstoned ids to
   `seedDefaultWorkspaces`; new `deleteNoteWorkspace` (destructive delete +
   embeddings + cross-link cleanup + tombstone + inbox/unassigned refusal); new
   `restoreDeletedWorkspaceByName`.
4. Server: `createNoteWorkspace` restore-by-name, `DELETE /api/note-workspaces/:id`
   route, `createNoteWorkspace` exported.
5. background.js: canonical normalizers, seed tombstone support,
   `handleNoteWorkspaceCreate` restore-by-name, `handleNoteWorkspaceDelete` +
   `NOTE_WORKSPACE_DELETE` route.
6. content.js: API shim maps `DELETE /api/note-workspaces/:id` -> `NOTE_WORKSPACE_DELETE`.
7. Updated tests across foundation / workspace-storage / server-routes / background-foundation.

## Files inspected

- backend/src/lib/foundation.js (read in full)
- backend/src/lib/storage.js (lines 283-421 and surrounding helpers; compactEmbeddings at 164)
- backend/src/server.js (createNoteWorkspace 974-1001; DELETE route 1774-1785; exports)
- chrome-extension/background.js (handleNoteWorkspaceCreate 2066-2098; handleNoteWorkspaceDelete 2104-2171; routes 4331-4333; exports 4527-4528; seed deletedIds 1253-1254)
- chrome-extension/content.js (shim 1523-1530)
- test/workspace-storage.test.js (delete/restore/normalize tests 297-396)
- test/background-foundation.test.js (delete/restore/normalizer tests 104-252)
- test/e2e/specs/backend.smoke.spec.js (confirmed Playwright dependency)
- package.json (test script)

Note: foundation.js and all of test/ are currently UNTRACKED in git, so `git diff`
shows no content for them; they were inspected directly by reading the files.

## Verification commands run

1. `node --check chrome-extension/content.js chrome-extension/background.js backend/src/server.js backend/src/lib/foundation.js backend/src/lib/storage.js`
   - Result: EXIT_CODE=0 (all parse cleanly).

2. `node --test test/foundation.test.js test/workspace-storage.test.js test/server-routes.test.js`
   - Result: tests 32, pass 32, fail 0.

3. `node --test test/background-foundation.test.js`
   - Result: tests 31, pass 31, fail 0.

4. `npm test` (`node --test test/*.test.js test/e2e/helpers/*.test.js`)
   - Result: tests 136, pass 136, fail 0.

5. `node --test test/e2e/specs/backend.smoke.spec.js` (diagnostic only)
   - Result: failing under node's runner (expected — see note below).

## Successful checks

- All five JS files pass `node --check`.
- All in-scope and full-suite tests pass (32 / 31 / 136, zero failures).
- (a) Single-value compatibility arrays: `normalizeTaskItem` and
  `normalizeContactItem` compute `workspaceId = pickWorkspaceId(item)` then set
  `workspaceIds = workspaceId ? [workspaceId] : []` and `taskIds = workspaceIds`.
  `pickWorkspaceId` prefers canonical `workspaceId`, then legacy `workspaceIds`,
  then legacy `taskIds`, always returning a single id. Test
  "normalizes single-workspace arrays for contacts and tasks" feeds
  `workspaceIds: [ws, "nw_extra"]` and asserts `.workspaceId === ws`,
  `.workspaceIds === [ws]`, `.taskIds === [ws]`. Confirmed correct.
- (b) `deleteNoteWorkspace` removes assigned memory ids, calls
  `compactEmbeddings({ removeIds })` (only when there are ids), strips removed
  contact/task cross-links from surviving memory (`contactId`, `contactIds`,
  `linkedTaskIds`), drops removed-memory refs from surviving contacts/tasks, and
  tombstones the workspace id+name into `deletedWorkspaces`. Backend test asserts
  embeddings gone, contact/task gone, survivor memory retained, deleted default
  not reseeded (length 3), inbox refused, missing -> null. background.js mirror
  deletes `embeddings[mid]` and tombstones identically; its test asserts the same.
- (c) Restore-by-name consumed once: `restoreDeletedWorkspaceByName` filters the
  matched tombstone out of `deletedWorkspaces` and saves, returning the id. The
  server's `createNoteWorkspace` runs the active-name duplicate check first, so a
  second create with the same name now hits the active duplicate and rejects with
  "Workspace already exists". Tests in both workspace-storage and
  background-foundation assert `restored === true` on first create, reused id,
  and "Workspace already exists" on the second. Confirmed single-consumption.
- (d) No unrelated breakage: full 136-test suite green; `deleteNoteWorkspace`
  returns `null`/`{error}` distinctly and the DELETE route maps null->404,
  error->400, success->200; PATCH route unchanged and still ordered before DELETE
  (both share the same `/api/note-workspaces/:id` regex, dispatched by method).
- `normalizeDbShape` derives contact `workspaceId` from `memoryIds`/by-contact
  memory and task `workspaceId` from `sourceMemoryIds`/`memoryIds`, only when the
  item has no explicit `workspaceId`; `deletedWorkspaces` normalized/deduped.
- Backend and background delete/restore logic are at parity (same cascade fields,
  same tombstone shape, same inbox guard, same counts payload).

## Failed checks

- None among in-scope tests.
- `test/e2e/specs/backend.smoke.spec.js` fails under `node --test`. This is
  PRE-EXISTING and UNRELATED: the smoke specs `require("@playwright/test")` and
  use Playwright's `test()` API, which is incompatible with node's built-in test
  runner. They are NOT part of `npm test` — the script globs only
  `test/*.test.js` and `test/e2e/helpers/*.test.js`, which excludes
  `test/e2e/specs/*.smoke.spec.js`. Not a regression from attempt 5.

## Suspected causes for failures

- N/A for in-scope tests (all pass). The smoke-spec failure cause is the
  Playwright test runner dependency, not this milestone's code.

## Known risks / observations (low severity, no fix applied)

1. Backend/background not-found shape mismatch: backend `deleteNoteWorkspace`
   returns `null` for an unknown id (server route -> 404), while
   background `handleNoteWorkspaceDelete` returns `{ error: "Not found" }`. Both
   surface a sensible error to the caller and content.js relays the handler
   result verbatim, so behavior is acceptable, but the return contracts differ.
   Recommendation (optional): align the two (e.g. background also returning
   null, or backend returning `{ error: "Not found" }`) for symmetry. No
   functional defect.
2. `createNoteWorkspace` always calls `restoreDeletedWorkspaceByName` (which
   mutates storage to clear a tombstone) on every create. When no tombstone
   matches it returns null and makes no change, so this is correct, just an extra
   read. Not a defect.
3. Tombstone matching is name-based and case-insensitive; if two different
   deleted workspaces ever shared a name, restore picks the first match. Given
   active-name uniqueness is enforced, collisions are unlikely. Acceptable.

No defects requiring a fix were found. Tests assert the load-bearing behaviors
(cascade delete, embedding removal, cross-link cleanup, tombstone+no-reseed,
inbox guard, restore-once, single-value arrays) rather than asserting too little.

## Final status

PASS. All required commands succeed (node --check exit 0; 32/31/136 tests pass,
0 failures). Claimed behaviors are implemented and correct in both the backend
and the background.js service-worker equivalents, with parity tests on both
paths. The only failing item is the Playwright smoke spec under `node --test`,
which is pre-existing, expected, and outside `npm test`. One low-severity
backend/background return-shape inconsistency noted as optional cleanup.
