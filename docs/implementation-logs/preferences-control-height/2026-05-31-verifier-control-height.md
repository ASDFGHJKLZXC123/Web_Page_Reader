# Control Height Alignment - Independent Verification Log

Date: 2026-05-31
Author: Codex verification sub-agent
Milestone: preferences-control-height

## What was reviewed

Verified the Claude Code implementation for shared settings control heights.
The review focused on ensuring single-line inputs and collapsed custom dropdown
triggers render at the same visual height within options/settings sections while
textareas remain multi-line.

## Files inspected

- `chrome-extension/options.css`
- `test/e2e/specs/builtin.smoke.spec.js`
- `docs/implementation-logs/preferences-control-height/2026-05-31-claude-code-control-height.md`

## Verification commands run

- `git status --short`
- `git diff -- chrome-extension/options.css test/e2e/specs/builtin.smoke.spec.js docs/implementation-logs/preferences-control-height/2026-05-31-claude-code-control-height.md`
- `rg -n "collapsed settings controls share one visual height|opt-control-height|opt-dropdown__trigger|textarea\\.opt-input" test/e2e/specs/builtin.smoke.spec.js chrome-extension/options.css docs/implementation-logs/preferences-control-height/2026-05-31-claude-code-control-height.md`
- `node --check chrome-extension/options.js chrome-extension/settings-utils.js chrome-extension/shortcut-utils.js`
- `npm test`
- `npx playwright test builtin.smoke.spec.js -g "collapsed settings controls share one visual height"`
- `npx playwright test builtin.smoke.spec.js -g "settings custom dropdowns drive the hidden native selects"`

## Successful checks

- `chrome-extension/options.css` defines `--opt-control-height: 38px` on
  `:root`.
- `input.opt-input` and `select.opt-input` use
  `height: var(--opt-control-height)` with matching line-height.
- `.opt-dropdown__trigger` uses `min-height: var(--opt-control-height)` with
  the existing border-box sizing, padding, and flex centering; the targeted
  browser regression confirms the collapsed dropdown triggers and input render
  within 1px of each other.
- `textarea.opt-input` explicitly uses `height: auto`, and `.opt-textarea`
  retains its multi-line minimum height.
- Expanded dropdown behavior remains covered by the existing Playwright
  custom-dropdown spec, which passed after the height change.
- The targeted Playwright regression exists at
  `test/e2e/specs/builtin.smoke.spec.js` and checks both AI-section collapsed
  dropdown/input parity and privacy-section textarea opt-out behavior.
- The required Claude Code implementation log exists under
  `docs/implementation-logs/preferences-control-height/`.
- `node --check` passed.
- `npm test` passed: 123 tests passed.
- Targeted Playwright height regression passed: 1 test passed.
- Targeted Playwright custom-dropdown behavior regression passed: 1 test
  passed.

## Failed checks

None.

## Suspected causes for failures

No failures observed.

## Known risks

- The repository has broad preexisting dirty work outside this verification
  scope. This pass inspected the requested files and did not identify unrelated
  scope creep or reverts in the shared-height change.
- `.opt-dropdown__trigger` uses `min-height` rather than `height`. Current
  content is constrained by nowrap/ellipsis and the browser regression confirms
  parity, but future trigger content that wraps or grows could exceed the token
  height.

## Final status

Passed. The shared control-height implementation satisfies the requested
acceptance criteria.
