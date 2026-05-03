# AI Assistant Across Websites

Minimal full-stack starter for a Chrome extension plus local backend that lets users invoke an assistant on any webpage.

## Update — May 2026

- **Notes folder mirror (built-in mode).** The extension now has an options page (`chrome://extensions` → Details → Extension options, or via the panel's Settings → "Notes folder → Configure"). Pick any folder on disk; saved notes are mirrored as one `mem_<id>.json` file per entry. The folder handle is persisted in IndexedDB so it survives browser restarts (you re-confirm permission once per Chrome session via "Grant access"). Each save broadcasts to the open options page for near-real-time mirroring; closing the page is fine — the missing entries are flushed on the next "Sync now" or page open. Optional checkbox to delete folder files that are no longer in memory (one-way sync).
- **Notes folder via backend (remote mode).** New `NOTES_DIR` env var. When set, the backend stores `db.json` and `embeddings.ndjson` in that absolute path instead of `backend/data/`. Auto-creates the directory; fails fast at startup if the path is unwritable. The resolved path is surfaced in `/health` and the panel's Settings status card.
- **Configure button fix.** The original implementation called `chrome.runtime.openOptionsPage()` directly from the content script — that API is not exposed to content scripts and the click silently no-op'd. Fixed by routing through an `OPEN_OPTIONS` message to the service worker.
- **Model list refresh.** Updated the per-provider dropdowns and defaults to current API names (Gemini 2.5/3.x, OpenAI GPT-5.x, Claude Opus 4.7 / Sonnet 4.6 / Haiku 4.5). Legacy entries (Gemini 1.5, GPT-4o family, GPT-3.5) removed; Opus 4.6 retained as a labeled-legacy option.

Files added: `chrome-extension/options.html`, `chrome-extension/options.js`, `chrome-extension/options.css`. Files modified: `chrome-extension/{manifest.json, background.js, content.js, styles.css}`, `backend/src/{server.js, lib/storage.js}`, `.env.example`.

## What it does

- Summarize, rewrite, or extract structured information from the current page
- Save notes and snippets into a personal workspace memory
- Run lightweight actions like creating tasks, saving contacts, adding rows to a table, or opening a draft
- Search saved memory using keyword matching plus vector similarity over locally generated embeddings
- Mirror saved notes to a folder on disk — pick a folder via the options page (built-in mode) or set `NOTES_DIR` (backend mode)

## Project structure

- `backend/`: Node.js API server with local JSON persistence
- `chrome-extension/`: Manifest V3 extension that injects an assistant panel into any webpage

## Run locally

1. Install Node.js 18+.
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

## API overview

- `POST /api/assist/analyze`
- `POST /api/memory/save`
- `GET /api/memory/search?q=...`
- `GET /api/memory/list`
- `POST /api/actions/run`
- `GET /api/actions/state`
- `GET /health` returns backend URL, Gemini config state, active models, the resolved `notesDir`, and saved item counts

## Notes

- With `GEMINI_API_KEY` set, the backend uses Gemini for both generation and embeddings.
- The backend auto-loads `.env` from the project root and `backend/.env` if present.
- Extract mode uses Gemini structured output with a response schema, not prompt-only JSON formatting.
- Without `GEMINI_API_KEY`, the app falls back to the deterministic local analysis and hashed embeddings.
- The extension settings section can test connectivity and display the current backend/Gemini status.
- The extension settings section can also save a custom backend URL, so you can point the extension at a hosted backend instead of localhost.
- The notes folder mirror in built-in mode requires Chrome 86+ and uses the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API). Permission is bound to the extension origin and persists in IndexedDB; expect a one-click re-grant after each Chrome restart.
- `chrome.storage.local` remains the source of truth for saved notes — the on-disk folder is a mirror, not the primary store. Revoking folder access in `chrome://settings/content/file-system` is safe; existing notes stay in extension storage and a new folder can be picked at any time.
