# Building Plan: Light Theme Front-End Polish

Date: 2026-06-01

## Goal

Fix light-theme frontend mismatches in the Chrome extension options page and injected panel without changing storage, theme-switching JavaScript, backup/settings behavior, or layout structure.

## Planning Review

Claude Code reviewed the plan read-only and returned a conditional go. The required refinements are included below:

- Keep this as a CSS-token polish pass.
- Preserve the existing `data-aaw-theme` theme switching behavior.
- Add computed-style tests that catch dark-on-dark regressions.
- Open the command palette before reading palette styles in tests because the palette is not in the DOM until opened.
- Use a value-driven sweep for translucent white borders so visible light-theme borders are not missed.
- Keep out-of-scope issues as report-only unless the user approves expanding scope.

## Scope

Primary files:

- `chrome-extension/options.css`
- `chrome-extension/styles.css`
- `test/e2e/specs/builtin.smoke.spec.js`

Non-goals:

- Do not change `appearanceSettings` storage.
- Do not change theme listener JavaScript unless a test proves a behavior bug.
- Do not change backup, shortcuts, or unrelated settings-page behavior.
- Do not revert unrelated dirty work.

## CSS Token Strategy

Add a small shared token set in both CSS roots:

- `--aaw-elevated-bg`
- `--aaw-subtle-fill`
- `--aaw-hairline`
- `--aaw-elevated-shadow`
- `--aaw-highlight-bg`
- `--aaw-highlight-text`

Use existing tokens such as `--aaw-bg`, `--aaw-bg-soft`, `--aaw-surface`, `--aaw-text`, `--aaw-text-muted`, `--aaw-border`, and `--aaw-danger` when they already express the right theme-aware surface.

Avoid a large token expansion unless a selector truly needs distinct semantics.

## Options Page Fixes

In `chrome-extension/options.css`:

- Update `.opt-section` so light mode uses a readable section background, visible border, and softer shadow.
- Update `.opt-folder-row` so the border remains visible in light mode.
- Update `.opt-subsection` to use `--aaw-hairline` for separators.
- Update `.opt-log` to remove hardcoded dark `#141820`.
- Update `.opt-dedupe-list` and `.opt-dedupe-audit` to remove hardcoded dark `#141820`.
- Update `.opt-btn-ghost` to replace translucent white fill with a theme-safe subtle fill.
- Update `.opt-dropdown__list` to use a theme-safe elevated shadow.
- Preserve `.opt-status` theme-aware behavior and `:empty` hiding.

Known `options.css` translucent-white border/separator occurrences to account for:

- Line area around `240`
- Line area around `287`
- Line area around `399`
- Line area around `438`
- Line area around `756`

## Injected Panel Fixes

In `chrome-extension/styles.css`:

- Update `.aaw-section` to use visible border and theme-safe shadow.
- Update `.aaw-result` to remove hardcoded dark `#141820`.
- Update `.aaw-command-palette` to remove hardcoded dark `#171a20`.
- Update `.aaw-highlight` to use theme-aware highlight tokens.
- Update `.aaw-btn.ghost`, `.aaw-result-chip`, `.aaw-shortcut-row kbd`, `.aaw-page-preview`, `.aaw-command-strip`, and `.aaw-command-btn:hover` to replace translucent white fills.
- Update visible card and row borders, including `.aaw-page-preview`, `.aaw-memory-result`, `.aaw-memory-result--search:hover`, `.aaw-lead-card`, `.aaw-task-card`, `.aaw-workspace-row`, `.aaw-privacy-event`, `.aaw-dedupe-record`, and `.aaw-search-clear`.
- Update heavy dark-only shadows for `.aaw-workspace-menu`, `.aaw-dropdown__list`, `.aaw-command-palette`, and `.aaw-context-drawer`.
- Update `.aaw-btn.danger` to use the existing danger token instead of hardcoded pale pink.

Known `styles.css` translucent-white border/separator occurrences to account for:

- Line area around `171`
- Line area around `442`
- Line area around `626`
- Line area around `753`
- Line area around `770`
- Line area around `869`
- Line area around `922`
- Line area around `1089`
- Line area around `1221`
- Line area around `1380`
- Line area around `1445`
- Line area around `2033`

## Test Plan

Add focused Playwright coverage in `test/e2e/specs/builtin.smoke.spec.js` or a new targeted spec if cleaner.

### Options Light Theme

- Open options with `appearanceSettings: { mode: "light" }`.
- Assert `.opt-log`, `.opt-dedupe-list`, `.opt-section`, and `.opt-folder-row` are no longer dark surfaces.
- Assert borders are visible, non-transparent, and distinguishable from the surrounding background.
- Assert at least one newly-tokenized options element repaints on Dark to Light without reload.

### Panel Light Theme

- Set `appearanceSettings: { mode: "light" }` before opening the panel.
- Open the panel and assert `.aaw-result` has readable text/background contrast.
- Open the command palette before checking palette styles. Use the existing message handler for `{ type: "AAW_OPEN_COMMAND_PALETTE" }` or a reliable keyboard shortcut.
- Assert `.aaw-command-palette` and `.aaw-command-palette__label` have readable contrast.
- Drive a search/highlight state and assert `.aaw-highlight` has readable contrast.
- Reset `appearanceSettings` after the test so the shared extension harness does not leak theme state into later tests.

### Dark Regression Guard

- Verify `.opt-log`, `.aaw-result`, and `.aaw-command-palette` still read as dark-theme surfaces in dark mode.
- Prefer luminance or contrast checks over exact hex checks to avoid brittle assertions.

### Computed Style Helpers

Add small helper functions for:

- Parsing computed `rgb(...)` / `rgba(...)` colors.
- Calculating relative luminance.
- Calculating WCAG contrast ratio.
- Checking border visibility by alpha and color distance from nearby backgrounds.

Suggested thresholds:

- Body text contrast: at least `4.5`.
- Large text or non-body labels: at least `3`.
- Border alpha: greater than `0`.
- Border color must differ meaningfully from both element and page backgrounds.

## Verification Commands

Run:

```bash
node --check test/e2e/specs/builtin.smoke.spec.js
npm test
AAW_E2E_HEADLESS=1 npx playwright test builtin.smoke.spec.js -g "light theme|appearance|status|feedback|custom dropdown|collapsed settings controls"
```

If targeted checks pass, run:

```bash
AAW_E2E_HEADLESS=1 npm run test:e2e
```

Note: the e2e harness launches headed by default unless `AAW_E2E_HEADLESS=1` is set.

## Required Logs

Implementation log:

```text
docs/implementation-logs/preferences-light-theme-polish/YYYY-MM-DD-claude-code-light-theme-polish.md
```

Verification log:

```text
docs/implementation-logs/preferences-light-theme-polish/YYYY-MM-DD-verifier-light-theme-polish.md
```

Each log must include:

- What was done or reviewed.
- Files changed or inspected.
- Verification commands run.
- Successful checks.
- Failed checks.
- Suspected causes for failures.
- Known risks.
- Final status.

## Out-of-Scope Findings To Report Only

- `.aaw-context-edge` / `.aaw-context-warning` use `var(--aaw-muted)`, but the real token appears to be `--aaw-text-muted`.
- `.aaw-logo-mark` glyph contrast should be verified in light mode before deciding whether it belongs in this task.

Do not fix these unless the user approves expanding scope.

## Acceptance Criteria

- Light theme no longer shows dark result, log, dedupe, or command-palette surfaces.
- Result text, command palette text, highlights, danger buttons, ghost controls, chips, keyboard tags, dropdowns, card borders, and separators are readable in light theme.
- Dark theme remains visually close to the current appearance.
- Theme changes still apply live without restart or reload.
- No storage/settings/backup/shortcut scope creep.
- Unit tests and targeted browser tests pass.
