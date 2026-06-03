# Implementation Log — Workspace "Inbox" → "Unassigned" Rename

- **Date:** 2026-06-02
- **Implementer:** Claude Code (attempt 2)
- **Milestone:** workspace-inbox-rename
- **Task:** Finish the UI rename from "Inbox" to "Unassigned" for the built-in
  no-project workspace bucket. UI/panel + test-facing wording only.

> Attempt 1 changed the visible panel labels in `chrome-extension/content.js`
> but ran silently too long and was terminated before finishing the
> test-facing wording and before producing a verified log. This attempt-2 log
> supersedes the earlier draft: it records what is actually in the tree now and
> reports Playwright as **deferred** (not run) in this attempt.

## What was done

### Verified already in place (from attempt 1) — `chrome-extension/content.js`

Confirmed via read + grep that every user-facing rendered label for the
built-in no-project bucket already reads "Unassigned":

1. Active workspace dropdown option (`activeWorkspaceSelectOptions`, ~line 4258)
   — `label: "Unassigned"`.
2. Workspaces list row label (`renderWorkspaceList` for the `unassigned` id,
   ~line 4453) — `label: "Unassigned"`.
3. Selected dashboard title (~line 4498) — `inbox ? "Unassigned" : ...`.
4. Note move destination dropdown (`moveSelectOptions`, ~line 4643) —
   `label: "Unassigned"`.
5. Page Memory copy — already says "Unassigned".

No further edits to `content.js` were needed; the only remaining "Inbox"
occurrences there are internal identifiers and comments (see "NOT changed").

### Finished in this attempt — `test/e2e/specs/builtin.smoke.spec.js`

Narrow test/user-facing wording rename plus one straightforward visible-label
assertion:

- Renamed the move test title to
  `"built-in mode moves a workspace note between projects and back to Unassigned"`.
- Updated two comments that referred to the visible bucket label
  ("Nor into the Unassigned bucket.", "...the Unassigned bucket is the active
  selection.").
- Added `await expect(list.locator('[data-aaw-test="workspace-row-inbox"]'))
  .toContainText("Unassigned")` in the stable-hooks test, asserting the visible
  row label is "Unassigned" while keeping the existing `workspace-row-inbox`
  hook. (The inbox row passes `count: NaN`, so no count span is appended and the
  button text is exactly "Unassigned".)
- The move test's `selectFromCustomDropdown(..., "Unassigned")` already selects
  the renamed dropdown option by visible label, exercising the dropdown rename.

## What was intentionally NOT changed (scope discipline)

- Sentinel id/value `unassigned` and all `/api/note-workspaces/unassigned/...`
  paths.
- Stable test hook `data-aaw-test="workspace-row-inbox"`.
- Internal identifiers/comments: `isInboxSelected()`, the `isInbox` row flag,
  the local `inbox` variable, and `content.js` comments. Explicitly allowed to
  remain for compatibility / minimal scope.
- Backend code, backend unit tests, and backend error messages (e.g. the
  storage test named "...and back to Inbox"). They reference the bucket
  conceptually, are not UI labels, and did not fail.
- Behavior: the unassigned bucket is still listed first, is still not deletable,
  and still targets the unassigned dashboard path.

## Files changed

- `test/e2e/specs/builtin.smoke.spec.js` — 1 test-name rename, 2 comment
  renames, 1 added visible-label assertion (+1 explanatory comment).

## Files inspected

- `chrome-extension/content.js` (workspace selector, list, dashboard title,
  move dropdown, Page Memory, `workspaceRow`) — confirmed labels already
  "Unassigned"; located the `workspace-row-inbox` hook on the row's button.
- `test/e2e/specs/builtin.smoke.spec.js` (full file).
- `package.json` (confirmed `npm test` = node `--test` unit suite, not
  Playwright).
- Repo-wide grep for `Inbox` / `workspace-row-inbox` to confirm no rendered
  label literals remain and to scope out backend/comment references.

## Verification commands run

1. `node --check chrome-extension/content.js` → **OK**
2. `node --check test/e2e/specs/builtin.smoke.spec.js` → **OK**
3. `npm test` (node `--test` unit suite) → **137 passed, 0 failed**

## Successful checks

- Both relevant files pass syntax check.
- Full unit suite (137 tests) green.
- Post-change grep confirms remaining `Inbox` occurrences in `content.js` are
  only comments, internal identifiers, and the `workspace-row-inbox` hook — no
  rendered label literals remain.

## Failed checks

- None.

## Suspected causes for failures

- N/A (no failures).

## Deferred

- **Playwright e2e was not run in this attempt**, per instructions. The
  parent/verifier will run targeted Playwright separately (e.g.
  `npx playwright test test/e2e/specs/builtin.smoke.spec.js -g "Unassigned|Workspaces"`).
  The newly added `toContainText("Unassigned")` assertion and the renamed
  dropdown selection are only fully exercised under Playwright.

## Known risks

- The added assertion and the move-dropdown selection depend on the visible
  label being exactly "Unassigned"; if a future change re-skins the row to
  include extra text, `toContainText` still holds, but an `exact` dropdown
  option match would break — acceptable and intentional.
- Internal naming (`isInboxSelected`, `isInbox`, comments, the
  `workspace-row-inbox` hook) still says "Inbox" by design; this is documented
  and intentional, but may read as inconsistent to a future maintainer.
- Backend retains historical "Inbox cannot be deleted" wording and a unit test
  named "...back to Inbox"; out of scope unless UI tests fail.

## Final status

**Complete (pending external Playwright run).** Visible panel labels were
already "Unassigned" (attempt 1); this attempt finished the test/user-facing
wording (test name + comments) and added a straightforward visible-label
assertion, leaving data model, hooks, API, and backend untouched. Syntax checks
and the full 137-test unit suite pass. Playwright is deferred to the
parent/verifier.
