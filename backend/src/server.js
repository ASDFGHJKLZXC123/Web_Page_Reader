const crypto = require("crypto");
const http = require("http");
const { URL } = require("url");
const { loadEnvFiles } = require("./lib/env");
loadEnvFiles();

const {
  buildEmbedding,
  buildResponse,
  cosineSimilarity,
  normalizeText,
  summarizeText,
  truncateText
} = require("./lib/analysis");

const {
  embedText,
  generateText,
  generateStructuredJson,
  getGeminiEmbeddingModel,
  getGeminiModel,
  isGeminiConfigured
} = require("./lib/gemini");

const {
  appendAction,
  appendMemory,
  deleteMemory,
  getActions,
  listMemory,
  loadAllEmbeddings,
  updateTask
} = require("./lib/storage");

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || (process.env.RENDER ? "0.0.0.0" : "127.0.0.1");

// CORS: in production set ALLOWED_ORIGINS=https://your-backend.com (comma-separated).
// In dev (unset), falls back to * for convenience.
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? new Set(process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean))
  : null;

// Rate limiting: max 10 analyze requests per minute (global sliding window).
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;
const analyzeTimestamps = [];

// Pagination defaults
const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 50;
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

// Maximum sizes (bytes / chars)
const MAX_BODY_BYTES = 2_000_000;
const MAX_PROMPT_CONTENT = 12_000;

// Scoring weights for hybrid search
const KEYWORD_WEIGHT = 0.45;
const VECTOR_WEIGHT = 0.55;

const VALID_ACTION_TYPES = new Set(["create_task", "add_table_row", "save_contact", "open_draft"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const EXTRACT_RESPONSE_SCHEMA = {
  type: "OBJECT",
  required: ["title", "url", "summary", "keyPoints", "contacts", "dates"],
  properties: {
    title: { type: "STRING" },
    url: { type: "STRING" },
    summary: { type: "STRING" },
    keyPoints: {
      type: "ARRAY",
      items: { type: "STRING" }
    },
    contacts: {
      type: "OBJECT",
      required: ["emails", "phones"],
      properties: {
        emails: { type: "ARRAY", items: { type: "STRING" } },
        phones: { type: "ARRAY", items: { type: "STRING" } }
      }
    },
    dates: {
      type: "ARRAY",
      items: { type: "STRING" }
    }
  }
};

function resolveAllowedOrigin(requestOrigin) {
  if (!ALLOWED_ORIGINS) return "*";
  if (requestOrigin && ALLOWED_ORIGINS.has(requestOrigin)) return requestOrigin;
  return null; // blocked — header will be omitted
}

function sendJson(response, statusCode, payload, requestOrigin) {
  const origin = resolveAllowedOrigin(requestOrigin || "");
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,PATCH,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "X-Content-Type-Options": "nosniff"
  };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  response.writeHead(statusCode, headers);
  response.end(JSON.stringify(payload));
}

function logRequest(method, pathname, statusCode, durationMs) {
  const timestamp = new Date().toISOString();
  process.stdout.write(`[${timestamp}] ${method} ${pathname} → ${statusCode} (${durationMs}ms)\n`);
}

function isRateLimited() {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  while (analyzeTimestamps.length > 0 && analyzeTimestamps[0] <= cutoff) {
    analyzeTimestamps.shift();
  }
  if (analyzeTimestamps.length >= RATE_LIMIT_MAX) return true;
  analyzeTimestamps.push(now);
  return false;
}

// Only user-caused errors get 400; everything else is 500.
function isClientError(message) {
  return (
    message === "Request body too large" ||
    message === "Invalid JSON body" ||
    message === "Validation error" ||
    message === "Unsupported action type" ||
    message === "Invalid action type" ||
    message === "Invalid action payload"
  );
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        request.destroy(); // stop the stream, don't keep buffering
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });

    request.on("error", reject);
  });
}

function scoreKeywordMatch(query, text) {
  const tokens = normalizeText(query)
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 1);

  if (tokens.length === 0) return 0;

  const haystack = normalizeText(text).toLowerCase();
  let hits = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) hits++;
  }

  return hits / tokens.length;
}

async function createEmbedding(text, taskType) {
  if (!text) return [];

  if (isGeminiConfigured()) {
    try {
      return await embedText(text, taskType);
    } catch (error) {
      console.warn("[embedding] Gemini embed failed, using local fallback:", error.message);
      return buildEmbedding(text);
    }
  }

  return buildEmbedding(text);
}

function buildPrompt({ mode, content, instruction, title, url }) {
  const safeContent = truncateText(content, MAX_PROMPT_CONTENT);
  const context = [
    `Title: ${title || "Untitled page"}`,
    `URL: ${url || ""}`,
    instruction ? `Instruction: ${instruction}` : ""
  ]
    .filter(Boolean)
    .join("\n");

  if (mode === "rewrite") {
    return [
      "You rewrite webpage content for clarity and usefulness.",
      "Return plain text only.",
      "Make the result concise and well-structured.",
      context,
      "",
      "Page content:",
      safeContent
    ].join("\n");
  }

  if (mode === "extract") {
    return [
      "Extract structured information from the webpage content.",
      "Follow the response schema exactly.",
      "If a field is unavailable, use empty strings or empty arrays.",
      context,
      "",
      "Page content:",
      safeContent
    ].join("\n");
  }

  return [
    "Summarize the webpage content for a user viewing it in a browser assistant.",
    "Return plain text only.",
    "Keep it brief and specific.",
    context,
    "",
    "Page content:",
    safeContent
  ].join("\n");
}

async function analyzeWithModel(body) {
  if (!isGeminiConfigured()) {
    return buildResponse(body);
  }

  const prompt = buildPrompt(body);

  if (body.mode === "extract") {
    try {
      const jsonText = await generateStructuredJson(prompt, EXTRACT_RESPONSE_SCHEMA);
      return { mode: "extract", output: JSON.parse(jsonText) };
    } catch (error) {
      console.warn("[analyze] Extract failed, using fallback:", error.message);
      return buildResponse(body);
    }
  }

  try {
    const text = await generateText(prompt);
    return {
      mode: body.mode === "rewrite" ? "rewrite" : "summarize",
      output: text || buildResponse(body).output
    };
  } catch (error) {
    console.warn("[analyze] Generation failed, using fallback:", error.message);
    return buildResponse(body);
  }
}

async function handleSearch(query, limit = DEFAULT_SEARCH_LIMIT) {
  const items = await listMemory();
  const queryEmbedding = await createEmbedding(query, "RETRIEVAL_QUERY");
  const embeddingsMap = loadAllEmbeddings();

  return items
    .map((item) => {
      const baseText = [item.title, item.note, item.snippet, item.sourceUrl].filter(Boolean).join(" ");
      const keywordScore = scoreKeywordMatch(query, baseText);
      // Embeddings are now stored separately; fall back to [] if not found.
      const vectorScore = cosineSimilarity(queryEmbedding, embeddingsMap.get(item.id) || []);
      const combinedScore = Number((keywordScore * KEYWORD_WEIGHT + vectorScore * VECTOR_WEIGHT).toFixed(4));

      return {
        ...item,
        keywordScore: Number(keywordScore.toFixed(4)),
        vectorScore: Number(vectorScore.toFixed(4)),
        score: combinedScore
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

async function createMemoryEntry(body) {
  const text = normalizeText(body.note || body.snippet || body.content || "");
  const embedding = await createEmbedding([body.title, text].join(" "), "RETRIEVAL_DOCUMENT");
  const entry = {
    id: `mem_${crypto.randomUUID()}`,
    createdAt: new Date().toISOString(),
    title: body.title || "Untitled note",
    sourceUrl: body.sourceUrl || "",
    snippet: body.snippet || "",
    note: body.note || "",
    tags: Array.isArray(body.tags) ? body.tags : [],
    summary: body.summary || summarizeText(text),
    embedding
  };

  return appendMemory(entry);
}

async function runAction(body) {
  const type = body.type;
  const payload = body.payload && typeof body.payload === "object" ? body.payload : {};
  const createdAt = new Date().toISOString();

  if (type === "create_task") {
    return {
      type,
      result: await appendAction("tasks", {
        id: `task_${crypto.randomUUID()}`,
        createdAt,
        title: payload.title || "Untitled task",
        dueDate: payload.dueDate || null,
        status: "open",
        notes: payload.notes || ""
      })
    };
  }

  if (type === "add_table_row") {
    return {
      type,
      result: await appendAction("tableRows", {
        id: `row_${crypto.randomUUID()}`,
        createdAt,
        table: payload.table || "default",
        values: payload.values || {}
      })
    };
  }

  if (type === "save_contact") {
    return {
      type,
      result: await appendAction("contacts", {
        id: `contact_${crypto.randomUUID()}`,
        createdAt,
        name: payload.name || "Unknown contact",
        email: payload.email || "",
        company: payload.company || "",
        notes: payload.notes || ""
      })
    };
  }

  if (type === "open_draft") {
    return {
      type,
      result: await appendAction("drafts", {
        id: `draft_${crypto.randomUUID()}`,
        createdAt,
        title: payload.title || "Untitled draft",
        body: payload.body || "",
        status: "open"
      })
    };
  }

  throw new Error("Unsupported action type");
}

// --- Input validation ---

function validateMemoryBody(body) {
  if (body.sourceUrl && typeof body.sourceUrl === "string" && body.sourceUrl !== "") {
    if (!body.sourceUrl.startsWith("http://") && !body.sourceUrl.startsWith("https://")) {
      return "sourceUrl must start with http:// or https://";
    }
  }
  if (body.title) body.title = String(body.title).trim().slice(0, 500);
  if (body.note) body.note = String(body.note).trim().slice(0, 10_000);
  if (body.snippet) body.snippet = String(body.snippet).trim().slice(0, 5_000);
  if (!Array.isArray(body.tags)) body.tags = [];
  return null;
}

function validateActionBody(body) {
  if (!body.type || !VALID_ACTION_TYPES.has(body.type)) {
    return "Invalid action type";
  }
  if (
    body.payload !== undefined &&
    (typeof body.payload !== "object" || body.payload === null || Array.isArray(body.payload))
  ) {
    return "payload must be an object";
  }
  const payload = body.payload || {};
  if (body.type === "create_task" && payload.title) {
    payload.title = String(payload.title).slice(0, 500);
  }
  if (body.type === "save_contact" && payload.email && !EMAIL_RE.test(payload.email)) {
    return "Invalid email address";
  }
  return null;
}

// --- HTTP server ---

const server = http.createServer(async (request, response) => {
  const startTime = Date.now();
  const requestOrigin = request.headers["origin"] || "";

  if (request.method === "OPTIONS") {
    const origin = resolveAllowedOrigin(requestOrigin);
    const headers = {
      "Access-Control-Allow-Methods": "GET,POST,DELETE,PATCH,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400"
    };
    if (origin) headers["Access-Control-Allow-Origin"] = origin;
    response.writeHead(204, headers);
    response.end();
    logRequest(request.method, request.url, 204, Date.now() - startTime);
    return;
  }

  const host = request.headers.host || "localhost";
  const requestUrl = new URL(request.url, `http://${host}`);
  const pathname = requestUrl.pathname;
  let responseStatus = 200;

  function reply(statusCode, payload) {
    responseStatus = statusCode;
    sendJson(response, statusCode, payload, requestOrigin);
  }

  try {
    if (request.method === "GET" && pathname === "/health") {
      const memoryItems = await listMemory();
      const actions = await getActions();
      reply(200, {
        ok: true,
        host: HOST,
        port: PORT,
        backendUrl: `http://${HOST}:${PORT}`,
        gemini: {
          configured: isGeminiConfigured(),
          model: getGeminiModel(),
          embeddingModel: getGeminiEmbeddingModel()
        },
        counts: {
          memory: memoryItems.length,
          tasks: Array.isArray(actions.tasks) ? actions.tasks.length : 0,
          tableRows: Array.isArray(actions.tableRows) ? actions.tableRows.length : 0,
          contacts: Array.isArray(actions.contacts) ? actions.contacts.length : 0,
          drafts: Array.isArray(actions.drafts) ? actions.drafts.length : 0
        }
      });
      return;
    }

    if (request.method === "GET" && pathname === "/api/memory/list") {
      const rawLimit = parseInt(requestUrl.searchParams.get("limit"), 10);
      const rawOffset = parseInt(requestUrl.searchParams.get("offset"), 10);
      const limit = Number.isFinite(rawLimit)
        ? Math.min(Math.max(rawLimit, 1), MAX_LIST_LIMIT)
        : DEFAULT_LIST_LIMIT;
      const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0;
      const allItems = await listMemory();
      const items = allItems.slice(offset, offset + limit);
      reply(200, { items, total: allItems.length, limit, offset });
      return;
    }

    if (request.method === "GET" && pathname === "/api/memory/search") {
      const query = requestUrl.searchParams.get("q") || "";
      const rawLimit = parseInt(requestUrl.searchParams.get("limit"), 10);
      const limit = Number.isFinite(rawLimit)
        ? Math.min(Math.max(rawLimit, 1), MAX_SEARCH_LIMIT)
        : DEFAULT_SEARCH_LIMIT;
      reply(200, { items: await handleSearch(query, limit) });
      return;
    }

    if (request.method === "GET" && pathname === "/api/actions/state") {
      reply(200, { actions: await getActions() });
      return;
    }

    if (request.method === "POST" && pathname === "/api/assist/analyze") {
      if (isRateLimited()) {
        reply(429, { error: "Rate limit exceeded" });
        return;
      }
      const body = await readBody(request);
      const result = await analyzeWithModel(body);
      reply(200, result);
      return;
    }

    if (request.method === "POST" && pathname === "/api/memory/save") {
      const body = await readBody(request);
      const validationError = validateMemoryBody(body);
      if (validationError) {
        reply(400, { error: validationError });
        return;
      }
      const result = await createMemoryEntry(body);
      reply(201, { item: result });
      return;
    }

    if (request.method === "POST" && pathname === "/api/actions/run") {
      const body = await readBody(request);
      const validationError = validateActionBody(body);
      if (validationError) {
        reply(400, { error: validationError });
        return;
      }
      const result = await runAction(body);
      reply(201, result);
      return;
    }

    const deleteMemoryMatch = pathname.match(/^\/api\/memory\/([^/]+)$/);
    if (request.method === "DELETE" && deleteMemoryMatch) {
      const id = deleteMemoryMatch[1];
      const deleted = await deleteMemory(id);
      if (deleted === null) {
        reply(404, { error: "Not found" });
      } else {
        reply(200, { deleted: true, id });
      }
      return;
    }

    const patchTaskMatch = pathname.match(/^\/api\/actions\/tasks\/([^/]+)$/);
    if (request.method === "PATCH" && patchTaskMatch) {
      const id = patchTaskMatch[1];
      const body = await readBody(request);
      const patch = {};
      if (body.status !== undefined) patch.status = body.status;
      if (body.title !== undefined) patch.title = body.title;
      if (body.notes !== undefined) patch.notes = body.notes;
      const updated = await updateTask(id, patch);
      if (updated === null) {
        reply(404, { error: "Not found" });
      } else {
        reply(200, updated);
      }
      return;
    }

    reply(404, { error: "Not found" });
  } catch (error) {
    const message = error.message || "Unknown error";
    const statusCode = isClientError(message) ? 400 : 500;
    responseStatus = statusCode;
    // Don't leak internal details for unexpected errors
    const clientMessage = statusCode === 500 ? "Internal server error" : message;
    sendJson(response, statusCode, { error: clientMessage }, requestOrigin);
  } finally {
    logRequest(request.method, pathname || request.url, responseStatus, Date.now() - startTime);
  }
});

server.on("error", (error) => {
  console.error("[server] Fatal error:", error.message);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("[server] Unhandled rejection:", reason);
});

server.listen(PORT, HOST, () => {
  console.log(`Assistant backend listening on http://${HOST}:${PORT}`);
});
