# Implementation Log — Preferences empty status boxes

- Date: 2026-05-31
- Implementer: Claude Code
- Milestone: preferences-status-empty
- Task: Hide empty `.opt-status` live regions so no empty bordered box is drawn

## What was done

The options/preferences page rendered small empty bordered boxes under several
sections. These were `.opt-status` live regions (`#ai-status`, `#backend-status`,
`#privacy-status`, `#status`, `#shortcut-status`) that have no text until an action
populates them, but were always styled with padding/border/background.

Fix (CSS-only, minimal):

- Added `.opt-status:empty { display: none; }` in `chrome-extension/options.css`.
  Empty status regions are no longer painted, but stay in the DOM so their
  `role="status"` / `aria-live="polite"` regions are preserved for accessibility.
- No JS change was required. All status setters write `textContent` directly
  (`setStatus` and `setStatusEl` in `options.js` use `el.textContent = text || ""`;
  shortcut status uses `el.textContent = message || ""`). Setting `""` makes the
  element `:empty` again, so a status cleared to empty re-hides automatically.
- Default-populated statuses keep their styling because they contain text and are
  therefore not `:empty` (dedupe-status, backup-status, and any populated
  success/error status).

## Files changed

- `chrome-extension/options.css` — added `.opt-status:empty { display: none; }` rule.
- `test/e2e/specs/builtin.smoke.spec.js` — added regression test
  "empty status live regions stay hidden while default-populated statuses show".

## Files inspected (not changed)

- `chrome-extension/options.html` — confirmed which status divs ship empty vs. with
  default text; confirmed sections render in a single scrolling page (not tab-hidden).
- `chrome-extension/options.js` — confirmed `setStatus`/`setStatusEl`/shortcut status
  all use `textContent` (no whitespace/innerHTML that would defeat `:empty`).
- `chrome-extension/settings-utils.js`, `chrome-extension/shortcut-utils.js` —
  syntax-checked; no status-styling logic requiring change.

## Verification commands run

- `node --check chrome-extension/options.js chrome-extension/settings-utils.js chrome-extension/shortcut-utils.js` → PASS ("SYNTAX OK")
- `npm test` → PASS (123 passed, 0 failed)
- `npx playwright test --grep "empty status live regions"` → PASS (1 passed)

## Successful checks

- JS syntax check passed for all three files.
- Full unit suite: 123/123 passed.
- New Playwright test asserts: the five initially-empty status regions are hidden but
  present in the DOM (count 1 each); dedupe-status and backup-status are visible; and
  clearing dedupe-status to `""` hides it again.

## Failed checks

- None.

## Suspected causes for failures

- N/A.

## Known risks

- `:empty` is defeated only if a status is later populated with whitespace-only text
  or child nodes; current setters write trimmed/real text or `""`, so this is not a
  concern today. If future code injects child elements into a status region while
  empty of visible text, it would still display — acceptable and out of scope.

## Final status

Complete. CSS-only fix plus one targeted regression test; all listed checks run and
passing.
