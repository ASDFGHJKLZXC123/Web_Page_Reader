# Implementation log — Notes folder export preview + Tasks dev badge

- Date: 2026-06-02
- Author: Claude Code (implementer)
- Milestone: notes-export-preview
- Attempt: 2

## What was done

1. **Read-only export preview UI** in the Notes folder settings section
   (`options.html`). Added a new "Export preview" subsection with the exact
   stable ids required: `mirror-preview-run`, `mirror-preview-search`,
   `mirror-preview-counts`, `mirror-preview-files`, `mirror-preview-detail`,
   `mirror-preview-json`, `mirror-preview-deletions`.

2. **Preview-only logic** in `options.js`:
   - The Preview button calls `mirrorTools.buildMirrorPlan(await loadMirrorDataset())`.
     It never calls `syncAll`, `writeMirrorFile`, or `removeMirrorPath` — the
     preview is strictly read-only.
   - Counts shown: notes, workspaces, sources, contacts, tasks, files.
   - Generated paths are grouped under six roots: root notes, indexes,
     workspaces, contacts, tasks, manifest. The search box filters paths/summaries.
   - Selecting a file shows its path, kind, a readable summary, and pretty JSON.
   - Include-contacts / include-tasks changes refresh an already-opened preview.
   - Deletion preview: when a folder handle exists, permission is `granted`, and
     `opt-delete-orphans` is checked, it reads the existing manifest and legacy
     `mem_*.json` files (read-only) and calls
     `mirrorTools.plannedStaleGeneratedPaths(previousManifest, plan, legacyMemoryFiles)`.
     Otherwise it renders an unavailable/disabled state with a reason.
   - Pure helpers exported under `module.exports.__test` so unit tests can build
     the preview/deletion models without a DOM: `buildMirrorPreview`,
     `buildDeletionPreview`, `previewFileSummary`, `previewGroupKey`,
     `loadMirrorDataset`.

3. **Preview styling** in `options.css` using existing theme tokens: a counts
   chip row, a two-column grid (files list + inspector) that collapses to one
   column at ≤760px, with long paths/JSON wrapping and scrolling.

4. **Panel reorder + Tasks dev badge** in `content.js`:
   - `_viewMain` now appends `workspaceSection` before `taskSection`
     (Workspaces appears before Tasks). The `g w` / `g t` command registry
     mapping is unchanged (it maps keys to elements, not DOM order).
   - Tasks keeps its "Tasks" title; subtitle now states it is an experimental
     developer workflow.
   - Added a compact `Dev feature` badge to `taskSection.actions` with
     `data-aaw-test="task-dev-badge"`. Existing task controls/test ids unchanged.

5. **Badge style** `.aaw-dev-badge` added to `styles.css`.

6. **Tests** updated/added:
   - `test/options-mirror.test.js`: preview counts/grouped paths, include
     toggles off, stale deletion preview, and unavailable-without-folder-access.
   - `test/e2e/specs/builtin.smoke.spec.js`: settings export preview (counts,
     file list, file selection → JSON, search filter, unavailable deletions),
     Workspaces-before-Tasks DOM order, the task dev badge, and task creation
     still working.

## Files changed

- `chrome-extension/options.html`
- `chrome-extension/options.js`
- `chrome-extension/options.css`
- `chrome-extension/content.js`
- `chrome-extension/styles.css`
- `test/options-mirror.test.js`
- `test/e2e/specs/builtin.smoke.spec.js`
- `docs/implementation-logs/notes-export-preview/2026-06-02-claude-code-notes-export-preview.md` (this log)

## Files inspected (not changed)

- `chrome-extension/mirror-utils.js` (plan/stale-path helpers)
- `test/e2e/helpers/extension-harness.js` (fixture/panel helpers)

## Verification commands run

- `node --check chrome-extension/options.js` → OK
- `node --check chrome-extension/content.js` → OK
- `npm test` → 129 passed, 0 failed
- `npx playwright test test/e2e/specs/builtin.smoke.spec.js` → 24 passed

## Successful checks

- All unit tests pass (129), including the 4 new preview/deletion tests.
- Full built-in smoke e2e suite passes (24), including the 2 new specs.
- Syntax checks clean for both edited extension scripts.

## Failed checks

- None.

## Suspected causes for failures

- N/A.

## Known risks

- The two-column preview grid uses a 760px breakpoint; very wide JSON still
  scrolls horizontally inside the `<pre>` if a single token is extremely long,
  though `white-space: pre-wrap` + `word-break: break-word` mitigate it.
- The deletion preview reflects the manifest/legacy state at the moment Preview
  is clicked; it is not re-read live as the folder changes externally. This is
  consistent with the read-only intent.

## Final status

Complete. Scope limited to the assigned paths; no unrelated worktree changes
reverted. Awaiting independent verification per CLAUDE.md workflow.
