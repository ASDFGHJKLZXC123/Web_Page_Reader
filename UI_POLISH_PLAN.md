# Chrome Extension UI Polish Plan

## Scope

This plan covers frontend UI polish for the injected Chrome extension panel only. It does not authorize implementation work in this planning task. Future implementation should keep existing selectors stable unless a section explicitly adds a new selector.

Target surfaces:

- Analyze
- Result
- Page Memory
- Lead Capture
- Tasks
- Workspaces
- Search Saved Memory

Primary files expected for future implementation:

- `chrome-extension/content.js`
- `chrome-extension/styles.css`
- `test/e2e/specs/*.spec.js`
- Helper/unit tests only if implementation extracts reusable state, date, or formatting helpers.

## Implementation Workflow Rule

For future code implementation of this plan:

- Only call Claude Code to perform code implementation. Codex should provide Claude Code with all context necessary to implement the requested section, including this plan, relevant repo files, stable selectors, test expectations, rejected/adjusted notes, and any current worktree constraints.
- After Claude Code finishes an implementation pass, call a sub-agent to verify the work. Verification should check behavior, accessibility, selector stability, repo safety, and the relevant test scenarios from this plan.
- After verification, revise the code through Claude Code using the verification findings and Claude Code's own review. Do not directly apply implementation edits outside that Claude Code implementation/revision loop.
- After every implementation, verification, and revision cycle, update this planning markdown with the current status, findings, decisions, and remaining work.
- If confusion or a blocking assumption comes up, discuss it with Claude Code and converge on a solution that both agents agree with. Limit this clarification loop to a maximum of five iterations before recording the unresolved blocker in this markdown and asking the user for direction.

Implementation cycle log:

| Date | Section | Claude Code Implementation | Sub-Agent Verification | Revision Status | Notes |
| --- | --- | --- | --- | --- | --- |
| 2026-05-27 | Analyze + Result | Done (revised) | Verified — 2 findings | Revised | Implemented in `chrome-extension/content.js` and `chrome-extension/styles.css`. Analyze: command strip moved before the shared input, input relabeled `Guidance` with neutral copy, compact source hint (`data-aaw-test="source-hint"`) showing selection vs readable page + char count via existing snapshot helpers and `selectionchange`, rewrite now disables all three commands in-flight, and `.aaw-rewrite-controls--inactive` keeps rewrite controls visible/de-emphasized when no selection. Result: added `data-state` on output + wrapper, `aria-busy` on `result-output`, `setResultProvenance(null)` before working render in `analyze()`/`runRewrite()`, copy feedback moved to inline polite `result-copy-feedback` (chip no longer changes on copy), test IDs `result-copy`/`result-clear`/`result-expand`, Expand switched to `aria-expanded`+`aria-controls`, `result-output` is `tabindex="0"` with `overflow-wrap: anywhere`. Verified: `node --check`, `npm run test:unit` (110 pass), `npx playwright test builtin.smoke` (9 pass). Stable selectors preserved. **Verification findings (2026-05-27):** (1) `analyze()` preflight too-short/no-content path rendered an error and returned before `setResultProvenance(null)`, so a prior successful result's provenance could persist on the error — fixed by moving `setResultProvenance(null)`/`setResultCopyFeedback("")` ahead of the preflight check. (2) `runRewrite()` no-selection path returned before clearing provenance/copy feedback or rendering an error, leaving stale output/provenance visible — fixed by clearing both and rendering a `rewrite` error result ("No selection. Select text on the page to rewrite.") before returning. Re-verified: `node --check`, `npm run test:unit` (110 pass). |
| 2026-05-27 | Page Memory + Lead Capture | Done (revised) | Verified — 2 findings | Revised | Implemented in `chrome-extension/content.js` and `chrome-extension/styles.css`; focused e2e added to `test/e2e/specs/builtin.smoke.spec.js`. Page Memory: new `setActionStatus(message, tone)` routes Save Memory / Run Action / Page Graph feedback through `memory-status` with `aaw-memory-status-line--saving|saved|error` tones (idle = base muted); lead/task/workspace feedback untouched. Save Memory kept primary full-width accent; action dropdown, Run Action, Page Graph regrouped into `.aaw-memory-actions-secondary` (3-col grid) under it; native disabled Save state still visible. Cards get `.aaw-page-memory-card` alongside `.aaw-memory-result`; previews clamp via `-webkit-line-clamp: 4` (full text remains in DOM/accessible); invalid/missing `createdAt` renders `Saved date unavailable` via `formatSavedDate()`. Edit Note / Edit Workspaces buttons expose `aria-expanded`/`aria-controls`, focus moves into the opened editor (textarea / first checkbox), Cancel restores focus to the trigger, Save (which re-renders the list) moves focus to Save Memory. `deleteWorkspaceNote` keeps native `window.confirm`; restores focus to the Delete button on cancel/error and to Save Memory after successful delete. Lead Capture: `input[type="email"]`/`input[type="tel"]` added to panel input styling + focus rules; checkbox copy renamed to `Create linked memory on save` (behavior/default unchanged); zero-lead extraction shows Drafts empty state and status `No lead details found on this page.`; per-draft save guard disables only the clicked `lead-save` button immediately, ignores duplicate clicks while pending, and restores only on failure — other draft cards stay usable; draft cards get `.aaw-lead-draft-card` (test hook preserved), saved contacts keep `.aaw-contact-card`; existing lead status tones reused. Verified: `node --check`, `npm run test:unit` (110 pass), `npx playwright test builtin.smoke` (11 pass, incl. 2 new). Stable selectors preserved. **Verification findings (2026-05-27):** (1) Page Memory edit/delete feedback was not confined to `memory-status` — workspace-membership-edit save (~L4632), note-edit save (~L4692), and `deleteWorkspaceNote` (~L4721) still wrote to `workspaceStatus.textContent` (no status tone, wrong region) while Save/Run/Page Graph correctly used `setActionStatus()`. Fixed by routing all three through `setActionStatus(...)` with `saved` tone on success and `error` tone on failure; lead/task/workspace feedback left in their own regions. (2) Zero-lead success path set the correct text but no status tone, so `aaw-lead-status-line--*` tone classes were applied inconsistently for the empty outcome — fixed by passing the `done` tone: `setLeadStatus("No lead details found on this page.", "done")`. Strengthened the focused page-memory e2e to assert the note-edit save writes "Note updated." to `memory-status` (and not `workspace-status`) and the confirmed delete writes "Note deleted." to `memory-status`. Re-verified: `node --check`, `npm run test:unit` (110 pass), `npx playwright test --grep "page memory cards expose"` (1 pass). |
| 2026-05-27 | Workspaces | Done (revised) | Verified — 1 finding | Revised | Implemented in `chrome-extension/content.js` and `chrome-extension/styles.css`; focused e2e added to `test/e2e/specs/builtin.smoke.spec.js`. **Row grid fix:** the Graph and Archive/Reopen buttons are now wrapped in a new `.aaw-workspace-row-actions` flex group, so each `.aaw-workspace-row` has exactly two children matching its `minmax(0,1fr) auto` grid (select column + action group), fixing the prior three-children/two-columns mismatch. **Reopen label:** archived list rows relabel the action from `Open` to `Reopen`, matching the dashboard copy. **Semantics:** the selected workspace's `.aaw-workspace-select` button (and the unassigned active row) now expose `aria-current="true"` because it is the currently displayed workspace context; `.aaw-workspace-row--active` is preserved purely for the selected visual state. Filter tabs (built via new shared `buildWorkspaceTabs()`) expose `aria-pressed` synced to the active filter, and the tab group is wrapped with `role="group"`/`aria-label`. **Structured states:** a shared `workspaceStateRow(kind, message)` helper renders empty/loading/error rows (icon + text, `aria-busy` on loading, `role="alert"` on error) and replaces the prior plain text nodes in the list (`renderWorkspaceListState` shows loading on refresh + error on load failure), the dashboard (`renderWorkspaceNotes` loading/error/no-selection), and the body (no-data, no notes/sources/contacts/tasks/activity). **Disabled action reasons:** disabled Save Current Page / Create Task / Capture Lead buttons get a `title` plus `aria-describedby` pointing at helper text in a new `.aaw-workspace-action-reasons` block; `disabledActionReason()` distinguishes unassigned ("Select a workspace…"), archived ("Reopen this workspace…"), read-only ("This workspace is read-only."), and current-page-unavailable cases. **Selectors:** added `data-aaw-test="workspace-body"` to the notes/body container without changing the existing `workspace-dashboard` selector; preserved `workspace-create-input`, `workspace-create`, `workspace-status`, `workspace-list`, `workspace-dashboard`; added `.aaw-workspace-row-actions`. Verified: `node --check chrome-extension/content.js` (OK), `npx playwright test -g "workspace"` (2 pass, incl. 1 new spec asserting aria-pressed, aria-current, grouped row actions, Reopen label, and `workspace-body`), full `npx playwright test` (16 pass). **Verification finding (2026-05-27):** the plan requires structured empty/loading/error rows for the workspace list, dashboard, *and* body, but `renderWorkspaceNotes()`'s no-dashboard/no-selection path only cleared `workspaceDashboard` (`workspaceDashboard.textContent = ""`) and added the empty state to the body — leaving the dashboard container blank instead of showing a structured no-selection row. Fixed by appending `workspaceStateRow("empty", "Select a workspace to view its dashboard.")` to `workspaceDashboard` in that path; `workspace-body` behavior left intact. Attempted to strengthen the focused e2e to assert the dashboard's no-selection row, but the shared persistent extension profile keeps a workspace selected across specs so the no-selection state isn't reliably reachable at test start — reverted that assertion. Re-verified: `node --check chrome-extension/content.js` (OK), `npx playwright test -g "workspace"` (2 pass). |
| 2026-05-27 | Tasks | Done (revised) | Verified — 1 finding | Revised | Implemented in `chrome-extension/content.js` and `chrome-extension/styles.css`; focused e2e added to `test/e2e/specs/builtin.smoke.spec.js`. **Responsive create fields:** `.aaw-section` is now a query container (`container: aaw-section / inline-size`) so the create grid responds to the injected panel width (~340/390/440px), not the host viewport. `.aaw-task-create-grid` is one column by default; at container `min-width:320px` it becomes two columns with the title (`[data-aaw-test="task-title"]`) spanning the full row and due+priority sharing the next row; at `min-width:380px` it becomes the dense three-column `minmax(0,1fr) minmax(112px,0.45fr) minmax(112px,0.45fr)` layout. Old viewport `@media (max-width:390px)` collapse for the task grid removed (lead/contact grids kept). **Date input:** `input[type="date"]` added to the shared `.aaw-root` input styling + focus rules, with `appearance:auto` and a dark-theme-visible `::-webkit-calendar-picker-indicator` (`filter: invert(0.75)`) to preserve native affordances. **Selects:** `aaw-select` class added to the card status/priority inline selects and the create priority select so the chevron/affordance is consistent; meta-group selects/date use a higher-specificity `flex:1 1 110px; flex-shrink:1; min-width:0` rule to override the inline `.aaw-actions .aaw-select { flex-shrink:0 }` and avoid overflow at narrow widths. **Filter tabs:** `aria-pressed` added and kept in sync with `.is-active` on initial render and on every tab click. **Card control groups:** `renderTaskCard` now wraps controls in `.aaw-task-control-group--meta` (status, priority, due), `--primary` (Mark Done/Reopen), `--context` (View Context, Graph, Open Source), `--danger` (Delete); `.aaw-task-actions` switched to a column flow with each group a wrap row. **Delete confirm:** `deleteTask(id, button)` now gates on `window.confirm("Delete this task?")` matching the Page Memory native-confirm pattern; cancel restores focus to the Delete button. **Focus preservation:** new `focusAfterTaskMutation(id)` runs after update/delete re-renders with fallback order — same task card (via new `data-task-id`), else first remaining card, else active filter tab, else create button, else the task list/status region (focused via `tabindex="-1"`). Stable selectors (`task-title`, `task-due`, `task-priority`, `task-notes`, `task-draft`, `task-create`, `task-status`, `task-list`, `task-delete`) preserved. Verified: `node --check chrome-extension/content.js` (OK), `npm run test:unit` (110 pass), `npx playwright test builtin.smoke` (12 pass, incl. 1 new tasks spec asserting aria-pressed sync, grouped controls, and confirm-guarded delete). **Verification finding (2026-05-27):** focus after a task update did not return to the control the user interacted with — `updateTask()` called `focusAfterTaskMutation(id)`, which always focused the first focusable element in the surviving card (the status select) regardless of whether the user changed priority, due date, or clicked Mark Done/Reopen. Fixed by tagging the inline controls with `data-aaw-control` (`status`, `priority`, `due`, `primary`), passing the origin control from each change/click handler through `updateTask(id, patch, originControl)` into `focusAfterTaskMutation(id, originControl)`, which now restores focus to the matching control on the re-rendered card first (status→status, priority→priority, due→due, Mark Done/Reopen→the primary action) before falling back to any focusable in the same card, the first card, active filter, create button, then task list/status. Strengthened the focused e2e to change a card's priority select and assert focus returns to that priority select after re-render. Re-verified: `node --check chrome-extension/content.js` (OK), `npx playwright test -g "tasks sync filter"` (1 pass). |

| 2026-05-27 | Search Saved Memory | Done (revised) | Verified — 1 finding | Revised | Implemented in `chrome-extension/content.js` and `chrome-extension/styles.css`; focused e2e extended in `test/e2e/specs/builtin.smoke.spec.js`. **Clear control:** a visible `Clear` button (`data-aaw-test="search-clear"`, `aria-label`/`title` "Clear search") now sits next to the search input in a new `.aaw-search-input-row`; its handler cancels the pending debounce (`clearTimeout(searchDebounceTimer)`), blanks `searchInput.value`, calls `searchMemory("")`, and returns focus to the input. Existing Escape handling on the input is unchanged. **Structured state rows:** new `searchStateRow(kind, message)` + `renderSearchStateRow(kind, message)` helpers render visual idle/empty/no-match/error rows (icon + text) inside `search-results` in addition to the `search-status` text; `searchMemory` renders idle on empty query, `empty` on `memoryTotal === 0`, `none` on zero items, and `error` on request failure, and the initial build seeds an idle row. State rows are intentionally silent (no aria-live/role) to keep `search-status` the single live region. **Live region de-dup:** removed `aria-live="polite"` from `search-results`; `search-status` remains the only announced region. **Card hierarchy + clamp:** search cards now carry `.aaw-memory-result--search`; the title weight/size was bumped for clearer hierarchy, and the body uses `.aaw-memory-body--clamp` (4-line `-webkit-line-clamp`) with full preview text preserved in `dataset.aawFull` and the accessible `title`. Matched-term highlighting (`appendHighlightedText`) is unchanged; title links and the explicit `Graph` action remain the only interactive elements (card not made clickable). **Hover lift:** `.aaw-memory-result--search:hover` suppresses the translate lift and accent border so the non-clickable card does not imply interactivity. **Total counts:** the result-count status uses `data.total` (API total matches) when finite, falling back to rendered `items.length` only when no total is supplied. **Selectors:** preserved `search-input`, `search-status`, `search-results`; added `search-clear`. Verified: `node --check chrome-extension/content.js` (OK), `node --check test/e2e/specs/builtin.smoke.spec.js` (OK), `npx playwright test builtin.smoke --grep "summarizes, saves, and searches"` (1 pass — now also asserts the clear control empties the input, restores the idle status, and refocuses the input). **Verification finding (2026-05-27):** the result-count status did not honor `data.memoryTotal` as an API-total fallback — it used `Number.isFinite(data.total) ? data.total : items.length`, dropping straight to the rendered page count when `total` was absent even though the plan asks to prefer API totals (`total`, then `memoryTotal`) before the rendered count. Fixed so `totalCount` uses finite `data.total` first, finite `data.memoryTotal` second, then `items.length`. A focused unit test was not practical: the count logic is inline in `searchMemory()` (no extractable helper), and the backend `/api/memory/search` always returns `total`, so the e2e path cannot exercise the `memoryTotal`-only fallback without refactoring out of this fix's scope. Re-verified: `node --check chrome-extension/content.js` (OK), `npx playwright test builtin.smoke --grep "summarizes, saves, and searches"` (1 pass). |

## Claude Review Status

Claude Code review was completed before this file was saved.

Review execution adjustment: the first tool-enabled Claude Code review in plan mode exceeded the per-call budget before returning output. After local repo inspection, the remaining Claude Code reviews were run in plan mode with tools disabled and with repo evidence supplied in the prompt. No files were edited by Claude.

Individual section reviews:

| Section | Verdict | Merge Decision |
| --- | --- | --- |
| Analyze | Accepted | Merged with clarifications on shared analyze disabling and existing selection status reuse. |
| Result | Accepted | Merged with explicit `aria-busy` placement and provenance clearing timing. |
| Page Memory | Accepted | Merged with disabled-save visibility and delete/focus notes. |
| Lead Capture | Accepted | Merged with per-draft save guard and duplicate-click test requirement. |
| Tasks | Accepted | Merged with breakpoint verification, delete confirmation reuse, and focus fallback order. |
| Workspaces | Accepted | Merged with selected-state semantic to be documented. |
| Search Saved Memory | Accepted | Merged with existing highlight reuse, debounce-clear note, and live-region selector stability. |

Combined-plan gates:

| Gate | Verdict | Decision |
| --- | --- | --- |
| Analyze | Accepted | Keep. |
| Analyze + Result | Initially rejected, then accepted | Clarified `aria-busy` belongs on `result-output`; clear provenance before working render. |
| Analyze + Result + Page Memory | Initially conditional, then accepted | Clarified native disabled button feedback and native confirm focus restoration. |
| Through Lead Capture | Accepted | Keep; record explicit selector mappings and duplicate-save assertion. |
| Through Tasks | Accepted | Keep; validate breakpoint behavior and focus fallbacks during implementation. |
| Through Workspaces | Accepted | Keep; final gate later chose `aria-current="true"` for selected workspace semantics. |
| Full plan including Search | Initially conditional, then accepted | Clarified rewrite inactive class/style, workspace `aria-current`, duplicate-save test mechanism, and Playwright-first test approach. |

## Section Plans

### Analyze

Planned changes:

- Move the command strip before the shared free-form instruction input.
- Rename instruction copy to neutral `Guidance`, because the same input feeds summarize, rewrite, and extract.
- Add a compact source hint near commands or guidance. It should show selected text versus readable full page and include character count when available.
- Reuse existing selection/page snapshot patterns, including `getSelectedText()`, `getReadablePageSnapshot()`, `captureRewriteSnapshot()`, `refreshRewriteSelectionStatus()`, and existing `selectionchange` behavior.
- Make in-flight disabling consistent. Rewrite should disable all three analyze commands with native `button.disabled = true`, matching summarize/extract behavior.
- Keep rewrite controls visible when no selection exists. Apply `.aaw-rewrite-controls--inactive` with reduced opacity around `0.65` and muted helper/status text, but do not use `display: none`, `visibility: hidden`, or group-level `pointer-events: none`.
- Preserve direct replacement when supported, copy fallback otherwise, and visible undo/copy affordances after preview generation.

Stable selectors and classes:

- Preserve `data-aaw-test="cmd-summarize"`.
- Preserve `data-aaw-test="cmd-rewrite"`.
- Preserve `data-aaw-test="cmd-extract"`.
- Add `.aaw-rewrite-controls--inactive`.

Future tests:

- Command strip appears before `Guidance`.
- Source hint changes after selection changes.
- No-selection rewrite status remains visible.
- Rewrite in-flight state disables summarize, rewrite, and extract.
- Rewrite fallback, undo, and copy controls remain reachable after preview generation.

### Result

Planned changes:

- Add explicit result state attributes, such as `data-state`, on result output and/or wrapper.
- Put `aria-busy` specifically on `result-output`, the element that already contains the live result text.
- Clear stale provenance with `setResultProvenance(null)` in `analyze()` and `runRewrite()` before rendering the working/loading result.
- Keep provenance clear for error rendering unless the failing response supplies fresh provenance.
- Move copy success/failure feedback out of the lifecycle chip and into inline toolbar feedback or a small polite live status element.
- Add stable toolbar test IDs for Copy, Clear, and Expand buttons.
- Use `aria-expanded` and `aria-controls` for Expand. Remove `aria-pressed` if it conflicts with disclosure semantics.
- Make result output focusable with `tabindex="0"` so keyboard users can scroll long output.
- Add long-token wrapping safeguards such as `overflow-wrap: anywhere`.

Stable selectors and classes:

- Preserve `data-aaw-test="result-chip"`.
- Preserve `data-aaw-test="result-output"`.
- Preserve `data-aaw-test="result-provenance"`.
- Add test IDs for result Copy, Clear, and Expand buttons.

Future tests:

- Stale provenance clears before the working state appears.
- Copy feedback does not change lifecycle chip text.
- Toolbar button test IDs exist.
- Expand button has `aria-expanded` and `aria-controls` wired to the output.
- Result output is focusable.
- A long token wraps inside the panel without horizontal overflow.

### Page Memory

Planned changes:

- Add local state styling for `memory-status`, such as `saving`, `saved`, `error`, and `idle`.
- Keep Save Memory as the primary accent action.
- Group action dropdown, Run Action, and Page Graph as secondary controls.
- Ensure Save Memory disabled feedback remains visible after regrouping.
- Keep Page Memory feedback in Page Memory. Save Memory, Run Action, Page Graph unavailable, note edit, and delete feedback may share `memory-status`; lead, task, and workspace feedback should stay in their own sections.
- Add `.aaw-page-memory-card` to page memory cards while preserving shared `.aaw-memory-result` styling.
- Clamp long page memory card previews without truncating the saved data.
- Handle invalid or missing `createdAt` with fallback text: `Saved date unavailable`.
- Add edit expansion and focus states. Edit buttons should expose `aria-expanded` and `aria-controls`, focus should move into the opened editor, and close/save should return focus to a sensible control.
- Keep the existing native `window.confirm` delete pattern. After cancel/confirm, restore focus to the Delete button or a nearby fallback target when possible.

Stable selectors and classes:

- Preserve `data-aaw-test="memory-note-input"`.
- Preserve `data-aaw-test="save-memory"`.
- Preserve `data-aaw-test="memory-status"`.
- Preserve `data-aaw-test="page-graph"`.
- Preserve `data-aaw-test="page-memory-list"`.
- Add `.aaw-page-memory-card`.

Future tests:

- Save status tone changes for saving/saved/error.
- Save Memory remains visually primary.
- Secondary action group does not obscure disabled Save state.
- Invalid dates render `Saved date unavailable`.
- Long previews clamp without losing accessible text.
- Edit buttons expose expansion semantics and focus moves into and out of editors.
- Delete confirmation cancel and confirm preserve focus as designed.

### Lead Capture

Planned changes:

- Style `input[type="email"]` and `input[type="tel"]` consistently with other panel inputs and focus states.
- Rename linked-memory checkbox text from `Save linked memory` to `Create linked memory on save`.
- Keep linked-memory behavior and default checked state unchanged.
- Use existing lead status tone classes consistently for capture, save, update, delete, unlink, empty, and error outcomes.
- Handle successful zero-lead extraction clearly. Render a visible Drafts empty state and set status to `No lead details found on this page.` instead of `0 lead drafts ready.`
- Add per-draft save guards. Disable only the clicked draft's Save Lead button immediately, block duplicate requests for that draft while pending, and restore the button only if save fails.
- Keep other draft cards usable while one draft saves.
- Add `.aaw-lead-draft-card` to draft cards while preserving existing draft test hooks. Saved contacts should continue using `.aaw-contact-card`.

Stable selectors and classes:

- Preserve `data-aaw-test="lead-capture"`.
- Preserve `data-aaw-test="lead-status"`.
- Preserve `data-aaw-test="lead-drafts"`.
- Preserve `data-aaw-test="lead-draft-card"`.
- Preserve `data-aaw-test="contact-list"`.
- Add `.aaw-lead-draft-card`.
- Preserve `.aaw-contact-card`.

Future tests:

- Email and telephone inputs inherit panel input styling.
- Checkbox copy is `Create linked memory on save`.
- Zero-lead extraction shows a clear empty state and status.
- Duplicate-save guard test keeps the save promise pending, clicks twice, verifies the button remains disabled, and verifies the observed contact-save request/message count increments only once.
- Draft and saved contact cards have distinct classes while existing selectors keep working.

### Tasks

Planned changes:

- Make task create fields responsive at injected panel widths around `340px`, `390px`, and `440px`.
- Keep a dense three-column layout only where it fits without overflow; otherwise fall back to two or one columns.
- Style `input[type="date"]` consistently with other inputs while preserving native date affordances.
- Keep task selects visually consistent, including card inline selects and create priority select.
- Add `aria-pressed` to task filter tabs and keep it synced with `.is-active`.
- Reorganize dense task card controls into predictable groups:
  - Metadata controls: status, priority, due date.
  - Primary state action: Mark Done or Reopen.
  - Context/source actions: View Context, Graph, Open Source.
  - Destructive action: Delete.
- Add delete confirmation before `deleteTask()` deletes a task, matching the Page Memory native confirm pattern.
- Preserve focus after updates and deletes where practical. Fallback order: updated card/action if still present, next card, active filter, create button, then task list/status.

Stable selectors and classes:

- Preserve `data-aaw-test="task-title"`.
- Preserve `data-aaw-test="task-due"`.
- Preserve `data-aaw-test="task-priority"`.
- Preserve `data-aaw-test="task-notes"`.
- Preserve `data-aaw-test="task-draft"`.
- Preserve `data-aaw-test="task-create"`.
- Preserve `data-aaw-test="task-status"`.
- Preserve `data-aaw-test="task-list"`.
- Preserve `data-aaw-test="task-delete"`.

Future tests:

- Responsive layout at `340px`, `390px`, and `440px` has no overflow or overlapping text.
- Date input uses panel input styling.
- Filter tabs keep `aria-pressed` and `.is-active` in sync.
- Card controls render in expected groups.
- Delete cancel does not delete; delete confirm deletes.
- Focus fallback order works after update and delete.

### Workspaces

Planned changes:

- Fix the workspace row grid mismatch by wrapping Graph and Archive/Reopen actions in `.aaw-workspace-row-actions`. The row should keep the select button in the first column and the action group in the second column.
- Rename archived row action from `Open` to `Reopen`, matching dashboard copy.
- Use `aria-current="true"` for the active workspace row/select button because it represents the currently displayed workspace context.
- Preserve `.aaw-workspace-row--active` for visual selected state.
- Add `aria-pressed` to workspace filter tabs.
- Render structured empty, loading, and error rows for workspace list, dashboard, and body instead of plain text only.
- Clarify disabled dashboard action reasons with `title` plus `aria-describedby` or helper text for archived/read-only/unassigned/current-page-unavailable cases.
- Add `data-aaw-test="workspace-body"` to the workspace body/notes container without changing the existing dashboard selector.

Stable selectors and classes:

- Preserve `data-aaw-test="workspace-create-input"`.
- Preserve `data-aaw-test="workspace-create"`.
- Preserve `data-aaw-test="workspace-status"`.
- Preserve `data-aaw-test="workspace-list"`.
- Preserve `data-aaw-test="workspace-dashboard"`.
- Add `data-aaw-test="workspace-body"`.
- Add `.aaw-workspace-row-actions`.

Future tests:

- Row action grouping fixes the two-column/three-child mismatch.
- Archived row action label is `Reopen`.
- Active workspace exposes `aria-current="true"`.
- Filter tabs expose `aria-pressed`.
- Empty/loading/error rows render in the list/dashboard/body.
- Disabled dashboard buttons expose useful reasons.
- Existing workspace selectors keep passing.

### Search Saved Memory

Planned changes:

- Add a visible clear control next to the search input.
- Clear control should cancel pending debounce, call `searchMemory("")`, keep Escape behavior unchanged, and return focus to the search input.
- Render visual idle, empty, no-match, and error rows inside `search-results` in addition to status text.
- Improve result card hierarchy while preserving existing matched-term highlighting logic.
- Clamp long previews in search cards while preserving full saved content in data/model and accessible text.
- Avoid hover lift on non-clickable cards.
- Do not make entire result cards clickable. Keep title links and Graph actions explicit.
- Use total counts when available from the API, such as `total` or `memoryTotal`; fall back to rendered item count only when totals are unavailable.
- Remove duplicate live-region announcements by keeping `search-status` as the live region and making results non-live unless there is a specific accessibility need.

Stable selectors and classes:

- Preserve `data-aaw-test="search-input"`.
- Preserve `data-aaw-test="search-status"`.
- Preserve `data-aaw-test="search-results"`.
- Add a clear-control test ID during implementation.

Future tests:

- Clear control clears query, cancels debounce, resets results/status, and returns focus to input.
- Escape still clears search.
- Idle, no saved memory, no match, and error rows render in `search-results`.
- Long previews clamp without horizontal overflow.
- Non-clickable search cards do not hover-lift.
- Total-count status uses API totals where available.
- `search-status` is the only live region for ordinary search result changes.

## Rejected / Adjusted Notes

- Rejected adding a global `/` focus shortcut for Search. Existing command registry behavior must not be expanded into host-page-global focus handling.
- Rejected making entire Search result cards clickable. Keep title links and Graph actions explicit.
- Rejected completely hiding Analyze rewrite controls. Keep them visible and de-emphasized with clear no-selection/status feedback.
- Adjusted Result accessibility after combined review: `aria-busy` belongs on `result-output`, and stale provenance clears before working result rendering.
- Adjusted Page Memory after combined review: native disabled styling communicates analyze/save disabled states; native confirm delete flow should restore focus after cancel/confirm.
- Adjusted Lead Capture test plan: the duplicate-save guard must prove the second click does not trigger a second save request/message.
- Adjusted Workspaces semantics: active workspace should use `aria-current="true"` rather than leaving the semantic undecided.
- Adjusted review execution: due to the initial tool-enabled Claude Code budget failure, later Claude reviews used plan mode with tools disabled and supplied repo evidence from local inspection.

## Test Plan

Document acceptance:

- `UI_POLISH_PLAN.md` exists at repo root.
- The plan includes all seven requested sections.
- The plan records Claude review status, merge decisions, rejected/adjusted notes, and future test scenarios.

Repo safety:

- This planning task should change only `UI_POLISH_PLAN.md`.
- No Chrome extension UI code should be edited as part of this task.

Future implementation test approach:

- Use existing Playwright extension smoke/e2e coverage for user-facing UI behavior, responsive widths, accessibility attributes, focus behavior, and async guards.
- Use Node/unit tests only if implementation extracts reusable state, date, or formatting helpers.

Future Playwright coverage should include:

- Result toolbar behavior, stale provenance clearing, copy feedback, expand semantics, and long result wrapping.
- Page Memory edit/delete, invalid dates, preview clamps, and primary/secondary action grouping.
- Lead Capture zero-result state and per-draft save guard.
- Task filters, responsive create layout, grouped card controls, delete confirmation, and focus fallback.
- Workspace row actions, selected state, dashboard/body states, disabled action reasons, and `workspace-body`.
- Search clear control, empty/no-match/error rows, total counts, long previews, non-clickable hover behavior, and live-region behavior.

Responsive visual checks:

- Cover injected panel widths around `340px`, `390px`, and `440px`.
- Verify no horizontal overflow, layout shift, or overlapping text.
- Verify fixed-format controls do not resize unexpectedly during hover, loading, or disabled states.
