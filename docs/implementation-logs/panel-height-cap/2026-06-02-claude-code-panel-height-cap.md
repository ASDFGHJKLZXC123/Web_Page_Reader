# Claude Code Implementation Log: Injected Panel Height Cap

## What Was Done / Reviewed
- This is implementation attempt 2. Attempt 1 was terminated after running silently too long, but it had already applied the substantive edits. This attempt inspected those edits, confirmed they satisfy the plan, ran the quick verification commands, and created this log. No further source/test edits were needed.
- Reviewed the injected-panel height cap in `chrome-extension/styles.css`:
  - `.aaw-root` base rule sets `max-height: min(720px, calc(100dvh - 24px));` (line 41), so the panel caps at 720px on tall desktop viewports and follows the 24px viewport gutter when the viewport is shorter than ~744px.
  - The `@media (max-width: 390px)` override keeps `max-height: calc(100dvh - 16px);` (line 106) with no 720px cap, matching the existing narrow-viewport layout (`right: 8px`, `width: calc(100vw - 16px)`).
  - Confirmed via grep that these are the only two `max-height` declarations scoped to `.aaw-root`; the other `max-height` values in the file target unrelated elements (`.aaw-result`, `.aaw-result--expanded`, command palette, dropdown lists, etc.) and do not conflict.
- Reviewed the three added Playwright specs near the end of `test/e2e/specs/builtin.smoke.spec.js` (the "Injected panel height cap" block) plus the shared `readPanelMetrics` helper:
  - Tall desktop (1440x1200): expects computed `maxHeight === "720px"`, `offsetHeight <= 720` and `> 600`, and `scrollHeight > clientHeight` (internal scroll). Consistent with the 720px cap binding when `calc(100dvh - 24px)` = 1176px.
  - Short desktop (1440x500): expects `maxHeight === "476px"` (viewport − 24px), `offsetHeight ≈ 476`, `< 720`, and internal scroll. Consistent with the gutter winning over the cap.
  - Narrow (380x900): expects `maxHeight === "884px"` (viewport − 16px via the mobile override), `offsetHeight > 720`, `≈ 884`, and internal scroll. Consistent with the `max-width: 390px` override dropping the 720px cap.
  - Each spec opens its own page, drives that page's viewport, and closes it in a `finally`, so the shared persistent context is left on the launch-default 1440x1200 viewport for other specs.
- Found no concrete defect in the source or test edits, so per the task instructions I made no changes to `chrome-extension/styles.css` or `test/e2e/specs/builtin.smoke.spec.js`.

## Files Changed
- None changed in this attempt.
- `docs/implementation-logs/panel-height-cap/2026-06-02-claude-code-panel-height-cap.md` (this log, newly created).

## Files Inspected
- `chrome-extension/styles.css` (panel `.aaw-root` height cap and the `max-width: 390px` override; grep sweep of all `max-height` declarations).
- `test/e2e/specs/builtin.smoke.spec.js` (the three injected-panel height-cap specs and the `readPanelMetrics` helper).
- `package.json` (to confirm what `npm test` runs).

## Verification Commands Run
- `node --check test/e2e/specs/builtin.smoke.spec.js`
- `npm test` (runs `node --test test/*.test.js test/e2e/helpers/*.test.js` — the unit suite, not Playwright)

## Successful Checks
- `node --check` on the smoke spec passed (printed `NODE_CHECK_OK`); the file parses cleanly.
- `npm test` passed: 137 tests, 0 failures.
- CSS review: the only two `.aaw-root`-scoped `max-height` rules are the base cap and the mobile override; no conflicting rule overrides them.

## Failed Checks
- None.

## Suspected Causes for Failures
- None.

## Known Risks
- This change is CSS-driven and has no unit-test coverage; the behavioral assertions live only in the three new Playwright specs, which were intentionally deferred to the parent/verifier in this attempt (see below). Final confidence on the resolved layout (`getComputedStyle().maxHeight` serialization of `min(...)`/`calc(100dvh - ...)`, and the exact px expectations) depends on that targeted Playwright run.
- `100dvh` (dynamic viewport height) is well-supported in current Chromium but is a relatively modern unit; the cap degrades gracefully (the `min()`/`calc()` simply resolves against the viewport) but was not exercised against older engines.

## Follow-up-only Stale Code Observations (NOT changed in this attempt)
Per the task, these are reported for follow-up only and were intentionally left untouched:
- `_viewSettings`, `setSettingsOpen`, `_animatePanelHeight`, and the in-panel settings back-button path appear stale/unreachable because the settings entry point now opens the full options page in a new tab instead of an in-panel settings view.
- `backendUrlInput`, `settingsStatus`, and `persistBackendUrl` (the inline in-panel backend settings pieces) appear orphaned now that backend configuration lives on the full options page.
- The full-tab Backend options were deliberately left unchanged because they control remote backend support and are still live.

## Playwright Deferral
- Playwright was intentionally NOT run in this attempt, per the task instructions. The parent/verifier will run the targeted injected-panel height-cap specs separately.

## Final Status
- Reviewed and locally verified (node --check + unit suite green). Source/test edits from attempt 1 satisfy the plan and were left unchanged. Targeted Playwright verification is deferred to the parent/verifier.
