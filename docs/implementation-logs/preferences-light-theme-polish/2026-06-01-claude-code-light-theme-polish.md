# Implementation Log: Light Theme Polish (Attempt 2 — Defect Fix)

Date: 2026-06-01
Implementer: Claude Code
Milestone: preferences-light-theme-polish

## What Was Done

This attempt was a narrow defect-fix pass on top of attempt 1's broad (user-owned)
light-theme CSS changes. It addressed the single concrete in-scope defect the
independent verifier flagged:

- `.aaw-btn.danger` in `chrome-extension/styles.css` still hard-coded its resting
  border color as `rgba(255, 77, 79, 0.4)` — the dark danger color `#ff4d4f` at 40%
  alpha. This pale pink does not adapt to the light theme and is nearly invisible on
  a white surface, and it ignored the existing `--aaw-danger` token.

Fix applied:

- Replaced the hard-coded value with
  `color-mix(in srgb, var(--aaw-danger) 40%, transparent)`.
  - Uses the existing theme-aware `--aaw-danger` token (`#ff4d4f` dark / `#d23436`
    light), as the plan requires.
  - Preserves the original 40% border softness so the dark theme stays visually
    close to its current appearance (acceptance criterion).
  - In light theme the border now derives from `#d23436` at 40%, which is visible
    against white instead of the previous invisible pale pink.
  - `color-mix(in srgb, ...)` is safe in this Chrome-only MV3 extension (supported
    since Chrome 111).

No JavaScript, storage, theme-switching, backup, shortcut, or layout behavior was
changed. No broad CSS/test rewrites were made in this attempt.

## Files Changed Or Inspected

Changed:

- `chrome-extension/styles.css` — `.aaw-btn.danger` resting `border-color` only
  (one line; previously `rgba(255, 77, 79, 0.4)` → token-based `color-mix`).
- `docs/implementation-logs/preferences-light-theme-polish/2026-06-01-claude-code-light-theme-polish.md`
  (this log).

Inspected:

- `docs/implementation-logs/preferences-light-theme-polish/2026-06-01-verifier-light-theme-polish.md`
- `docs/implementation-logs/preferences-light-theme-polish/2026-06-01-building-plan-light-theme-polish.md`
- `chrome-extension/styles.css` token roots (lines 10–95) and the
  `.aaw-btn.danger` / `.aaw-result-chip--*` blocks.
- `test/e2e/specs/builtin.smoke.spec.js` (syntax check target).

## Verification Commands Run

```bash
node --check test/e2e/specs/builtin.smoke.spec.js   # PASS (NODE_CHECK_OK)
npm test                                            # PASS (123 passed, 0 failed)
git diff -- chrome-extension/styles.css | grep ...  # confirms only .aaw-btn.danger border changed
```

## Successful Checks

- `node --check test/e2e/specs/builtin.smoke.spec.js` passed.
- `npm test` passed: 123 tests, 0 failed, 0 skipped.
- Static re-scan confirms `.aaw-btn.danger` no longer hard-codes a pale-pink border
  and now references `--aaw-danger`.
- The danger hover state (`border-color: var(--aaw-danger)`) and danger text color
  were already token-based and remain so; the resting/hover transition is preserved
  via the 40% → 100% alpha step.

## Failed Checks

- None introduced by this change.

## Suspected Causes For Failures

- Not applicable to this change. The pre-existing targeted Playwright failure
  (`Timed out waiting for MV3 extension service worker` in `launchExtension()`)
  reported by the verifier was not re-run in this attempt — see Known Risks. That
  failure occurs during harness/extension launch before any page or CSS is
  exercised, and a CSS-only border-color edit cannot affect MV3 service-worker
  registration, so it is not caused by this fix.

## Known Risks

- Full / targeted e2e was intentionally not re-run. Per the attempt scope, the
  Playwright service-worker timeout is a known harness launch failure unrelated to
  this CSS token fix; re-running would reproduce the same timeout without exercising
  the changed CSS. The light/dark danger-border rendering was therefore not
  browser-verified in this attempt.
- `color-mix` introduces a CSS function not previously used elsewhere in this
  codebase. It is valid in the targeted Chrome MV3 runtime, but is a new pattern.

## Out-Of-Scope Items Observed (Reported, Not Changed)

- `chrome-extension/styles.css:639` `.aaw-result-chip--error` hard-codes
  `border-color: rgba(255, 77, 79, 0.5)`. This is a sibling of `--working`
  (`rgba(247, 201, 72, 0.45)`) and `--done` (`rgba(72, 214, 181, 0.42)`), forming a
  consistent hard-coded status-chip border set. It is a different selector from the
  flagged `.aaw-btn.danger` defect, was not flagged by the verifier, and the plan's
  `.aaw-result-chip` note concerns translucent white fills, not status borders.
  Left unchanged to avoid scope creep; recommend a follow-up if status-chip borders
  should also become token/theme-aware.
- Previously reported out-of-scope items remain untouched per plan: `.aaw-context-edge`
  / `.aaw-context-warning` using `var(--aaw-muted)` (token appears to be
  `--aaw-text-muted`), and `.aaw-logo-mark` light-mode glyph contrast.
- The broader attempt-1 CSS diff (options.css / styles.css insertions) is treated as
  pre-existing user-owned dirty work and was not reverted or rewritten.

## Final Status

Status: complete for the assigned narrow scope.

The one explicit in-scope defect (`.aaw-btn.danger` hard-coded pale-pink border) is
fixed to use the existing `--aaw-danger` token while preserving border softness.
Syntax check and the full unit suite pass. Targeted/full e2e was deferred due to the
known, unrelated MV3 service-worker harness failure documented above.

---

# Attempt 4 — `.opt-btn-danger` Light-Theme Contrast Fix

Date: 2026-06-01
Implementer: Claude Code
Milestone: preferences-light-theme-polish

## What Was Done

Narrow defect-fix pass addressing the single concrete defect a fresh verifier
flagged: the `.opt-btn-danger` button in `chrome-extension/options.css` hard-coded
its background and border as `rgba(255, 77, 79, ...)` (the dark danger color). With
white text this has insufficient light-theme contrast, and it ignores the
theme-aware `--aaw-danger` token (`#ff4d4f` dark / `#d23436` light).

Fix applied to two selectors only:

- `.opt-btn-danger` — resting `background` fill and `border-color` changed from
  `rgba(255, 77, 79, 0.85)` / `rgba(255, 77, 79, 0.9)` to
  `color-mix(in srgb, var(--aaw-danger) 80%, black)`. The overlay
  `linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0))` highlight
  and `color: white` are preserved.
- `.opt-btn-danger:hover:not(:disabled)` — `background` and `border-color` changed
  from `rgba(255, 77, 79, 1)` to `color-mix(in srgb, var(--aaw-danger) 82%, black)`.

Deriving from `var(--aaw-danger)` and mixing 80–82% with black darkens the fill
enough for readable white text in both light and dark themes while keeping the
button visibly danger-colored. `color-mix(in srgb, ...)` is valid in this Chrome-only
MV3 extension (supported since Chrome 111) and matches the pattern introduced in
attempt 2.

No JavaScript, storage, tests, layout, or unrelated selectors were changed.

## Files Changed Or Inspected

Changed:

- `chrome-extension/options.css` — `.opt-btn-danger` resting `background` +
  `border-color`, and `.opt-btn-danger:hover:not(:disabled)` `background` +
  `border-color` only (4 declarations across the two selectors).
- `docs/implementation-logs/preferences-light-theme-polish/2026-06-01-claude-code-light-theme-polish.md`
  (this Attempt 4 entry).

Inspected:

- `chrome-extension/options.css` `--aaw-danger` token definitions (line 15 dark
  `#ff4d4f`, line 47 light `#d23436`) and the `.opt-btn-danger` block (lines 754–763).
- `AGENTS.md` (scope and required-log conventions).
- `test/e2e/specs/builtin.smoke.spec.js` (syntax-check target).

## Verification Commands Run

```bash
node --check test/e2e/specs/builtin.smoke.spec.js   # PASS (NODE_CHECK_OK)
npm test                                            # PASS (123 passed, 0 failed)
```

## Successful Checks

- `node --check test/e2e/specs/builtin.smoke.spec.js` passed (NODE_CHECK_OK).
- `npm test` passed: 123 tests, 0 failed, 0 skipped.
- Both danger selectors now derive from `var(--aaw-danger)` instead of the
  hard-coded `rgba(255, 77, 79, ...)` values; white text contrast improved via the
  80–82% mix with black.

## Failed Checks

- None introduced by this change.

## Suspected Causes For Failures

- Not applicable. The pre-existing MV3 service-worker launch timeout (see Known
  Risks) was not re-run; a CSS-only color edit cannot affect service-worker
  registration.

## Known Risks

- Full / targeted e2e was intentionally not re-run. The Playwright
  `Timed out waiting for MV3 extension service worker` failure in `launchExtension()`
  is a known harness launch failure unrelated to this CSS change, so the light/dark
  danger-button rendering was not browser-verified in this attempt.
- `color-mix` remains a relatively new CSS pattern in this codebase, but is valid in
  the targeted Chrome MV3 runtime and already used by attempt 2.

## Out-Of-Scope Items Observed (Reported, Not Changed)

- Per the assigned scope, `var(--aaw-muted)`/`--aaw-text-muted` usage, the
  `.aaw-logo-mark` light-mode glyph contrast, the `.aaw-result-chip--*` status
  borders, and the broader pre-existing dirty CSS were left untouched.

## Final Status

Status: complete for the assigned narrow scope.

The single in-scope defect (`.opt-btn-danger` hard-coded red with poor light-theme
white-text contrast) is fixed to derive from the theme-aware `--aaw-danger` token,
darkened 80–82% with black for readable white text. Syntax check and the full unit
suite pass. Targeted/full e2e was deferred due to the known, unrelated MV3
service-worker harness failure documented above.
