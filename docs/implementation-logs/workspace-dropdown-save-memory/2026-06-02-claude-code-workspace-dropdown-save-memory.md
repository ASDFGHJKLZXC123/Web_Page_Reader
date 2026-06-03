# Implementation Log — Workspace dropdown pairs with Save Memory

- Date: 2026-06-02
- Author: Claude Code (implementer)
- Milestone: workspace-dropdown-save-memory

## What was done

Reworked the Page Memory section so the active-workspace dropdown sits directly
in the primary save row alongside the `Save Memory` button, instead of being a
standalone control with its own "Workspace" sublabel above the action block.

- Removed the separate visible `Workspace` sublabel (`workspaceSaveLabel`) from
  `memoryWrap`.
- Stopped appending `activeWorkspaceSelect.element` directly to `memoryWrap`.
- Introduced a new container `const memorySaveRow = document.createElement("div")`
  with class `aaw-memory-save-row`, and appended `activeWorkspaceSelect.element`
  and `btnSaveMemory` into it.
- Appended `memorySaveRow` to `memoryButtons` before `.aaw-memory-actions-secondary`.
- Left the `active-workspace-selector` and `save-memory` data hooks unchanged.
- Preserved `selectedWorkspaceId`, `normalizeSelectedWorkspace`, dashboard reset,
  and refresh behavior unchanged (the dropdown `onChange` handler is untouched).

CSS:

- Added `.aaw-root .aaw-memory-save-row` (wrapping flex row, vertically aligned,
  explicit 8px column and row gaps).
- Added `.aaw-root .aaw-memory-actions .aaw-memory-save-row .aaw-dropdown`
  (`flex: 1 1 auto; width: auto; min-width: 0`) so the dropdown flexes/grows and
  can ellipsize; uses 4-class specificity to override the generic
  `.aaw-actions .aaw-dropdown { width: auto; flex-shrink: 0 }` rule.
- Added `.aaw-root .aaw-memory-actions .aaw-memory-save-row .aaw-dropdown__trigger`
  (`width: 100%`) so the trigger fills the flexed dropdown wrapper instead of
  inheriting the generic inline action dropdown trigger width.
- Replaced the obsolete `.aaw-root .aaw-memory-actions > .aaw-btn.accent { width: 100% }`
  rule (and its comment) with `.aaw-root .aaw-memory-save-row > .aaw-btn.accent`
  (`flex: 0 0 auto; min-width: 120px`) since Save Memory is no longer a direct
  child of `.aaw-memory-actions`.
- Left the secondary action row (`.aaw-memory-actions-secondary`) unchanged.

Test:

- Added a stable, non-pixel assertion to the existing "workspace UI drops ...
  keeps stable hooks" smoke test verifying both
  `[data-aaw-test="active-workspace-selector"]` and `[data-aaw-test="save-memory"]`
  resolve inside `.aaw-section--memory .aaw-memory-save-row`.

## Files changed

- `chrome-extension/content.js`
- `chrome-extension/styles.css`
- `test/e2e/specs/builtin.smoke.spec.js`
- `docs/implementation-logs/workspace-dropdown-save-memory/2026-06-02-claude-code-workspace-dropdown-save-memory.md` (this log)

## Planning review

Per AGENTS.md the planning review was requested, but the Claude Code planning
review call timed out with no output. Proceeded with the scoped plan as written
since the change is small and the requirements were explicit.

A second narrow Claude Code implementation pass was requested after local
inspection found the generic `.aaw-actions .aaw-dropdown .aaw-dropdown__trigger`
rule could keep the workspace dropdown trigger at `width: auto`. That pass timed
out without a final response, but the requested CSS edits were present on disk:
the save row now wraps with explicit `column-gap`/`row-gap`, and the row-specific
dropdown trigger override sets `width: 100%`.

## Verification commands run

- `node --check chrome-extension/content.js test/e2e/specs/builtin.smoke.spec.js`
- `git diff --check -- chrome-extension/content.js chrome-extension/styles.css test/e2e/specs/builtin.smoke.spec.js docs/implementation-logs/workspace-dropdown-save-memory/2026-06-02-claude-code-workspace-dropdown-save-memory.md`
- `npm test`
- `npx playwright test test/e2e/specs/builtin.smoke.spec.js -g "workspace UI drops|keeps a saved workspace note|moves a workspace note|panel orders"`

## Successful checks

- `node --check` passes for both `content.js` and the smoke spec.
- `git diff --check` reports no whitespace/conflict problems.
- `npm test`: 137 passed, 0 failed.
- Focused Playwright (`-g "workspace UI drops|keeps a saved workspace note|moves a workspace note|panel orders"`):
  4 passed, 0 failed — including the new `.aaw-memory-save-row` assertion in the
  "workspace UI drops ... keeps stable hooks" test.

## Failed checks

- None.

## Suspected causes for failures

- None.

## Known risks

- The dropdown wrapper and trigger overrides rely on specificity winning over the
  generic `.aaw-actions .aaw-dropdown` and `.aaw-actions .aaw-dropdown__trigger`
  rules; future CSS refactors that change the selector chain could reintroduce
  inline dropdown sizing.
- On very narrow containers the save row can wrap; if the workspace label is
  long, the dropdown ellipsizes (intended) but the layout was not pixel-tested
  across all widths.
- Only the Page Memory primary row changed; no functional/state behavior was
  modified, so risk to save/refresh flows is low.

## Final status

- Complete. All scoped changes applied; all verification commands pass
  (`node --check`, `git diff --check`, `npm test` 137/137, focused Playwright
  4/4). No unrelated worktree changes were touched.
