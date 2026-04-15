"use strict";

// ============================================================
// Analysis utilities (inlined — service workers can't use require/import)
// ============================================================

function normalizeText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function truncateText(text, maxLength = 12000) {
  const s = normalizeText(text);
  return s.length <= maxLength ? s : s.slice(0, maxLength);
}

function splitSentences(text) {
  return normalizeText(text)
    .split(/(?<=[.!?])\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function topSentences(text, count) {
  const sentences = splitSentences(text);
  const scored = sentences.map((sentence, index) => {
    const words = sentence.toLowerCase().match(/[a-z0-9]+/g) || [];
    const unique = new Set(words).size;
    const score = unique + Math.min(sentence.length / 30, 8) - index * 0.15;
    return { sentence, score, index };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .sort((a, b) => a.index - b.index)
    .map((i) => i.sentence);
}

function summarizeText(text) {
  return topSentences(text, 3).join(" ") || "No meaningful text available.";
}

function rewriteText(text, instruction) {
  const sentences = splitSentences(text).slice(0, 6);
  if (!sentences.length) return "No text available to rewrite.";
  const opener = instruction
    ? `Rewrite goal: ${instruction.trim()}.`
    : "Rewrite goal: clearer and shorter.";
  return [
    opener,
    ...sentences.map((s) => `- ${s.replace(/\b(is|are|was|were)\b/gi, "can be")}`)
  ].join("\n");
}

function extractStructuredInfo(text, title, url) {
  const emails = [
    ...new Set(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [])
  ];
  const phones = [
    ...new Set(
      text.match(
        /(?:\+?\d{1,2}\s*)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}/g
      ) || []
    )
  ];
  const dates = [
    ...new Set(
      text.match(
        /\b(?:\d{4}-\d{2}-\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}, \d{4})\b/gi
      ) || []
    )
  ];
  const keyPoints = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && l.length < 80)
    .slice(0, 8);
  return {
    title: title || "Untitled page",
    url: url || "",
    summary: summarizeText(text),
    keyPoints,
    contacts: { emails, phones },
    dates
  };
}

function tokenize(text) {
  return normalizeText(text).toLowerCase().match(/[a-z0-9]{2,}/g) || [];
}

function buildEmbedding(text, dimensions = 48) {
  const vector = new Array(dimensions).fill(0);
  const tokens = tokenize(text);
  if (!tokens.length) return vector;
  for (const token of tokens) {
    let hash = 2166136261;
    for (let i = 0; i < token.length; i++) {
      hash ^= token.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    vector[Math.abs(hash) % dimensions] += 1;
  }
  const mag = Math.sqrt(vector.reduce((s, v) => s + v * v, 0)) || 1;
  return vector.map((v) => Number((v / mag).toFixed(6)));
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

function buildLocalResponse({ mode, content, instruction, title, url }) {
  const text = normalizeText(content);
  if (mode === "rewrite") return { mode, output: rewriteText(text, instruction) };
  if (mode === "extract") return { mode, output: extractStructuredInfo(content, title, url) };
  return { mode: "summarize", output: summarizeText(text) };
}

// ============================================================
// Storage — chrome.storage.local
// ============================================================

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(updates) {
  return new Promise((resolve) => chrome.storage.local.set(updates, resolve));
}

async function loadMemory() {
  const { memory } = await storageGet(["memory"]);
  return Array.isArray(memory) ? memory : [];
}

async function loadActions() {
  const { actions } = await storageGet(["actions"]);
  return actions || { tasks: [], tableRows: [], contacts: [], drafts: [] };
}

async function loadEmbeddings() {
  const { embeddings } = await storageGet(["embeddings"]);
  return embeddings && typeof embeddings === "object" ? embeddings : {};
}

// ============================================================
// Settings
// ============================================================

async function getSettings() {
  return storageGet([
    "llmProvider",
    "geminiApiKey", "openaiApiKey", "anthropicApiKey",
    "geminiModel",  "openaiModel",  "anthropicModel",
    "geminiEmbeddingModel"
  ]);
}

// Returns the active provider name, its API key, and the chosen model.
async function getActiveProvider() {
  const settings = await getSettings();
  const provider = settings.llmProvider || "gemini";
  const keyMap = { gemini: "geminiApiKey", openai: "openaiApiKey", anthropic: "anthropicApiKey" };
  const modelMap = {
    gemini:    settings.geminiModel    || "gemini-2.5-flash",
    openai:    settings.openaiModel    || "gpt-4o",
    anthropic: settings.anthropicModel || "claude-sonnet-4-6"
  };
  return {
    provider,
    apiKey:    settings[keyMap[provider]] || "",
    model:     modelMap[provider],
    settings
  };
}

// ============================================================
// Gemini API
// ============================================================

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

// Used only by Gemini's native structured-output path.
const EXTRACT_RESPONSE_SCHEMA = {
  type: "OBJECT",
  required: ["title", "url", "summary", "keyPoints", "contacts", "dates"],
  properties: {
    title:     { type: "STRING" },
    url:       { type: "STRING" },
    summary:   { type: "STRING" },
    keyPoints: { type: "ARRAY", items: { type: "STRING" } },
    contacts: {
      type: "OBJECT",
      required: ["emails", "phones"],
      properties: {
        emails: { type: "ARRAY", items: { type: "STRING" } },
        phones: { type: "ARRAY", items: { type: "STRING" } }
      }
    },
    dates: { type: "ARRAY", items: { type: "STRING" } }
  }
};

async function geminiRequest(path, apiKey, body) {
  const response = await fetch(`${GEMINI_API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || "Gemini request failed");
  return data;
}

function extractTextFromGemini(data) {
  const parts = data.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => p.text || "").join("").trim();
}

async function geminiGenerateText(prompt, apiKey, model) {
  const data = await geminiRequest(`/models/${model}:generateContent`, apiKey, {
    contents: [{ parts: [{ text: prompt }] }]
  });
  return extractTextFromGemini(data);
}

async function geminiGenerateStructuredJson(prompt, apiKey, model) {
  const data = await geminiRequest(`/models/${model}:generateContent`, apiKey, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: EXTRACT_RESPONSE_SCHEMA
    }
  });
  return extractTextFromGemini(data);
}

async function geminiEmbedText(text, taskType, apiKey) {
  const { geminiEmbeddingModel = "gemini-embedding-001" } = await getSettings();
  const data = await geminiRequest(`/models/${geminiEmbeddingModel}:embedContent`, apiKey, {
    model: `models/${geminiEmbeddingModel}`,
    content: { parts: [{ text }] },
    taskType,
    outputDimensionality: 768
  });
  return Array.isArray(data.embedding?.values) ? data.embedding.values : [];
}

// ============================================================
// OpenAI API
// ============================================================

const OPENAI_API_BASE = "https://api.openai.com/v1";

async function openaiRequest(path, apiKey, body) {
  const response = await fetch(`${OPENAI_API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || "OpenAI request failed");
  return data;
}

async function openaiGenerateText(prompt, apiKey, model) {
  const data = await openaiRequest("/chat/completions", apiKey, {
    model,
    messages: [{ role: "user", content: prompt }]
  });
  return data.choices?.[0]?.message?.content?.trim() || "";
}

async function openaiGenerateStructuredJson(prompt, apiKey, model) {
  const data = await openaiRequest("/chat/completions", apiKey, {
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "You output only valid JSON. Follow the schema in the user message exactly. No markdown, no explanation." },
      { role: "user", content: prompt }
    ]
  });
  return data.choices?.[0]?.message?.content?.trim() || "";
}

async function openaiEmbedText(text, apiKey) {
  const response = await fetch(`${OPENAI_API_BASE}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text, dimensions: 768 })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || "OpenAI embedding failed");
  return Array.isArray(data.data?.[0]?.embedding) ? data.data[0].embedding : [];
}

// ============================================================
// Anthropic API
// ============================================================

const ANTHROPIC_API_BASE = "https://api.anthropic.com/v1";

async function anthropicRequest(apiKey, model, body) {
  const response = await fetch(`${ANTHROPIC_API_BASE}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      // Required for direct browser / service-worker access to the Anthropic API.
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({ model, max_tokens: 4096, ...body })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || "Anthropic request failed");
  return data;
}

function extractTextFromAnthropic(data) {
  return (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

async function anthropicGenerateText(prompt, apiKey, model, systemPrompt) {
  const body = { messages: [{ role: "user", content: prompt }] };
  if (systemPrompt) body.system = systemPrompt;
  const data = await anthropicRequest(apiKey, model, body);
  return extractTextFromAnthropic(data);
}

async function anthropicGenerateStructuredJson(prompt, apiKey, model) {
  const system = "Output only a raw JSON object. No markdown, no code blocks, no explanation.";
  const fullPrompt = prompt + "\n\nReturn only a valid JSON object.";
  const text = await anthropicGenerateText(fullPrompt, apiKey, model, system);
  // Strip accidental markdown fences that some models add despite instructions.
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

// Anthropic has no embedding API — callers fall back to local embeddings.

// ============================================================
// Unified generation — dispatches to the active provider
// ============================================================

async function generateText(prompt) {
  const { provider, apiKey, model } = await getActiveProvider();
  if (!apiKey) throw new Error(`${provider} API key not configured`);
  if (provider === "openai")    return openaiGenerateText(prompt, apiKey, model);
  if (provider === "anthropic") return anthropicGenerateText(prompt, apiKey, model);
  return geminiGenerateText(prompt, apiKey, model);
}

async function generateStructuredJson(prompt) {
  const { provider, apiKey, model } = await getActiveProvider();
  if (!apiKey) throw new Error(`${provider} API key not configured`);
  if (provider === "openai")    return openaiGenerateStructuredJson(prompt, apiKey, model);
  if (provider === "anthropic") return anthropicGenerateStructuredJson(prompt, apiKey, model);
  return geminiGenerateStructuredJson(prompt, apiKey, model);
}

// ============================================================
// Embedding — Gemini or OpenAI when configured; local fallback otherwise
// (Anthropic has no public embedding API.)
// ============================================================

async function createEmbedding(text, taskType) {
  if (!text) return [];
  const { provider, apiKey } = await getActiveProvider();

  if (provider === "gemini" && apiKey) {
    try { return await geminiEmbedText(text, taskType, apiKey); }
    catch (err) { console.warn("[embedding] Gemini failed, using local fallback:", err.message); }
  } else if (provider === "openai" && apiKey) {
    try { return await openaiEmbedText(text, apiKey); }
    catch (err) { console.warn("[embedding] OpenAI failed, using local fallback:", err.message); }
  }

  return buildEmbedding(text);
}

// ============================================================
// Scoring
// ============================================================

function scoreKeywordMatch(query, text) {
  const tokens = normalizeText(query)
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 1);
  if (!tokens.length) return 0;
  const haystack = normalizeText(text).toLowerCase();
  let hits = 0;
  for (const t of tokens) if (haystack.includes(t)) hits++;
  return hits / tokens.length;
}

// ============================================================
// Prompt builder
// ============================================================

// Inline schema description — used by OpenAI/Anthropic which don't accept a
// structured schema object the way Gemini does.
const EXTRACT_SCHEMA_DESCRIPTION = `{
  "title": string,
  "url": string,
  "summary": string,
  "keyPoints": string[],
  "contacts": { "emails": string[], "phones": string[] },
  "dates": string[]
}`;

function buildPrompt({ mode, content, instruction, title, url }) {
  const safeContent = truncateText(content, 12000);
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
      "Return a JSON object matching this schema exactly:",
      EXTRACT_SCHEMA_DESCRIPTION,
      "If a field is unavailable, use an empty string or empty array.",
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

// ============================================================
// Message handlers
// ============================================================

async function handleHealth() {
  const memory  = await loadMemory();
  const actions = await loadActions();
  const { provider, apiKey, model } = await getActiveProvider();

  return {
    ok: true,
    mode: "built-in",
    llm: {
      provider,
      model,
      configured: Boolean(apiKey)
    },
    counts: {
      memory:    memory.length,
      tasks:     (actions.tasks     || []).length,
      tableRows: (actions.tableRows || []).length,
      contacts:  (actions.contacts  || []).length,
      drafts:    (actions.drafts    || []).length
    }
  };
}

async function handleAnalyze({ mode, content, instruction, title, url }) {
  const { provider, apiKey } = await getActiveProvider();

  if (!apiKey) {
    return buildLocalResponse({ mode, content, instruction, title, url });
  }

  const prompt = buildPrompt({ mode, content, instruction, title, url });

  if (mode === "extract") {
    try {
      const jsonText = await generateStructuredJson(prompt);
      return { mode: "extract", output: JSON.parse(jsonText) };
    } catch (err) {
      console.warn(`[analyze] Extract failed (${provider}):`, err.message);
      return buildLocalResponse({ mode, content, instruction, title, url });
    }
  }

  try {
    const text = await generateText(prompt);
    return {
      mode: mode === "rewrite" ? "rewrite" : "summarize",
      output: text || buildLocalResponse({ mode, content, instruction, title, url }).output
    };
  } catch (err) {
    console.warn(`[analyze] Generation failed (${provider}):`, err.message);
    return buildLocalResponse({ mode, content, instruction, title, url });
  }
}

async function handleMemorySave(body) {
  const text = normalizeText(body.note || body.snippet || body.content || "");
  const embedding = await createEmbedding([body.title, text].join(" "), "RETRIEVAL_DOCUMENT");

  const item = {
    id:        `mem_${crypto.randomUUID()}`,
    createdAt: new Date().toISOString(),
    title:     body.title     || "Untitled note",
    sourceUrl: body.sourceUrl || "",
    snippet:   body.snippet   || "",
    note:      body.note      || "",
    tags:      Array.isArray(body.tags) ? body.tags : [],
    summary:   body.summary   || summarizeText(text)
  };

  const memory = await loadMemory();
  memory.unshift(item);
  await storageSet({ memory });

  if (embedding.length) {
    const embeddings = await loadEmbeddings();
    embeddings[item.id] = embedding;
    await storageSet({ embeddings });
  }

  return { item };
}

async function handleMemoryList({ limit = 50, offset = 0 } = {}) {
  const memory = await loadMemory();
  return {
    items:  memory.slice(offset, offset + limit),
    total:  memory.length,
    limit,
    offset
  };
}

async function handleMemoryDelete(id) {
  const memory = await loadMemory();
  const index = memory.findIndex((item) => item.id === id);
  if (index === -1) return { error: "Not found" };
  memory.splice(index, 1);
  await storageSet({ memory });
  const embeddings = await loadEmbeddings();
  delete embeddings[id];
  await storageSet({ embeddings });
  return { deleted: true, id };
}

async function handleMemorySearch({ query, limit = 10 }) {
  const memory = await loadMemory();
  const queryEmbedding = await createEmbedding(query, "RETRIEVAL_QUERY");
  const embeddings = await loadEmbeddings();

  return {
    items: memory
      .map((item) => {
        const baseText = [item.title, item.note, item.snippet, item.sourceUrl]
          .filter(Boolean)
          .join(" ");
        const keywordScore = scoreKeywordMatch(query, baseText);
        const vectorScore  = cosineSimilarity(queryEmbedding, embeddings[item.id] || []);
        const score = Number((keywordScore * 0.45 + vectorScore * 0.55).toFixed(4));
        return {
          ...item,
          keywordScore: Number(keywordScore.toFixed(4)),
          vectorScore:  Number(vectorScore.toFixed(4)),
          score
        };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  };
}

async function handleActionRun({ actionType, payload = {} }) {
  const createdAt = new Date().toISOString();
  const actions   = await loadActions();

  const builders = {
    create_task: () => ({
      kind: "tasks",
      item: {
        id:        `task_${crypto.randomUUID()}`,
        createdAt,
        title:     payload.title  || "Untitled task",
        dueDate:   payload.dueDate || null,
        status:    "open",
        notes:     payload.notes  || ""
      }
    }),
    add_table_row: () => ({
      kind: "tableRows",
      item: {
        id:        `row_${crypto.randomUUID()}`,
        createdAt,
        table:     payload.table  || "default",
        values:    payload.values || {}
      }
    }),
    save_contact: () => ({
      kind: "contacts",
      item: {
        id:        `contact_${crypto.randomUUID()}`,
        createdAt,
        name:      payload.name    || "Unknown",
        email:     payload.email   || "",
        company:   payload.company || "",
        notes:     payload.notes   || ""
      }
    }),
    open_draft: () => ({
      kind: "drafts",
      item: {
        id:        `draft_${crypto.randomUUID()}`,
        createdAt,
        title:     payload.title || "Untitled draft",
        body:      payload.body  || "",
        status:    "open"
      }
    })
  };

  const builder = builders[actionType];
  if (!builder) throw new Error("Unsupported action type");

  const { kind, item } = builder();
  if (!actions[kind]) actions[kind] = [];
  actions[kind].unshift(item);
  await storageSet({ actions });

  return { type: actionType, result: item };
}

async function handleActionState() {
  return { actions: await loadActions() };
}

async function handleTaskUpdate(id, patch) {
  const actions = await loadActions();
  const tasks   = actions.tasks || [];
  const index   = tasks.findIndex((t) => t.id === id);
  if (index === -1) return { error: "Not found" };

  const allowed = ["status", "title", "notes"];
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(patch, key) && patch[key] !== undefined) {
      tasks[index][key] = patch[key];
    }
  }
  actions.tasks = tasks;
  await storageSet({ actions });
  return tasks[index];
}

// ============================================================
// Message router
// ============================================================

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type || message.type === "TOGGLE_ASSISTANT") {
    return false;
  }

  routeMessage(message)
    .then(sendResponse)
    .catch((err) => sendResponse({ error: err.message || "Unknown error" }));

  return true; // keep channel open for async response
});

async function routeMessage(message) {
  switch (message.type) {
    case "HEALTH":         return handleHealth();
    case "ANALYZE":        return handleAnalyze(message);
    case "MEMORY_SAVE":    return handleMemorySave(message);
    case "MEMORY_LIST":    return handleMemoryList(message);
    case "MEMORY_SEARCH":  return handleMemorySearch(message);
    case "MEMORY_DELETE":  return handleMemoryDelete(message.id);
    case "ACTION_RUN":     return handleActionRun(message);
    case "ACTION_STATE":   return handleActionState();
    case "TASK_UPDATE":    return handleTaskUpdate(message.id, message.patch);
    default:               throw new Error(`Unknown message type: ${message.type}`);
  }
}

// ============================================================
// Extension toolbar button — toggle the side panel
// ============================================================

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_ASSISTANT" });
  } catch {
    // Content script not yet injected — inject it then retry.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["styles.css"] });
    await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_ASSISTANT" });
  }
});
