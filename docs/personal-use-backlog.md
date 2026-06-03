# Personal-Use Backlog

Deferred items for the personal loaded-unpacked build, with severity and rationale.
Severity: **P0** blocks personal use · **P1** high · **P2** medium · **P3** low.
None of these block day-to-day personal use; they are tracked follow-ups.

Date: 2026-06-03.

## P1 — Real-site manual QA pending

The automated suites (unit 137, e2e 33) run against deterministic local fixtures only.
The README manual QA checklist has **not** been executed against live external pages
(news/articles, LinkedIn-style profiles, contact pages, doc surfaces, dense pages).

Rationale: deterministic fixtures cannot reproduce real DOM variety, editor quirks
(Rewrite in-place vs copy fallback), lead mis-pairing on dense pages, or provider
latency/errors. Run the README checklist in both built-in and backend modes before
relying on it for important work.

## P2 — Storage scale / stress beyond representative e2e

`unlimitedStorage` is granted and retention can cap growth, but only representative data
volumes are exercised by the e2e harness. Large memory/embedding/contact/task counts and
large backup import/export are not stress-tested.

Rationale: behavior at scale (search ranking, backup size, clear-data/retention timing,
`chrome.storage.local` performance) is unverified. Add a high-volume scenario if personal
usage accumulates thousands of records.

## P2 — Service-worker idle/restart manual confirmation

MV3 terminates idle service workers. The re-injection fallback and event-driven design
are implemented and unit/e2e tested, but the idle→restart→wake path has not been manually
confirmed on a long-lived session.

Rationale: real-world idling differs from test timing. Follow the manual check in
`docs/personal-use-readiness.md` (force idle, then wake via the action/command) to confirm
no state loss or "context invalidated" failures.

## P2 — Redaction disabled by default

`defaultPrivacySettings()` in `chrome-extension/privacy-utils.js` ships with
`redaction.enabled = false`. With the default `auto` AI mode, page content (including any
emails/phones/token-like secrets on the page) is sent to the provider **unredacted**
unless the user turns redaction on or uses `ask`/`local_only`.

Rationale: discovered by inspection. The safe-by-default expectation some users assume is
not the shipped default. Either document prominently (done in README/readiness) or
consider flipping the default; deferred pending product decision.

## P3 — Web Store hardening out of scope

This build targets personal loaded-unpacked use. Public distribution would require CSP
tightening, narrowing `<all_urls>` / `http(s)://*/*` host permissions, adding any needed
`web_accessible_resources`/CSP entries, and a store listing/review pass.

Rationale: intentionally deferred; not needed for personal use. Tracked so it is not
mistaken for an oversight.

## P3 — Provider / model freshness periodic review

Provider/model dropdowns and defaults (Gemini 2.5/3.x, OpenAI GPT-5.x, Claude Opus 4.7 /
Sonnet 4.6 / Haiku 4.5) were refreshed in May 2026 but will drift as vendors release and
retire models.

Rationale: stale model IDs cause API errors. Re-check provider model lists and defaults
periodically (suggest quarterly) and update `chrome-extension` dropdowns + `.env.example`.

## P3 — Built-in export `includeSensitive` reachable outside the UI

`handleBackupExport` in `background.js` honors `includeSensitive=true` (which embeds API
keys). The options/panel backup UI hardcodes it to `false`, so normal use never exports
keys, but a direct message send (or future code path) could.

Rationale: discovered by inspection. Low risk for a single personal user, but worth a
guard or comment so a future caller does not accidentally export secrets.

## P3 — Lead extraction mis-pairing on dense pages

Documented in README limitations: deterministic (no-key) lead extraction can mis-pair
names/emails/phones on dense pages.

Rationale: accuracy limitation, not a defect; review extracted drafts before saving.

## P3 — Commit hygiene: keep `react 2/` and unrelated changes out of project commits

The working tree carries large unrelated/uncommitted changes, including the unrelated
top-level `react 2/` directory (17k+ insertions seen by the prior verifier).

Rationale: discovered by inspection. Before committing project work, scope commits to the
extension/backend/docs and explicitly exclude `react 2/` and other unrelated changes so
they are never shipped as part of this project.
