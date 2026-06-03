# Claude Code Implementation — Preferences status/feedback window theme fix

Date: 2026-05-31
Task: Make the settings/preferences `.opt-status` feedback windows follow the
appearance theme (Dark / Light / System) instead of staying dark in light mode.
Retry attempt: 2 (prior attempt diagnosed root cause but was blocked by an edit
permission prompt before changing files).

## What was done

The `.opt-status` feedback/status windows on the options page were painted with
hardcoded `rgba(255, 255, 255, ...)` border and background values. Those white
translucent overlays are visible on the dark surface but effectively disappear /
do not adapt on the light surface, so the box kept reading as "dark" after the
appearance theme switched to Light (or to a light-resolved System).

The theme-switching JS was already correct: `applyAppearanceTheme()` in
`options.js` sets `data-aaw-theme` on `document.documentElement`, re-applies on
radio change, and re-resolves on `prefers-color-scheme` change while in System
mode. The defect was purely in CSS — the status surface did not use theme tokens.

Fix:

- Added theme-aware tokens `--aaw-status-bg` / `--aaw-status-border` to both the
  default (dark) `:root` block and the `:root[data-aaw-theme="light"]` block in
  `chrome-extension/options.css`.
  - Dark: `rgba(255, 255, 255, 0.03)` bg, `rgba(255, 255, 255, 0.07)` border
    (identical to the previous hardcoded values, so the dark look is unchanged).
  - Light: `rgba(17, 19, 23, 0.04)` bg, `rgba(17, 19, 23, 0.12)` border — a
    subtle dark inset that reads as a box on the light section background.
- Pointed `.opt-status` at those tokens instead of the hardcoded white rgba.

Notes on the variants left intentionally unchanged:

- `.opt-status.is-error` / `.opt-status.is-success` only override `border-color`
  (colored red/teal translucent, visible on both backgrounds) and `color`
  (already `--aaw-danger` / `--aaw-success`, which are theme-aware). Their
  background still inherits the new theme-aware `--aaw-status-bg`, so error and
  success variants remain readable and theme-aware in both modes.
- `.opt-status:empty { display: none; }` is untouched, so empty live regions
  still do not draw a box.

## Files changed

- `chrome-extension/options.css`
  - added `--aaw-status-bg` / `--aaw-status-border` to `:root` (dark defaults)
  - added the light overrides to `:root[data-aaw-theme="light"]`
  - `.opt-status` now uses `var(--aaw-status-border)` / `var(--aaw-status-bg)`
- `test/e2e/specs/builtin.smoke.spec.js`
  - new test: "status feedback window adopts theme-aware colors across light and
    system themes" — uses the visible `#dedupe-status` feedback window and
    asserts computed `backgroundColor` / `borderTopColor` / `color` move off the
    dark styling when Light is selected, then that System mode follows
    `prefers-color-scheme` (light -> light styling, dark -> dark styling) live.

## Verification commands run

- `node --check chrome-extension/options.js chrome-extension/settings-utils.js chrome-extension/shortcut-utils.js` (also `node --check` on the spec)
- `npm test`
- `npx playwright test builtin.smoke.spec.js -g "appearance|status|feedback|empty"`

## Successful checks

- `node --check` passed for `options.js`, `settings-utils.js`,
  `shortcut-utils.js`, and the smoke spec.
- `npm test`: 123 pass, 0 fail.
- Playwright (filtered): 3 passed, including the new theme-aware status test and
  the existing "empty status live regions stay hidden" and "appearance theme is
  selectable" tests.

## Failed checks

- None.

## Suspected causes for failures

- N/A.

## Known risks

- Light-mode status colors are tuned values; if the surrounding section surface
  changes substantially in a future theme pass, the subtle inset may need
  re-tuning. Contrast is fine against the current `--aaw-bg-soft` light surface.
- Scope kept to the `.opt-status` feedback surface and the two new theme tokens;
  no backup/settings or unrelated dirty work was touched.

## Final status

Complete. `.opt-status` feedback windows are now theme-aware in Dark, Light, and
System modes, switching live without reload; empty status regions remain hidden;
error/success variants remain readable. Unit and targeted Playwright tests pass.
