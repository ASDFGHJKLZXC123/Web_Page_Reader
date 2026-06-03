# Workspace Simplification Attempt 4 Verification

Date: 2026-06-02
Verifier: Codex
Scope: Independent verification only; no feature fixes implemented.

## What was reviewed

- Reviewed `backend/src/lib/foundation.js` after Claude Code implementation attempt 4.
- Checked whether memory, contact, and task normalization produce canonical `workspaceId` plus compatibility `workspaceIds`/`taskIds` arrays constrained to `[]` or `[workspaceId]` where applicable.
- Checked for unexpected partial workspace-simplification changes in `foundation.js`.
- Reviewed the implementation log for required fields.
- Ran syntax and focused test checks.

## Files inspected

- `backend/src/lib/foundation.js`
- `backend/src/lib/storage.js`
- `test/foundation.test.js`
- `test/workspace-storage.test.js`
- `docs/implementation-logs/workspace-simplification/2026-06-02-claude-code-workspace-simplification.md`

## Verification commands run

- `git status --short`
- `git diff -- backend/src/lib/foundation.js`
- `git ls-files -- backend/src/lib/foundation.js docs/implementation-logs/workspace-simplification/2026-06-02-claude-code-workspace-simplification.md`
- `rg -n "normalize(Memory|Contact|Task)Item|pickWorkspaceId|normalizeWorkspaceIds|workspaceIds|taskIds|workspaceId" backend/src/lib/foundation.js`
- `rg -n "deriveContactWorkspaceId|deriveTaskWorkspaceId|deletedWorkspaces|seedDefaultWorkspaces|deleteWorkspace|tombstone|normalizeDbShape|normalizeActions|workspaceIdSet|workspaceIds:" backend/src/lib/foundation.js backend/src/lib/storage.js backend/src/server.js chrome-extension/background.js test/foundation.test.js test/workspace-storage.test.js`
- `node --check backend/src/lib/foundation.js`
- `node --test test/foundation.test.js`
- `node --test test/workspace-storage.test.js`
- Inline Node probe importing `normalizeMemoryItem`, `normalizeContactItem`, and `normalizeTaskItem`.
- Inline Node probe importing `normalizeDbShape`.

## Successful checks

- `node --check backend/src/lib/foundation.js` passed with no syntax errors.
- `node --test test/workspace-storage.test.js` passed: 7 tests passing.
- Memory normalization in `normalizeMemoryItem` produces a canonical `workspaceId`, and rewrites `workspaceIds`/`taskIds` to either `[]` or `[workspaceId]`.
- `normalizeTaskItem` and `normalizeContactItem` do derive a canonical `workspaceId` from `workspaceId`, `workspaceIds`, or `taskIds`.
- The implementation log exists and includes sections for what was done, files changed, verification commands run, successful checks, failed checks, suspected causes, known risks, and final status.

## Failed checks

- `node --test test/foundation.test.js` failed 1 of 12 tests:
  - `normalizeMemoryItem maps legacy taskIds to canonical workspaceIds` still expects `["nw_1", "nw_2"]`, but current normalization returns `["nw_1"]`.
  - This appears to be an outdated test expectation relative to the single-workspace plan, not necessarily a product defect.
- Contact/task compatibility arrays are not normalized:
  - `normalizeContactItem({ workspaceIds: [" nw_a ", "nw_b"], taskIds: ["legacy_task"] })` returns `workspaceId: "nw_a"` but leaves `workspaceIds: [" nw_a ", "nw_b"]` and `taskIds: ["legacy_task"]`.
  - `normalizeTaskItem({ workspaceIds: [" nw_a ", "nw_b"], taskIds: ["legacy_task"] })` returns `workspaceId: "nw_a"` but leaves `workspaceIds: [" nw_a ", "nw_b"]` and `taskIds: ["legacy_task"]`.

## Suspected causes for failures

- `normalizeContactItem` and `normalizeTaskItem` spread the original object and then assign `workspaceId`, but they do not assign normalized `workspaceIds` or `taskIds`. As a result, legacy arrays remain unchanged when present and are absent when not present.
- `test/foundation.test.js` was not updated for the new single-workspace note behavior.

## Unexpected partial changes identified

- `backend/src/lib/foundation.js` is untracked, so git cannot show a baseline diff for this file. Provenance of individual changes cannot be established from git metadata.
- `deriveContactWorkspaceId` and `deriveTaskWorkspaceId` are present but unused and unexported.
- `DEFAULT_DB` includes `deletedWorkspaces`, and `normalizeDeletedWorkspaces`/`seedDefaultWorkspaces(..., deletedIds)` exist, but `normalizeDbShape` does not normalize `deletedWorkspaces`.
- `backend/src/lib/storage.js` calls `seedDefaultWorkspaces(db.noteWorkspaces)` without passing deleted/tombstoned workspace ids, so default workspace tombstones are not wired through that backend path.

## Known risks

- `npm test` was not run because the focused foundation suite already failed and the storage-focused workspace suite passed.
- No browser/service-worker normalization verification was performed in this pass.
- Because `foundation.js` is untracked, review is limited to the current file contents rather than a clean git diff against a prior tracked version.

## Final status

Failed verification. Syntax passes, and storage-focused tests pass, but the normalization contract is incomplete for contacts/tasks because compatibility arrays are not rewritten to `[]` or `[workspaceId]`. There are also stranded partial workspace-deletion/derivation helpers in `foundation.js` that are not fully wired.
