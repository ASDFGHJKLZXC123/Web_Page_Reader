# Verification Log — Redaction Off-by-Default Documentation

- Date: 2026-06-03
- Verifier: Independent verification subagent (fresh)
- Milestone: personal-use-wrap-up
- Type: documentation-only follow-up (no application code changed by the implementer)
- Scope: verify only; no feature work, no app-code edits.

## What was reviewed

Confirmed that the docs accurately state the shipped privacy defaults and their
consequence:

1. Default `aiMode` is `auto`.
2. `redaction.enabled` is `false` by default.
3. Redaction applies only when `redaction.enabled && redaction.applyToModelPayload`.
4. Therefore the default `auto` mode sends provider-bound page content **unredacted**
   unless the user enables redaction or switches the request/host to
   `ask` / `local_only` / a per-site rule.

Each documented statement was cross-checked against the source of truth
(`chrome-extension/privacy-utils.js`) and against a live runtime exercise of the module.

## Files inspected

- `README.md` — "Privacy and secrets" section (lines 128–133). Reviewed only; not edited.
- `docs/personal-use-readiness.md` — "Privacy mode expectations" section (lines 106–127),
  incl. the new "Redaction is off by default" bullet. Reviewed only.
- `docs/personal-use-backlog.md` — P2 "Redaction disabled by default" (lines 40–49).
  Reviewed only.
- `docs/implementation-logs/personal-use-wrap-up/2026-06-03-claude-code-redaction-default-docs.md`
  — the implementation log this pass produced.
- `chrome-extension/privacy-utils.js` — `defaultPrivacySettings()`, `AI_MODES`,
  `normalizePrivacySettings`, `evaluatePrivacy`, `prepareOutboundContent`,
  `sanitizeUrlForProvider`, `privacyPreflight`. Source of truth; not edited.

No application code (extension or backend) was modified during verification.

## Verification commands run

- `node --check chrome-extension/privacy-utils.js` → OK (source parses).
- Node runtime cross-check via `require("./chrome-extension/privacy-utils.js")`:
  - `defaultPrivacySettings().aiMode` → `auto`.
  - `defaultPrivacySettings().redaction.enabled` → `false`.
  - `defaultPrivacySettings().redaction.applyToModelPayload` → `true`.
  - `AI_MODES` → `auto,ask,local_only`.
  - `prepareOutboundContent` with default settings on content carrying an email + a
    `sk-…` secret → content returned **unchanged**, `redactionCounts =
    {emails:0,phones:0,secrets:0}` (confirms no redaction by default).
  - Same content with `redaction.enabled` flipped on → content redacted to
    `contact [redacted-email] [redacted-secret] here` (confirms redaction is gated on
    `enabled`).
  - `privacyPreflight` with default settings on host `x.com` → `effectiveAiMode = auto`,
    `allowProviderSend = true`, `blocked = false` (confirms default `auto` permits
    provider send).

## Successful checks

- **README** (line 131): "Redaction is off by default (`redaction.enabled = false`)" and
  "Because the default AI mode is `auto`, … page content … is sent to the provider
  **unredacted** until you turn redaction on, or switch the request/host to `ask`,
  `local_only`, or a per-site rule." — Matches source and runtime exactly.
- **Readiness** (lines 122–127): new "Redaction is off by default" bullet states
  `defaultPrivacySettings()` ships `redaction.enabled = false`, the `auto`-mode
  consequence, the `ask`/`local_only`/per-site escape hatches, and cross-references
  backlog P2. — Accurate.
- **Backlog P2** (lines 40–49): states `redaction.enabled = false` plus the `auto`-mode
  unredacted-send consequence and the `ask`/`local_only` escape; "(done in
  README/readiness)" is now substantiated by the README/readiness edits. — Accurate.
- **Gating claim**: source `prepareOutboundContent` (line 299) redacts content/pageMeta
  only under `s.redaction.enabled && s.redaction.applyToModelPayload`, exactly as
  documented; confirmed by the redaction on/off runtime difference.
- **Mode set**: `AI_MODES = {auto, ask, local_only}` matches docs; `auto` is the shipped
  default and is not blocked by `privacyPreflight`.

## Failed checks

- None. All four scoped claims are accurately documented and match source + runtime.

## Known risks

- **Minor pre-existing wording nuance (not in scope, conservative direction).** Both
  `README.md` line 131 and `docs/personal-use-readiness.md` line 121 group URL host-
  reduction under "When enabled" / "(when enabled)" — e.g. README: "When enabled, it
  strips emails … ; URLs are reduced to host … unless you opt in to sending the full
  URL." In source, `prepareOutboundContent` (lines 291–312) **always** runs
  `sanitizeUrlForProvider` (governed solely by `sendFullUrlToProvider`), independent of
  `redaction.enabled`; the runtime check showed `https://x.com/p?q=1#f` reduced to
  `https://x.com/p` even with redaction off. So URL host-reduction is not actually
  contingent on redaction being enabled. This errs on the safe side (the real behavior
  is more protective than the docs imply) and does **not** affect the four scoped claims
  about content redaction, which are all correct. Optional future docs tidy-up; not a
  blocker for this pass.
- Per CLAUDE.md and the docs-only nature of the change, `npm test` / `npm run test:e2e`
  were not run (no executable behavior changed). The targeted `node --check` + module
  runtime cross-check above is sufficient to verify the documented facts.
- Broad dirty worktree (incl. unrelated top-level `react 2/`) remains; out of scope here
  and tracked as backlog P3 (commit hygiene).

## Final status

**Pass.** The README "Privacy and secrets" bullet, the readiness "Privacy mode
expectations" / "Redaction is off by default" bullet, and backlog P2 accurately state
that the default `aiMode` is `auto`, `redaction.enabled` is `false` by default, redaction
applies only when `enabled && applyToModelPayload`, and that default `auto` therefore
sends provider-bound page content unredacted unless redaction is enabled or
`ask`/`local_only`/site rules are used — all confirmed against
`chrome-extension/privacy-utils.js` and a live runtime exercise. One minor, conservative,
pre-existing wording nuance about URL host-reduction is noted as a non-blocking risk. No
application code changed; no commit made.
