const crypto = require("crypto");
const http = require("http");
const { URL } = require("url");
const { loadEnvFiles } = require("./lib/env");
loadEnvFiles();

const {
  buildEmbedding,
  buildSummaryObject,
  buildResponse,
  buildTaskDraft,
  cosineSimilarity,
  normalizeExtractOutput,
  normalizeSummaryOutput,
  normalizeText,
  sanitizeProvenanceShape,
  sanitizeRewriteText,
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

const { buildContextGraph } = require("./lib/context-graph");
const { buildWorkspaceDashboard } = require("./lib/workspace-dashboard");

const {
  appendAction,
  appendMemory,
  appendNoteWorkspace,
  appendPrivacyEvent,
  applyDedupeMerge,
  batchContacts,
  batchTasks,
  clearData,
  createBackupRestorePoint,
  createContact,
  createTaskWithLinks,
  deleteContact,
  deleteMemory,
  deleteNoteWorkspace,
  deleteTask,
  restoreDeletedWorkspaceByName,
  getActions,
  getContact,
  getDataDir,
  getPrivacySettings,
  getTaskContext,
  exportBackup,
  ignoreDedupeGroup,
  importBackup,
  listContacts,
  listDedupeAudit,
  listDedupeCandidates,
  listNoteWorkspaces,
  listMemory,
  listPrivacyEvents,
  listTasks,
  loadAllEmbeddings,
  patchPrivacySettings,
  previewDedupeMerge,
  runRetention,
  undoDedupeMerge,
  unignoreDedupeGroup,
  updateMemory,
  updateContact,
  updateNoteWorkspace,
  updateTask,
  validateBackupEnvelope
} = require("./lib/storage");

const privacy = require("./lib/privacy");

const {
  buildMemoryItem,
  buildMemorySearchText,
  compactStringArray,
  LEAD_STATUSES,
  normalizeContactItem,
  scoreMemoryKeyword,
  sourceParts,
  TASK_PRIORITIES,
  TASK_STATUSES
} = require("./lib/foundation");

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
const VALID_WORKSPACE_STATUSES = new Set(["open", "archived"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const EXTRACT_RESPONSE_SCHEMA = {
  type: "OBJECT",
  required: ["schemaVersion", "title", "url", "summary", "keyPoints", "contacts", "dates", "links"],
  properties: {
    schemaVersion: { type: "NUMBER" },
    title: { type: "STRING" },
    url: { type: "STRING" },
    summary: { type: "STRING" },
    keyPoints: {
      type: "ARRAY",
      items: { type: "STRING" }
    },
    contacts: {
      type: "OBJECT",
      required: ["emails", "phones", "people", "organizations"],
      properties: {
        emails: { type: "ARRAY", items: { type: "STRING" } },
        phones: { type: "ARRAY", items: { type: "STRING" } },
        people: { type: "ARRAY", items: { type: "STRING" } },
        organizations: { type: "ARRAY", items: { type: "STRING" } }
      }
    },
    dates: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          text: { type: "STRING" },
          isoDate: { type: "STRING" },
          context: { type: "STRING" },
          type: { type: "STRING" }
        }
      }
    },
    links: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          text: { type: "STRING" },
          url: { type: "STRING" },
          type: { type: "STRING" },
          context: { type: "STRING" }
        }
      }
    },
    confidence: { type: "NUMBER" },
    fieldConfidence: { type: "OBJECT" },
    extractionMeta: { type: "OBJECT" }
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

function buildEmbeddingMeta(provider, model, embedding, extra = {}) {
  return {
    provider,
    model,
    dimensions: Array.isArray(embedding) ? embedding.length : 0,
    version: 1,
    createdAt: new Date().toISOString(),
    ...extra
  };
}

async function createEmbeddingWithMeta(text, taskType) {
  if (!text) {
    return {
      embedding: [],
      meta: buildEmbeddingMeta("none", "none", [])
    };
  }

  if (isGeminiConfigured()) {
    try {
      const embedding = await embedText(text, taskType);
      return {
        embedding,
        meta: buildEmbeddingMeta("gemini", getGeminiEmbeddingModel(), embedding)
      };
    } catch (error) {
      console.warn("[embedding] Gemini embed failed, using local fallback:", error.message);
      const embedding = buildEmbedding(text);
      return {
        embedding,
        meta: buildEmbeddingMeta("local", "local-hash-v1", embedding, { fallbackReason: "gemini_failed" })
      };
    }
  }

  const embedding = buildEmbedding(text);
  return {
    embedding,
    meta: buildEmbeddingMeta("local", "local-hash-v1", embedding)
  };
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
      "Return replacement text only.",
      "Do not include labels, explanations, quotes, markdown, or bullets unless the original selected text is already a list.",
      "Preserve intended meaning, whitespace, and line breaks.",
      context,
      "",
      "Selected text:",
      safeContent
    ].join("\n");
  }

  if (mode === "extract") {
    return [
      "Extract structured information from the webpage content.",
      "Return JSON only. Use schemaVersion 2.",
      "Fields: title, url, summary, keyPoints, dates, contacts, links, confidence, fieldConfidence, extractionMeta.",
      "Dates are objects with text, isoDate, context, and type.",
      "Contacts include emails, phones, people, and organizations.",
      "Links include text, url, type, and context.",
      context,
      "",
      "Page content:",
      safeContent
    ].join("\n");
  }

  return [
    "Summarize the webpage content for a user viewing it in a browser assistant.",
    "Return JSON only with schemaVersion, tldr, keyPoints, importantDetails, openQuestions, source, and engine.",
    "Keep it brief and specific.",
    context,
    "",
    "Page content:",
    safeContent
  ].join("\n");
}

async function analyzeWithModel(body) {
  const fallback = buildResponse(body);
  if (body && body.aiMode === "local_only") {
    return {
      ...fallback,
      privacyMeta: privacy.sanitizeProvenance({
        ...(body.privacyMeta || {}),
        operation: body.mode || "analyze",
        effectiveAiMode: "local_only",
        sentToProvider: false,
        sentToBackend: true
      })
    };
  }

  if (!isGeminiConfigured()) {
    return fallback;
  }

  const prompt = buildPrompt(body);

  if (body.mode === "extract") {
    try {
      const jsonText = await generateStructuredJson(prompt, EXTRACT_RESPONSE_SCHEMA);
      return {
        mode: "extract",
        output: normalizeExtractOutput(JSON.parse(jsonText), fallback.output, {
          engine: "model_validated",
          provider: "gemini",
          model: getGeminiModel(),
          promptVersion: "page-info-v2",
          fallbackReason: "",
          provenance: body.privacyMeta || {}
        })
      };
    } catch (error) {
      console.warn("[analyze] Extract failed, using fallback:", error.message);
      return {
        ...fallback,
        output: normalizeExtractOutput(null, fallback.output, {
          engine: "local",
          provider: "gemini",
          model: getGeminiModel(),
          fallbackReason: "provider_error",
          validationWarnings: [error.message],
          provenance: body.privacyMeta || {}
        })
      };
    }
  }

  if (body.mode === "summarize") {
    try {
      const text = await generateText(prompt);
      return {
        mode: "summarize",
        output: normalizeSummaryOutput(JSON.parse(text), {
          ...fallback.output,
          engine: "llm"
        })
      };
    } catch (error) {
      console.warn("[analyze] Summary failed, using fallback:", error.message);
      return fallback;
    }
  }

  try {
    const text = await generateText(prompt);
    return {
      mode: body.mode === "rewrite" ? "rewrite" : "summarize",
      output: body.mode === "rewrite"
        ? { replacement: sanitizeRewriteText(text, body.content), source: text ? "model" : "local-fallback" }
        : (text || fallback.output)
    };
  } catch (error) {
    console.warn("[analyze] Generation failed, using fallback:", error.message);
    return fallback;
  }
}

function buildRequestPrivacyMeta(body = {}, overrides = {}) {
  if (!body || !body.privacyMeta) return null;
  const providerConfigured = isGeminiConfigured();
  return privacy.sanitizeProvenance({
    ...body.privacyMeta,
    operation: overrides.operation || body.mode || body.privacyMeta.operation || "analyze",
    effectiveAiMode: overrides.effectiveAiMode || body.aiMode || body.privacyMeta.effectiveAiMode,
    provider: Object.prototype.hasOwnProperty.call(overrides, "provider")
      ? overrides.provider
      : (providerConfigured ? "gemini" : ""),
    model: Object.prototype.hasOwnProperty.call(overrides, "model")
      ? overrides.model
      : (providerConfigured ? getGeminiModel() : ""),
    sentToProvider: Boolean(overrides.sentToProvider),
    sentToBackend: Object.prototype.hasOwnProperty.call(overrides, "sentToBackend")
      ? Boolean(overrides.sentToBackend)
      : true
  });
}

async function attachPrivacyEvent(response, body, overrides = {}) {
  const meta = buildRequestPrivacyMeta(body, overrides);
  if (!meta) return response;
  await appendPrivacyEvent(meta);
  return { ...response, privacyMeta: meta };
}

async function extractContactsWithModel(body = {}) {
  const fallback = extractContactDrafts(body);
  if (body.aiMode === "local_only" || !isGeminiConfigured()) return fallback;

  try {
    const prompt = [
      "Extract lead/contact records from this webpage content.",
      "Return JSON only with shape {\"contacts\":[],\"extractionMeta\":{}}.",
      "Each contact may include name, company, email, phone, roleTitle, website, linkedInUrl, notes, confidence, and fieldConfidence.",
      "Do not invent sourceUrl/sourceTitle; preserve provided source metadata.",
      `Title: ${body.sourceTitle || body.title || ""}`,
      `URL: ${body.sourceUrl || body.url || ""}`,
      "",
      truncateText(body.content || "", MAX_PROMPT_CONTENT)
    ].join("\n");
    const parsed = JSON.parse(await generateText(prompt));
    if (!parsed || !Array.isArray(parsed.contacts)) {
      throw new Error("Model lead_capture response did not include contacts array.");
    }
    const modelContacts = parsed.contacts;
    const merged = fallback.contacts.map((contact, index) => normalizeContactItem({
      ...contact,
      ...(modelContacts[index] && typeof modelContacts[index] === "object" ? modelContacts[index] : {}),
      sourceUrl: contact.sourceUrl,
      sourceTitle: contact.sourceTitle,
      sourceDomain: contact.sourceDomain,
      email: contact.email || modelContacts[index]?.email || "",
      emails: compactStringArray([...(contact.emails || []), ...compactStringArray(modelContacts[index]?.emails)]).slice(0, 40),
      phone: contact.phone || modelContacts[index]?.phone || "",
      phones: compactStringArray([...(contact.phones || []), ...compactStringArray(modelContacts[index]?.phones)]).slice(0, 40),
      confidence: Math.max(Number(contact.confidence) || 0, Number(modelContacts[index]?.confidence) || 0)
    }));
    return {
      contacts: merged,
      extractionMeta: {
        ...fallback.extractionMeta,
        engine: "model_validated",
        provider: "gemini",
        model: getGeminiModel(),
        fallbackReason: "",
        validationWarnings: [],
        provenance: sanitizeProvenanceShape(body.privacyMeta)
      }
    };
  } catch (error) {
    return {
      ...fallback,
      extractionMeta: {
        ...fallback.extractionMeta,
        provider: isGeminiConfigured() ? "gemini" : "",
        model: isGeminiConfigured() ? getGeminiModel() : "",
        fallbackReason: "provider_error",
        validationWarnings: [error.message],
        provenance: sanitizeProvenanceShape(body.privacyMeta)
      }
    };
  }
}

async function taskDraftWithModel(body = {}) {
  const fallback = buildTaskDraft(body);
  if (body.aiMode === "local_only" || !isGeminiConfigured()) return fallback;

  try {
    const prompt = [
      "Draft one follow-up task from this webpage.",
      "Return JSON only with shape {\"draft\":{\"title\":\"\",\"notes\":\"\",\"dueDate\":\"\",\"priority\":\"none\",\"sourceUrl\":\"\",\"sourceTitle\":\"\",\"sourceMemoryIds\":[]},\"extractionMeta\":{}}.",
      "Priority must be one of none, low, medium, high.",
      `Title: ${body.sourceTitle || body.title || ""}`,
      `URL: ${body.sourceUrl || body.url || ""}`,
      "",
      truncateText(body.content || "", MAX_PROMPT_CONTENT)
    ].join("\n");
    const parsed = JSON.parse(await generateText(prompt));
    const draft = parsed && parsed.draft && typeof parsed.draft === "object" ? parsed.draft : {};
    if (!parsed || !parsed.draft || typeof parsed.draft !== "object") {
      throw new Error("Model task_draft response did not include draft object.");
    }
    const allowedPriority = new Set(["none", "low", "medium", "high"]);
    return {
      draft: {
        ...fallback.draft,
        title: typeof draft.title === "string" && draft.title.trim() ? draft.title.trim().slice(0, 180) : fallback.draft.title,
        notes: typeof draft.notes === "string" && draft.notes.trim() ? draft.notes.trim().slice(0, 4000) : fallback.draft.notes,
        dueDate: typeof draft.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(draft.dueDate) ? draft.dueDate : fallback.draft.dueDate,
        priority: allowedPriority.has(draft.priority) ? draft.priority : fallback.draft.priority,
        sourceUrl: fallback.draft.sourceUrl,
        sourceTitle: fallback.draft.sourceTitle,
        sourceMemoryIds: fallback.draft.sourceMemoryIds
      },
      extractionMeta: {
        ...fallback.extractionMeta,
        engine: "model_validated",
        provider: "gemini",
        model: getGeminiModel(),
        fallbackReason: "",
        validationWarnings: [],
        provenance: sanitizeProvenanceShape(body.privacyMeta)
      }
    };
  } catch (error) {
    return {
      ...fallback,
      extractionMeta: {
        ...fallback.extractionMeta,
        provider: isGeminiConfigured() ? "gemini" : "",
        model: isGeminiConfigured() ? getGeminiModel() : "",
        fallbackReason: "provider_error",
        validationWarnings: [error.message],
        provenance: sanitizeProvenanceShape(body.privacyMeta)
      }
    };
  }
}

async function checkLlmHealth() {
  const configured = isGeminiConfigured();
  const model = getGeminiModel();
  const embeddingModel = getGeminiEmbeddingModel();
  const base = {
    provider: "gemini",
    model,
    embeddingModel,
    configured
  };

  if (!configured) {
    return {
      ok: false,
      llm: { ...base, healthy: false },
      message: "GEMINI_API_KEY is not configured."
    };
  }

  try {
    await generateText("Reply with exactly: OK");
    return {
      ok: true,
      llm: { ...base, healthy: true }
    };
  } catch (error) {
    return {
      ok: false,
      llm: { ...base, healthy: false },
      message: error.message || "Gemini API key check failed."
    };
  }
}

function normalizeEmbeddingRecord(record) {
  if (Array.isArray(record)) {
    return {
      embedding: record,
      meta: {
        provider: "legacy",
        model: "unknown",
        dimensions: record.length,
        version: 0,
        createdAt: null
      }
    };
  }
  if (record && typeof record === "object") {
    const embedding = Array.isArray(record.embedding) ? record.embedding : [];
    return {
      embedding,
      meta: record.meta || {
        provider: "legacy",
        model: "unknown",
        dimensions: embedding.length,
        version: 0,
        createdAt: null
      }
    };
  }
  return { embedding: [], meta: null };
}

function isCompatibleEmbedding(queryMeta, docRecord) {
  if (!queryMeta || !docRecord || !Array.isArray(docRecord.embedding) || docRecord.embedding.length === 0) {
    return false;
  }
  const docMeta = docRecord.meta;
  if (!docMeta || docMeta.provider === "legacy" || queryMeta.provider === "legacy") return false;
  return (
    queryMeta.provider === docMeta.provider &&
    queryMeta.model === docMeta.model &&
    queryMeta.dimensions === docMeta.dimensions
  );
}

function searchMatchType(keywordScore, vectorScore, vectorAvailable) {
  if (vectorAvailable && keywordScore > 0) return "mixed";
  if (vectorAvailable && vectorScore > 0) return "semantic";
  return "keyword";
}

async function handleSearch(query, { limit = DEFAULT_SEARCH_LIMIT, offset = 0 } = {}) {
  const items = await listMemory();
  const workspaces = await listNoteWorkspaces("all");
  const workspaceNameById = new Map(workspaces.map((workspace) => [workspace.id, workspace.name]));
  const queryEmbeddingRecord = await createEmbeddingWithMeta(query, "RETRIEVAL_QUERY");
  const embeddingsMap = loadAllEmbeddings();
  let vectorUsed = false;

  const ranked = items
    .map((item) => {
      const workspaceNames = (item.workspaceIds || item.taskIds || [])
        .map((id) => workspaceNameById.get(id))
        .filter(Boolean);
      const baseText = buildMemorySearchText(item, workspaceNames);
      const keyword = scoreMemoryKeyword(query, item, workspaceNames);
      const fallbackKeywordScore = keyword.keywordScore || scoreKeywordMatch(query, baseText);
      const docRecord = normalizeEmbeddingRecord(embeddingsMap.get(item.id));
      const vectorAvailable = isCompatibleEmbedding(queryEmbeddingRecord.meta, docRecord);
      const vectorScore = vectorAvailable
        ? cosineSimilarity(queryEmbeddingRecord.embedding, docRecord.embedding)
        : 0;
      if (vectorAvailable) vectorUsed = true;
      const combinedScore = vectorAvailable
        ? Number((fallbackKeywordScore * KEYWORD_WEIGHT + vectorScore * VECTOR_WEIGHT).toFixed(4))
        : fallbackKeywordScore;

      return {
        ...item,
        workspaceLabels: workspaceNames,
        matchedFields: keyword.matchedFields,
        matchedTerms: keyword.matchedTerms,
        matchType: searchMatchType(fallbackKeywordScore, vectorScore, vectorAvailable),
        keywordScore: Number(fallbackKeywordScore.toFixed(4)),
        vectorScore: Number(vectorScore.toFixed(4)),
        vectorAvailable,
        score: combinedScore
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const rankingMode = vectorUsed ? "mixed" : "keyword";
  const fallbackReason = vectorUsed ? "" : "no_compatible_embeddings";
  return {
    items: ranked.slice(offset, offset + limit),
    total: ranked.length,
    limit,
    offset,
    query,
    memoryTotal: items.length,
    rankingMode,
    embeddingProvider: queryEmbeddingRecord.meta.provider,
    fallbackReason
  };
}

function memoryUrlKey(item) {
  return item.urlKey || sourceParts(item.sourceUrl || item.canonicalUrl).urlKey;
}

function sourceDomainFor(value) {
  try {
    return value ? new URL(value).hostname.toLowerCase() : "";
  } catch {
    return "";
  }
}

function extractJsonLdContactHints(value) {
  const hints = {
    people: [],
    organizations: [],
    emails: [],
    phones: [],
    links: []
  };

  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }

    const typeValue = node["@type"] || node.type || "";
    const types = Array.isArray(typeValue) ? typeValue : [typeValue];
    const normalizedTypes = types.map((type) => String(type || "").toLowerCase());
    const name = String(node.name || "").trim();
    if (name && normalizedTypes.some((type) => ["person", "profilepage"].includes(type))) {
      hints.people.push(name);
    }
    if (name && normalizedTypes.some((type) => ["organization", "corporation", "localbusiness"].includes(type))) {
      hints.organizations.push(name);
    }
    if (node.email) hints.emails.push(String(node.email));
    if (node.telephone) hints.phones.push(String(node.telephone));
    if (node.url) hints.links.push({ text: name || String(node.url), url: String(node.url), type: "page" });
    if (node.sameAs) {
      const sameAs = Array.isArray(node.sameAs) ? node.sameAs : [node.sameAs];
      for (const url of sameAs) hints.links.push({ text: name || String(url), url: String(url), type: "social" });
    }

    for (const child of Object.values(node)) {
      if (child && typeof child === "object") visit(child);
    }
  };

  visit(value);
  return {
    people: compactStringArray(hints.people),
    organizations: compactStringArray(hints.organizations),
    emails: compactStringArray(hints.emails),
    phones: compactStringArray(hints.phones),
    links: compactStringArray(hints.links.map((link) => link.url)).map((url) => ({ text: url, url, type: "page" }))
  };
}

function mergePageMetaHints(pageMeta = {}) {
  const jsonLdHints = extractJsonLdContactHints(pageMeta.jsonLd || pageMeta.structuredData || []);
  return {
    ...pageMeta,
    people: compactStringArray([
      ...(Array.isArray(pageMeta.people) ? pageMeta.people : []),
      ...jsonLdHints.people
    ]),
    organizations: compactStringArray([
      ...(Array.isArray(pageMeta.organizations) ? pageMeta.organizations : []),
      ...jsonLdHints.organizations
    ]),
    mailto: compactStringArray([
      ...(Array.isArray(pageMeta.mailto) ? pageMeta.mailto : []),
      ...jsonLdHints.emails
    ]),
    tel: compactStringArray([
      ...(Array.isArray(pageMeta.tel) ? pageMeta.tel : []),
      ...jsonLdHints.phones
    ]),
    links: [
      ...(Array.isArray(pageMeta.links) ? pageMeta.links : []),
      ...jsonLdHints.links
    ]
  };
}

function extractContactDrafts(body = {}) {
  const text = normalizeText(body.content || "");
  const pageMeta = mergePageMetaHints(body.pageMeta && typeof body.pageMeta === "object" ? body.pageMeta : {});
  const sourceUrl = body.sourceUrl || body.url || "";
  const sourceTitle = body.sourceTitle || body.title || "";
  const sourceDomain = sourceDomainFor(sourceUrl);
  const emails = compactStringArray([
    ...(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []),
    ...(Array.isArray(pageMeta.mailto) ? pageMeta.mailto : [])
  ]).map((email) => email.toLowerCase());
  const uniqueEmails = compactStringArray(emails);
  const phones = compactStringArray([
    ...(text.match(/(?:\+?\d{1,2}\s*)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}/g) || []),
    ...(Array.isArray(pageMeta.tel) ? pageMeta.tel : [])
  ]);
  const linkedInUrl = compactStringArray([
    ...(Array.isArray(pageMeta.links) ? pageMeta.links.map((link) => link.url) : []),
    sourceUrl
  ]).find((url) => /linkedin\.com\/(in|company)\//i.test(url)) || "";
  const organizations = compactStringArray([
    ...(Array.isArray(pageMeta.organizations) ? pageMeta.organizations : []),
    ...(Array.isArray(pageMeta.headings) ? pageMeta.headings : [])
  ]);
  const names = compactStringArray([
    ...(Array.isArray(pageMeta.people) ? pageMeta.people : []),
    sourceTitle
  ]).filter((name) => name && name.length <= 120);
  const count = Math.max(1, uniqueEmails.length, phones.length, names.length);
  const contacts = [];
  for (let index = 0; index < count; index++) {
    contacts.push(normalizeContactItem({
      sourceUrl,
      sourceTitle,
      sourceDomain: sourceDomainFor(sourceUrl),
      pageKind: pageMeta.pageKind || (/linkedin\.com\/in\//i.test(linkedInUrl) ? "linkedin_profile" : "webpage"),
      name: names[index] || names[0] || organizations[0] || sourceTitle || "Unknown contact",
      company: organizations[index] || organizations[0] || "",
      email: uniqueEmails[index] || "",
      emails: uniqueEmails[index] ? [uniqueEmails[index]] : uniqueEmails,
      phone: phones[index] || "",
      phones: phones[index] ? [phones[index]] : phones,
      website: pageMeta.canonicalUrl || sourceUrl,
      linkedInUrl,
      socialUrls: linkedInUrl ? [linkedInUrl] : [],
      leadStatus: "new",
      tags: ["lead"],
      notes: text.slice(0, 1000),
      confidence: uniqueEmails[index] || phones[index] ? 0.78 : 0.55,
      fieldConfidence: {
        email: uniqueEmails[index] ? 0.9 : 0,
        phone: phones[index] ? 0.85 : 0,
        sourceUrl: sourceUrl ? 0.9 : 0
      }
    }));
  }
  return {
    contacts,
    extractionMeta: {
      schemaVersion: 2,
      contract: "lead_capture",
      engine: "local",
      provider: "",
      model: "",
      promptVersion: "lead-capture-v1",
      fallbackReason: "local_fallback",
      validationWarnings: [],
      provenance: sanitizeProvenanceShape(body.privacyMeta),
      sourceUrl,
      sourceDomain
    }
  };
}

function parseLimitOffset(searchParams, defaultLimit, maxLimit) {
  const rawLimit = parseInt(searchParams.get("limit"), 10);
  const rawOffset = parseInt(searchParams.get("offset"), 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), maxLimit)
    : defaultLimit;
  const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0;
  return { limit, offset };
}

function parseCsvSearchParam(searchParams, name) {
  return compactStringArray(String(searchParams.get(name) || "").split(","));
}

function invalidListValue(values, allowed) {
  return values.find((value) => value !== "all" && !allowed.has(value));
}

function dashboardOptionsFromSearchParams(searchParams) {
  return {
    memoryLimit: searchParams.get("memoryLimit"),
    sourceLimit: searchParams.get("sourceLimit"),
    contactLimit: searchParams.get("contactLimit"),
    taskLimit: searchParams.get("taskLimit"),
    activityLimit: searchParams.get("activityLimit"),
    taskStatus: searchParams.get("taskStatus") || "all"
  };
}

async function normalizeWorkspaceIdsInput(value) {
  if (value === undefined) return { workspaceIds: [] };
  if (!Array.isArray(value)) return { error: "workspaceIds must be an array" };

  const workspaceIds = [];
  const seen = new Set();
  for (const raw of value) {
    if (typeof raw !== "string") return { error: "workspaceIds must contain only strings" };
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    workspaceIds.push(id);
  }

  if (workspaceIds.length === 0) return { workspaceIds };

  const workspaces = await listNoteWorkspaces("all");
  const knownIds = new Set(workspaces.map((workspace) => workspace.id));
  const unknownId = workspaceIds.find((id) => !knownIds.has(id));
  if (unknownId) return { error: `Unknown note workspace ID: ${unknownId}` };
  return { workspaceIds };
}

async function normalizeMemoryMembershipInput(body) {
  const value = Object.prototype.hasOwnProperty.call(body, "workspaceIds")
    ? body.workspaceIds
    : body.taskIds;
  const normalized = await normalizeWorkspaceIdsInput(value);
  if (normalized.error) return normalized;
  return {
    workspaceIds: normalized.workspaceIds,
    taskIds: normalized.workspaceIds
  };
}

function normalizeWorkspaceName(value) {
  const name = String(value || "").trim();
  if (!name) return { error: "Workspace name is required" };
  if (name.length > 200) return { error: "Workspace name must be 200 characters or fewer" };
  return { name };
}

async function createNoteWorkspace(body) {
  const { name, error } = normalizeWorkspaceName(body.name);
  if (error) return { error };
  const existing = await listNoteWorkspaces("all");
  const duplicate = existing.find((workspace) => workspace.name.trim().toLowerCase() === name.toLowerCase());
  if (duplicate) {
    return {
      error: duplicate.status === "archived"
        ? "Workspace already exists as archived; reopen it instead"
        : "Workspace already exists"
    };
  }
  const now = new Date().toISOString();
  // Reuse the id of a previously deleted workspace with the same name, restoring
  // it as an empty open workspace instead of minting a fresh id.
  const restored = await restoreDeletedWorkspaceByName(name);
  const id = restored && restored.id ? restored.id : `nw_${crypto.randomUUID()}`;
  return {
    workspace: await appendNoteWorkspace({
      id,
      createdAt: now,
      updatedAt: now,
      name,
      status: "open"
    }),
    restored: Boolean(restored && restored.id)
  };
}

async function patchNoteWorkspace(id, body) {
  const patch = {};

  if (Object.prototype.hasOwnProperty.call(body, "name")) {
    const { name, error } = normalizeWorkspaceName(body.name);
    if (error) return { error };
    const existing = await listNoteWorkspaces("all");
    const duplicate = existing.find((workspace) =>
      workspace.id !== id &&
      workspace.name.trim().toLowerCase() === name.toLowerCase()
    );
    if (duplicate) {
      return {
        error: duplicate.status === "archived"
          ? "Workspace already exists as archived; reopen it instead"
          : "Workspace already exists"
      };
    }
    patch.name = name;
  }

  if (Object.prototype.hasOwnProperty.call(body, "status")) {
    if (!VALID_WORKSPACE_STATUSES.has(body.status)) return { error: "Invalid workspace status" };
    patch.status = body.status;
  }

  const updated = await updateNoteWorkspace(id, patch);
  return updated ? { workspace: updated } : { notFound: true };
}

async function createMemoryEntry(body) {
  const text = normalizeText(body.note || body.snippet || body.content || "");
  const embeddingRecord = await createEmbeddingWithMeta([body.title, text].join(" "), "RETRIEVAL_DOCUMENT");
  const createdAt = new Date().toISOString();
  const entry = {
    ...buildMemoryItem(
      {
        ...body,
        summary: body.summary || summarizeText(text)
      },
      { id: `mem_${crypto.randomUUID()}`, now: createdAt }
    ),
    embedding: embeddingRecord.embedding,
    embeddingMeta: embeddingRecord.meta
  };

  return appendMemory(entry);
}

async function updateMemoryEntry(id, body) {
  const patch = {};
  if (
    Object.prototype.hasOwnProperty.call(body, "workspaceIds") ||
    Object.prototype.hasOwnProperty.call(body, "taskIds")
  ) {
    const normalized = await normalizeMemoryMembershipInput(body);
    if (normalized.error) return { error: normalized.error };
    patch.workspaceIds = normalized.workspaceIds;
    patch.taskIds = normalized.taskIds;
  }
  if (Object.prototype.hasOwnProperty.call(body, "note")) {
    patch.note = String(body.note || "").trim().slice(0, 10_000);
  }
  if (Object.prototype.hasOwnProperty.call(body, "tags")) {
    if (!Array.isArray(body.tags)) return { error: "tags must be an array" };
    patch.tags = compactStringArray(body.tags);
  }
  const item = await updateMemory(id, patch);
  return item ? { item } : { notFound: true };
}

async function createContactEntry(body) {
  return { contact: await createContact(body) };
}

async function patchContactEntry(id, body) {
  if (body.leadStatus && !LEAD_STATUSES.has(body.leadStatus)) return { error: "Invalid lead status" };
  const contact = await updateContact(id, body);
  return contact ? { contact } : { notFound: true };
}

async function buildContextResponse(subject) {
  return buildContextGraph({
    memory: await listMemory(),
    workspaces: await listNoteWorkspaces("all"),
    actions: await getActions()
  }, subject);
}

async function buildWorkspaceDashboardResponse(subject, options = {}) {
  return buildWorkspaceDashboard({
    memory: await listMemory(),
    workspaces: await listNoteWorkspaces("all"),
    actions: await getActions()
  }, subject, options);
}

async function runAction(body) {
  const type = body.type;
  const payload = body.payload && typeof body.payload === "object" ? body.payload : {};
  const createdAt = new Date().toISOString();

  if (type === "create_task") {
    const created = await createTaskWithLinks({
      title: payload.title || "Untitled task",
      notes: payload.notes || "",
      dueDate: payload.dueDate || "",
      priority: payload.priority || "none",
      status: payload.status || "open",
      sourceUrl: payload.sourceUrl || "",
      sourceTitle: payload.sourceTitle || "",
      sourceSnippet: payload.sourceSnippet || "",
      sourceMemoryIds: payload.sourceMemoryIds || [],
      clientRequestId: payload.clientRequestId || ""
    });
    if (created.error) return created;
    return {
      type,
      result: created.task,
      linkedMemoryItems: created.linkedMemoryItems || [],
      duplicate: Boolean(created.duplicate)
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
    const contact = await createContact({
      sourceUrl: payload.sourceUrl || "",
      sourceTitle: payload.sourceTitle || payload.title || "",
      name: payload.name || "Unknown contact",
      email: payload.email || "",
      emails: payload.emails || [],
      phone: payload.phone || "",
      phones: payload.phones || [],
      company: payload.company || "",
      roleTitle: payload.roleTitle || "",
      notes: payload.notes || "",
      leadStatus: payload.leadStatus || "new",
      tags: payload.tags || ["lead"],
      memoryIds: payload.memoryIds || []
    });
    return {
      type,
      result: contact
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
      const noteWorkspaces = await listNoteWorkspaces("all");
      reply(200, {
        ok: true,
        host: HOST,
        port: PORT,
        backendUrl: `http://${HOST}:${PORT}`,
        notesDir: getDataDir(),
        gemini: {
          configured: isGeminiConfigured(),
          model: getGeminiModel(),
          embeddingModel: getGeminiEmbeddingModel()
        },
        counts: {
          memory: memoryItems.length,
          noteWorkspaces: noteWorkspaces.length,
          tasks: Array.isArray(actions.tasks) ? actions.tasks.length : 0,
          tableRows: Array.isArray(actions.tableRows) ? actions.tableRows.length : 0,
          contacts: Array.isArray(actions.contacts) ? actions.contacts.length : 0,
          drafts: Array.isArray(actions.drafts) ? actions.drafts.length : 0
        }
      });
      return;
    }

    if (request.method === "GET" && pathname === "/api/memory/list") {
      const { limit, offset } = parseLimitOffset(requestUrl.searchParams, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
      const allItems = await listMemory();
      const items = allItems.slice(offset, offset + limit);
      reply(200, { items, total: allItems.length, limit, offset });
      return;
    }

    if (request.method === "GET" && pathname === "/api/llm/health") {
      reply(200, await checkLlmHealth());
      return;
    }

    if (pathname === "/api/privacy/settings") {
      if (request.method === "GET") {
        reply(200, { settings: await getPrivacySettings() });
        return;
      }
      if (request.method === "PATCH") {
        const body = await readBody(request);
        reply(200, { settings: await patchPrivacySettings(body) });
        return;
      }
    }

    if (request.method === "GET" && pathname === "/api/privacy/provenance") {
      const { limit, offset } = parseLimitOffset(requestUrl.searchParams, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
      reply(200, await listPrivacyEvents({ limit, offset }));
      return;
    }

    if (request.method === "POST" && pathname === "/api/privacy/clear-data") {
      const body = await readBody(request);
      if (!body.confirmationToken) {
        reply(400, { error: "confirmationToken is required" });
        return;
      }
      const validated = privacy.validateClearBuckets(body.buckets);
      if (validated.error) {
        reply(400, { error: validated.error });
        return;
      }
      const parsedBefore = privacy.parseBeforeTimestamp(body.before);
      if (parsedBefore && parsedBefore.error) {
        reply(400, { error: parsedBefore.error });
        return;
      }
      reply(200, await clearData({ buckets: validated.buckets, before: parsedBefore ? parsedBefore.before : null }));
      return;
    }

    if (request.method === "POST" && pathname === "/api/privacy/retention/run") {
      reply(200, await runRetention());
      return;
    }

    if (request.method === "GET" && pathname === "/api/backup/export") {
      reply(200, await exportBackup({
        includeEmbeddings: requestUrl.searchParams.get("includeEmbeddings") !== "false",
        includeSettings: requestUrl.searchParams.get("includeSettings") === "true",
        includeSensitive: requestUrl.searchParams.get("includeSensitive") === "true",
        includeAudit: requestUrl.searchParams.get("includeAudit") === "true"
      }));
      return;
    }

    if (request.method === "POST" && pathname === "/api/backup/validate") {
      const body = await readBody(request);
      const result = validateBackupEnvelope(body.backup || body);
      reply(result.valid ? 200 : 400, result);
      return;
    }

    if (request.method === "POST" && pathname === "/api/backup/restore-point") {
      reply(200, await createBackupRestorePoint());
      return;
    }

    if (request.method === "POST" && pathname === "/api/backup/import") {
      const body = await readBody(request);
      const result = await importBackup(body);
      reply(result.error ? 400 : 200, result);
      return;
    }

    if (request.method === "GET" && pathname === "/api/memory/search") {
      const query = requestUrl.searchParams.get("q") || "";
      const { limit, offset } = parseLimitOffset(requestUrl.searchParams, DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT);
      reply(200, await handleSearch(query, { limit, offset }));
      return;
    }

    if (request.method === "GET" && pathname === "/api/memory/source") {
      const urlKey = requestUrl.searchParams.get("urlKey") || "";
      if (!urlKey) {
        reply(400, { error: "urlKey is required" });
        return;
      }
      const { limit, offset } = parseLimitOffset(requestUrl.searchParams, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
      const allItems = (await listMemory()).filter((item) => memoryUrlKey(item) === urlKey);
      const items = allItems.slice(offset, offset + limit);
      reply(200, { items, total: allItems.length, limit, offset });
      return;
    }

    if (request.method === "GET" && pathname === "/api/dedupe/candidates") {
      reply(200, await listDedupeCandidates({
        type: requestUrl.searchParams.get("type") || "all",
        includeIgnored: requestUrl.searchParams.get("includeIgnored") === "true"
      }));
      return;
    }

    if (request.method === "GET" && pathname === "/api/dedupe/audit") {
      const { limit, offset } = parseLimitOffset(requestUrl.searchParams, DEFAULT_LIST_LIMIT, 100);
      reply(200, await listDedupeAudit({ limit, offset }));
      return;
    }

    if (request.method === "POST" && pathname === "/api/dedupe/preview") {
      const body = await readBody(request);
      const result = await previewDedupeMerge(body);
      reply(result.error ? 404 : 200, result);
      return;
    }

    if (request.method === "POST" && pathname === "/api/dedupe/apply") {
      const body = await readBody(request);
      const result = await applyDedupeMerge(body);
      reply(result.error ? (result.statusCode || 400) : 200, result);
      return;
    }

    if (request.method === "POST" && pathname === "/api/dedupe/undo") {
      const body = await readBody(request);
      const result = await undoDedupeMerge(body);
      reply(result.error ? 400 : 200, result);
      return;
    }

    if (request.method === "POST" && pathname === "/api/dedupe/ignore") {
      const body = await readBody(request);
      const result = await ignoreDedupeGroup(body);
      reply(result.error ? 400 : 200, result);
      return;
    }

    if (request.method === "POST" && pathname === "/api/dedupe/unignore") {
      const body = await readBody(request);
      const result = await unignoreDedupeGroup(body);
      reply(result.error ? 400 : 200, result);
      return;
    }

    if (request.method === "GET" && pathname === "/api/contacts") {
      const { limit, offset } = parseLimitOffset(requestUrl.searchParams, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
      const statuses = parseCsvSearchParam(requestUrl.searchParams, "statuses");
      const status = requestUrl.searchParams.get("status") || "";
      const contactStatuses = statuses.length ? statuses : parseCsvSearchParam(requestUrl.searchParams, "status");
      const invalidStatus = invalidListValue(contactStatuses, LEAD_STATUSES);
      if (invalidStatus) {
        reply(400, { error: "Invalid lead status" });
        return;
      }
      const result = await listContacts({
        limit,
        offset,
        q: requestUrl.searchParams.get("q") || "",
        status,
        statuses: statuses.length ? statuses : undefined,
        sourceHost: requestUrl.searchParams.get("sourceHost") || "",
        sourceUrlKey: requestUrl.searchParams.get("sourceUrlKey") || requestUrl.searchParams.get("urlKey") || "",
        memoryId: requestUrl.searchParams.get("memoryId") || "",
        workspaceId: requestUrl.searchParams.get("workspaceId") || "",
        sortBy: requestUrl.searchParams.get("sortBy") || "updatedAt",
        sortDir: requestUrl.searchParams.get("sortDir") || "desc"
      });
      reply(200, result);
      return;
    }

    const contactMatch = pathname.match(/^\/api\/contacts\/([^/]+)$/);
    if (request.method === "GET" && contactMatch) {
      const contact = await getContact(contactMatch[1]);
      if (!contact) reply(404, { error: "Not found" });
      else reply(200, { contact });
      return;
    }

    if (request.method === "GET" && pathname === "/api/note-workspaces") {
      const status = requestUrl.searchParams.get("status") || "open";
      if (status !== "all" && !VALID_WORKSPACE_STATUSES.has(status)) {
        reply(400, { error: "Invalid workspace status" });
        return;
      }
      const workspaces = await listNoteWorkspaces(status);
      const memoryItems = await listMemory();
      const counts = new Map();
      for (const item of memoryItems) {
        for (const id of item.workspaceIds || item.taskIds || []) counts.set(id, (counts.get(id) || 0) + 1);
      }
      const unassignedNoteCount = memoryItems.filter((item) => (item.workspaceIds || item.taskIds || []).length === 0).length;
      reply(200, {
        unassignedNoteCount,
        items: workspaces.map((workspace) => ({
          ...workspace,
          noteCount: counts.get(workspace.id) || 0
        }))
      });
      return;
    }

    if (request.method === "GET" && pathname === "/api/note-workspaces/unassigned/notes") {
      const { limit, offset } = parseLimitOffset(requestUrl.searchParams, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
      const allItems = (await listMemory()).filter((item) => (item.workspaceIds || item.taskIds || []).length === 0);
      const items = allItems.slice(offset, offset + limit);
      reply(200, { items, total: allItems.length, limit, offset });
      return;
    }

    if (request.method === "GET" && pathname === "/api/note-workspaces/unassigned/dashboard") {
      reply(200, await buildWorkspaceDashboardResponse({ type: "unassigned" }, dashboardOptionsFromSearchParams(requestUrl.searchParams)));
      return;
    }

    const workspaceNotesMatch = pathname.match(/^\/api\/note-workspaces\/([^/]+)\/notes$/);
    if (request.method === "GET" && workspaceNotesMatch) {
      const id = workspaceNotesMatch[1];
      const exists = (await listNoteWorkspaces("all")).some((workspace) => workspace.id === id);
      if (!exists) {
        reply(404, { error: "Not found" });
        return;
      }
      const { limit, offset } = parseLimitOffset(requestUrl.searchParams, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
      const allItems = (await listMemory()).filter((item) => (item.workspaceIds || item.taskIds || []).includes(id));
      const items = allItems.slice(offset, offset + limit);
      reply(200, { items, total: allItems.length, limit, offset });
      return;
    }

    const workspaceDashboardMatch = pathname.match(/^\/api\/note-workspaces\/([^/]+)\/dashboard$/);
    if (request.method === "GET" && workspaceDashboardMatch) {
      reply(200, await buildWorkspaceDashboardResponse({ type: "workspace", workspaceId: decodeURIComponent(workspaceDashboardMatch[1]) }, dashboardOptionsFromSearchParams(requestUrl.searchParams)));
      return;
    }

    if (request.method === "GET" && pathname === "/api/actions/state") {
      reply(200, { actions: await getActions() });
      return;
    }

    if (request.method === "GET" && pathname === "/api/actions/tasks") {
      const { limit, offset } = parseLimitOffset(requestUrl.searchParams, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
      const status = requestUrl.searchParams.get("status") || "open";
      const statuses = parseCsvSearchParam(requestUrl.searchParams, "statuses");
      const taskStatuses = statuses.length ? statuses : parseCsvSearchParam(requestUrl.searchParams, "status");
      const invalidStatus = invalidListValue(taskStatuses, TASK_STATUSES);
      if (invalidStatus) {
        reply(400, { error: "Invalid task status" });
        return;
      }
      const priorities = parseCsvSearchParam(requestUrl.searchParams, "priorities");
      const taskPriorities = priorities.length ? priorities : parseCsvSearchParam(requestUrl.searchParams, "priority");
      const invalidPriority = invalidListValue(taskPriorities, TASK_PRIORITIES);
      if (invalidPriority) {
        reply(400, { error: "Invalid task priority" });
        return;
      }
      const dueBucket = requestUrl.searchParams.get("dueBucket") || "";
      if (dueBucket && !["none", "overdue", "today", "week", "next_7_days", "upcoming"].includes(dueBucket)) {
        reply(400, { error: "Invalid due bucket" });
        return;
      }
      reply(200, await listTasks({
        status,
        statuses: statuses.length ? statuses : undefined,
        priority: requestUrl.searchParams.get("priority") || "",
        priorities: priorities.length ? priorities : undefined,
        sourceHost: requestUrl.searchParams.get("sourceHost") || "",
        sourceUrlKey: requestUrl.searchParams.get("sourceUrlKey") || requestUrl.searchParams.get("urlKey") || "",
        memoryId: requestUrl.searchParams.get("memoryId") || "",
        workspaceId: requestUrl.searchParams.get("workspaceId") || "",
        dueBucket,
        dueFrom: requestUrl.searchParams.get("dueFrom") || "",
        dueTo: requestUrl.searchParams.get("dueTo") || "",
        q: requestUrl.searchParams.get("q") || "",
        sortBy: requestUrl.searchParams.get("sortBy") || "updatedAt",
        sortDir: requestUrl.searchParams.get("sortDir") || "desc",
        limit,
        offset
      }));
      return;
    }

    const taskContextMatch = pathname.match(/^\/api\/actions\/tasks\/([^/]+)\/context$/);
    if (request.method === "GET" && taskContextMatch) {
      const context = await getTaskContext(taskContextMatch[1]);
      if (!context) reply(404, { error: "Not found" });
      else reply(200, context);
      return;
    }

    if (request.method === "GET" && pathname === "/api/context/source") {
      const urlKey = requestUrl.searchParams.get("urlKey") || "";
      if (!urlKey) {
        reply(400, { error: "urlKey is required" });
        return;
      }
      reply(200, await buildContextResponse({ type: "source", urlKey }));
      return;
    }

    if (request.method === "GET" && pathname === "/api/context/search") {
      const { limit } = parseLimitOffset(requestUrl.searchParams, 20, 50);
      reply(200, await buildContextResponse({
        type: "search",
        q: requestUrl.searchParams.get("q") || requestUrl.searchParams.get("query") || "",
        limit
      }));
      return;
    }

    const contextMatch = pathname.match(/^\/api\/context\/(memory|contact|task|workspace)\/([^/]+)$/);
    if (request.method === "GET" && contextMatch) {
      reply(200, await buildContextResponse({ type: contextMatch[1], id: decodeURIComponent(contextMatch[2]) }));
      return;
    }

    if (request.method === "POST" && pathname === "/api/assist/analyze") {
      if (isRateLimited()) {
        reply(429, { error: "Rate limit exceeded" });
        return;
      }
      const body = await readBody(request);
      const result = await analyzeWithModel(body);
      reply(200, await attachPrivacyEvent(result, body, {
        operation: body.mode || "analyze",
        sentToProvider: body.aiMode !== "local_only" && isGeminiConfigured(),
        sentToBackend: true
      }));
      return;
    }

    if (request.method === "POST" && pathname === "/api/memory/save") {
      const body = await readBody(request);
      const validationError = validateMemoryBody(body);
      if (validationError) {
        reply(400, { error: validationError });
        return;
      }
      const normalized = await normalizeMemoryMembershipInput(body);
      if (normalized.error) {
        reply(400, { error: normalized.error });
        return;
      }
      body.workspaceIds = normalized.workspaceIds;
      body.taskIds = normalized.taskIds;
      const result = await createMemoryEntry(body);
      reply(201, { item: result });
      return;
    }

    if (request.method === "POST" && pathname === "/api/contacts/extract") {
      const body = await readBody(request);
      const sentToProvider = body.aiMode !== "local_only" && isGeminiConfigured();
      reply(200, await attachPrivacyEvent(await extractContactsWithModel(body), body, {
        operation: "lead_capture",
        provider: sentToProvider ? "gemini" : "",
        model: sentToProvider ? getGeminiModel() : "",
        sentToProvider,
        sentToBackend: true
      }));
      return;
    }

    if (request.method === "POST" && pathname === "/api/contacts") {
      const body = await readBody(request);
      const result = await createContactEntry(body);
      reply(201, result);
      return;
    }

    if (request.method === "POST" && pathname === "/api/contacts/batch") {
      const body = await readBody(request);
      reply(200, await batchContacts({
        ids: body.ids,
        action: body.action,
        patch: body.patch || {}
      }));
      return;
    }

    if (request.method === "POST" && pathname === "/api/actions/tasks/draft") {
      const body = await readBody(request);
      const sentToProvider = body.aiMode !== "local_only" && isGeminiConfigured();
      reply(200, await attachPrivacyEvent(await taskDraftWithModel(body), body, {
        operation: "task_draft",
        provider: sentToProvider ? "gemini" : "",
        model: sentToProvider ? getGeminiModel() : "",
        sentToProvider,
        sentToBackend: true
      }));
      return;
    }

    if (request.method === "POST" && pathname === "/api/note-workspaces") {
      const body = await readBody(request);
      const result = await createNoteWorkspace(body);
      if (result.error) {
        reply(400, { error: result.error });
        return;
      }
      reply(201, result);
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
      if (result.error) {
        reply(400, { error: result.error });
        return;
      }
      reply(201, result);
      return;
    }

    const patchMemoryMatch = pathname.match(/^\/api\/memory\/([^/]+)$/);
    if (request.method === "PATCH" && patchMemoryMatch) {
      const body = await readBody(request);
      const result = await updateMemoryEntry(patchMemoryMatch[1], body);
      if (result.error) {
        reply(400, { error: result.error });
      } else if (result.notFound) {
        reply(404, { error: "Not found" });
      } else {
        reply(200, result);
      }
      return;
    }

    const patchContactMatch = pathname.match(/^\/api\/contacts\/([^/]+)$/);
    if (request.method === "PATCH" && patchContactMatch) {
      const body = await readBody(request);
      const result = await patchContactEntry(patchContactMatch[1], body);
      if (result.error) {
        reply(400, { error: result.error });
      } else if (result.notFound) {
        reply(404, { error: "Not found" });
      } else {
        reply(200, result);
      }
      return;
    }

    const deleteContactMatch = pathname.match(/^\/api\/contacts\/([^/]+)$/);
    if (request.method === "DELETE" && deleteContactMatch) {
      const deleted = await deleteContact(deleteContactMatch[1]);
      if (deleted === null) reply(404, { error: "Not found" });
      else reply(200, { deleted: true, contact: deleted });
      return;
    }

    if (request.method === "POST" && pathname === "/api/actions/tasks/batch") {
      const body = await readBody(request);
      reply(200, await batchTasks({
        ids: body.ids,
        action: body.action,
        patch: body.patch || {}
      }));
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

    const patchWorkspaceMatch = pathname.match(/^\/api\/note-workspaces\/([^/]+)$/);
    if (request.method === "PATCH" && patchWorkspaceMatch) {
      const body = await readBody(request);
      const result = await patchNoteWorkspace(patchWorkspaceMatch[1], body);
      if (result.error) {
        reply(400, { error: result.error });
      } else if (result.notFound) {
        reply(404, { error: "Not found" });
      } else {
        reply(200, result);
      }
      return;
    }

    const deleteWorkspaceMatch = pathname.match(/^\/api\/note-workspaces\/([^/]+)$/);
    if (request.method === "DELETE" && deleteWorkspaceMatch) {
      const result = await deleteNoteWorkspace(deleteWorkspaceMatch[1]);
      if (result === null) {
        reply(404, { error: "Not found" });
      } else if (result.error) {
        reply(400, { error: result.error });
      } else {
        reply(200, result);
      }
      return;
    }

    const deleteTaskMatch = pathname.match(/^\/api\/actions\/tasks\/([^/]+)$/);
    if (request.method === "DELETE" && deleteTaskMatch) {
      const deleted = await deleteTask(deleteTaskMatch[1]);
      if (deleted === null) reply(404, { error: "Not found" });
      else reply(200, { deleted: true, task: deleted });
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
      if (body.dueDate !== undefined) patch.dueDate = body.dueDate;
      if (body.priority !== undefined) patch.priority = body.priority;
      const updated = await updateTask(id, patch);
      if (updated && updated.error) {
        reply(400, { error: updated.error });
      } else if (updated === null) {
        reply(404, { error: "Not found" });
      } else {
        reply(200, { task: updated });
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

function startServer({ port = PORT, host = HOST } = {}) {
  server.on("error", (error) => {
    console.error("[server] Fatal error:", error.message);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    console.error("[server] Unhandled rejection:", reason);
  });

  return server.listen(port, host, () => {
    console.log(`Assistant backend listening on http://${host}:${port}`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  analyzeWithModel,
  buildPrompt,
  createEmbedding,
  createEmbeddingWithMeta,
  buildContextResponse,
  buildWorkspaceDashboardResponse,
  createMemoryEntry,
  createBackupRestorePoint,
  applyDedupeMerge,
  exportBackup,
  getTaskContext,
  handleSearch,
  importBackup,
  listDedupeCandidates,
  previewDedupeMerge,
  runAction,
  readBody,
  scoreKeywordMatch,
  server,
  startServer,
  createNoteWorkspace,
  patchNoteWorkspace,
  updateMemoryEntry,
  validateBackupEnvelope,
  validateActionBody,
  validateMemoryBody
};
