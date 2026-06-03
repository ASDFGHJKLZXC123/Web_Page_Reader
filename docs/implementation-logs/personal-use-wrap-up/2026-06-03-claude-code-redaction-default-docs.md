# Implementation Log — Redaction Off-by-Default Documentation

- Date: 2026-06-03
- Implementer: Claude Code
- Milestone: personal-use-wrap-up
- Type: documentation only (no application code changed)

## What was done

Tiny docs-only follow-up to the personal-use wrap-up, addressing the prior verifier's
informational note (`2026-06-03-verifier-personal-use-docs.md`): make the
redaction-off-by-default behavior explicit — including the consequence that the default
`auto` AI mode sends page content unredacted unless the user enables redaction or switches
to `ask`/`local_only`/a per-site rule.

1. **`README.md` — "Privacy and secrets" section.** Replaced the existing
   "Optional redaction strips…" bullet with an explicit one: redaction is off by default
   (`redaction.enabled = false`); when enabled it strips emails/phones/token-like secrets
   and reduces URLs to host unless full-URL send is opted into; and, because the default AI
   mode is `auto`, page content (including any emails/phones/token-like secrets on the page)
   is sent to the provider **unredacted** until the user turns redaction on or switches the
   request/host to `ask`, `local_only`, or a per-site rule. Wording/host of the bullet was
   kept; no other README content was touched.

2. **`docs/personal-use-readiness.md` — "Privacy mode expectations" section.** Left the
   existing `local_only`/`ask`/`auto`/Site-rules bullets intact and added one new bullet,
   "**Redaction is off by default.**", stating `defaultPrivacySettings()` ships
   `redaction.enabled = false`, that combined with the default `auto` mode page content is
   sent unredacted unless redaction is enabled or the request/host is switched to
   `ask`/`local_only` (globally or via a per-site rule), and cross-referencing backlog P2.

3. **`docs/personal-use-backlog.md` — reviewed, not changed.** The P2 "Redaction disabled
   by default" entry already states the consequence accurately and says it was documented
   "in README/readiness". My README/readiness edits make that statement genuinely accurate,
   so no adjustment was needed for it to remain correct.

4. **This implementation log — added.**

## Files changed

- `README.md` — one bullet in "Privacy and secrets" rewritten to state the off-by-default
  default and its `auto`-mode consequence.
- `docs/personal-use-readiness.md` — one new bullet added under "Privacy mode expectations".
- `docs/implementation-logs/personal-use-wrap-up/2026-06-03-claude-code-redaction-default-docs.md`
  — this log.

No application code (extension or backend) was changed.

## Files inspected (not changed)

- `chrome-extension/privacy-utils.js` — confirmed `defaultPrivacySettings()` returns
  `aiMode: "auto"` and `redaction.enabled: false` (with `applyToModelPayload: true` and the
  individual `redact*` toggles defaulting `true`, all gated behind the master `enabled`
  flag); `prepareOutboundContent` redacts only when `s.redaction.enabled &&
  s.redaction.applyToModelPayload`. `AI_MODES = {auto, ask, local_only}`. These confirm the
  documented default and consequence are accurate.
- `docs/personal-use-backlog.md` — P2 "Redaction disabled by default" entry (reviewed for
  continued accuracy; unchanged).
- `docs/implementation-logs/personal-use-wrap-up/2026-06-03-claude-code-personal-use-docs.md`
  and `…-verifier-personal-use-docs.md` — prior pass and the informational note this
  follow-up resolves.

## Verification commands run

- `git status --short` (before/after) — confirmed only `README.md` (already dirty) and
  untracked `docs/` files are affected; `react 2/` and all other unrelated dirty work are
  preserved untouched.
- `git diff -- README.md` — confirmed the only change I introduced is the single redaction
  bullet (the remainder of the README diff is pre-existing dirty-worktree content).
- Source cross-check of the documented facts via reading `chrome-extension/privacy-utils.js`
  (`defaultPrivacySettings`, `AI_MODES`, `prepareOutboundContent` redaction gate).

## Successful checks

- Documented defaults match source: `aiMode = "auto"`, `redaction.enabled = false`,
  redaction applied only when `enabled && applyToModelPayload`.
- README and readiness now state the off-by-default consequence explicitly, resolving the
  prior verifier's informational note; backlog P2's "(done in README/readiness)" is now
  genuinely accurate.
- Edits are minimal and match surrounding doc voice/structure; no unrelated lines touched.

## Failed checks

- None.

## Suspected causes for failures

- N/A — no failures.

## Known risks

- Per CLAUDE.md and the docs-only nature of this pass, `npm test` / `npm run test:e2e` were
  **not** run; they are deferred to the orchestrator's independent verification / final
  gate. No executable code changed, so test outcomes are unaffected.
- The broad dirty worktree (including unrelated top-level `react 2/`) was preserved
  untouched; commit hygiene to exclude it remains tracked as backlog P3.

## Final status

Complete (docs-only). README "Privacy and secrets" and
`docs/personal-use-readiness.md` "Privacy mode expectations" now state redaction-off-by-default
and its `auto`-mode consequence explicitly; `docs/personal-use-backlog.md` reviewed and left
accurate; this log written. No application code changed, no commit made. Automated tests
deferred to the orchestrator final gate.
