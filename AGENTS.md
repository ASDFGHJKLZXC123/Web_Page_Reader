# Repository Guidelines

## Project Structure & Module Organization

This project is a Chrome extension plus local Node.js backend for an AI assistant that works across websites. Backend API code lives in `backend/src/`, with shared backend utilities in `backend/src/lib/`. The Manifest V3 extension lives in `chrome-extension/`, including the service worker, content script, options page, styles, icons, and browser-side helpers. Tests live under `test/`; unit and route-level tests are in `test/*.test.js`, Playwright helpers and fixtures are in `test/e2e/`, and browser smoke specs are in `test/e2e/specs/`. Project documentation and planning notes live in the root markdown files.

## Build, Test, and Development Commands

- `npm start`: start the local backend, normally at `http://127.0.0.1:8787`.
- `npm test`: run Node unit and helper tests.
- `npm run test:unit`: same unit/helper test suite as `npm test`.
- `npm run test:e2e`: run Playwright browser extension tests.
- `npm run test:all`: run unit tests and Playwright e2e tests.
- `npm run playwright:install`: install the Chromium browser used by Playwright.

Install Node.js 18+ before running the project. Load `chrome-extension/` as an unpacked extension in Chrome for manual testing.

## Coding Style & Naming Conventions

Use plain JavaScript in the backend and extension unless an existing subproject already uses TypeScript. Keep backend logic modular under `backend/src/lib/` and browser-only behavior in `chrome-extension/`. Name helper files by feature, such as `privacy-utils.js`, `shortcut-utils.js`, or `selection-replacement.js`. Tests should use Node's built-in test runner style and be named `*.test.js`; Playwright specs should be named `*.spec.js`.

## Testing Guidelines

Add focused unit tests near the behavior being changed, especially for backend utilities, storage, route behavior, extension helpers, privacy handling, shortcuts, and rewrite flows. Use Playwright tests for browser-extension workflows that require content scripts, the service worker, Chrome storage, fixture pages, or the local backend. Run `npm test` for narrow backend/helper changes and `npm run test:e2e` when extension integration or UI behavior changes.

## Agent Implementation Workflow

For code implementation tasks, call Claude Code for the implementation pass instead of editing code directly. If Claude Code fails or returns incomplete work, retry with clarified instructions up to five total implementation attempts. After each Claude Code implementation attempt that changes code, call a fresh verification sub-agent to inspect the result, run relevant checks, and report defects. Verification sub-agents should not implement feature work unless explicitly reassigned after their review.

## Planning Review Workflow

When making a build or implementation plan, call Claude Code to verify or review the planning work before execution. Ask it to identify missed requirements, better solutions, major risks, unnecessary complexity, and alternative approaches. Incorporate the feedback into the plan or explicitly note why it was not adopted.

## Required Logs

Implementation logs:

```text
docs/implementation-logs/<milestone>/YYYY-MM-DD-claude-code-<task>.md
```

Independent verification logs:

```text
docs/implementation-logs/<milestone>/YYYY-MM-DD-verifier-<task>.md
```

Each log must state:

- what was done or reviewed,
- files changed or inspected,
- verification commands run,
- successful checks,
- failed checks,
- suspected causes for failures,
- known risks,
- final status.

## Scope & Decision Discipline

Keep implementations as small as the problem allows: if a coding task can be done in 200 lines, do not turn it into 300 lines. Do not edit code outside the requested scope, even if you notice a bug; report the bug first and wait for approval before modifying it. When confusion comes up, do not make assumptions; ask for clarification before proceeding.

## Security & Configuration Tips

Copy `.env.example` to `.env` for local backend configuration. `GEMINI_API_KEY` enables model-backed analysis and embeddings; without it, the app uses deterministic local fallbacks. `NOTES_DIR` can redirect backend JSON storage to an absolute folder. Never commit `.env`, local data, browser profile data, or generated test artifacts.
