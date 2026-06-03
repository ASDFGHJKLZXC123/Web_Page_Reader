# Control Height Alignment — Implementation Log

Date: 2026-05-31
Author: Claude Code (implementer)
Milestone: preferences-control-height

## What was done

Made collapsed single-line settings controls share one visual height so that
text/password/url/date/number inputs, native selects, and collapsed custom
dropdown triggers all line up within options/settings sections, while textareas
keep their multi-line height.

- Added a shared `--opt-control-height: 38px` token under `:root` in
  `chrome-extension/options.css`.
- Applied `height: var(--opt-control-height)` + `line-height: 1.5` to
  `input.opt-input` and `select.opt-input` (single-line controls only).
- Applied `min-height: var(--opt-control-height)` to `.opt-dropdown__trigger`
  (it already uses `display: flex; align-items: center`, so content stays
  vertically centered and unclipped).
- Added a `textarea.opt-input { height: auto; }` override so textareas are not
  forced to single-line height; `.opt-textarea` min-height/rows preserved.
- Global `* { box-sizing: border-box; }` means the input `height` and the
  trigger `min-height` resolve to the same outer box, so heights match.
- Dropdown expanded listbox styles left unchanged.

## Files changed

- `chrome-extension/options.css`
- `test/e2e/specs/builtin.smoke.spec.js` (added regression test
  "collapsed settings controls share one visual height")
- `docs/implementation-logs/preferences-control-height/2026-05-31-claude-code-control-height.md`

## Verification commands run

- `node --check chrome-extension/options.js chrome-extension/settings-utils.js chrome-extension/shortcut-utils.js`
- `npm test`
- targeted Playwright: `npx playwright test builtin.smoke.spec.js -g "collapsed settings controls share one visual height"`

## Results

(See PR/return message for exact command output.)

## Known risks

- The token value (38px) is tuned to the existing 8px padding + 13px/1.5
  line-height; changing padding/font in these controls may require revisiting
  the token. The Playwright test guards regressions against drift > 1px.

## Final status

Implementation complete pending the command results recorded in the return message.
