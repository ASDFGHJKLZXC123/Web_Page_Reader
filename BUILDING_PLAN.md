# AI Assistant Across Websites - Building Plan

## Purpose

This plan upgrades the Chrome extension frontend and its supporting service-worker/backend paths so the current product fully covers the eight target use cases:

1. Research assistant summarization
2. Rewrite selected text
3. Extract structured information
4. Save page memory
5. Workspace-based note organization
6. Search past saved memory
7. Lightweight CRM / lead capture
8. Task creation from webpages

The work should be implemented as an end-to-end extension upgrade, not a visual-only frontend pass. Several workflows share storage, memory search, service-worker routing, and optional backend API behavior, so each milestone must preserve parity between built-in extension mode and remote backend mode.

## Current State Summary

- The in-page panel is implemented in `chrome-extension/content.js`.
- Built-in mode behavior is implemented in `chrome-extension/background.js` using `chrome.storage.local`.
- Optional remote backend behavior is implemented under `backend/src`.
- The current extension already has summarize, rewrite, extract, memory save, workspaces, search, and action plumbing.
- Gaps remain around direct rewrite insertion, structured extract links, contact/task management UI, task-memory linkage, richer memory/source metadata, search result usability, and schema naming conflicts.
- Existing memory workspace membership is stored as `taskIds`, which must be migrated conceptually to `workspaceIds` before real task linkage is added.

## Guiding Principles

- Keep the Chrome extension panel as the primary user experience.
- Preserve existing saved data and make legacy records readable.
- Maintain behavior parity between service-worker built-in mode and optional backend mode.
- Do not persist full page text by default; store excerpts, summaries, structured fields, and search documents.
- Use safe rendering only: prefer DOM APIs and `textContent`; do not render extracted page content with `innerHTML`.
- Do not silently switch from remote backend mode to built-in mode after backend failures.
- Treat unsupported browser surfaces clearly: use fallback copy flows rather than claiming full support.
- Add automated tests before large behavior changes where practical.

## Milestone 1: Shared Foundations

### Goal

Create the common infrastructure needed by later milestones without changing the user-facing workflows more than necessary.

### Key Changes

- Add a test harness using `node:test`.
- Add a small set of pure helper modules for logic that is currently embedded in content-script or service-worker code:
  - readable page text extraction
  - page/source context capture
  - source URL/source key normalization
  - memory/search document construction
  - workspace membership normalization
  - task/contact normalization
  - safe URL validation
- Add service-worker write serialization for mutating storage flows so concurrent memory, workspace, contact, and task writes do not clobber each other.
- Add backend testability improvements, including a guarded server entrypoint and temporary `NOTES_DIR` support in tests.
- Add compatibility normalizers for existing memory, workspace, task, and contact records.

### Interfaces

- Keep existing routes and messages intact.
- Introduce internal canonical fields while still accepting legacy fields:
  - `workspaceIds` is canonical note workspace membership.
  - `taskIds` remains accepted as legacy workspace membership.
  - `linkedTaskIds` is reserved for real task linkage from memory items.

### Acceptance Criteria

- Existing extension behavior still loads.
- Existing memory/workspace/action records remain readable.
- Mutating built-in storage handlers are serialized.
- Backend tests can run against temporary data directories.

### Tests

- Unit tests for source URL normalization.
- Unit tests for legacy memory/action/workspace normalization.
- Service-worker storage tests with mocked `chrome.storage.local`.
- Backend smoke tests with temporary `NOTES_DIR`.

## Milestone 2: Memory and Workspace Model

### Goal

Make saved notes reliably tied to source pages and organized into workspaces without relying on the confusing `taskIds` name.

### Key Changes

- Reframe the Memory UI as "Page Memory".
- Add a page preview: title, host, selected/full-page source indicator.
- Add "Saved on this page" with existing notes for the current source key.
- Add edit/delete controls for saved page notes.
- Add canonical memory fields:
  - `schemaVersion`
  - `createdAt`
  - `updatedAt`
  - `sourceUrl`
  - `canonicalUrl`
  - `urlKey`
  - `sourceHost`
  - `sourceOrigin`
  - `sourcePath`
  - `sourceHash`
  - `faviconUrl`
  - `note`
  - `snippet`
  - `pageExcerpt`
  - `contentHash`
  - `summary`
  - `tags`
  - `workspaceIds`
  - `linkedTaskIds`
  - `sourceType`
  - `searchDocumentVersion`
- Do not persist full page text by default.
- Build the memory search document from title, note, snippet, excerpt, source host/url, tags, and workspace labels.
- Seed default workspaces idempotently:
  - `Job Search`
  - `Startup Ideas`
  - `Research`
  - `Client Leads`
- Avoid duplicate default workspaces by stable default id and case-insensitive name match.
- Add unassigned-notes route/message instead of client-filtering only the first page of memory.
- Preserve selected workspaces after save for batch capture.
- Rename UI label from "Note workspace" to "Workspaces".

### Interfaces

- `POST /api/memory/save` accepts `workspaceIds` and legacy `taskIds`.
- `PATCH /api/memory/:id` updates note, tags, and membership.
- `GET /api/note-workspaces?status=open|archived|all` returns counts and stable ordering.
- `GET /api/note-workspaces/:id/notes` uses normalized membership.
- Add a built-in message/API path for unassigned notes with pagination.
- Folder mirror should write the new JSON shape and handle update/delete broadcasts.

### Acceptance Criteria

- Existing `taskIds`-only notes display under the correct workspace memberships.
- New notes save with `workspaceIds`.
- Default workspaces appear once and only once.
- Archived workspaces keep note membership.
- Unassigned notes are listed accurately across more than one page.
- Folder mirror updates changed membership fields.

### Tests

- Workspace seeding idempotency.
- Legacy `taskIds` normalization.
- Unknown workspace ID validation.
- Duplicate membership de-duping.
- Open, archived, and unassigned counts.
- Save to multiple workspaces.
- Edit membership after save.
- Archive/reopen without deleting note links.
- Options-page mirror update after membership changes.

## Milestone 3: Search Saved Memory

### Goal

Make saved memory searchable by keyword or concept, even when the user does not remember the exact page title.

### Key Changes

- Rename UI section to "Search saved memory".
- Add states for idle, searching, no saved memory, no matches, degraded fallback, and error.
- Debounce input and prevent stale response rendering with request sequence tracking or `AbortController`.
- Preserve current results while a new query is in flight.
- Show result cards with:
  - clickable safe source title
  - hostname
  - saved date
  - workspace chips
  - summary/snippet/note preview
  - human match label: keyword, semantic, or mixed
- Hide raw scores by default.
- Highlight keyword matches using DOM text/span nodes, not `innerHTML`.
- Add keyboard behavior:
  - Enter runs search immediately.
  - Escape clears query/results.
  - Focus remains in the input.
- Add embedding metadata for new vectors:
  - provider
  - model
  - dimensions
  - version
  - createdAt
- Compare vectors only when query and document embeddings are from the same vector space.
- Fall back to keyword-only ranking when embeddings are unavailable, incompatible, or failed.
- Existing saved memory without embeddings must remain keyword-searchable.

### Interfaces

- `GET /api/memory/search?q=&limit=&offset=`
- Response shape:
  - `items`
  - `total`
  - `limit`
  - `offset`
  - `query`
  - `rankingMode`
  - `embeddingProvider`
  - `fallbackReason`
- Item score metadata:
  - `score`
  - `keywordScore`
  - `vectorScore`
  - `vectorAvailable`
  - `matchedFields`
  - `matchedTerms`
  - `workspaceLabels`

### Acceptance Criteria

- Search finds notes by note body, snippet, summary, tags, workspace name, hostname, and source URL.
- Search works without any embedding API key.
- Search does not fail when embedding calls fail.
- Source links only open safe `http:` and `https:` URLs.
- Built-in and backend modes return compatible ranked results for golden fixtures.

### Tests

- Tokenization and Unicode/accent handling.
- Keyword scoring field weights.
- Vector-space metadata compatibility.
- Embedding failure fallback.
- Legacy embedding handling.
- Stale response protection.
- Source-link validation.
- Built-in/backend golden ranking fixture.
- Large memory set performance smoke test.

## Milestone 4: Analyze Improvements: Summarize and Extract

### Goal

Make research summarization and structured extraction reliable, structured, and useful as inputs to memory, contacts, and tasks.

### Summarize Changes

- Remove blocking LLM API-key preflight from the main summarize flow.
- Keep health checks inside Settings only.
- Add readable page content extraction:
  - prefer `article`, `main`, `[role="main"]`, `.article`, `.post`, `.entry-content`, `.markdown-body`, `.doc-content`
  - clean cloned content by removing script/style/nav/header/footer/aside/form/button
  - preserve headings and list structure where possible
  - compute original and submitted character counts
- Ignore selections inside the extension panel.
- Do not call the model for selected text under about 80 characters or full-page text under about 200 characters.
- Return structured summary output:
  - `tldr`
  - `keyPoints`
  - `importantDetails`
  - `openQuestions`
  - `source`
- Add deterministic structured local fallback and mark `engine: "local"`.

### Extract Changes

- Define `ExtractedPageInfo v1`:
  - `schemaVersion`
  - `title`
  - `url`
  - `summary`
  - `keyPoints`
  - `dates`
  - `contacts`
  - `links`
  - `extractionMeta`
- Compute `schemaVersion` and `extractionMeta` locally, not from the LLM.
- Expand dates to objects with text, optional ISO date, context, and type.
- Expand contacts to emails, phones, people, and organizations.
- Add links with text, URL, type, and context.
- Collect extract metadata:
  - meta description
  - canonical URL
  - Open Graph dates
  - `time[datetime]`
  - limited JSON-LD
  - anchors
  - `mailto:`
  - `tel:`
- Revalidate link schemes at render/open time.
- Render extraction as structured sections instead of raw text dump.
- Store `lastExtractResult` so actions use normalized data, not scraped result text.

### Interfaces

- Continue using `/api/assist/analyze`.
- Add summarize-specific and extract-specific normalized response objects.
- Parameterize structured JSON schema generation so Gemini structured output is not extract-only.
- Allow optional `structuredExtraction` in memory save.

### Acceptance Criteria

- Summarize works without an API key through local fallback.
- Summaries display as structured research output.
- Extract includes links.
- Extract handles malformed model JSON by falling back deterministically.
- Unsafe links are not rendered as active links.
- Extract result can be copied as JSON/Markdown and saved to memory.

### Tests

- Readable selector priority.
- Boilerplate removal.
- Selected text vs full page.
- Low-text thresholds.
- Summary object rendering.
- Extract schema normalization.
- Legacy extraction shape coercion.
- Unsafe link rejection.
- Copy JSON and Markdown.
- No-key fallback.
- Built-in/backend extract parity fixture.

## Milestone 5: Rewrite Selected Text

### Goal

Allow users to select rough writing in common web editors and rewrite it clearly, shorter, or more professionally, with safe direct replacement where possible and copy fallback elsewhere.

### Key Changes

- Split rewrite into `runRewrite()` instead of using generic `analyze()`.
- Require selected text for rewrite; never silently rewrite the whole page.
- Add rewrite goal segmented control:
  - `Clearer`
  - `Shorter`
  - `Professional`
- Keep instruction textarea as extra guidance.
- Add rewrite status line:
  - no selection
  - selected N chars
  - not directly replaceable
  - selection changed
  - replaced
  - copy fallback
- Add a testable selection/replacement helper.
- Preserve a local non-serializable selection snapshot.
- Use serializable metadata for panel state:
  - selected text
  - character count
  - replaceability
  - target type
  - timestamp
  - version
- Support direct apply for:
  - textarea
  - safe text-like inputs
  - standard contenteditable roots
  - Gmail-style compose fields
  - LinkedIn-style editors
- Notion direct apply only for validated single-block contenteditable selections.
- Google Docs/canvas/unsupported editors use preview/copy fallback.
- Reject password, hidden, disabled, readonly, collapsed, cross-root, or stale selections.
- Auto-replace only when response source is `model`.
- Local fallback, stale selections, unsupported surfaces, or older backend responses go to preview/copy fallback.
- Add guarded Undo after successful replacement.

### Interfaces

- Reuse `/api/assist/analyze` with `mode: "rewrite"`.
- Send:
  - selected text as `content`
  - `rewriteGoal`
  - optional instruction
  - title/url
  - small before/after context
- Response includes:
  - replacement text
  - `source: "model" | "local-fallback"`
- Rewrite sanitizer must preserve whitespace and newlines.
- Prompt must require replacement text only, no labels, quotes, markdown, bullets, or explanation.

### Acceptance Criteria

- Rewrite requires a selection.
- Textarea/input replacement preserves native undo where possible.
- Contenteditable replacement works for simple editable blocks.
- Fallback copy path is clear for unsupported editors.
- Panel focus does not destroy the saved selection unexpectedly.
- Controlled React/Vue editors receive input events and do not silently revert in supported fixtures.

### Tests

- Textarea replacement.
- Input replacement.
- Readonly/disabled rejection.
- Contenteditable single-block and multiline.
- Gmail-like fixture.
- LinkedIn-like fixture.
- Notion-like single-block direct apply.
- Notion-like multi-block fallback.
- Google Docs/canvas fallback.
- Stale selection rejection.
- Whitespace and emoji/code point handling.
- Source gating: model auto-apply, fallback copy only.

## Milestone 6: Lead Capture

### Goal

Turn company pages, LinkedIn profiles, and contact pages into lightweight CRM records and optional memory notes.

### Key Changes

- Add a dedicated Lead Capture panel section.
- Use selected text first, otherwise page text.
- Collect DOM hints:
  - `mailto:`
  - `tel:`
  - canonical URL
  - meta/OG title
  - visible headings
  - JSON-LD `Person`, `Organization`, `LocalBusiness`
  - page hostname
  - LinkedIn profile URL when applicable
- `Capture Lead` calls a contact extraction API/message.
- Render editable draft cards.
- Support one-person pages and multi-contact pages.
- Add contact list/detail UI:
  - search
  - status filter
  - pagination
  - edit/save/delete
  - open source URL
  - linked memory IDs
  - unlink behavior
- Deleting a contact does not delete linked memory by default.
- Existing `/api/actions/run` `save_contact` remains backward-compatible but routes through the new normalizer.

### Contact Fields

- `id`
- `createdAt`
- `updatedAt`
- `sourceUrl`
- `sourceTitle`
- `sourceDomain`
- `pageKind`
- `name`
- `firstName`
- `lastName`
- `company`
- `roleTitle`
- `department`
- `email`
- `emails`
- `phone`
- `phones`
- `website`
- `linkedInUrl`
- `location`
- `address`
- `socialUrls`
- `leadStatus`
- `tags`
- `notes`
- `confidence`
- `fieldConfidence`
- `memoryIds`

Allowed `leadStatus` values:

- `new`
- `contacted`
- `qualified`
- `disqualified`
- `archived`

Keep raw extraction transient by default, or cap tightly if persisted.

### Interfaces

- `POST /api/contacts/extract`
- `POST /api/contacts`
- `GET /api/contacts?limit&offset&q&status`
- `GET /api/contacts/:id`
- `PATCH /api/contacts/:id`
- `DELETE /api/contacts/:id`
- Built-in messages:
  - `CONTACT_EXTRACT`
  - `CONTACT_CREATE`
  - `CONTACT_LIST`
  - `CONTACT_GET`
  - `CONTACT_UPDATE`
  - `CONTACT_DELETE`
- List response:
  - `contacts`
  - `total`
  - `limit`
  - `offset`
- `q` searches name, company, role, emails, phones, source domain, notes, and tags.

### Storage Behavior

- Persist contacts under existing `actions.contacts` for compatibility.
- Add helper behavior:
  - normalize legacy minimal contacts
  - list contacts
  - get contact
  - create contact
  - update contact
  - delete contact
  - merge contacts
- Dedupe by normalized email, LinkedIn URL, phone, then name plus company/domain.
- Run dedupe/merge inside the write queue.
- Merge rules:
  - arrays union and de-dupe
  - empty scalar fills from new value
  - conflicting scalar is preserved unless explicitly merged into an existing contact
  - `updatedAt` refreshes
  - `memoryIds` union
- Optional `saveMemory` creates a linked lead memory note with `kind: "lead"` and `contactId`.
- Notes folder mirror only mirrors linked memory notes, not standalone contact records.

### Acceptance Criteria

- Contact extraction works with no API key using deterministic fallback.
- Contact extraction handles multiple contacts.
- Users can edit extracted draft cards before saving.
- Saved contacts are visible in a contacts list.
- Contacts can be edited and deleted.
- Saving a lead memory note makes it searchable in memory search.
- Legacy `save_contact` action still works.

### Tests

- Contact normalization and legacy migration.
- Fallback extraction from mailto/tel/JSON-LD/headings.
- Email/phone/URL normalization.
- Contact dedupe and merge.
- Contact CRUD backend tests.
- Built-in service-worker contact messages.
- Multi-contact UI rendering.
- Linked lead memory appears in memory search.
- Mirror smoke for linked lead memory note.

## Milestone 7: Task Creation

### Goal

Let users save webpage context and create follow-up tasks linked back to that context.

### Key Changes

- Do not reuse `memory.taskIds`; it means workspace membership.
- Add `memory.linkedTaskIds`.
- Add task fields:
  - `id`
  - `createdAt`
  - `updatedAt`
  - `title`
  - `status`
  - `notes`
  - `dueDate`
  - `priority`
  - `sourceUrl`
  - `sourceTitle`
  - `sourceHost`
  - `sourceSnippet`
  - `sourceMemoryIds`
  - `completedAt`
  - `clientRequestId`
- Allowed task statuses:
  - `open`
  - `in_progress`
  - `done`
  - `archived`
- Allowed priorities:
  - `none`
  - `low`
  - `medium`
  - `high`
- Add `capturePageContext()` and store `lastSavedContext` after memory save succeeds.
- Create Task uses the saved snapshot, not live selection after click.
- If no saved context exists or fingerprint differs, save context first, then create task.
- Replace generic action dropdown path with clearer Context + Task flow.
- Add task controls:
  - title
  - due date
  - priority
  - notes
- Add Tasks section:
  - status tabs
  - task rows/cards
  - source host
  - due date
  - priority/status controls
  - Mark Done/Reopen
  - Open Source
  - View Context

### Interfaces

- Extend `POST /api/actions/run` for `type: "create_task"`.
- All new values must be inside `payload`.
- Return `{ type, result, linkedMemoryItems }`.
- Add:
  - `GET /api/actions/tasks?status=open|in_progress|done|archived|all&limit&offset`
  - `PATCH /api/actions/tasks/:id`
  - `GET /api/actions/tasks/:id/context`

### Persistence

- Backend helper `createTaskWithLinks()` validates memory IDs, creates the task, updates linked memory items, and avoids partial mutation if validation fails.
- Service worker performs linked creation inside the write queue.
- Use one `chrome.storage.local.set({ actions, memory })` after validation.
- Broadcast `MEMORY_UPDATED` for each linked memory item so folder mirror rewrites JSON with `linkedTaskIds`.
- Status update rules:
  - `done` sets `completedAt`
  - reopening clears `completedAt`

### Acceptance Criteria

- Creating a task from a webpage creates or reuses saved page memory.
- Task links back to source memory and source URL.
- Memory item links to task via `linkedTaskIds`.
- Task list can filter by status.
- Mark Done/Reopen works.
- Deleted memory does not break task display; context shows unavailable linked entries.
- Duplicate clicks do not create duplicate tasks when `clientRequestId` matches.

### Tests

- Save memory then create linked task.
- Invalid memory ID rollback.
- Duplicate `clientRequestId`.
- Task status transitions.
- Due date and priority updates.
- Task list filters.
- Deleted memory context.
- Built-in/backend parity.
- Service-worker concurrency between memory save and create task.

## Milestone 8: End-to-End QA and Polish

### Goal

Verify that all eight user-facing workflows are complete and coherent inside the extension panel.

### Key Changes

- Polish panel layout so sections remain scannable and do not overlap on narrow viewports.
- Ensure long text, URLs, contact names, and task titles wrap safely.
- Review labels for consistency:
  - Analyze
  - Page Memory
  - Workspaces
  - Search Saved Memory
  - Lead Capture
  - Tasks
  - Settings
- Confirm Settings still handles provider/backend configuration and notes folder mirror.
- Update README with supported use cases, limitations, setup, and manual QA checklist.

### Acceptance Criteria By Use Case

1. Research assistant:
   - User can click Summarize and get key points without leaving the page.
   - Works with model or local fallback.

2. Rewrite selected text:
   - User can highlight text and rewrite it.
   - Supported editors replace in place.
   - Unsupported editors provide copy fallback.

3. Extract structured info:
   - User can extract title, summary, key points, dates, contacts, and links.
   - Result is structured, copyable, and usable for memory/contact/task flows.

4. Save page memory:
   - User can save notes tied to the current webpage.
   - Saved notes show on the page and can be reopened/searched later.

5. Workspace organization:
   - User can route notes into named workspaces.
   - Default workspaces are available.
   - Notes can belong to multiple workspaces.

6. Search past memory:
   - User can search by keyword or concept.
   - Results show source links and workspace metadata.

7. Lightweight CRM:
   - User can capture leads from company/profile/contact pages.
   - Contacts can be saved, searched, edited, and linked to memory.

8. Task creation:
   - User can save context and create follow-up tasks linked to the page/memory.
   - Tasks can be viewed and updated.

### Tests

- Run full automated suite.
- Manual Chrome QA in built-in mode.
- Manual Chrome QA in remote backend mode.
- Manual QA with no API key.
- Manual QA with configured model key.
- Manual QA for notes folder mirror.
- Manual QA for SPA navigation.
- Manual QA for unsupported surfaces and fallbacks.

## Per-Milestone Build and Verification Workflow

Use this workflow when implementing each milestone.

1. Call Claude Code with a bounded implementation prompt for exactly one milestone.
2. Require Claude Code to list changed files and tests run.
3. Inspect the diff before accepting it.
4. Run automated tests plus milestone-specific checks.
5. Spawn a sub-agent to verify the completed milestone read-only.
6. Fix any verification findings before starting the next milestone.

## Sub-Agent Verification Standard

Each verification sub-agent should answer:

- Which milestone was reviewed?
- Which files changed?
- Which acceptance criteria pass?
- Which acceptance criteria are incomplete?
- Were built-in and backend paths both considered?
- Were legacy data paths considered?
- Were tests added or updated?
- What manual QA remains?

A milestone is not complete until verification has no blocking findings.

## Original Use Case Coverage Map

| Use case | Primary milestone | Supporting milestones |
| --- | --- | --- |
| Research assistant | Milestone 4 | Milestone 1, Milestone 8 |
| Rewrite selected text | Milestone 5 | Milestone 1, Milestone 8 |
| Extract structured info | Milestone 4 | Milestone 1, Milestone 6, Milestone 7 |
| Save page memory | Milestone 2 | Milestone 1, Milestone 3, Milestone 8 |
| Workspace notes | Milestone 2 | Milestone 1, Milestone 3 |
| Search memory | Milestone 3 | Milestone 1, Milestone 2 |
| CRM / lead capture | Milestone 6 | Milestone 1, Milestone 2, Milestone 3, Milestone 4 |
| Task creation | Milestone 7 | Milestone 1, Milestone 2, Milestone 4 |

## Known Risks

- `taskIds` currently means workspace membership; do not use it for real tasks.
- Service-worker storage writes can race unless serialized.
- Backend and built-in mode can drift unless fixtures test both paths.
- Full semantic search requires compatible embedding metadata; otherwise fall back to keyword ranking.
- Rewrite insertion is fragile across custom editors; use strict support detection and copy fallback.
- LinkedIn/contact pages may hide data behind auth or lazy loading; fallback must be honest.
- Notes folder mirror mirrors memory notes, not standalone contacts or tasks unless explicitly linked through memory.
- Chrome-restricted pages and canvas-only editors cannot be fully controlled by the extension.

## Definition of Done

The project reaches full coverage when:

- All eight use cases pass the end-to-end QA checklist.
- Built-in extension mode and remote backend mode behave consistently where applicable.
- Existing saved data still loads.
- New memory, workspace, contact, and task records normalize correctly.
- Search works with and without embedding APIs.
- Rewrite has safe direct replacement and clear fallback.
- Extract includes links and structured contacts/dates.
- Contacts and tasks are manageable from the panel.
- Folder mirror is not broken by new memory metadata.
- Automated tests and manual QA evidence are recorded.
