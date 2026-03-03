# AI Assistant Across Websites

Minimal full-stack starter for a Chrome extension plus local backend that lets users invoke an assistant on any webpage.

## What it does

- Summarize, rewrite, or extract structured information from the current page
- Save notes and snippets into a personal workspace memory
- Run lightweight actions like creating tasks, saving contacts, adding rows to a table, or opening a draft
- Search saved memory using keyword matching plus vector similarity over locally generated embeddings

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
```

You can still override any of these with exported environment variables.

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
- `GET /health` returns backend URL, Gemini config state, active models, and saved item counts

## Notes

- With `GEMINI_API_KEY` set, the backend uses Gemini for both generation and embeddings.
- The backend auto-loads `.env` from the project root and `backend/.env` if present.
- Extract mode uses Gemini structured output with a response schema, not prompt-only JSON formatting.
- Without `GEMINI_API_KEY`, the app falls back to the deterministic local analysis and hashed embeddings.
- The extension settings section can test connectivity and display the current backend/Gemini status.
- The extension settings section can also save a custom backend URL, so you can point the extension at a hosted backend instead of localhost.
