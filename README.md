# AI Assistant Across Websites

Minimal full-stack starter for a Chrome extension plus local backend that lets users invoke an assistant on any webpage.

## Update — May 2026

- **Notes folder mirror (built-in mode).** The extension now has an options page (`chrome://extensions` → Details → Extension options, or via the panel's Settings → "Notes folder → Configure"). Pick any folder on disk; saved notes are mirrored as one `mem_<id>.json` file per entry. The folder handle is persisted in IndexedDB so it survives browser restarts (you re-confirm permission once per Chrome session via "Grant access"). Each save broadcasts to the open options page for near-real-time mirroring; closing the page is fine — the missing entries are flushed on the next "Sync now" or page open. Optional checkbox to delete folder files that are no longer in memory (one-way sync).
- **Keyboard command layer.** The panel supports a command palette (`Ctrl/Cmd+K` in the panel, `Alt+Shift+K` from Chrome commands), section jumps (`g a`, `g m`, `g l`, `g t`, `g w`, `g s`), quick analyze keys (`1`, `2`, `3`), save (`Ctrl/Cmd+S`), search focus (`/`), primary section action (`Ctrl/Cmd+Enter`), and ordered Escape closing.
- **Note Workspaces.** Saved memory notes can now be grouped into named multi-page workspaces. A note may belong to multiple workspaces, workspaces can be archived without deleting note links, and old notes without workspace metadata remain valid as unassigned notes.
- **Notes folder via backend (remote mode).** New `NOTES_DIR` env var. When set, the backend stores `db.json` and `embeddings.ndjson` in that absolute path instead of `backend/data/`. Auto-creates the directory; fails fast at startup if the path is unwritable. The resolved path is surfaced in `/health` and the panel's Settings status card.
- **Configure button fix.** The original implementation called `chrome.runtime.openOptionsPage()` directly from the content script — that API is not exposed to content scripts and the click silently no-op'd. Fixed by routing through an `OPEN_OPTIONS` message to the service worker.
- **Model list refresh.** Updated the per-provider dropdowns and defaults to current API names (Gemini 2.5/3.x, OpenAI GPT-5.x, Claude Opus 4.7 / Sonnet 4.6 / Haiku 4.5). Legacy entries (Gemini 1.5, GPT-4o family, GPT-3.5) removed; Opus 4.6 retained as a labeled-legacy option.

Files added: `chrome-extension/options.html`, `chrome-extension/options.js`, `chrome-extension/options.css`. Files modified: `chrome-extension/{manifest.json, background.js, content.js, styles.css}`, `backend/src/{server.js, lib/storage.js}`, `.env.example`.

## What it does

- Summarize articles, docs, blogs, and reports without leaving the page.
- Rewrite selected text with clearer, shorter, or more professional wording. Supported form fields and simple editors can be replaced in place; unsupported editors use copy fallback.
- Extract structured page information: title, summary, key points, dates, contacts, and links.
- Save page memory with notes tied to the current URL.
- Organize saved notes into workspaces such as Job Search, Startup Ideas, Research, and Client Leads.
- Search saved memory by keyword and, when embeddings are available, semantic similarity.
- Capture leads from company pages, LinkedIn profiles, and contact pages, then save searchable contact-style records.
- Create follow-up tasks from saved webpage context, with links back to the source memory and page.
- Mirror saved notes to a folder on disk. Pick a folder via the options page in built-in mode, or set `NOTES_DIR` in backend mode.

## Project structure

- `backend/`: Node.js API server with local JSON persistence
- `chrome-extension/`: Manifest V3 extension that injects an assistant panel into any webpage

## Run locally

1. Install Node.js 18+, then install dependencies from the lockfile:

```bash
npm ci
```

2. Create a local env file:

```bash
cp .env.example .env
```

3. Set your Gemini API key in `.env`:

```bash
GEMINI_API_KEY=your_key_here
```

Optional:

```bash
GEMINI_MODEL=gemini-2.5-flash
GEMINI_EMBEDDING_MODEL=gemini-embedding-001
NOTES_DIR=/absolute/path/to/notes
```

You can still override any of these with exported environment variables. `NOTES_DIR`, when set, redirects the backend's JSON storage to that folder; the directory is auto-created and the server fails fast if it is not writable.

4. Start the backend:

```bash
npm start
```

5. In Chrome, open `chrome://extensions`.
6. Enable Developer mode.
7. Click "Load unpacked" and select `chrome-extension/`.

The backend runs on `http://127.0.0.1:8787` by default.

## Modes

The extension runs in one of two modes, selected by the backend URL in Settings:

- **Built-in mode (default).** Leave the backend URL blank. The MV3 service worker handles analyze, memory, contacts, tasks, and backup locally and stores everything in `chrome.storage.local`; no backend process is required. AI calls go directly to the configured provider using the API key saved in extension settings.
- **Local/remote backend mode.** Set a backend URL (e.g. `http://127.0.0.1:8787`) to route requests to the Node backend, which persists JSON under `NOTES_DIR` or `backend/data/` and uses `GEMINI_API_KEY` from `.env`. The two modes expose the same routes; if the backend is unreachable, requests fail until it is back or you clear the URL to return to built-in mode.

## API overview

- `POST /api/assist/analyze`
- `POST /api/memory/save`
- `PATCH /api/memory/:id`
- `DELETE /api/memory/:id`
- `GET /api/memory/source?urlKey=...`
- `GET /api/memory/search?q=...`
- `GET /api/memory/list`
- `GET /api/note-workspaces?status=open|archived|all`
- `POST /api/note-workspaces`
- `PATCH /api/note-workspaces/:id`
- `GET /api/note-workspaces/:id/notes`
- `POST /api/contacts/extract`
- `POST /api/contacts`
- `GET /api/contacts?limit&offset&q&status`
- `GET /api/contacts/:id`
- `PATCH /api/contacts/:id`
- `DELETE /api/contacts/:id`
- `POST /api/actions/run`
- `GET /api/actions/state`
- `GET /api/actions/tasks?status=open|in_progress|done|archived|all&limit&offset`
- `PATCH /api/actions/tasks/:id`
- `GET /api/actions/tasks/:id/context`
- `GET /health` returns backend URL, Gemini config state, active models, the resolved `notesDir`, and saved item counts

## Frontend workflows

- **Analyze**: Summarize, Rewrite, and Extract run against selected text first, otherwise the readable page snapshot.
- **Page Memory**: Saves notes, snippets, page excerpts, extraction output, and workspace membership. `workspaceIds` is the canonical note workspace field; legacy `taskIds` is still accepted only as workspace membership.
- **Workspaces**: Lists default and custom workspaces, supports creating and archiving workspaces, and lets saved notes be reviewed, edited, deleted, or reassigned.
- **Lead Capture**: Extracts lead drafts from selected text or the page using `mailto:`, `tel:`, headings, JSON-LD, LinkedIn URLs, and visible text. Drafts are editable before saving. Saved contacts can be searched, paged, edited, deleted, opened at source, and linked or unlinked from memory notes.
- **Tasks**: Creates or reuses saved page memory, then creates a linked task with title, due date, priority, notes, source URL, and `sourceMemoryIds`. Task cards can update status, priority, and due date, mark done or reopen, open the source, and view linked context. Deleted memory appears as unavailable context instead of breaking the task.
- **Search Saved Memory**: Searches note title, note body, snippets, summaries, page excerpts, tags, source URL/host, and workspace labels.
- **Settings**: Stores provider/model/API key choices, optional backend URL, and notes folder mirror configuration.
- **Keyboard**: `Alt+Shift+A` toggles the panel, `Alt+Shift+K` opens the command palette, `Ctrl/Cmd+K` opens the palette when focus is inside the panel, `1/2/3` run Summarize/Rewrite/Extract, `Ctrl/Cmd+S` saves memory, `/` focuses memory search, and `g` sequences jump sections.

## Limitations

- Built-in mode stores data in `chrome.storage.local`; remote backend mode stores data in JSON files under `NOTES_DIR` or `backend/data`.
- Rewrite replacement is conservative. Complex editors such as Google Docs canvas surfaces may require copy fallback.
- Without an API key, summarize/extract/rewrite and search use deterministic local fallbacks.
- Semantic search quality depends on configured embeddings. Legacy or incompatible embeddings fall back to keyword ranking.
- The built-in notes folder mirror always writes memory notes and indexes. Standalone contact/task summary files are opt-in from the options page.
- Lead extraction is deterministic when no model key is configured and can mis-pair names/emails/phones on dense pages.

## Privacy and secrets

- AI-send follows a privacy mode: `auto` sends page content to the provider, `ask` prompts for confirmation per request, and `local_only` stays on-device using deterministic fallbacks. Per-site rules can exclude hosts (forcing `local_only`) or override the mode for specific hosts.
- **Redaction is off by default** (`redaction.enabled = false`). When enabled, it strips emails, phone numbers, and token-like secrets from outbound model payloads; URLs are reduced to host (query/hash dropped) unless you opt in to sending the full URL. Because the default AI mode is `auto`, this means page content — including any emails, phone numbers, or token-like secrets on the page — is sent to the provider **unredacted** until you turn redaction on, or switch the request/host to `ask`, `local_only`, or a per-site rule.
- API keys live in `chrome.storage.local` (built-in mode) or `.env` (backend mode). `.env` and `backend/.env` are git-ignored — never commit them.
- Backup export defaults to no settings and no API keys. The backend `/api/backup/export` defaults `includeSettings=false`/`includeSensitive=false`; the options backup UI exposes settings/embeddings/audit toggles only and always sends `includeSensitive=false`. The built-in export supports `includeSensitive` (which would include API keys), but no UI surface enables it.

## Testing

Unit and route-level tests run with Node's built-in test runner:

```bash
npm test
```

Browser e2e tests use Playwright with the unpacked MV3 extension loaded into a persistent Chromium profile:

```bash
npm run playwright:install
npm run test:e2e
```

The e2e harness serves deterministic fixture pages over local HTTP and covers both built-in `chrome.storage.local` mode and remote backend mode with a temporary `NOTES_DIR`. It runs headed by default because MV3 service-worker discovery is more reliable locally; set `AAW_E2E_HEADLESS=1` only in environments where headless extension loading is known to work.

## Manual QA checklist

Run these checks in both built-in mode and remote backend mode when possible:

- Open a long article, click Summarize, and confirm key points render in the Result section.
- Select text in a textarea/input, click Rewrite, and confirm supported fields replace in place with Undo available.
- Select text in an unsupported editor or document surface, click Rewrite, and confirm copy fallback is clear.
- Click Extract on a page with dates, contacts, and links; confirm structured fields render and can be copied.
- Save page memory with a note and workspace selection; confirm it appears under Saved on this page and in Workspaces.
- Search saved memory by a word that appears in note text and by a workspace name.
- Capture a lead from a contact page or LinkedIn-style profile; edit the draft, save it, search contacts, edit status, unlink memory, and delete the contact.
- Create a task from a page; verify source memory is linked, status/priority/due date updates work, Mark Done/Reopen works, and View Context opens linked memory.
- Delete linked memory and confirm the task context reports the missing memory entry instead of failing.
- Configure a notes folder mirror, save/update/delete a memory note, and confirm mirrored JSON updates.
- Use `Alt+Shift+K` or `Ctrl/Cmd+K` to open the command palette, run Summarize from it, confirm page editors are not interrupted, and press Escape to close palette, settings, then panel.

## Notes

- With `GEMINI_API_KEY` set, the backend uses Gemini for both generation and embeddings.
- The backend auto-loads `.env` from the project root and `backend/.env` if present.
- Extract mode uses Gemini structured output with a response schema, not prompt-only JSON formatting.
- Without `GEMINI_API_KEY`, the app falls back to the deterministic local analysis and hashed embeddings.
- The extension settings section can test connectivity and display the current backend/Gemini status.
- The extension settings section can also save a custom backend URL, so you can point the extension at a hosted backend instead of localhost.
- The notes folder mirror in built-in mode requires Chrome 86+ and uses the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API). Permission is bound to the extension origin and persists in IndexedDB; expect a one-click re-grant after each Chrome restart.
- `chrome.storage.local` remains the source of truth for saved notes — the on-disk folder is a mirror, not the primary store. Revoking folder access in `chrome://settings/content/file-system` is safe; existing notes stay in extension storage and a new folder can be picked at any time.
