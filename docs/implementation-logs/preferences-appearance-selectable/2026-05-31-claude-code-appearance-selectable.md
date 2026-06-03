# Appearance Theme Selectable — Implementation Log

- Date: 2026-05-31
- Implementer: Claude Code
- Milestone: preferences-appearance-selectable

## What was done

The Appearance theme chooser persisted correctly but rendered as plain native
radios with a weak/unclear selected state. Restyled the three theme controls
into segmented card buttons with a clear selected state, hover and focus-visible
states, and a full-label click target. No JS behavior, storage key, values, or
markup semantics were changed.

- Reused the existing accent/border/surface CSS variables so the light theme
  (`:root[data-aaw-theme="light"]`) is covered by the same selectors.
- Kept the native `<input type="radio" name="appearance-mode">` controls for
  accessibility and keyboard support; visually hid the radio dot (clip pattern)
  so the whole label is the clickable control.
- Selected state via `.opt-radio:has(input:checked)` (Chrome-supported),
  hover via `.opt-radio:hover`, focus ring via
  `.opt-radio:has(input:focus-visible)`.
- Layout still uses `flex` + `flex-wrap`, so the existing mobile breakpoints
  (760px / 620px) are unaffected; the `min-width: 104px` cards wrap as needed.

## Files changed

- `chrome-extension/options.css` — replaced `.opt-appearance` / `.opt-radio`
  rules with segmented card-button styling (visually-hidden input, hover,
  checked, focus-visible states).
- `test/e2e/specs/builtin.smoke.spec.js` — added regression test
  "appearance theme is selectable via the visible card labels and persists".

No changes to `options.html` markup were needed; the existing `data-aaw-test`
attributes and radio structure were sufficient.

## Verification commands run

- `node --check chrome-extension/options.js chrome-extension/settings-utils.js chrome-extension/shortcut-utils.js`
- `npm test`
- `npx playwright test test/e2e/specs/builtin.smoke.spec.js -g "appearance theme is selectable"`

## Successful checks

- Syntax check: `SYNTAX OK` for all three JS files.
- Unit tests: 123 passed, 0 failed.
- Targeted Playwright test: 1 passed. It opens `#appearance`, clicks the visible
  Dark/Light/System card labels (not the hidden input), and verifies:
  - the corresponding input is `:checked`,
  - `chrome.storage.local.appearanceSettings.mode` equals the clicked value,
  - root `data-aaw-theme` becomes `light` then `dark` for those selections.

## Failed checks

- None.

## Suspected causes for failures

- N/A.

## Known risks

- `:has()` and `:focus-visible` are required; both are supported in the
  Chromium/Chrome target for this MV3 extension, so this is low risk.
- The native radio dot is visually hidden; the card border/fill/ring now
  conveys selection. Screen readers still announce the radio group normally.

## Final status

Complete. All run checks passed.
