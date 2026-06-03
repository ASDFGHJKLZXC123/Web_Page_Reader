"use strict";

if (typeof importScripts === "function") {
  try {
    importScripts("privacy-utils.js");
  } catch (error) {
    console.warn("[privacy] Unable to load privacy utilities:", error && error.message);
  }
}

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

function buildSummaryObject({ content, title, url, source = {}, engine = "local" } = {}) {
  const text = normalizeText(content);
  return {
    schemaVersion: 1,
    tldr: summarizeText(text),
    keyPoints: topSentences(text, 5),
    importantDetails: topSentences(text, 8).slice(3, 8),
    openQuestions: splitSentences(text).filter((sentence) => sentence.includes("?")).slice(0, 3),
    source: {
      title: title || source.title || "Untitled page",
      url: url || source.url || "",
      sourceType: source.sourceType || "page",
      originalCharCount: Number(source.originalCharCount || text.length),
      submittedCharCount: Number(source.submittedCharCount || text.length)
    },
    engine
  };
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

function sanitizeRewriteText(value, original = "") {
  let text = String(value || "")
    .replace(/^```(?:text)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/^["']|["']$/g, "")
    .trim();
  if (/^(rewrite|rewritten|output|result)\s*:/i.test(text)) {
    text = text.replace(/^(rewrite|rewritten|output|result)\s*:\s*/i, "").trim();
  }
  const leading = String(original || "").match(/^\s*/)[0];
  const trailing = String(original || "").match(/\s*$/)[0];
  return `${leading}${text}${trailing}`;
}

function isSafeLinkUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:" || url.protocol === "tel:";
  } catch {
    return false;
  }
}

function normalizeLinks(links = []) {
  if (!Array.isArray(links)) return [];
  const seen = new Set();
  const out = [];
  for (const link of links) {
    if (!link || typeof link !== "object") continue;
    const url = String(link.url || "").trim();
    if (!url || !isSafeLinkUrl(url) || seen.has(url)) continue;
    seen.add(url);
    out.push({
      text: String(link.text || url).trim().slice(0, 200),
      url,
      type: /^mailto:/i.test(url) ? "email" : (/^tel:/i.test(url) ? "phone" : (link.type || "page")),
      context: String(link.context || "").trim().slice(0, 240)
    });
    if (out.length >= 40) break;
  }
  return out;
}

function normalizeDateItems(dates = [], fallbackDates = []) {
  const source = [
    ...(Array.isArray(fallbackDates) ? fallbackDates : []),
    ...(Array.isArray(dates) ? dates : [])
  ];
  const seen = new Set();
  const out = [];
  for (const item of source) {
    if (!item) continue;
    let next = null;
    if (typeof item === "string") {
      next = {
        text: item,
        isoDate: /^\d{4}-\d{2}-\d{2}$/.test(item) ? item : "",
        context: "",
        type: "mentioned"
      };
    } else if (typeof item === "object") {
      const text = String(item.text || item.date || item.value || "").trim();
      if (!text) continue;
      next = {
        text,
        isoDate: String(item.isoDate || item.iso || "").trim(),
        context: String(item.context || "").trim(),
        type: String(item.type || "mentioned").trim()
      };
    }
    if (!next || seen.has(next.text)) continue;
    seen.add(next.text);
    out.push(next);
    if (out.length >= 30) break;
  }
  return out;
}

function mergeStringArrays(first = [], second = [], maxItems = 40) {
  const seen = new Set();
  const out = [];
  for (const raw of [...(Array.isArray(first) ? first : []), ...(Array.isArray(second) ? second : [])]) {
    const value = String(raw || "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= maxItems) break;
  }
  return out;
}

function sanitizeProvenanceShape(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const counts = source.redactionCounts && typeof source.redactionCounts === "object" ? source.redactionCounts : {};
  const redactionCounts = {};
  for (const key of Object.keys(counts)) {
    const n = Number(counts[key]);
    if (Number.isFinite(n) && n > 0) redactionCounts[key] = n;
  }
  return {
    operation: typeof source.operation === "string" ? source.operation : "",
    effectiveAiMode: typeof source.effectiveAiMode === "string" ? source.effectiveAiMode : "",
    provider: typeof source.provider === "string" ? source.provider : "",
    model: typeof source.model === "string" ? source.model : "",
    sentToProvider: Boolean(source.sentToProvider),
    sentToBackend: Boolean(source.sentToBackend),
    contentSource: typeof source.contentSource === "string" ? source.contentSource : "",
    originalCharCount: Math.max(0, Math.floor(Number(source.originalCharCount) || 0)),
    submittedCharCount: Math.max(0, Math.floor(Number(source.submittedCharCount) || 0)),
    redactionCounts,
    siteRule: typeof source.siteRule === "string" ? source.siteRule : "",
    host: typeof source.host === "string" ? source.host : "",
    storedBuckets: Array.isArray(source.storedBuckets) ? source.storedBuckets.filter((item) => typeof item === "string").slice(0, 20) : [],
    timestamp: typeof source.timestamp === "string" ? source.timestamp : ""
  };
}

const EXTRACT_PROMPT_VERSION = "page-info-v2";

function normalizeConfidence(value, fallback = 0.6) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function normalizeFieldConfidence(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const out = {};
  for (const key of Object.keys(source)) out[key] = normalizeConfidence(source[key], 0);
  return out;
}

function extractionMeta(base = {}, patch = {}) {
  const source = base && typeof base === "object" ? base : {};
  const next = patch && typeof patch === "object" ? patch : {};
  return {
    ...source,
    engine: next.engine || source.engine || "local",
    provider: next.provider || source.provider || "",
    model: next.model || source.model || "",
    promptVersion: next.promptVersion || source.promptVersion || EXTRACT_PROMPT_VERSION,
    fallbackReason: next.fallbackReason || source.fallbackReason || "",
    validationWarnings: Array.isArray(next.validationWarnings)
      ? next.validationWarnings.map(String).slice(0, 20)
      : (Array.isArray(source.validationWarnings) ? source.validationWarnings.map(String).slice(0, 20) : []),
    provenance: sanitizeProvenanceShape(next.provenance && typeof next.provenance === "object"
      ? next.provenance
      : (source.provenance && typeof source.provenance === "object" ? source.provenance : {}))
  };
}

function dateObjectsFromText(text) {
  return [
    ...new Set(
      String(text || "").match(
        /\b(?:\d{4}-\d{2}-\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]* \d{1,2}, \d{4})\b/gi
      ) || []
    )
  ].map((value) => ({
    text: value,
    isoDate: /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "",
    context: "",
    type: "mentioned"
  }));
}

function extractStructuredInfo(text, title, url, pageMeta = {}) {
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
  const keyPoints = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && l.length < 80)
    .slice(0, 8);
  return {
    schemaVersion: 2,
    title: title || "Untitled page",
    url: url || "",
    summary: summarizeText(text),
    keyPoints,
    dates: [
      ...dateObjectsFromText(text),
      ...(Array.isArray(pageMeta.timeDatetimes) ? pageMeta.timeDatetimes : []).map((value) => ({
        text: String(value),
        isoDate: String(value).slice(0, 10),
        context: "time element",
        type: "metadata"
      }))
    ].slice(0, 20),
    contacts: {
      emails,
      phones,
      people: [],
      organizations: Array.isArray(pageMeta.organizations) ? pageMeta.organizations.slice(0, 20) : []
    },
    links: normalizeLinks(pageMeta.links),
    confidence: 0.62,
    fieldConfidence: {
      title: title ? 0.9 : 0.4,
      url: url ? 0.95 : 0,
      contacts: emails.length || phones.length ? 0.85 : 0.35,
      dates: 0.75,
      links: Array.isArray(pageMeta.links) && pageMeta.links.length ? 0.8 : 0.3
    },
    extractionMeta: {
      extractedAt: new Date().toISOString(),
      canonicalUrl: pageMeta.canonicalUrl || "",
      metaDescription: pageMeta.metaDescription || "",
      openGraphDates: Array.isArray(pageMeta.openGraphDates) ? pageMeta.openGraphDates : [],
      timeDatetimes: Array.isArray(pageMeta.timeDatetimes) ? pageMeta.timeDatetimes : [],
      jsonLdTypes: Array.isArray(pageMeta.jsonLdTypes) ? pageMeta.jsonLdTypes : [],
      linkCount: Array.isArray(pageMeta.links) ? pageMeta.links.length : 0,
      engine: "local",
      provider: "",
      model: "",
      promptVersion: EXTRACT_PROMPT_VERSION,
      fallbackReason: "local_fallback",
      validationWarnings: [],
      provenance: {}
    }
  };
}

function normalizeSummaryOutput(value, fallback) {
  if (!value || typeof value !== "object") return fallback;
  return {
    ...fallback,
    ...value,
    schemaVersion: 1,
    keyPoints: Array.isArray(value.keyPoints) ? value.keyPoints.map(String).filter(Boolean).slice(0, 8) : fallback.keyPoints,
    importantDetails: Array.isArray(value.importantDetails) ? value.importantDetails.map(String).filter(Boolean).slice(0, 8) : fallback.importantDetails,
    openQuestions: Array.isArray(value.openQuestions) ? value.openQuestions.map(String).filter(Boolean).slice(0, 8) : fallback.openQuestions,
    source: { ...fallback.source, ...(value.source && typeof value.source === "object" ? value.source : {}) }
  };
}

function normalizeExtractOutput(value, fallback, metaPatch = {}) {
  if (!value || typeof value !== "object") {
    return {
      ...fallback,
      schemaVersion: 2,
      extractionMeta: extractionMeta(fallback && fallback.extractionMeta, {
        ...metaPatch,
        fallbackReason: metaPatch.fallbackReason || "invalid_model_output",
        validationWarnings: ["Model output was not an object."]
      })
    };
  }
  const modelContacts = value.contacts && typeof value.contacts === "object" ? value.contacts : {};
  const fallbackContacts = fallback.contacts || {};
  const warnings = [];
  if (value.links && !Array.isArray(value.links)) warnings.push("links was not an array.");
  if (value.dates && !Array.isArray(value.dates)) warnings.push("dates was not an array.");
  if (value.keyPoints && !Array.isArray(value.keyPoints)) warnings.push("keyPoints was not an array.");
  return {
    ...fallback,
    title: typeof value.title === "string" && value.title.trim() ? value.title.trim().slice(0, 240) : fallback.title,
    url: fallback.url,
    summary: typeof value.summary === "string" && value.summary.trim() ? value.summary.trim().slice(0, 4000) : fallback.summary,
    schemaVersion: 2,
    keyPoints: Array.isArray(value.keyPoints) ? value.keyPoints.map(String).filter(Boolean).slice(0, 12) : fallback.keyPoints,
    dates: normalizeDateItems(value.dates, fallback.dates),
    contacts: {
      ...fallback.contacts,
      emails: mergeStringArrays(fallbackContacts.emails, modelContacts.emails, 40),
      phones: mergeStringArrays(fallbackContacts.phones, modelContacts.phones, 40),
      people: mergeStringArrays(fallbackContacts.people, modelContacts.people, 40),
      organizations: mergeStringArrays(fallbackContacts.organizations, modelContacts.organizations, 40)
    },
    links: normalizeLinks([...(fallback.links || []), ...(Array.isArray(value.links) ? value.links : [])]),
    confidence: normalizeConfidence(value.confidence, fallback.confidence || 0.6),
    fieldConfidence: {
      ...(fallback.fieldConfidence || {}),
      ...normalizeFieldConfidence(value.fieldConfidence)
    },
    extractionMeta: extractionMeta(fallback.extractionMeta, {
      ...metaPatch,
      validationWarnings: [
        ...warnings,
        ...(Array.isArray(metaPatch.validationWarnings) ? metaPatch.validationWarnings : [])
      ]
    })
  };
}

function buildTaskDraft({ content, title, url, sourceTitle, sourceUrl, sourceMemoryIds = [], pageMeta = {}, privacyMeta = {} } = {}, metaPatch = {}) {
  const text = normalizeText(content);
  const dates = dateObjectsFromText(text);
  const draftTitle = title && !/^untitled/i.test(title)
    ? `Follow up: ${title}`.slice(0, 180)
    : "Follow up on current page";
  const notes = [
    summarizeText(text),
    url || sourceUrl ? `Source: ${sourceTitle || title || "Current page"}` : ""
  ].filter(Boolean).join("\n");
  return {
    draft: {
      title: draftTitle,
      notes,
      dueDate: dates[0] && dates[0].isoDate ? dates[0].isoDate : "",
      priority: "none",
      sourceUrl: sourceUrl || url || "",
      sourceTitle: sourceTitle || title || "",
      sourceMemoryIds: Array.isArray(sourceMemoryIds) ? sourceMemoryIds.map(String).filter(Boolean).slice(0, 20) : []
    },
    extractionMeta: extractionMeta({}, {
      engine: "local",
      provider: "",
      model: "",
      promptVersion: "task-draft-v1",
      fallbackReason: "local_fallback",
      provenance: privacyMeta && typeof privacyMeta === "object" ? privacyMeta : {},
      validationWarnings: Array.isArray(pageMeta.validationWarnings) ? pageMeta.validationWarnings : [],
      ...metaPatch
    })
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

function buildLocalResponse({ mode, content, instruction, title, url, pageMeta, source }) {
  const text = normalizeText(content);
  if (mode === "rewrite") return { mode, output: { replacement: sanitizeRewriteText(rewriteText(text, instruction), content), source: "local-fallback" } };
  if (mode === "extract") return { mode, output: extractStructuredInfo(content, title, url, pageMeta) };
  return { mode: "summarize", output: buildSummaryObject({ content: text, title, url, source, engine: "local" }) };
}

const privacyTools = (typeof self !== "undefined" && self.AssistantPrivacy)
  || (typeof globalThis !== "undefined" && globalThis.AssistantPrivacy)
  || (typeof require !== "undefined" ? require("./privacy-utils.js") : null)
  || {};

// ============================================================
// Storage — chrome.storage.local
// ============================================================

const DEFAULT_NOTE_WORKSPACES = [
  { id: "nw_default_job_search", name: "Job Search" },
  { id: "nw_default_startup_ideas", name: "Startup Ideas" },
  { id: "nw_default_research", name: "Research" },
  { id: "nw_default_client_leads", name: "Client Leads" }
];
const LEAD_STATUSES = new Set(["new", "contacted", "qualified", "disqualified", "archived"]);
const TASK_STATUSES = new Set(["open", "in_progress", "done", "archived"]);
const TASK_PRIORITIES = new Set(["none", "low", "medium", "high"]);
const BACKUP_FORMAT = "aaw.backup.v1";
const BACKUP_CONFIRMATION = "REPLACE";
const APP_VERSION = "0.1.0";
const BACKUP_ALLOWED_SETTING_KEYS = new Set([
  "assistantBackendUrl",
  "llmProvider",
  "geminiModel",
  "openaiModel",
  "anthropicModel",
  "geminiEmbeddingModel",
  "geminiApiKey",
  "openaiApiKey",
  "anthropicApiKey"
]);
const BACKUP_SENSITIVE_SETTING_KEYS = new Set(["geminiApiKey", "openaiApiKey", "anthropicApiKey"]);

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(updates) {
  return new Promise((resolve, reject) => chrome.storage.local.set(updates, () => {
    if (chrome.runtime && chrome.runtime.lastError) {
      reject(new Error(chrome.runtime.lastError.message || "Storage write failed"));
      return;
    }
    resolve();
  }));
}

function broadcastMirrorDataChanged(reason, detail = {}) {
  chrome.runtime.sendMessage({
    type: "MIRROR_DATA_CHANGED",
    reason,
    ...detail
  }).catch(() => {});
}

let storageWriteChain = Promise.resolve();
let defaultWorkspaceSeed = null;

function enqueueStorageWrite(fn) {
  const run = storageWriteChain.then(fn, fn);
  storageWriteChain = run.catch(() => {});
  return run;
}

async function loadMemory() {
  const { memory } = await storageGet(["memory"]);
  return Array.isArray(memory) ? memory : [];
}

async function loadNoteWorkspaces() {
  const { noteWorkspaces } = await storageGet(["noteWorkspaces"]);
  return ensureDefaultNoteWorkspaces(Array.isArray(noteWorkspaces) ? noteWorkspaces : []);
}

async function loadActions() {
  const { actions } = await storageGet(["actions"]);
  const source = actions || { tasks: [], tableRows: [], contacts: [], drafts: [] };
  return {
    tasks: Array.isArray(source.tasks) ? source.tasks.map(normalizeTaskItem) : [],
    tableRows: Array.isArray(source.tableRows) ? source.tableRows : [],
    contacts: Array.isArray(source.contacts) ? source.contacts.map(normalizeContactItem) : [],
    drafts: Array.isArray(source.drafts) ? source.drafts : []
  };
}

async function loadEmbeddings() {
  const { embeddings } = await storageGet(["embeddings"]);
  return embeddings && typeof embeddings === "object" ? embeddings : {};
}

async function loadPrivacySettings() {
  const { privacySettings } = await storageGet(["privacySettings"]);
  return privacyTools.normalizePrivacySettings
    ? privacyTools.normalizePrivacySettings(privacySettings)
    : (privacySettings || {});
}

async function patchPrivacySettings(patch) {
  const current = await loadPrivacySettings();
  const settings = privacyTools.mergePrivacySettings
    ? privacyTools.mergePrivacySettings(current, patch)
    : { ...current, ...(patch || {}) };
  await storageSet({ privacySettings: settings });
  return settings;
}

async function appendPrivacyEvent(meta) {
  const { privacyEvents } = await storageGet(["privacyEvents"]);
  const next = [
    privacyTools.sanitizeProvenance ? privacyTools.sanitizeProvenance(meta) : meta,
    ...(Array.isArray(privacyEvents) ? privacyEvents : [])
  ];
  const capped = privacyTools.capPrivacyEvents ? privacyTools.capPrivacyEvents(next) : next.slice(0, 500);
  await storageSet({ privacyEvents: capped });
  return capped[0];
}

async function attachPrivacyEvent(response, message = {}, overrides = {}) {
  if (!message || !message.privacyMeta || !privacyTools.sanitizeProvenance) return response;
  const meta = privacyTools.sanitizeProvenance({
    ...message.privacyMeta,
    operation: overrides.operation || message.mode || message.privacyMeta.operation || "analyze",
    effectiveAiMode: overrides.effectiveAiMode || message.aiMode || message.privacyMeta.effectiveAiMode,
    provider: overrides.provider || "",
    model: overrides.model || "",
    sentToProvider: Boolean(overrides.sentToProvider),
    sentToBackend: Object.prototype.hasOwnProperty.call(overrides, "sentToBackend")
      ? Boolean(overrides.sentToBackend)
      : false
  });
  await appendPrivacyEvent(meta);
  return { ...response, privacyMeta: meta };
}

async function listPrivacyEvents({ limit = 50, offset = 0 } = {}) {
  const { privacyEvents } = await storageGet(["privacyEvents"]);
  const events = Array.isArray(privacyEvents) ? privacyEvents : [];
  return { events: events.slice(offset, offset + limit), total: events.length, limit, offset };
}

async function clearBuiltInData({ buckets = [], before = null } = {}) {
  return enqueueStorageWrite(async () => {
    const current = await storageGet(["memory", "embeddings", "actions", "privacyEvents", "privacySettings"]);
    const actions = current.actions || { tasks: [], tableRows: [], contacts: [], drafts: [] };
    const settings = privacyTools.normalizePrivacySettings
      ? privacyTools.normalizePrivacySettings(current.privacySettings)
      : current.privacySettings;
    const summary = {};
    const updates = {};

    for (const bucket of buckets) {
      if (bucket === "memory") {
        const memory = Array.isArray(current.memory) ? current.memory : [];
        if (before && privacyTools.partitionByRetention) {
          const { kept, removedIds } = privacyTools.partitionByRetention(memory, before, "id");
          updates.memory = kept;
          summary.memory = removedIds.length;
          if (settings && settings.retention && settings.retention.embeddingsPolicy === "with_memory") {
            const embeddings = current.embeddings && typeof current.embeddings === "object" ? { ...current.embeddings } : {};
            for (const id of removedIds) delete embeddings[id];
            updates.embeddings = embeddings;
          }
        } else {
          updates.memory = [];
          summary.memory = memory.length;
          updates.embeddings = {};
        }
      } else if (bucket === "embeddings") {
        updates.embeddings = {};
        summary.embeddings = "cleared";
      } else if (bucket === "privacyEvents") {
        const events = Array.isArray(current.privacyEvents) ? current.privacyEvents : [];
        if (before && privacyTools.partitionByRetention) {
          const { kept, removedIds } = privacyTools.partitionByRetention(events, before, "timestamp");
          updates.privacyEvents = kept;
          summary.privacyEvents = removedIds.length;
        } else {
          updates.privacyEvents = [];
          summary.privacyEvents = events.length;
        }
      } else if (["contacts", "tasks", "drafts", "tableRows"].includes(bucket)) {
        const list = Array.isArray(actions[bucket]) ? actions[bucket] : [];
        if (before && privacyTools.partitionByRetention) {
          const { kept, removedIds } = privacyTools.partitionByRetention(list, before, "id");
          actions[bucket] = kept;
          summary[bucket] = removedIds.length;
        } else {
          actions[bucket] = [];
          summary[bucket] = list.length;
        }
        updates.actions = actions;
      }
    }

    await storageSet(updates);
    if (Object.prototype.hasOwnProperty.call(updates, "memory")) {
      chrome.runtime.sendMessage({ type: "MEMORY_CLEARED" }).catch(() => {});
    }
    if (Object.prototype.hasOwnProperty.call(updates, "actions")) {
      broadcastMirrorDataChanged("retention", { buckets });
    }
    return { cleared: summary, before: before || null };
  });
}

async function runBuiltInRetention(now = Date.now()) {
  const settings = await loadPrivacySettings();
  if (!settings.retention || !settings.retention.enabled) return { ran: false, removed: {} };
  const buckets = [];
  const beforeByBucket = {};
  for (const bucket of ["memory", "contacts", "tasks", "drafts", "tableRows", "privacyEvents"]) {
    const cutoff = privacyTools.retentionCutoff ? privacyTools.retentionCutoff(settings.retention, bucket, now) : null;
    if (cutoff) {
      buckets.push(bucket);
      beforeByBucket[bucket] = cutoff;
    }
  }
  const removed = {};
  for (const bucket of buckets) {
    const result = await clearBuiltInData({ buckets: [bucket], before: beforeByBucket[bucket] });
    removed[bucket] = result.cleared[bucket] || 0;
  }
  return { ran: true, removed };
}

function compactStringArray(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const next = raw.trim();
    if (!next || seen.has(next)) continue;
    seen.add(next);
    out.push(next);
  }
  return out;
}

function normalizeWorkspaceIds(item = {}) {
  // Canonical single-value workspaceId takes precedence over legacy arrays.
  if (typeof item.workspaceId === "string" && item.workspaceId.trim()) return [item.workspaceId.trim()];
  if (Array.isArray(item.workspaceIds)) return compactStringArray(item.workspaceIds);
  return compactStringArray(item.taskIds);
}

// Reduce any legacy multi-workspace membership to a single canonical workspaceId
// ("" means Inbox/Unassigned).
function pickWorkspaceId(item = {}) {
  return normalizeWorkspaceIds(item)[0] || "";
}

function normalizeMemoryItem(item = {}) {
  const workspaceId = pickWorkspaceId(item);
  const workspaceIds = workspaceId ? [workspaceId] : [];
  return {
    ...item,
    tags: compactStringArray(item.tags),
    workspaceId,
    // Legacy compatibility: always [] or [workspaceId].
    workspaceIds,
    taskIds: workspaceIds,
    linkedTaskIds: compactStringArray(item.linkedTaskIds)
  };
}

function normalizeTaskItem(task = {}) {
  const sourceUrl = normalizeSourceUrl(task.sourceUrl);
  const parts = sourceParts(sourceUrl);
  const status = TASK_STATUSES.has(task.status) ? task.status : "open";
  const completedAt = status === "done"
    ? (typeof task.completedAt === "string" ? task.completedAt : "")
    : "";
  // Canonical single workspace assignment ("" means unassigned); falls back to legacy arrays.
  const workspaceId = pickWorkspaceId(task);
  const workspaceIds = workspaceId ? [workspaceId] : [];
  return {
    ...task,
    id: typeof task.id === "string" ? task.id : "",
    createdAt: typeof task.createdAt === "string" ? task.createdAt : "",
    updatedAt: typeof task.updatedAt === "string" ? task.updatedAt : "",
    status,
    title: typeof task.title === "string" && task.title.trim() ? task.title : "Untitled task",
    notes: typeof task.notes === "string" ? task.notes : "",
    dueDate: typeof task.dueDate === "string" ? task.dueDate : "",
    priority: TASK_PRIORITIES.has(task.priority) ? task.priority : "none",
    workspaceId,
    // Legacy compatibility: always [] or [workspaceId].
    workspaceIds,
    taskIds: workspaceIds,
    sourceUrl,
    sourceTitle: typeof task.sourceTitle === "string" ? task.sourceTitle : "",
    sourceHost: typeof task.sourceHost === "string" && task.sourceHost.trim()
      ? task.sourceHost.trim().toLowerCase()
      : parts.sourceHost,
    sourceSnippet: typeof task.sourceSnippet === "string" ? task.sourceSnippet : "",
    sourceMemoryIds: compactStringArray(task.sourceMemoryIds),
    completedAt,
    clientRequestId: typeof task.clientRequestId === "string" ? task.clientRequestId : ""
  };
}

function normalizeSourceUrl(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) {
      url.port = "";
    }
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return "";
  }
}

function sourceParts(sourceUrl) {
  const normalized = normalizeSourceUrl(sourceUrl);
  if (!normalized) {
    return {
      canonicalUrl: "",
      urlKey: "",
      sourceHost: "",
      sourceOrigin: "",
      sourcePath: "",
      sourceHash: ""
    };
  }
  const url = new URL(normalized);
  url.hash = "";
  return {
    canonicalUrl: normalized,
    urlKey: url.toString(),
    sourceHost: url.hostname,
    sourceOrigin: url.origin,
    sourcePath: url.pathname,
    sourceHash: new URL(normalized).hash.replace(/^#/, "")
  };
}

function urlKeyFor(value) {
  return sourceParts(value).urlKey;
}

function contentHashFor(value) {
  const text = String(value || "");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0).toString(16);
}

function buildMemoryItem(input = {}, { id, now } = {}) {
  const { content, ...persistedInput } = input;
  const createdAt = input.createdAt || now || new Date().toISOString();
  const sourceUrl = typeof input.sourceUrl === "string" ? input.sourceUrl : "";
  const parts = sourceParts(sourceUrl);
  const note = typeof input.note === "string" ? input.note : "";
  const snippet = typeof input.snippet === "string" ? input.snippet : "";
  const pageExcerpt = typeof input.pageExcerpt === "string"
    ? input.pageExcerpt
    : (typeof input.content === "string" ? input.content.slice(0, 5000) : "");
  const workspaceIds = normalizeWorkspaceIds(input);

  return normalizeMemoryItem({
    ...persistedInput,
    schemaVersion: input.schemaVersion || 2,
    id: input.id || id || "",
    createdAt,
    updatedAt: input.updatedAt || createdAt,
    title: input.title || "Untitled note",
    sourceUrl,
    ...parts,
    faviconUrl: typeof input.faviconUrl === "string" ? input.faviconUrl : "",
    note,
    snippet,
    pageExcerpt,
    contentHash: input.contentHash || contentHashFor([input.title, sourceUrl, note, snippet, pageExcerpt].join("\n")),
    summary: input.summary || "",
    tags: compactStringArray(input.tags),
    workspaceIds,
    taskIds: workspaceIds,
    linkedTaskIds: compactStringArray(input.linkedTaskIds),
    sourceType: input.sourceType || (snippet ? "selection" : "page"),
    searchDocumentVersion: input.searchDocumentVersion || 1
  });
}

function buildMemorySearchText(item = {}, workspaceNames = []) {
  return [
    item.title,
    item.note,
    item.snippet,
    item.summary,
    item.pageExcerpt,
    item.sourceUrl,
    item.sourceHost,
    ...(Array.isArray(item.tags) ? item.tags : []),
    ...(Array.isArray(workspaceNames) ? workspaceNames : [])
  ]
    .filter(Boolean)
    .join(" ");
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizePhone(value) {
  return String(value || "").trim().replace(/[^\d+]/g, "");
}

function normalizeUrlValue(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    return url.toString();
  } catch {
    return "";
  }
}

function normalizeContactItem(contact = {}) {
  const emails = compactStringArray([contact.email, ...(Array.isArray(contact.emails) ? contact.emails : [])])
    .map(normalizeEmail)
    .filter(Boolean);
  const phones = compactStringArray([contact.phone, ...(Array.isArray(contact.phones) ? contact.phones : [])])
    .map(normalizePhone)
    .filter(Boolean);
  const uniqueEmails = compactStringArray(emails);
  const uniquePhones = compactStringArray(phones);
  const sourceUrl = normalizeUrlValue(contact.sourceUrl);
  let sourceDomain = typeof contact.sourceDomain === "string" ? contact.sourceDomain.trim().toLowerCase() : "";
  if (!sourceDomain && sourceUrl) {
    try { sourceDomain = new URL(sourceUrl).hostname; } catch {}
  }
  const name = typeof contact.name === "string" && contact.name.trim() ? contact.name.trim() : "Unknown contact";
  const nameParts = name.split(/\s+/).filter(Boolean);
  // Canonical single workspace assignment ("" means unassigned); falls back to legacy arrays.
  const workspaceId = pickWorkspaceId(contact);
  const workspaceIds = workspaceId ? [workspaceId] : [];
  return {
    ...contact,
    id: typeof contact.id === "string" ? contact.id : "",
    createdAt: typeof contact.createdAt === "string" ? contact.createdAt : "",
    updatedAt: typeof contact.updatedAt === "string" ? contact.updatedAt : "",
    workspaceId,
    // Legacy compatibility: always [] or [workspaceId].
    workspaceIds,
    taskIds: workspaceIds,
    sourceUrl,
    sourceTitle: typeof contact.sourceTitle === "string" ? contact.sourceTitle : "",
    sourceDomain,
    pageKind: typeof contact.pageKind === "string" ? contact.pageKind : "webpage",
    name,
    firstName: contact.firstName || nameParts[0] || "",
    lastName: contact.lastName || (nameParts.length > 1 ? nameParts.slice(1).join(" ") : ""),
    email: uniqueEmails[0] || "",
    emails: uniqueEmails,
    phone: uniquePhones[0] || "",
    phones: uniquePhones,
    company: typeof contact.company === "string" ? contact.company : "",
    roleTitle: typeof contact.roleTitle === "string" ? contact.roleTitle : "",
    department: typeof contact.department === "string" ? contact.department : "",
    website: normalizeUrlValue(contact.website),
    linkedInUrl: normalizeUrlValue(contact.linkedInUrl),
    location: typeof contact.location === "string" ? contact.location : "",
    address: typeof contact.address === "string" ? contact.address : "",
    socialUrls: compactStringArray(contact.socialUrls).map(normalizeUrlValue).filter(Boolean),
    leadStatus: LEAD_STATUSES.has(contact.leadStatus) ? contact.leadStatus : "new",
    tags: compactStringArray(contact.tags),
    notes: typeof contact.notes === "string" ? contact.notes : "",
    confidence: typeof contact.confidence === "number" ? Math.max(0, Math.min(1, contact.confidence)) : 0.5,
    fieldConfidence: contact.fieldConfidence && typeof contact.fieldConfidence === "object" ? contact.fieldConfidence : {},
    memoryIds: compactStringArray(contact.memoryIds)
  };
}

function contactDedupeKey(contact = {}) {
  const normalized = normalizeContactItem(contact);
  if (normalized.email) return `email:${normalized.email}`;
  if (normalized.linkedInUrl) return `linkedin:${normalized.linkedInUrl}`;
  if (normalized.phone) return `phone:${normalized.phone}`;
  const companyOrDomain = (normalized.company || normalized.sourceDomain).toLowerCase();
  if (normalized.name !== "Unknown contact" && companyOrDomain) return `name:${normalized.name.toLowerCase()}|${companyOrDomain}`;
  return "";
}

function mergeContactItems(existing = {}, incoming = {}, now = new Date().toISOString()) {
  const a = normalizeContactItem(existing);
  const b = normalizeContactItem(incoming);
  const merged = { ...a };
  for (const key of [
    "sourceUrl", "sourceTitle", "sourceDomain", "pageKind", "name", "firstName", "lastName",
    "company", "roleTitle", "department", "website", "linkedInUrl", "location", "address", "notes"
  ]) {
    if ((!merged[key] || merged[key] === "Unknown contact") && b[key]) merged[key] = b[key];
  }
  merged.emails = compactStringArray([...(a.emails || []), ...(b.emails || [])]).map(normalizeEmail).filter(Boolean);
  merged.email = merged.emails[0] || "";
  merged.phones = compactStringArray([...(a.phones || []), ...(b.phones || [])]).map(normalizePhone).filter(Boolean);
  merged.phone = merged.phones[0] || "";
  merged.socialUrls = compactStringArray([...(a.socialUrls || []), ...(b.socialUrls || [])]);
  merged.tags = compactStringArray([...(a.tags || []), ...(b.tags || [])]);
  merged.memoryIds = compactStringArray([...(a.memoryIds || []), ...(b.memoryIds || [])]);
  merged.leadStatus = a.leadStatus || b.leadStatus || "new";
  merged.confidence = Math.max(a.confidence || 0, b.confidence || 0);
  merged.fieldConfidence = { ...(a.fieldConfidence || {}), ...(b.fieldConfidence || {}) };
  merged.updatedAt = now;
  return normalizeContactItem(merged);
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
    links: normalizeLinks(hints.links)
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
    links: normalizeLinks([
      ...(Array.isArray(pageMeta.links) ? pageMeta.links : []),
      ...jsonLdHints.links
    ])
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
  ]).filter((name) => name.length <= 120);
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
      sourceDomain,
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

function createOrMergeContactResult(actions, contact, now = new Date().toISOString()) {
  if (!Array.isArray(actions.contacts)) actions.contacts = [];
  const incoming = normalizeContactItem({
    ...contact,
    id: contact.id || `contact_${crypto.randomUUID()}`,
    createdAt: contact.createdAt || now,
    updatedAt: now
  });
  const incomingKey = contactDedupeKey(incoming);
  const index = incomingKey
    ? actions.contacts.findIndex((item) => contactDedupeKey(item) === incomingKey)
    : -1;

  if (index >= 0) {
    const beforeContact = normalizeContactItem(actions.contacts[index]);
    actions.contacts[index] = mergeContactItems(actions.contacts[index], incoming, now);
    return {
      contact: normalizeContactItem(actions.contacts[index]),
      audit: {
        id: `dedupe_${crypto.randomUUID()}`,
        createdAt: now,
        type: "contact",
        groupId: `contact:auto:${incomingKey}`,
        reason: "automatic contact merge on save",
        planHash: "",
        primaryId: beforeContact.id,
        duplicateIds: [incoming.id],
        before: { contacts: [{ index, record: beforeContact }] },
        undoable: false,
        automatic: true
      }
    };
  }

  actions.contacts.unshift(incoming);
  return { contact: incoming, audit: null };
}

function createOrMergeContact(actions, contact, now = new Date().toISOString()) {
  return createOrMergeContactResult(actions, contact, now).contact;
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function tokenizeSearchQuery(value) {
  return normalizeSearchText(value).match(/[a-z0-9]{2,}/g) || [];
}

function buildMemorySearchFields(item = {}, workspaceNames = []) {
  return [
    { name: "title", weight: 1, text: item.title },
    { name: "note", weight: 0.95, text: item.note },
    { name: "tags", weight: 0.9, text: Array.isArray(item.tags) ? item.tags.join(" ") : "" },
    { name: "workspace", weight: 0.85, text: Array.isArray(workspaceNames) ? workspaceNames.join(" ") : "" },
    { name: "summary", weight: 0.75, text: item.summary },
    { name: "snippet", weight: 0.7, text: item.snippet },
    { name: "sourceHost", weight: 0.6, text: item.sourceHost },
    { name: "sourceUrl", weight: 0.5, text: item.sourceUrl },
    { name: "pageExcerpt", weight: 0.45, text: item.pageExcerpt }
  ];
}

function scoreMemoryKeyword(query, item = {}, workspaceNames = []) {
  const terms = [...new Set(tokenizeSearchQuery(query))];
  if (!terms.length) return { keywordScore: 0, matchedFields: [], matchedTerms: [] };
  const fields = buildMemorySearchFields(item, workspaceNames)
    .map((field) => ({ ...field, normalized: normalizeSearchText(field.text) }))
    .filter((field) => field.normalized);
  const matchedFields = new Set();
  const matchedTerms = new Set();
  let score = 0;

  for (const term of terms) {
    let bestWeight = 0;
    for (const field of fields) {
      if (!field.normalized.includes(term)) continue;
      matchedFields.add(field.name);
      matchedTerms.add(term);
      bestWeight = Math.max(bestWeight, field.weight);
    }
    score += bestWeight;
  }

  return {
    keywordScore: Number((score / terms.length).toFixed(4)),
    matchedFields: Array.from(matchedFields),
    matchedTerms: Array.from(matchedTerms)
  };
}

function normalizeWorkspaceItem(workspace) {
  return {
    ...workspace,
    id: typeof workspace.id === "string" ? workspace.id : "",
    name: typeof workspace.name === "string" ? workspace.name : "",
    status: workspace.status === "archived" ? "archived" : "open"
  };
}

function seedDefaultNoteWorkspaceItems(workspaces, deletedIds = [], now = new Date().toISOString()) {
  const existing = (Array.isArray(workspaces) ? workspaces : []).map(normalizeWorkspaceItem);
  const ids = new Set(existing.map((workspace) => workspace.id).filter(Boolean));
  const names = new Set(existing.map((workspace) => workspace.name.trim().toLowerCase()).filter(Boolean));
  const tombstoned = deletedIds instanceof Set ? deletedIds : new Set(deletedIds || []);
  const missing = [];

  for (const workspace of DEFAULT_NOTE_WORKSPACES) {
    // Do not re-seed a default workspace the user deleted.
    if (ids.has(workspace.id) || names.has(workspace.name.toLowerCase()) || tombstoned.has(workspace.id)) continue;
    missing.push({
      id: workspace.id,
      createdAt: now,
      updatedAt: now,
      name: workspace.name,
      status: "open",
      isDefault: true
    });
  }

  return { items: [...missing, ...existing], added: missing.length };
}

async function ensureDefaultNoteWorkspaces(workspaces) {
  const { deletedWorkspaces } = await storageGet(["deletedWorkspaces"]);
  const deletedIds = (Array.isArray(deletedWorkspaces) ? deletedWorkspaces : []).map((workspace) => workspace.id);
  const seeded = seedDefaultNoteWorkspaceItems(workspaces, deletedIds);
  if (seeded.added === 0) return seeded.items;
  if (!defaultWorkspaceSeed) {
    defaultWorkspaceSeed = storageSet({ noteWorkspaces: seeded.items })
      .then(() => seeded.items)
      .finally(() => {
        defaultWorkspaceSeed = null;
      });
  }
  return defaultWorkspaceSeed;
}

function normalizeWorkspaceName(value) {
  const name = String(value || "").trim();
  if (!name) throw new Error("Workspace name is required");
  if (name.length > 200) throw new Error("Workspace name must be 200 characters or fewer");
  return name;
}

async function normalizeWorkspaceIdsInput(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("workspaceIds must be an array");

  const workspaceIds = [];
  const seen = new Set();
  for (const raw of value) {
    if (typeof raw !== "string") throw new Error("workspaceIds must contain only strings");
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    workspaceIds.push(id);
  }

  if (!workspaceIds.length) return [];
  const workspaces = await loadNoteWorkspaces();
  const knownIds = new Set(workspaces.map((workspace) => workspace.id));
  const unknownId = workspaceIds.find((id) => !knownIds.has(id));
  if (unknownId) throw new Error(`Unknown note workspace ID: ${unknownId}`);
  return workspaceIds;
}

async function normalizeMemoryMembershipInput(body) {
  const value = Object.prototype.hasOwnProperty.call(body, "workspaceIds")
    ? body.workspaceIds
    : body.taskIds;
  return normalizeWorkspaceIdsInput(value);
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
    openai:    settings.openaiModel    || "gpt-5.5",
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
  required: ["schemaVersion", "title", "url", "summary", "keyPoints", "contacts", "dates", "links"],
  properties: {
    schemaVersion: { type: "NUMBER" },
    title:     { type: "STRING" },
    url:       { type: "STRING" },
    summary:   { type: "STRING" },
    keyPoints: { type: "ARRAY", items: { type: "STRING" } },
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
    extractionMeta: { type: "OBJECT" }
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

async function checkActiveProviderHealth() {
  const { provider, apiKey, model } = await getActiveProvider();
  const base = {
    provider,
    model,
    configured: Boolean(apiKey)
  };

  if (!apiKey) {
    return {
      ok: false,
      llm: { ...base, healthy: false },
      message: `${provider} API key is not configured.`
    };
  }

  try {
    const prompt = "Reply with exactly: OK";
    if (provider === "openai") {
      await openaiGenerateText(prompt, apiKey, model);
    } else if (provider === "anthropic") {
      await anthropicGenerateText(prompt, apiKey, model);
    } else {
      await geminiGenerateText(prompt, apiKey, model);
    }
    return {
      ok: true,
      llm: { ...base, healthy: true }
    };
  } catch (err) {
    return {
      ok: false,
      llm: { ...base, healthy: false },
      message: err.message || `${provider} API key check failed.`
    };
  }
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
  if (!text) return { embedding: [], meta: buildEmbeddingMeta("none", "none", []) };
  const { provider, apiKey, settings } = await getActiveProvider();

  if (provider === "gemini" && apiKey) {
    const model = settings.geminiEmbeddingModel || "gemini-embedding-001";
    try {
      const embedding = await geminiEmbedText(text, taskType, apiKey);
      return { embedding, meta: buildEmbeddingMeta("gemini", model, embedding) };
    } catch (err) {
      console.warn("[embedding] Gemini failed, using local fallback:", err.message);
      const embedding = buildEmbedding(text);
      return { embedding, meta: buildEmbeddingMeta("local", "local-hash-v1", embedding, { fallbackReason: "gemini_failed" }) };
    }
  } else if (provider === "openai" && apiKey) {
    try {
      const embedding = await openaiEmbedText(text, apiKey);
      return { embedding, meta: buildEmbeddingMeta("openai", "text-embedding-3-small", embedding) };
    } catch (err) {
      console.warn("[embedding] OpenAI failed, using local fallback:", err.message);
      const embedding = buildEmbedding(text);
      return { embedding, meta: buildEmbeddingMeta("local", "local-hash-v1", embedding, { fallbackReason: "openai_failed" }) };
    }
  }

  const embedding = buildEmbedding(text);
  return { embedding, meta: buildEmbeddingMeta("local", "local-hash-v1", embedding) };
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
  "schemaVersion": 2,
  "title": string,
  "url": string,
  "summary": string,
  "keyPoints": string[],
  "dates": [{ "text": string, "isoDate": string, "context": string, "type": string }],
  "contacts": { "emails": string[], "phones": string[], "people": string[], "organizations": string[] },
  "links": [{ "text": string, "url": string, "type": string, "context": string }],
  "confidence": number,
  "fieldConfidence": object,
  "extractionMeta": object
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
      "Return JSON only matching schemaVersion 2:",
      EXTRACT_SCHEMA_DESCRIPTION,
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

// ============================================================
// Message handlers
// ============================================================

async function handleHealth() {
  const memory  = await loadMemory();
  const noteWorkspaces = await loadNoteWorkspaces();
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
      noteWorkspaces: noteWorkspaces.length,
      tasks:     (actions.tasks     || []).length,
      tableRows: (actions.tableRows || []).length,
      contacts:  (actions.contacts  || []).length,
      drafts:    (actions.drafts    || []).length
    }
  };
}

async function handleLlmHealth() {
  return checkActiveProviderHealth();
}

async function handleAnalyze(message = {}) {
  const { mode, content, instruction, title, url, pageMeta, source } = message;
  const { provider, apiKey, model } = await getActiveProvider();
  const fallback = buildLocalResponse({ mode, content, instruction, title, url, pageMeta, source });
  const attach = (response, sentToProvider) => attachPrivacyEvent(response, message, {
    operation: mode || "analyze",
    provider: sentToProvider ? provider : "",
    model: sentToProvider ? model : "",
    sentToProvider,
    sentToBackend: false
  });

  if (message.aiMode === "local_only") {
    return attach(fallback, false);
  }

  if (!apiKey) {
    return attach(fallback, false);
  }

  const prompt = buildPrompt({ mode, content, instruction, title, url });

  if (mode === "extract") {
    try {
      const jsonText = await generateStructuredJson(prompt);
      return attach({
        mode: "extract",
        output: normalizeExtractOutput(JSON.parse(jsonText), fallback.output, {
          engine: "model_validated",
          provider,
          model,
          promptVersion: "page-info-v2",
          fallbackReason: "",
          provenance: message.privacyMeta || {}
        })
      }, true);
    } catch (err) {
      console.warn(`[analyze] Extract failed (${provider}):`, err.message);
      return attach({
        ...fallback,
        output: normalizeExtractOutput(null, fallback.output, {
          engine: "local",
          provider,
          model,
          fallbackReason: "provider_error",
          validationWarnings: [err.message],
          provenance: message.privacyMeta || {}
        })
      }, true);
    }
  }

  if (mode === "summarize") {
    try {
      const text = await generateText(prompt);
      return attach({ mode: "summarize", output: normalizeSummaryOutput(JSON.parse(text), { ...fallback.output, engine: "llm" }) }, true);
    } catch (err) {
      console.warn(`[analyze] Summary failed (${provider}):`, err.message);
      return attach(fallback, true);
    }
  }

  try {
    const text = await generateText(prompt);
    return attach({
      mode: mode === "rewrite" ? "rewrite" : "summarize",
      output: mode === "rewrite"
        ? { replacement: sanitizeRewriteText(text, content), source: text ? "model" : "local-fallback" }
        : (text || fallback.output)
    }, true);
  } catch (err) {
    console.warn(`[analyze] Generation failed (${provider}):`, err.message);
    return attach(fallback, true);
  }
}

async function handleMemorySave(body) {
  const text = normalizeText(body.note || body.snippet || body.content || "");
  const embeddingRecord = await createEmbeddingWithMeta([body.title, text].join(" "), "RETRIEVAL_DOCUMENT");
  const workspaceIds = await normalizeMemoryMembershipInput(body);
  const item = buildMemoryItem(
    {
      ...body,
      workspaceIds,
      taskIds: workspaceIds,
      summary: body.summary || summarizeText(text)
    },
    { id: `mem_${crypto.randomUUID()}`, now: new Date().toISOString() }
  );

  return enqueueStorageWrite(async () => {
    const memory = await loadMemory();
    memory.unshift(item);
    await storageSet({ memory });

    if (embeddingRecord.embedding.length) {
      const embeddings = await loadEmbeddings();
      embeddings[item.id] = {
        embedding: embeddingRecord.embedding,
        meta: embeddingRecord.meta
      };
      await storageSet({ embeddings });
    }

    // Notify the options page (if open) so it can mirror the entry to disk.
    // Throws when no listener is registered — swallow it.
    chrome.runtime.sendMessage({ type: "MEMORY_SAVED", item }).catch(() => {});

    return { item };
  });
}

async function handleMemoryList({ limit = 50, offset = 0 } = {}) {
  const memory = (await loadMemory()).map(normalizeMemoryItem);
  return {
    items:  memory.slice(offset, offset + limit),
    total:  memory.length,
    limit,
    offset
  };
}

async function handleMemorySource({ urlKey, limit = 50, offset = 0 } = {}) {
  const key = String(urlKey || "");
  if (!key) return { error: "urlKey is required" };
  const memory = (await loadMemory()).map(normalizeMemoryItem);
  const items = memory.filter((item) => (item.urlKey || urlKeyFor(item.sourceUrl || item.canonicalUrl)) === key);
  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
    limit,
    offset
  };
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
  if (!queryMeta || !docRecord || !Array.isArray(docRecord.embedding) || !docRecord.embedding.length) return false;
  const docMeta = docRecord.meta;
  if (!docMeta || docMeta.provider === "legacy" || queryMeta.provider === "legacy") return false;
  return queryMeta.provider === docMeta.provider &&
    queryMeta.model === docMeta.model &&
    queryMeta.dimensions === docMeta.dimensions;
}

function searchMatchType(keywordScore, vectorScore, vectorAvailable) {
  if (vectorAvailable && keywordScore > 0) return "mixed";
  if (vectorAvailable && vectorScore > 0) return "semantic";
  return "keyword";
}

async function handleMemoryDelete(id) {
  return enqueueStorageWrite(async () => {
    const memory = await loadMemory();
    const index = memory.findIndex((item) => item.id === id);
    if (index === -1) return { error: "Not found" };
    memory.splice(index, 1);
    await storageSet({ memory });
    const embeddings = await loadEmbeddings();
    delete embeddings[id];
    await storageSet({ embeddings });
    chrome.runtime.sendMessage({ type: "MEMORY_DELETED", id }).catch(() => {});
    return { deleted: true, id };
  });
}

async function handleMemoryUpdate(id, patch = {}) {
  return enqueueStorageWrite(async () => {
    const memory = await loadMemory();
    const index = memory.findIndex((item) => item.id === id);
    if (index === -1) return { error: "Not found" };

    const next = normalizeMemoryItem(memory[index]);
    if (
      Object.prototype.hasOwnProperty.call(patch, "workspaceIds") ||
      Object.prototype.hasOwnProperty.call(patch, "taskIds")
    ) {
      next.workspaceIds = await normalizeMemoryMembershipInput(patch);
      next.taskIds = next.workspaceIds;
      // Clear stale singular workspaceId so normalizeMemoryItem honors the new arrays.
      next.workspaceId = next.workspaceIds[0] || "";
    }
    if (Object.prototype.hasOwnProperty.call(patch, "note")) {
      next.note = normalizeText(patch.note).slice(0, 10_000);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "tags")) {
      if (!Array.isArray(patch.tags)) return { error: "tags must be an array" };
      next.tags = compactStringArray(patch.tags);
    }
    next.updatedAt = new Date().toISOString();

    memory[index] = normalizeMemoryItem(next);
    await storageSet({ memory });
    chrome.runtime.sendMessage({ type: "MEMORY_UPDATED", item: memory[index] }).catch(() => {});
    return { item: memory[index] };
  });
}

async function handleMemorySearch({ query, limit = 10, offset = 0 }) {
  const memory = (await loadMemory()).map(normalizeMemoryItem);
  const workspaces = await loadNoteWorkspaces();
  const workspaceNameById = new Map(workspaces.map((workspace) => [workspace.id, workspace.name]));
  const queryEmbeddingRecord = await createEmbeddingWithMeta(query, "RETRIEVAL_QUERY");
  const embeddings = await loadEmbeddings();
  let vectorUsed = false;

  const ranked = memory
    .map((item) => {
      const workspaceNames = (item.workspaceIds || item.taskIds || [])
        .map((id) => workspaceNameById.get(id))
        .filter(Boolean);
      const baseText = buildMemorySearchText(item, workspaceNames);
      const keyword = scoreMemoryKeyword(query, item, workspaceNames);
      const keywordScore = keyword.keywordScore || scoreKeywordMatch(query, baseText);
      const docRecord = normalizeEmbeddingRecord(embeddings[item.id]);
      const vectorAvailable = isCompatibleEmbedding(queryEmbeddingRecord.meta, docRecord);
      const vectorScore = vectorAvailable
        ? cosineSimilarity(queryEmbeddingRecord.embedding, docRecord.embedding)
        : 0;
      if (vectorAvailable) vectorUsed = true;
      const score = vectorAvailable
        ? Number((keywordScore * 0.45 + vectorScore * 0.55).toFixed(4))
        : keywordScore;
      return {
        ...item,
        workspaceLabels: workspaceNames,
        matchedFields: keyword.matchedFields,
        matchedTerms: keyword.matchedTerms,
        matchType: searchMatchType(keywordScore, vectorScore, vectorAvailable),
        keywordScore: Number(keywordScore.toFixed(4)),
        vectorScore: Number(vectorScore.toFixed(4)),
        vectorAvailable,
        score
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return {
    items: ranked.slice(offset, offset + limit),
    total: ranked.length,
    limit,
    offset,
    query,
    memoryTotal: memory.length,
    rankingMode: vectorUsed ? "mixed" : "keyword",
    embeddingProvider: queryEmbeddingRecord.meta.provider,
    fallbackReason: vectorUsed ? "" : "no_compatible_embeddings"
  };
}

async function handleNoteWorkspaceList({ status = "open" } = {}) {
  if (status !== "all" && status !== "open" && status !== "archived") {
    return { error: "Invalid workspace status" };
  }

  const workspaces = await loadNoteWorkspaces();
  const memory = (await loadMemory()).map(normalizeMemoryItem);
  const counts = new Map();
  for (const item of memory) {
    for (const id of item.workspaceIds || item.taskIds || []) counts.set(id, (counts.get(id) || 0) + 1);
  }
  const unassignedNoteCount = memory.filter((item) => (item.workspaceIds || item.taskIds || []).length === 0).length;

  return {
    unassignedNoteCount,
    items: workspaces
      .filter((workspace) => status === "all" || workspace.status === status)
      .map((workspace) => ({ ...workspace, noteCount: counts.get(workspace.id) || 0 }))
  };
}

async function handleNoteWorkspaceCreate({ name }) {
  const normalizedName = normalizeWorkspaceName(name);
  const now = new Date().toISOString();
  return enqueueStorageWrite(async () => {
    const workspaces = await loadNoteWorkspaces();
    const duplicate = workspaces.find((item) => item.name.trim().toLowerCase() === normalizedName.toLowerCase());
    if (duplicate) {
      return {
        error: duplicate.status === "archived"
          ? "Workspace already exists as archived; reopen it instead"
          : "Workspace already exists"
      };
    }
    // Reuse the id of a previously deleted workspace with the same name and clear
    // its tombstone, restoring it as an empty open workspace.
    const { deletedWorkspaces } = await storageGet(["deletedWorkspaces"]);
    const deleted = Array.isArray(deletedWorkspaces) ? deletedWorkspaces : [];
    const tombstone = deleted.find((item) => (item.name || "").trim().toLowerCase() === normalizedName.toLowerCase());
    const workspace = {
      id: tombstone && tombstone.id ? tombstone.id : `nw_${crypto.randomUUID()}`,
      createdAt: now,
      updatedAt: now,
      name: normalizedName,
      status: "open"
    };
    workspaces.unshift(workspace);
    const updates = { noteWorkspaces: workspaces };
    if (tombstone) updates.deletedWorkspaces = deleted.filter((item) => item.id !== tombstone.id);
    await storageSet(updates);
    broadcastMirrorDataChanged("workspace", { action: "create", id: workspace.id });
    return { workspace, restored: Boolean(tombstone) };
  });
}

// Destructively delete a workspace and all data assigned to it: memory notes
// (and their embeddings), contacts, tasks, plus cross-links pointing at the
// removed records. The id is tombstoned so deleted defaults are not reseeded.
// Inbox/Unassigned (no real workspace record) cannot be deleted.
async function handleNoteWorkspaceDelete(id) {
  const workspaceId = String(id || "").trim();
  if (!workspaceId || workspaceId === "inbox" || workspaceId === "unassigned") {
    return { error: "Unassigned cannot be deleted" };
  }
  return enqueueStorageWrite(async () => {
    const workspaces = await loadNoteWorkspaces();
    const index = workspaces.findIndex((workspace) => workspace.id === workspaceId);
    if (index === -1) return { error: "Not found" };
    const [removed] = workspaces.splice(index, 1);

    const now = new Date().toISOString();
    const memory = (await loadMemory()).map(normalizeMemoryItem);
    const removedMemoryIds = new Set(memory.filter((item) => item.workspaceId === workspaceId).map((item) => item.id));
    const actions = await loadActions();
    const removedContactIds = new Set((actions.contacts || []).filter((contact) => contact.workspaceId === workspaceId).map((contact) => contact.id));
    const removedTaskIds = new Set((actions.tasks || []).filter((task) => task.workspaceId === workspaceId).map((task) => task.id));

    const nextMemory = memory
      .filter((item) => !removedMemoryIds.has(item.id))
      .map((item) => {
        const next = normalizeMemoryItem(item);
        let touched = false;
        if (removedContactIds.has(next.contactId)) { next.contactId = ""; touched = true; }
        if (Array.isArray(next.contactIds) && next.contactIds.some((cid) => removedContactIds.has(cid))) {
          next.contactIds = next.contactIds.filter((cid) => !removedContactIds.has(cid));
          touched = true;
        }
        const linked = next.linkedTaskIds.filter((tid) => !removedTaskIds.has(tid));
        if (linked.length !== next.linkedTaskIds.length) { next.linkedTaskIds = linked; touched = true; }
        if (!touched) return item;
        next.updatedAt = now;
        return next;
      });

    actions.contacts = (actions.contacts || [])
      .filter((contact) => !removedContactIds.has(contact.id))
      .map((contact) => {
        const memoryIds = (contact.memoryIds || []).filter((mid) => !removedMemoryIds.has(mid));
        if (memoryIds.length === (contact.memoryIds || []).length) return contact;
        return normalizeContactItem({ ...contact, memoryIds, updatedAt: now });
      });
    actions.tasks = (actions.tasks || [])
      .filter((task) => !removedTaskIds.has(task.id))
      .map((task) => {
        const sourceMemoryIds = (task.sourceMemoryIds || []).filter((mid) => !removedMemoryIds.has(mid));
        if (sourceMemoryIds.length === (task.sourceMemoryIds || []).length) return task;
        return normalizeTaskItem({ ...task, sourceMemoryIds, updatedAt: now });
      });

    const embeddings = await loadEmbeddings();
    for (const mid of removedMemoryIds) delete embeddings[mid];

    const { deletedWorkspaces } = await storageGet(["deletedWorkspaces"]);
    const deleted = Array.isArray(deletedWorkspaces) ? deletedWorkspaces : [];
    if (!deleted.some((workspace) => workspace.id === workspaceId)) {
      deleted.unshift({ id: workspaceId, name: removed.name || "" });
    }

    await storageSet({ noteWorkspaces: workspaces, memory: nextMemory, actions, embeddings, deletedWorkspaces: deleted });
    broadcastMirrorDataChanged("workspace", { action: "delete", id: workspaceId });
    return {
      deleted: true,
      workspaceId,
      counts: { notes: removedMemoryIds.size, contacts: removedContactIds.size, tasks: removedTaskIds.size }
    };
  });
}

async function handleNoteWorkspaceUpdate(id, patch = {}) {
  return enqueueStorageWrite(async () => {
    const workspaces = await loadNoteWorkspaces();
    const index = workspaces.findIndex((workspace) => workspace.id === id);
    if (index === -1) return { error: "Not found" };

    const next = { ...workspaces[index] };
    if (Object.prototype.hasOwnProperty.call(patch, "name")) {
      const nextName = normalizeWorkspaceName(patch.name);
      const duplicate = workspaces.find((workspace) =>
        workspace.id !== id &&
        workspace.name.trim().toLowerCase() === nextName.toLowerCase()
      );
      if (duplicate) {
        return {
          error: duplicate.status === "archived"
            ? "Workspace already exists as archived; reopen it instead"
            : "Workspace already exists"
        };
      }
      next.name = nextName;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "status")) {
      if (patch.status !== "open" && patch.status !== "archived") {
        return { error: "Invalid workspace status" };
      }
      next.status = patch.status;
    }
    next.updatedAt = new Date().toISOString();
    workspaces[index] = next;
    await storageSet({ noteWorkspaces: workspaces });
    broadcastMirrorDataChanged("workspace", { action: "update", id });
    return { workspace: next };
  });
}

async function handleNoteWorkspaceNotes({ id, limit = 50, offset = 0 }) {
  const workspaces = await loadNoteWorkspaces();
  if (!workspaces.some((workspace) => workspace.id === id)) return { error: "Not found" };
  const memory = (await loadMemory()).map(normalizeMemoryItem);
  const items = memory.filter((item) => (item.workspaceIds || item.taskIds || []).includes(id));
  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
    limit,
    offset
  };
}

async function handleUnassignedWorkspaceNotes({ limit = 50, offset = 0 } = {}) {
  const memory = (await loadMemory()).map(normalizeMemoryItem);
  const items = memory.filter((item) => (item.workspaceIds || item.taskIds || []).length === 0);
  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
    limit,
    offset
  };
}

function dashboardLimit(value, fallback, max = 50) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 1), max) : fallback;
}

function normalizeDashboardOptions(options = {}) {
  return {
    memoryLimit: dashboardLimit(options.memoryLimit, 12, 50),
    sourceLimit: dashboardLimit(options.sourceLimit, 12, 50),
    contactLimit: dashboardLimit(options.contactLimit, 10, 50),
    taskLimit: dashboardLimit(options.taskLimit, 10, 50),
    activityLimit: dashboardLimit(options.activityLimit, 20, 100),
    taskStatus: options.taskStatus || "all"
  };
}

function dashboardWorkspaceIdsFor(raw = {}) {
  if (Array.isArray(raw.workspaceIds)) return compactStringArray(raw.workspaceIds);
  return compactStringArray(raw.taskIds);
}

function dashboardSourceKey(value) {
  const normalized = normalizeSourceUrl(value);
  return normalized ? sourceParts(normalized).urlKey : "";
}

function dashboardSourceHost(value) {
  const key = dashboardSourceKey(value);
  return key ? sourceParts(key).sourceHost : "";
}

function dashboardRecentSort(a, b) {
  const left = Date.parse(a.updatedAt || a.createdAt || a.completedAt || "") || 0;
  const right = Date.parse(b.updatedAt || b.createdAt || b.completedAt || "") || 0;
  return right - left;
}

function dashboardWarning(warnings, code, message, entityType, entityId, missingId) {
  warnings.push({ code, message, entityType, entityId, missingId });
}

function dashboardSourceBucket(key, item = {}) {
  if (key === "source:missing") {
    return { id: "source:missing", urlKey: "", sourceHost: "", title: "No source URL", memoryIds: [], contactIds: [], taskIds: [], count: 0 };
  }
  return {
    id: `source:${key}`,
    urlKey: key,
    sourceHost: dashboardSourceHost(key),
    title: item.sourceTitle || item.title || dashboardSourceHost(key) || key,
    memoryIds: [],
    contactIds: [],
    taskIds: [],
    count: 0
  };
}

function dashboardActivity(activity, type, item, action, title, workspaceId = "") {
  const field = action === "completed" ? "completedAt" : action === "created" ? "createdAt" : "updatedAt";
  const timestamp = item[field] || "";
  if (!timestamp) return;
  activity.push({ id: `${type}:${item.id}:${action}:${timestamp}`, type, entityId: item.id, action, title, timestamp, workspaceId });
}

function buildWorkspaceDashboardLocal({ memory = [], workspaces = [], actions = {} } = {}, subject = {}, options = {}) {
  const opts = normalizeDashboardOptions(options);
  const normalizedMemory = (Array.isArray(memory) ? memory : []).map((item) => ({
    ...normalizeMemoryItem(item),
    _workspaceIds: dashboardWorkspaceIdsFor(item)
  }));
  const normalizedWorkspaces = (Array.isArray(workspaces) ? workspaces : []).map(normalizeWorkspaceItem);
  const contacts = (Array.isArray(actions.contacts) ? actions.contacts : []).map(normalizeContactItem);
  const tasks = (Array.isArray(actions.tasks) ? actions.tasks : []).map(normalizeTaskItem);
  const workspaceId = subject.type === "unassigned" ? "unassigned" : String(subject.workspaceId || subject.id || "");
  const unassigned = workspaceId === "unassigned";
  const workspace = unassigned
    ? { id: "unassigned", name: "Unassigned", status: "open", unassigned: true }
    : normalizedWorkspaces.find((item) => item.id === workspaceId);
  const warnings = [];
  if (!workspace) {
    return {
      workspace: { id: workspaceId, name: workspaceId || "Unknown workspace", status: "missing", missing: true },
      permissions: { canWrite: false, canArchive: false, canCreateTask: false, canCaptureLead: false, canSaveCurrentPage: false },
      metrics: { notes: 0, sources: 0, contacts: 0, tasks: 0, openTasks: 0, doneTasks: 0, activity: 0, warnings: 1 },
      memory: { items: [], total: 0, limit: opts.memoryLimit },
      sources: [],
      contacts: { items: [], total: 0, limit: opts.contactLimit },
      tasks: { items: [], total: 0, limit: opts.taskLimit },
      activity: [],
      warnings: [{ code: "missing_workspace", message: `Workspace ${workspaceId} was not found.`, entityType: "workspace", entityId: workspaceId }]
    };
  }

  const workspaceMemory = normalizedMemory
    .filter((item) => unassigned ? item._workspaceIds.length === 0 : item._workspaceIds.includes(workspace.id))
    .sort(dashboardRecentSort);
  const memoryIds = new Set(workspaceMemory.map((item) => item.id));
  const memoryById = new Map(normalizedMemory.map((item) => [item.id, item]));
  const sourceKeys = new Set(workspaceMemory.map((item) => dashboardSourceKey(item.sourceUrl || item.canonicalUrl)).filter(Boolean));
  const buckets = new Map();
  for (const item of workspaceMemory) {
    const key = dashboardSourceKey(item.sourceUrl || item.canonicalUrl) || "source:missing";
    if (!buckets.has(key)) buckets.set(key, dashboardSourceBucket(key, item));
    const bucket = buckets.get(key);
    bucket.memoryIds.push(item.id);
    bucket.count = bucket.memoryIds.length;
    if (!bucket.latestAt || Date.parse(item.updatedAt || item.createdAt || "") > Date.parse(bucket.latestAt)) {
      bucket.latestAt = item.updatedAt || item.createdAt || "";
      if (item.title) bucket.title = item.sourceTitle || item.title;
    }
  }

  const workspaceContacts = contacts.filter((contact) => {
    const linked = (contact.memoryIds || []).some((id) => memoryIds.has(id));
    const legacy = workspaceMemory.some((item) => item.contactId === contact.id);
    const key = dashboardSourceKey(contact.sourceUrl);
    return linked || legacy || (key && sourceKeys.has(key));
  }).sort(dashboardRecentSort);
  for (const contact of contacts) {
    for (const memoryId of contact.memoryIds || []) {
      if (!memoryById.has(memoryId)) dashboardWarning(warnings, "missing_memory", `Contact ${contact.id} references missing memory ${memoryId}.`, "contact", contact.id, memoryId);
    }
  }
  for (const contact of workspaceContacts) {
    const key = dashboardSourceKey(contact.sourceUrl);
    if (key && buckets.has(key)) buckets.get(key).contactIds.push(contact.id);
  }

  const linkedTaskIds = new Set();
  for (const item of workspaceMemory) for (const id of item.linkedTaskIds || []) linkedTaskIds.add(id);
  const workspaceTasksAll = tasks.filter((task) => {
    const viaMemory = (task.sourceMemoryIds || []).some((id) => memoryIds.has(id));
    const viaLinked = linkedTaskIds.has(task.id);
    const key = dashboardSourceKey(task.sourceUrl);
    return viaMemory || viaLinked || (key && sourceKeys.has(key));
  }).sort(dashboardRecentSort);
  const workspaceTasks = opts.taskStatus && opts.taskStatus !== "all"
    ? workspaceTasksAll.filter((task) => task.status === opts.taskStatus)
    : workspaceTasksAll;
  for (const task of tasks) {
    for (const memoryId of task.sourceMemoryIds || []) {
      if (!memoryById.has(memoryId)) dashboardWarning(warnings, "missing_memory", `Task ${task.id} references missing memory ${memoryId}.`, "task", task.id, memoryId);
    }
  }
  for (const task of workspaceTasksAll) {
    const key = dashboardSourceKey(task.sourceUrl);
    if (key && buckets.has(key)) buckets.get(key).taskIds.push(task.id);
  }

  const activity = [];
  for (const item of workspaceMemory) {
    dashboardActivity(activity, "memory", item, "created", item.title || "Saved note", workspace.id);
    if (item.updatedAt && item.updatedAt !== item.createdAt) dashboardActivity(activity, "memory", item, "updated", item.title || "Saved note", workspace.id);
  }
  for (const contact of workspaceContacts) {
    dashboardActivity(activity, "contact", contact, "created", contact.name || "Contact", workspace.id);
    if (contact.updatedAt && contact.updatedAt !== contact.createdAt) dashboardActivity(activity, "contact", contact, "updated", contact.name || "Contact", workspace.id);
  }
  for (const task of workspaceTasksAll) {
    dashboardActivity(activity, "task", task, "created", task.title || "Task", workspace.id);
    if (task.updatedAt && task.updatedAt !== task.createdAt) dashboardActivity(activity, "task", task, "updated", task.title || "Task", workspace.id);
    if (task.completedAt) dashboardActivity(activity, "task", task, "completed", task.title || "Task", workspace.id);
  }
  activity.sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0));

  const sources = [...buckets.values()]
    .map((bucket) => ({ ...bucket, contactCount: bucket.contactIds.length, taskCount: bucket.taskIds.length }))
    .sort((a, b) => (Date.parse(b.latestAt || "") || 0) - (Date.parse(a.latestAt || "") || 0));
  const openTasks = workspaceTasksAll.filter((task) => task.status === "open" || task.status === "in_progress").length;
  const doneTasks = workspaceTasksAll.filter((task) => task.status === "done").length;
  const canWrite = !unassigned && workspace.status !== "archived";
  return {
    workspace,
    permissions: { canWrite, canArchive: !unassigned && !workspace.missing, canCreateTask: canWrite, canCaptureLead: canWrite, canSaveCurrentPage: canWrite },
    metrics: { notes: workspaceMemory.length, sources: sources.length, contacts: workspaceContacts.length, tasks: workspaceTasksAll.length, openTasks, doneTasks, activity: activity.length, warnings: warnings.length },
    memory: { items: workspaceMemory.slice(0, opts.memoryLimit), total: workspaceMemory.length, limit: opts.memoryLimit },
    sources: sources.slice(0, opts.sourceLimit),
    contacts: { items: workspaceContacts.slice(0, opts.contactLimit), total: workspaceContacts.length, limit: opts.contactLimit },
    tasks: { items: workspaceTasks.slice(0, opts.taskLimit), total: workspaceTasks.length, allTotal: workspaceTasksAll.length, limit: opts.taskLimit, status: opts.taskStatus },
    activity: activity.slice(0, opts.activityLimit),
    warnings
  };
}

async function handleWorkspaceDashboard(message = {}) {
  return buildWorkspaceDashboardLocal({
    memory: await loadMemory(),
    workspaces: await loadNoteWorkspaces(),
    actions: await loadActions()
  }, { type: "workspace", workspaceId: message.id }, message);
}

async function handleUnassignedWorkspaceDashboard(message = {}) {
  return buildWorkspaceDashboardLocal({
    memory: await loadMemory(),
    workspaces: await loadNoteWorkspaces(),
    actions: await loadActions()
  }, { type: "unassigned" }, message);
}

function dedupeStableHash(value) {
  const stringify = (input) => {
    if (Array.isArray(input)) return `[${input.map(stringify).join(",")}]`;
    if (input && typeof input === "object") return `{${Object.keys(input).sort().map((key) => `${JSON.stringify(key)}:${stringify(input[key])}`).join(",")}}`;
    return JSON.stringify(input);
  };
  const text = stringify(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0).toString(16);
}

function dedupeSafePreview(...values) {
  const text = values.find((value) => typeof value === "string" && value.trim()) || "";
  return text.replace(/\s+/g, " ").trim().slice(0, 280);
}

function dedupeSourceKey(value) {
  return urlKeyFor(value);
}

function dedupeSourcePathKey(value) {
  const key = dedupeSourceKey(value);
  if (!key) return "";
  try {
    const url = new URL(key);
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    const entries = [...url.searchParams.entries()].sort((a, b) => `${a[0]}=${a[1]}`.localeCompare(`${b[0]}=${b[1]}`));
    url.search = "";
    for (const [param, val] of entries) url.searchParams.append(param, val);
    return url.toString();
  } catch {
    return "";
  }
}

function dedupeRecordFingerprint(type, records) {
  return (records || []).map((record) => {
    if (type === "contact") {
      const c = normalizeContactItem(record);
      return {
        id: c.id,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        sourceUrl: c.sourceUrl,
        sourceTitle: c.sourceTitle,
        sourceDomain: c.sourceDomain,
        pageKind: c.pageKind,
        name: c.name,
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
        emails: c.emails,
        phone: c.phone,
        phones: c.phones,
        company: c.company,
        roleTitle: c.roleTitle,
        department: c.department,
        website: c.website,
        linkedInUrl: c.linkedInUrl,
        location: c.location,
        address: c.address,
        socialUrls: c.socialUrls,
        leadStatus: c.leadStatus,
        notes: c.notes,
        confidence: c.confidence,
        fieldConfidence: c.fieldConfidence,
        tags: c.tags,
        memoryIds: c.memoryIds
      };
    }
    if (type === "task") {
      const t = normalizeTaskItem(record);
      return {
        id: t.id,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        status: t.status,
        title: t.title,
        notes: t.notes,
        dueDate: t.dueDate,
        priority: t.priority,
        sourceUrl: t.sourceUrl,
        sourceTitle: t.sourceTitle,
        sourceHost: t.sourceHost,
        sourceSnippet: t.sourceSnippet,
        sourceMemoryIds: t.sourceMemoryIds,
        completedAt: t.completedAt,
        clientRequestId: t.clientRequestId
      };
    }
    if (type === "memory") {
      const m = normalizeMemoryItem(record);
      return {
        id: m.id,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
        title: m.title,
        note: m.note,
        summary: m.summary,
        snippet: m.snippet,
        fingerprint: m.fingerprint,
        contentHash: m.contentHash,
        sourceUrl: m.sourceUrl,
        canonicalUrl: m.canonicalUrl,
        urlKey: m.urlKey,
        sourceHost: m.sourceHost,
        sourceType: m.sourceType,
        tags: m.tags,
        workspaceIds: m.workspaceIds,
        taskIds: m.taskIds,
        linkedTaskIds: m.linkedTaskIds,
        contactId: m.contactId,
        contactIds: compactStringArray(m.contactIds)
      };
    }
    return record;
  });
}

function addDedupeGroup(groups, type, reason, key, item) {
  if (!key || !item || !item.id) return;
  const groupId = `${type}:${dedupeStableHash(key)}:${String(key).slice(0, 80)}`;
  if (!groups.has(groupId)) groups.set(groupId, { groupId, type, reason, key, itemIds: [], records: [] });
  const group = groups.get(groupId);
  if (group.itemIds.includes(item.id)) return;
  group.itemIds.push(item.id);
  group.records.push(item);
}

function buildDedupeCandidatesLocal({ memory = [], actions = {}, ignored = [] } = {}, { type = "all", includeIgnored = false } = {}) {
  const groups = new Map();
  const contacts = (actions.contacts || []).map(normalizeContactItem);
  const tasks = (actions.tasks || []).map(normalizeTaskItem);
  const notes = (memory || []).map(normalizeMemoryItem);
  const ignoredIds = new Set((ignored || []).map((item) => typeof item === "string" ? item : item && item.groupId).filter(Boolean));

  for (const contact of contacts) addDedupeGroup(groups, "contact", "same normalized lead identity", contactDedupeKey(contact), contact);
  for (const task of tasks) {
    const title = normalizeSearchText(task.title).slice(0, 160);
    const source = dedupeSourceKey(task.sourceUrl);
    if (task.clientRequestId) addDedupeGroup(groups, "task", "same client request", `client:${task.clientRequestId}`, task);
    if (title && source) addDedupeGroup(groups, "task", "same title and source", `title-source:${title}|${source}`, task);
    if (title && task.dueDate && source) addDedupeGroup(groups, "task", "same title, due date, and source", `title-due-source:${title}|${task.dueDate}|${source}`, task);
  }
  for (const item of notes) {
    const key = dedupeSourceKey(item.sourceUrl || item.canonicalUrl);
    const note = normalizeSearchText(item.note || item.snippet).slice(0, 160);
    const title = normalizeSearchText(item.title).slice(0, 160);
    if (item.fingerprint) addDedupeGroup(groups, "memory", "same page fingerprint", `fingerprint:${item.fingerprint}`, item);
    if (item.contentHash) addDedupeGroup(groups, "memory", "same content hash", `content:${item.contentHash}`, item);
    if (key && note) addDedupeGroup(groups, "memory", "same source and note", `source-note:${key}|${note}`, item);
    if (key && title) addDedupeGroup(groups, "memory", "same title and source", `title-source:${title}|${key}`, item);
  }

  const sourceRecords = new Map();
  const addSource = (kind, item, title, url) => {
    const key = dedupeSourceKey(url);
    if (!key) return;
    if (!sourceRecords.has(key)) {
      sourceRecords.set(key, {
        id: `source:${dedupeStableHash(key)}`,
        urlKey: key,
        pathKey: dedupeSourcePathKey(key),
        title: title || sourceParts(key).sourceHost,
        hasTitle: Boolean(title),
        recordIds: [],
        sourceHost: sourceParts(key).sourceHost
      });
    }
    sourceRecords.get(key).recordIds.push(`${kind}:${item.id}`);
  };
  for (const item of notes) addSource("memory", item, item.sourceTitle || item.title, item.sourceUrl || item.canonicalUrl);
  for (const contact of contacts) addSource("contact", contact, contact.sourceTitle || contact.name, contact.sourceUrl);
  for (const task of tasks) addSource("task", task, task.sourceTitle || task.title, task.sourceUrl);
  for (const record of sourceRecords.values()) {
    addDedupeGroup(groups, "source", "same normalized source URL", `source:${record.urlKey}`, record);
    if (record.pathKey) addDedupeGroup(groups, "source", "same normalized source host/path", `source-path:${record.pathKey}`, record);
    const title = record.hasTitle ? normalizeSearchText(record.title).slice(0, 160) : "";
    if (title && record.sourceHost) addDedupeGroup(groups, "source", "same source host and title", `source-title:${record.sourceHost}|${title}`, record);
  }

  const consolidated = new Map();
  for (const group of groups.values()) {
    const signature = group.type === "source" ? group.groupId : `${group.type}:${[...group.itemIds].sort().join("|")}`;
    if (!consolidated.has(signature)) {
      consolidated.set(signature, group);
      continue;
    }
    const existing = consolidated.get(signature);
    if (!existing.reason.includes(group.reason)) existing.reason = `${existing.reason}; ${group.reason}`;
  }

  return [...consolidated.values()]
    .filter((group) => group.itemIds.length > 1 || (group.type === "source" && group.records.some((record) => (record.recordIds || []).length > 1)))
    .filter((group) => type === "all" || group.type === type)
    .map((group) => {
      const preview = group.type === "contact" ? group.records.map((contact) => ({ id: contact.id, label: contact.name || contact.company || contact.email || "Contact", summary: dedupeSafePreview([contact.company, contact.roleTitle, contact.email, contact.phone, contact.notes].filter(Boolean).join(" - ")), meta: { email: contact.email, phone: contact.phone, company: contact.company } }))
        : group.type === "task" ? group.records.map((task) => ({ id: task.id, label: task.title || "Task", summary: dedupeSafePreview(task.notes, task.sourceSnippet), meta: { status: task.status, priority: task.priority, dueDate: task.dueDate } }))
        : group.type === "memory" ? group.records.map((item) => ({ id: item.id, label: item.title || "Saved note", summary: dedupeSafePreview(item.note, item.summary, item.snippet), meta: { sourceUrl: item.sourceUrl, sourceType: item.sourceType } }))
        : group.records.map((record) => ({ id: record.id, label: record.title || record.sourceHost || record.urlKey || "Source", summary: dedupeSafePreview(record.title, record.urlKey), meta: { urlKey: record.urlKey, recordCount: record.recordIds.length, recordIds: record.recordIds.slice(0, 8) } }));
      const ignored = ignoredIds.has(group.groupId);
      return { groupId: group.groupId, type: group.type, reason: group.reason, key: group.key, itemIds: [...group.itemIds].sort(), ignored, mergeable: group.type !== "source", preview };
    })
    .filter((group) => includeIgnored || !group.ignored)
    .sort((a, b) => `${a.type}:${a.key}`.localeCompare(`${b.type}:${b.key}`));
}

async function loadDedupeIgnored() {
  const { dedupeIgnored } = await storageGet(["dedupeIgnored"]);
  return Array.isArray(dedupeIgnored) ? dedupeIgnored : [];
}

async function loadDedupeAudit() {
  const { dedupeAudit } = await storageGet(["dedupeAudit"]);
  return Array.isArray(dedupeAudit) ? dedupeAudit : [];
}

async function handleDedupeCandidates(message = {}) {
  return {
    candidates: buildDedupeCandidatesLocal({
      memory: await loadMemory(),
      actions: await loadActions(),
      ignored: await loadDedupeIgnored()
    }, { type: message.typeFilter || message.dedupeType || "all", includeIgnored: Boolean(message.includeIgnored) }),
    ignored: await loadDedupeIgnored()
  };
}

function buildDedupePlanLocal(dataset, input = {}) {
  const requestedType = input.dedupeType || input.typeFilter || input.itemType || input.recordType || "all";
  const candidates = buildDedupeCandidatesLocal(dataset, { includeIgnored: true, type: requestedType });
  const candidate = input.groupId ? candidates.find((item) => item.groupId === input.groupId) : null;
  if (!candidate) return { error: "Duplicate group not found" };
  const ids = [...candidate.itemIds].sort();
  const primaryId = input.primaryId && ids.includes(input.primaryId) ? input.primaryId : ids[0];
  const duplicateIds = ids.filter((id) => id !== primaryId);
  const sourceRecords = candidate.type === "contact" ? (dataset.actions.contacts || []).map(normalizeContactItem)
    : candidate.type === "task" ? (dataset.actions.tasks || []).map(normalizeTaskItem)
    : candidate.type === "memory" ? (dataset.memory || []).map(normalizeMemoryItem)
    : candidate.preview;
  const records = candidate.type === "source"
    ? candidate.preview
    : ids.map((id) => sourceRecords.find((record) => record.id === id)).filter(Boolean);
  const planHash = dedupeStableHash({
    version: 1,
    type: candidate.type,
    groupId: candidate.groupId,
    primaryId,
    duplicateIds,
    records: dedupeRecordFingerprint(candidate.type, records)
  });
  return {
    ...candidate,
    primaryId,
    duplicateIds,
    planHash,
    operations: candidate.type === "source"
      ? [{ action: "ignore_or_review", description: "Source groups are derived; no stored source record will be merged." }]
      : [{ action: "keep", id: primaryId }, ...duplicateIds.map((id) => ({ action: "merge_delete", id })), { action: "rewrite_links" }]
  };
}

async function handleDedupePreview(message = {}) {
  const plan = buildDedupePlanLocal({ memory: await loadMemory(), actions: await loadActions(), ignored: await loadDedupeIgnored() }, message);
  return plan.error ? { error: plan.error } : { plan };
}

function publicDedupeAuditItem(item = {}) {
  const { before, ...safe } = item || {};
  return safe;
}

function snapshotLocal(items, ids) {
  const wanted = new Set(ids);
  return (items || []).map((record, index) => ({ index, record: JSON.parse(JSON.stringify(record)) })).filter((entry) => wanted.has(entry.record.id));
}

function rewriteLocalIds(list, duplicateIds, primaryId) {
  const duplicates = new Set(duplicateIds);
  return compactStringArray((Array.isArray(list) ? list : []).map((id) => duplicates.has(id) ? primaryId : id));
}

async function handleDedupeApply(message = {}) {
  return enqueueStorageWrite(async () => {
    if (!message.planHash) return { error: "planHash is required", statusCode: 400 };
    const actions = await loadActions();
    const memory = (await loadMemory()).map(normalizeMemoryItem);
    const ignored = await loadDedupeIgnored();
    const plan = buildDedupePlanLocal({ memory, actions, ignored }, message);
    if (plan.error) {
      const previous = (await loadDedupeAudit()).find((item) => item.groupId === message.groupId && item.planHash === message.planHash && !item.undoneAt);
      if (previous) return { applied: true, idempotent: true, audit: publicDedupeAuditItem(previous), plan: null };
      return { error: plan.error };
    }
    if (message.planHash !== plan.planHash) return { error: "Stale dedupe plan", statusCode: 409, currentPlanHash: plan.planHash };
    if (plan.type === "source") return { error: "Source groups are derived; ignore or review this group instead." };

    const now = new Date().toISOString();
    const ids = [plan.primaryId, ...plan.duplicateIds];
    const before = {};
    let nextMemory = memory;
    let nextContacts = actions.contacts || [];
    let nextTasks = actions.tasks || [];
    let nextEmbeddings = null;

    if (plan.type === "contact") {
      before.contacts = snapshotLocal(nextContacts, ids);
      before.memory = snapshotLocal(nextMemory, nextMemory
        .filter((item) => ids.includes(item.contactId) || (Array.isArray(item.contactIds) && item.contactIds.some((id) => ids.includes(id))))
        .map((item) => item.id));
      let primary = normalizeContactItem(nextContacts.find((contact) => contact.id === plan.primaryId));
      for (const id of plan.duplicateIds) {
        const duplicate = nextContacts.find((contact) => contact.id === id);
        if (duplicate) primary = mergeContactItems(primary, duplicate, now);
      }
      nextContacts = nextContacts.filter((contact) => !plan.duplicateIds.includes(contact.id)).map((contact) => contact.id === plan.primaryId ? primary : contact);
      nextMemory = nextMemory.map((item) => normalizeMemoryItem({
        ...item,
        contactId: plan.duplicateIds.includes(item.contactId) ? plan.primaryId : item.contactId,
        contactIds: rewriteLocalIds(item.contactIds, plan.duplicateIds, plan.primaryId)
      }));
    }
    if (plan.type === "task") {
      before.tasks = snapshotLocal(nextTasks, ids);
      before.memory = snapshotLocal(nextMemory, nextMemory.filter((item) => (item.linkedTaskIds || []).some((id) => ids.includes(id))).map((item) => item.id));
      const primary = normalizeTaskItem(nextTasks.find((task) => task.id === plan.primaryId));
      for (const id of plan.duplicateIds) {
        const duplicate = normalizeTaskItem(nextTasks.find((task) => task.id === id));
        primary.sourceMemoryIds = compactStringArray([...(primary.sourceMemoryIds || []), ...(duplicate.sourceMemoryIds || [])]);
        if (!primary.notes && duplicate.notes) primary.notes = duplicate.notes;
        if (!primary.dueDate && duplicate.dueDate) primary.dueDate = duplicate.dueDate;
        if (primary.priority === "none" && duplicate.priority !== "none") primary.priority = duplicate.priority;
      }
      primary.updatedAt = now;
      nextTasks = nextTasks.filter((task) => !plan.duplicateIds.includes(task.id)).map((task) => task.id === plan.primaryId ? normalizeTaskItem(primary) : task);
      nextMemory = nextMemory.map((item) => normalizeMemoryItem({ ...item, linkedTaskIds: rewriteLocalIds(item.linkedTaskIds, plan.duplicateIds, plan.primaryId) }));
    }
    if (plan.type === "memory") {
      before.memory = snapshotLocal(nextMemory, ids);
      const embeddings = await loadEmbeddings();
      before.embeddings = {};
      for (const id of plan.duplicateIds) {
        if (embeddings[id]) before.embeddings[id] = embeddings[id];
        delete embeddings[id];
      }
      nextEmbeddings = embeddings;
      before.contacts = snapshotLocal(nextContacts, nextContacts.filter((contact) => (contact.memoryIds || []).some((id) => ids.includes(id))).map((contact) => contact.id));
      before.tasks = snapshotLocal(nextTasks, nextTasks.filter((task) => (task.sourceMemoryIds || []).some((id) => ids.includes(id))).map((task) => task.id));
      const primary = normalizeMemoryItem(nextMemory.find((item) => item.id === plan.primaryId));
      for (const id of plan.duplicateIds) {
        const duplicate = normalizeMemoryItem(nextMemory.find((item) => item.id === id));
        primary.tags = compactStringArray([...(primary.tags || []), ...(duplicate.tags || [])]);
        primary.workspaceIds = compactStringArray([...(primary.workspaceIds || []), ...(duplicate.workspaceIds || duplicate.taskIds || [])]);
        primary.taskIds = primary.workspaceIds;
        primary.linkedTaskIds = compactStringArray([...(primary.linkedTaskIds || []), ...(duplicate.linkedTaskIds || [])]);
        if (!primary.note && duplicate.note) primary.note = duplicate.note;
        if (!primary.summary && duplicate.summary) primary.summary = duplicate.summary;
        if (!primary.snippet && duplicate.snippet) primary.snippet = duplicate.snippet;
        if (!primary.contactId && duplicate.contactId) primary.contactId = duplicate.contactId;
      }
      primary.updatedAt = now;
      nextMemory = nextMemory.filter((item) => !plan.duplicateIds.includes(item.id)).map((item) => item.id === plan.primaryId ? normalizeMemoryItem(primary) : item);
      nextContacts = nextContacts.map((contact) => normalizeContactItem({ ...contact, memoryIds: rewriteLocalIds(contact.memoryIds, plan.duplicateIds, plan.primaryId) }));
      nextTasks = nextTasks.map((task) => normalizeTaskItem({ ...task, sourceMemoryIds: rewriteLocalIds(task.sourceMemoryIds, plan.duplicateIds, plan.primaryId) }));
    }

    actions.contacts = nextContacts;
    actions.tasks = nextTasks;
    const audit = { id: `dedupe_${crypto.randomUUID()}`, createdAt: now, type: plan.type, groupId: plan.groupId, reason: plan.reason, planHash: plan.planHash, primaryId: plan.primaryId, duplicateIds: plan.duplicateIds, before, undoable: true };
    const auditList = [audit, ...(await loadDedupeAudit())].slice(0, 100);
    await storageSet({ actions, memory: nextMemory, dedupeAudit: auditList, ...(nextEmbeddings ? { embeddings: nextEmbeddings } : {}) });
    broadcastMirrorDataChanged("dedupe", { action: "apply", dedupeType: plan.type, id: audit.id });
    return { applied: true, audit: publicDedupeAuditItem(audit), plan };
  });
}

function restoreLocalRecords(current, snapshots) {
  const ids = new Set((snapshots || []).map((entry) => entry.record.id));
  const kept = (current || []).filter((record) => !ids.has(record.id));
  const byIndex = new Map();
  for (const entry of [...(snapshots || [])].sort((a, b) => a.index - b.index)) {
    if (!byIndex.has(entry.index)) byIndex.set(entry.index, []);
    byIndex.get(entry.index).push(entry.record);
  }
  const maxIndex = Math.max(kept.length + byIndex.size - 1, ...byIndex.keys());
  const restored = [];
  let keptIndex = 0;
  for (let index = 0; index <= maxIndex; index++) {
    if (byIndex.has(index)) restored.push(...byIndex.get(index));
    else if (keptIndex < kept.length) restored.push(kept[keptIndex++]);
  }
  return restored.concat(kept.slice(keptIndex));
}

async function handleDedupeUndo({ auditId } = {}) {
  return enqueueStorageWrite(async () => {
    const audit = (await loadDedupeAudit()).find((item) => item.id === auditId);
    if (!audit) return { error: "Audit record not found" };
    if (!audit.undoable) return { error: "Audit record is not undoable" };
    const actions = await loadActions();
    let memory = await loadMemory();
    if (audit.before && audit.before.memory) memory = restoreLocalRecords(memory, audit.before.memory).map(normalizeMemoryItem);
    if (audit.before && audit.before.contacts) actions.contacts = restoreLocalRecords(actions.contacts, audit.before.contacts).map(normalizeContactItem);
    if (audit.before && audit.before.tasks) actions.tasks = restoreLocalRecords(actions.tasks, audit.before.tasks).map(normalizeTaskItem);
    let embeddings = null;
    if (audit.before && audit.before.embeddings) {
      embeddings = await loadEmbeddings();
      Object.assign(embeddings, audit.before.embeddings);
    }
    const auditList = (await loadDedupeAudit()).map((item) => item.id === auditId ? { ...item, undoable: false, undoneAt: new Date().toISOString() } : item);
    await storageSet({ actions, memory, dedupeAudit: auditList, ...(embeddings ? { embeddings } : {}) });
    broadcastMirrorDataChanged("dedupe", { action: "undo", id: auditId });
    return { undone: true, auditId };
  });
}

async function handleDedupeAudit({ limit = 50, offset = 0 } = {}) {
  const audit = await loadDedupeAudit();
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  return { items: audit.slice(safeOffset, safeOffset + safeLimit).map(publicDedupeAuditItem), total: audit.length, limit: safeLimit, offset: safeOffset };
}

async function handleDedupeIgnore(message = {}) {
  return enqueueStorageWrite(async () => {
    const plan = buildDedupePlanLocal({ memory: await loadMemory(), actions: await loadActions(), ignored: await loadDedupeIgnored() }, message);
    const groupId = message.groupId || plan.groupId;
    if (!groupId) return { error: "groupId is required" };
    const ignored = await loadDedupeIgnored();
    if (!ignored.some((item) => item.groupId === groupId)) ignored.unshift({ groupId, type: message.dedupeType || plan.type || "", reason: message.reason || plan.reason || "", ignoredAt: new Date().toISOString() });
    await storageSet({ dedupeIgnored: ignored.slice(0, 500) });
    return { ignored: true, groupId };
  });
}

async function handleDedupeUnignore({ groupId } = {}) {
  return enqueueStorageWrite(async () => {
    if (!groupId) return { error: "groupId is required" };
    await storageSet({ dedupeIgnored: (await loadDedupeIgnored()).filter((item) => item.groupId !== groupId) });
    return { unignored: true, groupId };
  });
}

function backupBool(value, fallback = false) {
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  return fallback;
}

function unsafeBackupKeys(value, pathName = "$", out = []) {
  if (!value || typeof value !== "object") return out;
  for (const key of Object.keys(value)) {
    if (key === "__proto__" || key === "prototype" || key === "constructor") out.push(`${pathName}.${key}`);
    unsafeBackupKeys(value[key], `${pathName}.${key}`, out);
  }
  return out;
}

function backupArray(section, field = "items") {
  return section && Array.isArray(section[field]) ? section[field] : [];
}

function backupClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeBackupActions(section = {}) {
  return {
    tasks: Array.isArray(section.tasks) ? section.tasks.map(normalizeTaskItem) : [],
    contacts: Array.isArray(section.contacts) ? section.contacts.map(normalizeContactItem) : [],
    drafts: Array.isArray(section.drafts) ? section.drafts : [],
    tableRows: Array.isArray(section.tableRows) ? section.tableRows : []
  };
}

function sanitizeBackupSettingsItems(items = {}) {
  const out = {};
  if (!items || typeof items !== "object" || Array.isArray(items)) return out;
  for (const [key, value] of Object.entries(items)) {
    if (!BACKUP_ALLOWED_SETTING_KEYS.has(key) || BACKUP_SENSITIVE_SETTING_KEYS.has(key)) continue;
    out[key] = value;
  }
  return out;
}

function validateBackupEnvelopeLocal(backup = {}) {
  const errors = [];
  const warnings = [];
  if (!backup || typeof backup !== "object" || Array.isArray(backup)) return { valid: false, errors: ["Backup must be an object"], warnings };
  const unsafe = unsafeBackupKeys(backup);
  if (unsafe.length) errors.push(`Backup contains unsafe keys: ${unsafe.slice(0, 5).join(", ")}`);
  if (backup.format !== BACKUP_FORMAT) errors.push(`Unsupported backup format: ${backup.format || "missing"}`);
  const sections = backup.sections || {};
  if (!sections || typeof sections !== "object" || Array.isArray(sections)) errors.push("sections object is required");
  for (const [name, field] of [["memory", "items"], ["noteWorkspaces", "items"], ["embeddings", "items"]]) {
    if (sections[name] && sections[name].version !== 1) errors.push(`sections.${name}.version must be 1`);
    if (sections[name] && !Array.isArray(sections[name][field])) errors.push(`sections.${name}.${field} must be an array`);
  }
  if (sections.actions) {
    if (sections.actions.version !== 1) errors.push("sections.actions.version must be 1");
    for (const key of ["tasks", "contacts", "drafts", "tableRows"]) {
      if (!Array.isArray(sections.actions[key])) errors.push(`sections.actions.${key} must be an array`);
    }
  }
  if (sections.settings) {
    if (sections.settings.version !== 1) errors.push("sections.settings.version must be 1");
    if (sections.settings.items && (typeof sections.settings.items !== "object" || Array.isArray(sections.settings.items))) {
      errors.push("sections.settings.items must be an object");
    }
    for (const key of Object.keys(sections.settings.items || {})) {
      if (!BACKUP_ALLOWED_SETTING_KEYS.has(key)) errors.push(`sections.settings.items.${key} is not allowed`);
    }
  }
  if (sections.privacy && sections.privacy.version !== 1) errors.push("sections.privacy.version must be 1");
  if (sections.dedupe && sections.dedupe.version !== 1) errors.push("sections.dedupe.version must be 1");
  if (sections.dedupe) {
    if (sections.dedupe.ignored && !Array.isArray(sections.dedupe.ignored)) errors.push("sections.dedupe.ignored must be an array");
    if (sections.dedupe.audit && !Array.isArray(sections.dedupe.audit)) errors.push("sections.dedupe.audit must be an array");
  }
  for (const [index, item] of backupArray(sections.embeddings).entries()) {
    if (!item || typeof item.id !== "string" || !Array.isArray(item.embedding) || !item.embedding.every((n) => Number.isFinite(n))) {
      errors.push(`sections.embeddings.items[${index}] must have id and finite embedding`);
    } else if (item.meta && Number.isFinite(Number(item.meta.dimensions)) && Number(item.meta.dimensions) !== item.embedding.length) {
      errors.push(`sections.embeddings.items[${index}] dimensions do not match vector length`);
    }
  }
  if (backup.options && backup.options.includeSensitive) warnings.push("Backup declares sensitive settings.");
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    summary: {
      memory: backupArray(sections.memory).length,
      noteWorkspaces: backupArray(sections.noteWorkspaces).length,
      tasks: sections.actions && Array.isArray(sections.actions.tasks) ? sections.actions.tasks.length : 0,
      contacts: sections.actions && Array.isArray(sections.actions.contacts) ? sections.actions.contacts.length : 0,
      embeddings: backupArray(sections.embeddings).length,
      dedupeIgnored: sections.dedupe && Array.isArray(sections.dedupe.ignored) ? sections.dedupe.ignored.length : 0,
      dedupeAudit: sections.dedupe && Array.isArray(sections.dedupe.audit) ? sections.dedupe.audit.length : 0
    }
  };
}

async function handleBackupExport(message = {}) {
  const includeEmbeddings = backupBool(message.includeEmbeddings, true);
  const includeSettings = backupBool(message.includeSettings, false);
  const includeSensitive = backupBool(message.includeSensitive, false);
  const includeAudit = backupBool(message.includeAudit, false);
  const settings = includeSettings ? await storageGet([
    "assistantBackendUrl",
    "llmProvider",
    "geminiModel",
    "openaiModel",
    "anthropicModel",
    "geminiEmbeddingModel",
    ...(includeSensitive ? ["geminiApiKey", "openaiApiKey", "anthropicApiKey"] : [])
  ]) : {};
  return {
    format: BACKUP_FORMAT,
    exportedAt: new Date().toISOString(),
    app: { name: "AI Assistant Across Websites", version: APP_VERSION },
    source: { mode: "built-in", notesDir: "", extensionVersion: APP_VERSION },
    options: { includeEmbeddings, includeSettings, includeSensitive, includeAudit },
    sections: {
      memory: { version: 1, items: (await loadMemory()).map(normalizeMemoryItem) },
      noteWorkspaces: { version: 1, items: await loadNoteWorkspaces() },
      actions: { version: 1, ...(await loadActions()) },
      embeddings: { version: 1, items: includeEmbeddings ? Object.entries(await loadEmbeddings()).map(([id, record]) => ({ id, embedding: record.embedding || record, meta: record.meta || {} })) : [] },
      settings: { version: 1, items: settings },
      privacy: { version: 1, settings: includeSettings ? await loadPrivacySettings() : {} },
      dedupe: { version: 1, ignored: backupClone(await loadDedupeIgnored()), audit: includeAudit ? backupClone((await loadDedupeAudit()).map(publicDedupeAuditItem)) : [] }
    }
  };
}

async function handleBackupValidate(message = {}) {
  return validateBackupEnvelopeLocal(message.backup || message);
}

async function handleBackupRestorePoint() {
  return enqueueStorageWrite(async () => {
    const backup = await handleBackupExport({ includeEmbeddings: true, includeSettings: true, includeAudit: true });
    const restorePointId = `restore_${crypto.randomUUID()}`;
    const { backupRestorePoints } = await storageGet(["backupRestorePoints"]);
    const points = Array.isArray(backupRestorePoints) ? backupRestorePoints : [];
    points.unshift({ id: restorePointId, createdAt: backup.exportedAt, backup });
    await storageSet({ backupRestorePoints: points.slice(0, 5) });
    return { restorePointId, createdAt: backup.exportedAt };
  });
}

function backupIdMapper(existingIds, prefix) {
  const ids = new Set(existingIds);
  return (id) => {
    if (!ids.has(id)) {
      ids.add(id);
      return id;
    }
    let next;
    do {
      next = `${prefix}_${crypto.randomUUID()}`;
    } while (ids.has(next));
    ids.add(next);
    return next;
  };
}

function remapBackupIds(list, map) {
  return compactStringArray((Array.isArray(list) ? list : []).map((id) => map.get(id) || id));
}

async function handleBackupImport(message = {}) {
  return enqueueStorageWrite(async () => {
    const backup = message.backup;
    const validation = validateBackupEnvelopeLocal(backup);
    if (!validation.valid) return { error: "Invalid backup", validation };
    const sections = backup.sections || {};
    const includeSettings = backupBool(message.includeSettings, true);
    const includeEmbeddings = backupBool(message.includeEmbeddings, true);
    const mode = message.mode || "merge";
    let memory = (await loadMemory()).map(normalizeMemoryItem);
    let noteWorkspaces = await loadNoteWorkspaces();
    let actions = await loadActions();
    let embeddings = await loadEmbeddings();

    if (mode === "replace") {
      if (message.confirmationToken !== BACKUP_CONFIRMATION) return { error: `Type ${BACKUP_CONFIRMATION} to replace data` };
      const { backupRestorePoints } = await storageGet(["backupRestorePoints"]);
      const restorePoints = Array.isArray(backupRestorePoints) ? backupRestorePoints : [];
      if (!restorePoints.some((point) => point.id === message.restorePointId)) return { error: "Valid restore point is required for replace import" };
      memory = backupArray(sections.memory).map(normalizeMemoryItem);
      noteWorkspaces = backupArray(sections.noteWorkspaces);
      actions = normalizeBackupActions(sections.actions || {});
      embeddings = {};
      if (includeEmbeddings) {
        for (const item of backupArray(sections.embeddings)) embeddings[item.id] = { embedding: item.embedding || [], meta: item.meta || {} };
      }
    } else if (mode === "merge") {
      const importedActions = normalizeBackupActions(sections.actions || {});
      const workspaceMap = new Map();
      const memoryMap = new Map();
      const contactMap = new Map();
      const taskMap = new Map();
      const workspaceIdFor = backupIdMapper(noteWorkspaces.map((item) => item.id), "nw_import");
      const memoryIdFor = backupIdMapper(memory.map((item) => item.id), "mem_import");
      const contactIdFor = backupIdMapper(actions.contacts.map((item) => item.id), "contact_import");
      const taskIdFor = backupIdMapper(actions.tasks.map((item) => item.id), "task_import");
      const workspaceNameToId = new Map(noteWorkspaces.map((item) => [String(item.name || "").trim().toLowerCase(), item.id]));
      const contactKeyToId = new Map(actions.contacts.map((item) => [contactDedupeKey(item), item.id]).filter(([key]) => key));
      const taskRequestToId = new Map(actions.tasks.map((item) => [item.clientRequestId, item.id]).filter(([key]) => key));
      const existingMemoryIds = new Set(memory.map((item) => item.id));
      const existingMemoryById = new Map(memory.map((item) => [item.id, item]));
      const importedContactById = new Map();
      const importedTaskById = new Map();

      for (const raw of backupArray(sections.noteWorkspaces)) {
        const workspace = raw && typeof raw === "object" ? { ...raw } : {};
        if (!workspace.id) continue;
        const nameKey = String(workspace.name || "").trim().toLowerCase();
        if (workspaceNameToId.has(nameKey)) {
          workspaceMap.set(workspace.id, workspaceNameToId.get(nameKey));
          continue;
        }
        const nextId = workspaceIdFor(workspace.id);
        workspaceMap.set(workspace.id, nextId);
        noteWorkspaces.unshift({ ...workspace, id: nextId });
      }
      for (const raw of importedActions.contacts) {
        const contact = normalizeContactItem(raw);
        importedContactById.set(contact.id, contact);
        const key = contactDedupeKey(contact);
        if (key && contactKeyToId.has(key)) {
          contactMap.set(contact.id, contactKeyToId.get(key));
          continue;
        }
        const nextId = contactIdFor(contact.id);
        contactMap.set(contact.id, nextId);
        actions.contacts.unshift({ ...contact, id: nextId });
        if (key) contactKeyToId.set(key, nextId);
      }
      for (const raw of importedActions.tasks) {
        const task = normalizeTaskItem(raw);
        importedTaskById.set(task.id, task);
        if (task.clientRequestId && taskRequestToId.has(task.clientRequestId)) {
          taskMap.set(task.id, taskRequestToId.get(task.clientRequestId));
          continue;
        }
        const nextId = taskIdFor(task.id);
        taskMap.set(task.id, nextId);
        actions.tasks.unshift({ ...task, id: nextId });
      }
      for (const raw of backupArray(sections.memory)) {
        const item = normalizeMemoryItem(raw);
        if (!item.id) continue;
        if (existingMemoryIds.has(item.id)) {
          const existing = existingMemoryById.get(item.id);
          if (existing && existing.title === item.title && existing.sourceUrl === item.sourceUrl && existing.note === item.note) {
            memoryMap.set(item.id, item.id);
            continue;
          }
        }
        const nextId = memoryIdFor(item.id);
        memoryMap.set(item.id, nextId);
        existingMemoryIds.add(nextId);
        memory.unshift(normalizeMemoryItem({ ...item, id: nextId, workspaceIds: remapBackupIds(item.workspaceIds || item.taskIds, workspaceMap), taskIds: remapBackupIds(item.workspaceIds || item.taskIds, workspaceMap), linkedTaskIds: remapBackupIds(item.linkedTaskIds, taskMap), contactId: item.contactId ? (contactMap.get(item.contactId) || item.contactId) : "", contactIds: remapBackupIds(item.contactIds, contactMap) }));
      }
      actions.contacts = actions.contacts.map((contact) => normalizeContactItem({
        ...contact,
        memoryIds: compactStringArray([
          ...remapBackupIds(contact.memoryIds, memoryMap),
          ...[...contactMap.entries()]
            .filter(([, mappedId]) => mappedId === contact.id)
            .flatMap(([oldId]) => remapBackupIds((importedContactById.get(oldId) || {}).memoryIds, memoryMap))
        ])
      }));
      actions.tasks = actions.tasks.map((task) => normalizeTaskItem({
        ...task,
        sourceMemoryIds: compactStringArray([
          ...remapBackupIds(task.sourceMemoryIds, memoryMap),
          ...[...taskMap.entries()]
            .filter(([, mappedId]) => mappedId === task.id)
            .flatMap(([oldId]) => remapBackupIds((importedTaskById.get(oldId) || {}).sourceMemoryIds, memoryMap))
        ])
      }));
      actions.drafts = [...importedActions.drafts, ...actions.drafts];
      actions.tableRows = [...importedActions.tableRows, ...actions.tableRows];
      if (includeEmbeddings) {
        for (const item of backupArray(sections.embeddings)) {
          const nextId = memoryMap.get(item.id);
          if (nextId && !embeddings[nextId]) embeddings[nextId] = { embedding: item.embedding || [], meta: item.meta || {} };
        }
      }
    } else {
      return { error: "Import mode must be merge or replace" };
    }

    const updates = { memory, noteWorkspaces, actions, embeddings };
    if (includeSettings) {
      const settings = sanitizeBackupSettingsItems(sections.settings && sections.settings.items);
      Object.assign(updates, settings);
      if (sections.privacy && sections.privacy.settings) {
        updates.privacySettings = mode === "replace"
          ? sections.privacy.settings
          : (privacyTools.mergePrivacySettings ? privacyTools.mergePrivacySettings(await loadPrivacySettings(), sections.privacy.settings) : sections.privacy.settings);
      }
    }
    if (mode === "replace" && !includeSettings) {
      updates.privacySettings = privacyTools.defaultPrivacySettings ? privacyTools.defaultPrivacySettings() : {};
    }
    if (sections.dedupe && Array.isArray(sections.dedupe.ignored)) {
      updates.dedupeIgnored = mode === "replace" ? sections.dedupe.ignored : [...sections.dedupe.ignored, ...(await loadDedupeIgnored())].slice(0, 500);
    } else if (mode === "replace") {
      updates.dedupeIgnored = [];
    }
    if (mode === "replace" && sections.dedupe && Array.isArray(sections.dedupe.audit)) updates.dedupeAudit = sections.dedupe.audit;
    else if (mode === "replace") updates.dedupeAudit = [];
    await storageSet(updates);
    chrome.runtime.sendMessage({ type: "BACKUP_IMPORTED", mode }).catch(() => {});
    return { imported: true, mode, summary: validateBackupEnvelopeLocal(await handleBackupExport({ includeEmbeddings, includeSettings: true })).summary };
  });
}

function createLinkedTaskState(actions, memory, payload = {}, now = new Date().toISOString()) {
  if (!Array.isArray(actions.tasks)) actions.tasks = [];
  const normalizedMemory = (Array.isArray(memory) ? memory : []).map(normalizeMemoryItem);
  const memoryById = new Map(normalizedMemory.map((item) => [item.id, item]));
  const sourceMemoryIds = compactStringArray(payload.sourceMemoryIds || payload.memoryIds);
  const missingId = sourceMemoryIds.find((id) => !memoryById.has(id));
  if (missingId) return { error: `Unknown memory ID: ${missingId}` };
  if (payload.status && !TASK_STATUSES.has(payload.status)) return { error: "Invalid task status" };
  if (payload.priority && !TASK_PRIORITIES.has(payload.priority)) return { error: "Invalid task priority" };

  const clientRequestId = typeof payload.clientRequestId === "string" ? payload.clientRequestId.trim() : "";
  if (clientRequestId) {
    const duplicate = actions.tasks.find((task) => task.clientRequestId === clientRequestId);
    if (duplicate) {
      return {
        task: normalizeTaskItem(duplicate),
        memory,
        linkedMemoryItems: sourceMemoryIds.map((id) => memoryById.get(id)).filter(Boolean),
        duplicate: true,
        changed: false
      };
    }
  }

  const firstMemory = sourceMemoryIds.length ? memoryById.get(sourceMemoryIds[0]) : null;
  const task = normalizeTaskItem({
    ...payload,
    id: payload.id || `task_${crypto.randomUUID()}`,
    createdAt: payload.createdAt || now,
    updatedAt: now,
    status: payload.status || "open",
    priority: payload.priority || "none",
    sourceMemoryIds,
    sourceUrl: payload.sourceUrl || (firstMemory && firstMemory.sourceUrl) || "",
    sourceTitle: payload.sourceTitle || (firstMemory && firstMemory.title) || "",
    sourceSnippet: payload.sourceSnippet || (firstMemory && (firstMemory.snippet || firstMemory.note || firstMemory.pageExcerpt)) || "",
    completedAt: payload.status === "done" ? (payload.completedAt || now) : "",
    clientRequestId
  });

  actions.tasks.unshift(task);
  const linkedMemoryItems = [];
  const linkedIds = new Set(sourceMemoryIds);
  const nextMemory = normalizedMemory.map((item) => {
    if (!linkedIds.has(item.id)) return item;
    const next = normalizeMemoryItem({
      ...item,
      linkedTaskIds: compactStringArray([...(item.linkedTaskIds || []), task.id]),
      updatedAt: now
    });
    linkedMemoryItems.push(next);
    return next;
  });

  return { task, memory: nextMemory, linkedMemoryItems, duplicate: false, changed: true };
}

async function handleActionRun({ actionType, payload = {} }) {
  const createdAt = new Date().toISOString();

  if (actionType === "create_task") {
    return enqueueStorageWrite(async () => {
      const actions = await loadActions();
      const memory = await loadMemory();
      const created = createLinkedTaskState(actions, memory, {
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
      if (created.error) return { error: created.error };
      if (created.changed) {
        await storageSet({ actions, memory: created.memory });
        for (const item of created.linkedMemoryItems || []) {
          chrome.runtime.sendMessage({ type: "MEMORY_UPDATED", item }).catch(() => {});
        }
        broadcastMirrorDataChanged("task", { action: "create", id: created.task.id });
      }
      return {
        type: actionType,
        result: created.task,
        linkedMemoryItems: created.linkedMemoryItems || [],
        duplicate: Boolean(created.duplicate)
      };
    });
  }

  if (actionType === "save_contact") {
    return enqueueStorageWrite(async () => {
      const actions = await loadActions();
      const saved = createOrMergeContactResult(actions, {
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
      const updates = { actions };
      if (saved.audit) updates.dedupeAudit = [saved.audit, ...(await loadDedupeAudit())].slice(0, 100);
      await storageSet(updates);
      broadcastMirrorDataChanged("contact", { action: saved.audit ? "merge" : "create", id: saved.contact.id });
      return { type: actionType, result: saved.contact };
    });
  }

  const builders = {
    add_table_row: () => ({
      kind: "tableRows",
      item: {
        id:        `row_${crypto.randomUUID()}`,
        createdAt,
        table:     payload.table  || "default",
        values:    payload.values || {}
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

  return enqueueStorageWrite(async () => {
    const actions = await loadActions();
    const { kind, item } = builder();
    if (!actions[kind]) actions[kind] = [];
    actions[kind].unshift(item);
    await storageSet({ actions });

    return { type: actionType, result: item };
  });
}

async function handleActionState() {
  return { actions: await loadActions() };
}

async function handleContactExtract(message) {
  const fallback = extractContactDrafts(message);
  const { provider, apiKey, model } = await getActiveProvider();
  let result = fallback;
  let sentToProvider = false;
  if (message.aiMode !== "local_only" && apiKey) {
    sentToProvider = true;
    try {
      const prompt = [
        "Extract lead/contact records from this webpage content.",
        "Return JSON only with shape {\"contacts\":[],\"extractionMeta\":{}}.",
        "Each contact may include name, company, email, phone, roleTitle, website, linkedInUrl, notes, confidence, and fieldConfidence.",
        `Title: ${message.sourceTitle || message.title || ""}`,
        `URL: ${message.sourceUrl || message.url || ""}`,
        "",
        truncateText(message.content || "", 12000)
      ].join("\n");
      const parsed = JSON.parse(await generateText(prompt));
      if (!parsed || !Array.isArray(parsed.contacts)) {
        throw new Error("Model lead_capture response did not include contacts array.");
      }
      const modelContacts = parsed.contacts;
      result = {
        contacts: fallback.contacts.map((contact, index) => normalizeContactItem({
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
        })),
        extractionMeta: {
          ...fallback.extractionMeta,
          engine: "model_validated",
          provider,
          model,
          fallbackReason: "",
          validationWarnings: [],
          provenance: sanitizeProvenanceShape(message.privacyMeta)
        }
      };
    } catch (error) {
      result = {
        ...fallback,
        extractionMeta: {
          ...fallback.extractionMeta,
          provider,
          model,
          fallbackReason: "provider_error",
          validationWarnings: [error.message],
          provenance: sanitizeProvenanceShape(message.privacyMeta)
        }
      };
    }
  }
  return attachPrivacyEvent(result, message, {
    operation: "lead_capture",
    provider: sentToProvider ? provider : "",
    model: sentToProvider ? model : "",
    sentToProvider,
    sentToBackend: false
  });
}

async function handleTaskDraft(message) {
  const fallback = buildTaskDraft(message);
  const { provider, apiKey, model } = await getActiveProvider();
  let result = fallback;
  let sentToProvider = false;
  if (message.aiMode !== "local_only" && apiKey) {
    sentToProvider = true;
    try {
      const prompt = [
        "Draft one follow-up task from this webpage.",
        "Return JSON only with shape {\"draft\":{\"title\":\"\",\"notes\":\"\",\"dueDate\":\"\",\"priority\":\"none\",\"sourceUrl\":\"\",\"sourceTitle\":\"\",\"sourceMemoryIds\":[]},\"extractionMeta\":{}}.",
        "Priority must be one of none, low, medium, high.",
        `Title: ${message.sourceTitle || message.title || ""}`,
        `URL: ${message.sourceUrl || message.url || ""}`,
        "",
        truncateText(message.content || "", 12000)
      ].join("\n");
      const parsed = JSON.parse(await generateText(prompt));
      const draft = parsed && parsed.draft && typeof parsed.draft === "object" ? parsed.draft : {};
      if (!parsed || !parsed.draft || typeof parsed.draft !== "object") {
        throw new Error("Model task_draft response did not include draft object.");
      }
      const allowedPriority = new Set(["none", "low", "medium", "high"]);
      result = {
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
          provider,
          model,
          fallbackReason: "",
          validationWarnings: [],
          provenance: sanitizeProvenanceShape(message.privacyMeta)
        }
      };
    } catch (error) {
      result = {
        ...fallback,
        extractionMeta: {
          ...fallback.extractionMeta,
          provider,
          model,
          fallbackReason: "provider_error",
          validationWarnings: [error.message],
          provenance: sanitizeProvenanceShape(message.privacyMeta)
        }
      };
    }
  }
  return attachPrivacyEvent(result, message, {
    operation: "task_draft",
    provider: sentToProvider ? provider : "",
    model: sentToProvider ? model : "",
    sentToProvider,
    sentToBackend: false
  });
}

function normalizeFilterList(value) {
  if (Array.isArray(value)) return compactStringArray(value);
  return compactStringArray(String(value || "").split(","));
}

function normalizeListWindow(limit, offset) {
  return {
    limit: Math.min(Math.max(Number(limit) || 50, 1), 200),
    offset: Math.max(Number(offset) || 0, 0)
  };
}

function pageMeta(total, limit, offset, pageCount) {
  return {
    count: pageCount,
    total,
    limit,
    offset,
    hasNext: offset + pageCount < total,
    hasPrevious: offset > 0
  };
}

function countBy(items, fn) {
  const out = {};
  for (const item of items) {
    const key = fn(item);
    if (!key) continue;
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function compareValues(a, b) {
  if (a === b) return 0;
  if (a === undefined || a === null || a === "") return 1;
  if (b === undefined || b === null || b === "") return -1;
  return String(a).localeCompare(String(b));
}

function normalizeSort(field, dir, allowed, fallback) {
  const sortField = allowed.includes(field) ? field : fallback;
  return { field: sortField, dir: String(dir || "desc").toLowerCase() === "asc" ? "asc" : "desc" };
}

function normalizeContactSort(field, dir) {
  return normalizeSort(field, dir, ["updatedAt", "createdAt", "name", "company", "leadStatus", "source"], "updatedAt");
}

function normalizeTaskSort(field, dir) {
  return normalizeSort(field, dir, ["updatedAt", "createdAt", "dueDate", "priority", "status", "title", "source"], "updatedAt");
}

function contactSearchText(contact = {}) {
  return [
    contact.name,
    contact.company,
    contact.roleTitle,
    contact.email,
    contact.phone,
    ...(Array.isArray(contact.emails) ? contact.emails : []),
    ...(Array.isArray(contact.phones) ? contact.phones : []),
    contact.sourceDomain,
    contact.sourceUrl,
    contact.notes,
    ...(Array.isArray(contact.tags) ? contact.tags : [])
  ].filter(Boolean).join(" ").toLowerCase();
}

function taskSearchText(task = {}) {
  return [
    task.title,
    task.notes,
    task.status,
    task.priority,
    task.sourceTitle,
    task.sourceHost,
    task.sourceUrl,
    task.sourceSnippet
  ].filter(Boolean).join(" ").toLowerCase();
}

function sortContacts(items, field, dir) {
  const sort = normalizeContactSort(field, dir);
  const pick = (item) => sort.field === "source" ? item.sourceDomain : item[sort.field];
  return [...items].sort((a, b) => (sort.dir === "asc" ? 1 : -1) * compareValues(pick(a), pick(b)));
}

function sortTasks(items, field, dir) {
  const sort = normalizeTaskSort(field, dir);
  const pick = (item) => sort.field === "source" ? item.sourceHost : item[sort.field];
  return [...items].sort((a, b) => (sort.dir === "asc" ? 1 : -1) * compareValues(pick(a), pick(b)));
}

function workspaceFacet(ids, workspaceById) {
  return ids
    .filter(Boolean)
    .sort()
    .map((id) => ({ id, name: workspaceById.get(id) ? workspaceById.get(id).name : id }));
}

function buildListIndexes(memory = [], workspaces = []) {
  const normalizedMemory = Array.isArray(memory) ? memory.map(normalizeMemoryItem) : [];
  const memoryById = new Map(normalizedMemory.map((item) => [item.id, item]));
  const memoryByContactId = new Map();
  for (const item of normalizedMemory) {
    if (!item.contactId) continue;
    if (!memoryByContactId.has(item.contactId)) memoryByContactId.set(item.contactId, []);
    memoryByContactId.get(item.contactId).push(item);
  }
  return {
    memoryById,
    memoryByContactId,
    workspaceById: new Map((Array.isArray(workspaces) ? workspaces : []).map((workspace) => [workspace.id, workspace]))
  };
}

function contactWorkspaceIds(contact, indexes) {
  const ids = new Set();
  for (const memoryId of contact.memoryIds || []) {
    const item = indexes.memoryById.get(memoryId);
    for (const workspaceId of (item && item.workspaceIds) || []) ids.add(workspaceId);
  }
  for (const item of indexes.memoryByContactId.get(contact.id) || []) {
    for (const workspaceId of item.workspaceIds || []) ids.add(workspaceId);
  }
  return [...ids];
}

function taskWorkspaceIds(task, indexes) {
  const ids = new Set();
  for (const memoryId of task.sourceMemoryIds || []) {
    const item = indexes.memoryById.get(memoryId);
    for (const workspaceId of (item && item.workspaceIds) || []) ids.add(workspaceId);
  }
  return [...ids];
}

function contactFacets(contacts, indexes) {
  const workspaceIds = new Set();
  for (const contact of contacts) {
    for (const id of contactWorkspaceIds(contact, indexes)) workspaceIds.add(id);
  }
  return {
    statuses: countBy(contacts, (contact) => contact.leadStatus),
    sources: Object.keys(countBy(contacts, (contact) => contact.sourceDomain)).sort(),
    workspaces: workspaceFacet([...workspaceIds], indexes.workspaceById)
  };
}

function taskFacets(tasks, indexes) {
  const workspaceIds = new Set();
  for (const task of tasks) {
    for (const id of taskWorkspaceIds(task, indexes)) workspaceIds.add(id);
  }
  return {
    statuses: countBy(tasks, (task) => task.status),
    priorities: countBy(tasks, (task) => task.priority),
    sources: Object.keys(countBy(tasks, (task) => task.sourceHost)).sort(),
    workspaces: workspaceFacet([...workspaceIds], indexes.workspaceById)
  };
}

function taskMatchesDueBucket(task, bucket, nowMs = Date.now()) {
  const due = task.dueDate ? Date.parse(`${task.dueDate}T00:00:00.000Z`) : NaN;
  if (bucket === "none") return !task.dueDate;
  if (Number.isNaN(due)) return false;
  const now = new Date(nowMs);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (bucket === "overdue") return due < today;
  if (bucket === "today") return due === today;
  if (bucket === "week" || bucket === "next_7_days") return due >= today && due <= today + 7 * 24 * 60 * 60 * 1000;
  if (bucket === "upcoming") return due > today;
  return true;
}

function dateInRange(dateValue, fromValue, toValue) {
  if (!fromValue && !toValue) return true;
  if (!dateValue) return false;
  const date = Date.parse(`${dateValue}T00:00:00.000Z`);
  if (Number.isNaN(date)) return false;
  if (fromValue) {
    const from = Date.parse(`${fromValue}T00:00:00.000Z`);
    if (!Number.isNaN(from) && date < from) return false;
  }
  if (toValue) {
    const to = Date.parse(`${toValue}T00:00:00.000Z`);
    if (!Number.isNaN(to) && date > to) return false;
  }
  return true;
}

const MAX_CONTEXT_GRAPH_NODES = 160;

function contextSourceNodeId(value) {
  const normalized = normalizeSourceUrl(value);
  return normalized ? `source:${sourceParts(normalized).urlKey}` : "";
}

function addContextNode(nodes, node) {
  if (!node || !node.id || nodes.has(node.id)) return;
  nodes.set(node.id, node);
}

function addContextEdge(edges, from, to, type, label, relation = "direct") {
  if (!from || !to || from === to) return;
  const id = `${type}:${from}->${to}`;
  if (edges.has(id)) return;
  edges.set(id, { id, from, to, type, label, relation });
}

function addContextWarning(warnings, code, message, nodeId, missingId) {
  warnings.push({ code, message, nodeId, missingId });
}

function contextWorkspaceIdsFor(raw = {}) {
  if (Array.isArray(raw.workspaceIds)) {
    return { ids: compactStringArray(raw.workspaceIds), relation: "direct" };
  }
  return { ids: compactStringArray(raw.taskIds), relation: "legacy" };
}

function contextNodeLabel(item, fallback) {
  return String(item && (item.title || item.name || item.urlKey || item.sourceUrl) || fallback || "").trim();
}

function addContextSourceNode(nodes, sourceUrl, title) {
  const normalized = normalizeSourceUrl(sourceUrl);
  if (!normalized) return "";
  const parts = sourceParts(normalized);
  const id = `source:${parts.urlKey}`;
  addContextNode(nodes, {
    id,
    type: "source",
    entityId: parts.urlKey,
    label: title || parts.sourceHost || parts.urlKey,
    subtitle: parts.sourceOrigin,
    url: parts.urlKey
  });
  return id;
}

function extractionContextLabel(memoryItem) {
  const extraction = memoryItem.structuredExtraction;
  if (!extraction || typeof extraction !== "object") return "";
  return extraction.title || extraction.summary || "Structured extraction";
}

function buildFullContextGraph({ memory = [], workspaces = [], actions = {} } = {}) {
  const normalizedMemory = (Array.isArray(memory) ? memory : []).map((item) => {
    const membership = contextWorkspaceIdsFor(item);
    return {
      ...normalizeMemoryItem(item),
      _workspaceIds: membership.ids,
      _workspaceRelation: membership.relation
    };
  });
  const normalizedWorkspaces = (Array.isArray(workspaces) ? workspaces : []).map(normalizeWorkspaceItem);
  const contacts = (Array.isArray(actions.contacts) ? actions.contacts : []).map(normalizeContactItem);
  const tasks = (Array.isArray(actions.tasks) ? actions.tasks : []).map(normalizeTaskItem);
  const nodes = new Map();
  const edges = new Map();
  const warnings = [];
  const memoryById = new Map(normalizedMemory.map((item) => [item.id, item]));
  const workspaceById = new Map(normalizedWorkspaces.map((item) => [item.id, item]));
  const contactById = new Map(contacts.map((item) => [item.id, item]));
  const taskById = new Map(tasks.map((item) => [item.id, item]));

  for (const workspace of normalizedWorkspaces) {
    addContextNode(nodes, {
      id: `workspace:${workspace.id}`,
      type: "workspace",
      entityId: workspace.id,
      label: workspace.name || workspace.id,
      subtitle: workspace.status || "open"
    });
  }
  for (const item of normalizedMemory) {
    addContextNode(nodes, {
      id: `memory:${item.id}`,
      type: "memory",
      entityId: item.id,
      label: contextNodeLabel(item, "Untitled note"),
      subtitle: item.note || item.summary || item.snippet || "",
      url: item.sourceUrl,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    });
  }
  for (const contact of contacts) {
    addContextNode(nodes, {
      id: `contact:${contact.id}`,
      type: "contact",
      entityId: contact.id,
      label: contact.name || "Unknown contact",
      subtitle: [contact.company, contact.email, contact.leadStatus].filter(Boolean).join(" - "),
      url: contact.sourceUrl,
      createdAt: contact.createdAt,
      updatedAt: contact.updatedAt
    });
  }
  for (const task of tasks) {
    addContextNode(nodes, {
      id: `task:${task.id}`,
      type: "task",
      entityId: task.id,
      label: task.title || "Untitled task",
      subtitle: [task.status, task.priority, task.dueDate].filter(Boolean).join(" - "),
      url: task.sourceUrl,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    });
  }

  for (const item of normalizedMemory) {
    const memoryNode = `memory:${item.id}`;
    for (const workspaceId of item._workspaceIds || []) {
      if (!workspaceById.has(workspaceId)) {
        addContextWarning(warnings, "missing_workspace", `Memory ${item.id} references missing workspace ${workspaceId}.`, memoryNode, workspaceId);
        continue;
      }
      addContextEdge(edges, memoryNode, `workspace:${workspaceId}`, "memory_workspace", item._workspaceRelation === "legacy" ? "Legacy workspace membership" : "Workspace membership", item._workspaceRelation || "direct");
    }
    for (const taskId of item.linkedTaskIds || []) {
      if (!taskById.has(taskId)) {
        addContextWarning(warnings, "missing_task", `Memory ${item.id} references missing linked task ${taskId}.`, memoryNode, taskId);
        continue;
      }
      addContextEdge(edges, memoryNode, `task:${taskId}`, "memory_task", "Linked task", "direct");
    }
    if (item.contactId) {
      if (!contactById.has(item.contactId)) {
        addContextWarning(warnings, "missing_contact", `Memory ${item.id} references missing contact ${item.contactId}.`, memoryNode, item.contactId);
      } else {
        addContextEdge(edges, memoryNode, `contact:${item.contactId}`, "memory_contact", "Legacy contact link", "legacy");
      }
    }
    const sourceId = addContextSourceNode(nodes, item.sourceUrl || item.canonicalUrl, item.sourceTitle || item.title);
    if (sourceId) addContextEdge(edges, memoryNode, sourceId, "memory_source", "Exact source URL", "direct");
    if (item.structuredExtraction && typeof item.structuredExtraction === "object") {
      const extractionNode = `extraction:${item.id}`;
      addContextNode(nodes, {
        id: extractionNode,
        type: "extraction",
        entityId: item.id,
        label: extractionContextLabel(item),
        subtitle: "Structured extraction"
      });
      addContextEdge(edges, memoryNode, extractionNode, "memory_extraction", "Structured extraction", "direct");
    }
  }

  for (const task of tasks) {
    const taskNode = `task:${task.id}`;
    for (const memoryId of task.sourceMemoryIds || []) {
      if (!memoryById.has(memoryId)) {
        addContextWarning(warnings, "missing_memory", `Task ${task.id} references missing source memory ${memoryId}.`, taskNode, memoryId);
        continue;
      }
      addContextEdge(edges, taskNode, `memory:${memoryId}`, "task_memory", "Source memory", "direct");
    }
    const sourceId = addContextSourceNode(nodes, task.sourceUrl, task.sourceTitle || task.title);
    if (sourceId) addContextEdge(edges, taskNode, sourceId, "task_source", "Exact source URL", "direct");
  }

  for (const contact of contacts) {
    const contactNode = `contact:${contact.id}`;
    for (const memoryId of contact.memoryIds || []) {
      if (!memoryById.has(memoryId)) {
        addContextWarning(warnings, "missing_memory", `Contact ${contact.id} references missing memory ${memoryId}.`, contactNode, memoryId);
        continue;
      }
      addContextEdge(edges, contactNode, `memory:${memoryId}`, "contact_memory", "Contact memory", "direct");
    }
    const sourceId = addContextSourceNode(nodes, contact.sourceUrl, contact.sourceTitle || contact.name);
    if (sourceId) addContextEdge(edges, contactNode, sourceId, "contact_source", "Exact source URL", "direct");
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()], warnings };
}

function contextNodeSearchText(node) {
  return normalizeSearchText([node.label, node.subtitle, node.url, node.entityId].filter(Boolean).join(" "));
}

function contextSubjectNodeId(subject = {}) {
  if (["memory", "contact", "task", "workspace"].includes(subject.type)) return subject.id ? `${subject.type}:${subject.id}` : "";
  if (subject.type === "source") return contextSourceNodeId(subject.urlKey || subject.sourceUrl || subject.id);
  return "";
}

function selectContextStartNodes(full, subject = {}) {
  if (subject.type === "search") {
    const query = normalizeSearchText(subject.q || subject.query || "");
    if (!query) return [];
    const limit = Math.min(Math.max(Number(subject.limit) || 20, 1), 50);
    return full.nodes
      .filter((node) => node.type !== "extraction" && contextNodeSearchText(node).includes(query))
      .slice(0, limit)
      .map((node) => node.id);
  }
  const id = contextSubjectNodeId(subject);
  return id ? [id] : [];
}

function buildContextGraph(dataset = {}, subject = {}) {
  const full = buildFullContextGraph(dataset);
  const nodeMap = new Map(full.nodes.map((node) => [node.id, node]));
  const startIds = selectContextStartNodes(full, subject).filter((id) => nodeMap.has(id));
  const requestedId = contextSubjectNodeId(subject);
  const warnings = [...full.warnings];
  if (requestedId && startIds.length === 0) {
    addContextWarning(warnings, "missing_subject", `No context node found for ${requestedId}.`, requestedId, requestedId);
  }
  const adjacency = new Map();
  for (const edge of full.edges) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    if (!adjacency.has(edge.to)) adjacency.set(edge.to, []);
    adjacency.get(edge.from).push(edge);
    adjacency.get(edge.to).push(edge);
  }
  const included = new Set(startIds);
  let frontier = new Set(startIds);
  const depth = subject.type === "search" ? 1 : 2;
  for (let level = 0; level < depth && frontier.size > 0; level++) {
    const next = new Set();
    for (const nodeId of frontier) {
      for (const edge of adjacency.get(nodeId) || []) {
        const other = edge.from === nodeId ? edge.to : edge.from;
        if (!nodeMap.has(other) || included.has(other)) continue;
        if (included.size >= MAX_CONTEXT_GRAPH_NODES) break;
        included.add(other);
        next.add(other);
      }
    }
    frontier = next;
  }
  const nodes = [...included].map((id) => nodeMap.get(id)).filter(Boolean);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = full.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
  const relatedWarnings = warnings.filter((warning) => !warning.nodeId || nodeIds.has(warning.nodeId) || warning.nodeId === requestedId);
  const subjectNode = requestedId ? nodeMap.get(requestedId) || null : null;
  return {
    subject: {
      type: subject.type || "unknown",
      id: subject.id || subject.urlKey || subject.q || subject.query || "",
      nodeId: requestedId || "",
      label: subjectNode ? subjectNode.label : (subject.q || subject.query || subject.urlKey || subject.id || ""),
      found: subject.type === "search" ? nodes.length > 0 : Boolean(subjectNode)
    },
    nodes,
    edges,
    groups: Object.entries(nodes.reduce((acc, node) => {
      acc[node.type] = (acc[node.type] || 0) + 1;
      return acc;
    }, {})).map(([type, count]) => ({ type, count })),
    counts: {
      nodes: nodes.length,
      edges: edges.length,
      warnings: relatedWarnings.length,
      memory: nodes.filter((node) => node.type === "memory").length,
      workspaces: nodes.filter((node) => node.type === "workspace").length,
      contacts: nodes.filter((node) => node.type === "contact").length,
      tasks: nodes.filter((node) => node.type === "task").length,
      sources: nodes.filter((node) => node.type === "source").length,
      extractions: nodes.filter((node) => node.type === "extraction").length
    },
    warnings: relatedWarnings
  };
}

async function handleContactList({ limit = 50, offset = 0, query = "", q = "", status = "", statuses, sourceHost = "", sourceUrlKey = "", urlKey = "", memoryId = "", workspaceId = "", sortBy = "updatedAt", sortDir = "desc" } = {}) {
  const actions = await loadActions();
  const memory = await loadMemory();
  const workspaces = await loadNoteWorkspaces();
  const indexes = buildListIndexes(memory, workspaces);
  const explicitStatuses = normalizeFilterList(statuses);
  const statusList = explicitStatuses.length ? explicitStatuses : normalizeFilterList(status);
  if (statusList.some((item) => item !== "all" && !LEAD_STATUSES.has(item))) return { error: "Invalid lead status" };
  const search = String(q || query || "").trim().toLowerCase();
  const host = String(sourceHost || "").trim().toLowerCase();
  const normalizedUrlKey = normalizeSourceUrl(sourceUrlKey || urlKey);
  const workspaceIds = normalizeFilterList(workspaceId);
  const window = normalizeListWindow(limit, offset);
  let contacts = actions.contacts || [];

  if (statusList.length && !statusList.includes("all")) contacts = contacts.filter((contact) => statusList.includes(contact.leadStatus));
  if (host) contacts = contacts.filter((contact) => (contact.sourceDomain || "").toLowerCase() === host);
  if (normalizedUrlKey) contacts = contacts.filter((contact) => normalizeSourceUrl(contact.sourceUrl) === normalizedUrlKey);
  if (memoryId) contacts = contacts.filter((contact) => (contact.memoryIds || []).includes(memoryId));
  if (workspaceIds.length && !workspaceIds.includes("all")) {
    contacts = contacts.filter((contact) => contactWorkspaceIds(contact, indexes).some((id) => workspaceIds.includes(id)));
  }
  if (search) contacts = contacts.filter((contact) => contactSearchText(contact).includes(search));

  contacts = sortContacts(contacts, sortBy, sortDir);
  const page = contacts.slice(window.offset, window.offset + window.limit);
  return {
    contacts: page,
    total: contacts.length,
    limit: window.limit,
    offset: window.offset,
    listMeta: pageMeta(contacts.length, window.limit, window.offset, page.length),
    filters: { q: search, statuses: statusList.length ? statusList : ["all"], status: statusList[0] || "all", sourceHost: host, sourceUrlKey: normalizedUrlKey, memoryId, workspaceIds },
    sort: normalizeContactSort(sortBy, sortDir),
    facets: contactFacets(actions.contacts || [], indexes)
  };
}

async function handleContactGet(id) {
  const actions = await loadActions();
  const contact = (actions.contacts || []).find((item) => item.id === id);
  return contact ? { contact } : { error: "Not found" };
}

async function handleContactCreate({ contact = {} } = {}) {
  return enqueueStorageWrite(async () => {
    const actions = await loadActions();
    const saved = createOrMergeContactResult(actions, contact);
    const updates = { actions };
    if (saved.audit) updates.dedupeAudit = [saved.audit, ...(await loadDedupeAudit())].slice(0, 100);
    await storageSet(updates);
    broadcastMirrorDataChanged("contact", { action: saved.audit ? "merge" : "create", id: saved.contact.id });
    return { contact: saved.contact };
  });
}

async function handleContactUpdate(id, patch = {}) {
  if (patch.leadStatus && !LEAD_STATUSES.has(patch.leadStatus)) return { error: "Invalid lead status" };
  return enqueueStorageWrite(async () => {
    const actions = await loadActions();
    const contacts = actions.contacts || [];
    const index = contacts.findIndex((contact) => contact.id === id);
    if (index === -1) return { error: "Not found" };
    contacts[index] = normalizeContactItem({
      ...contacts[index],
      ...patch,
      id,
      updatedAt: new Date().toISOString()
    });
    actions.contacts = contacts;
    await storageSet({ actions });
    broadcastMirrorDataChanged("contact", { action: "update", id });
    return { contact: contacts[index] };
  });
}

async function handleContactDelete(id) {
  return enqueueStorageWrite(async () => {
    const actions = await loadActions();
    const memory = (await loadMemory()).map(normalizeMemoryItem);
    const contacts = actions.contacts || [];
    const index = contacts.findIndex((contact) => contact.id === id);
    if (index === -1) return { error: "Not found" };
    const [removed] = contacts.splice(index, 1);
    actions.contacts = contacts;
    let touchedMemory = false;
    for (const item of memory) {
      if (item.contactId === id) {
        item.contactId = "";
        item.updatedAt = new Date().toISOString();
        touchedMemory = true;
      }
      if (Array.isArray(item.contactIds) && item.contactIds.includes(id)) {
        item.contactIds = item.contactIds.filter((contactId) => contactId !== id);
        item.updatedAt = new Date().toISOString();
        touchedMemory = true;
      }
    }
    const updates = { actions };
    if (touchedMemory) updates.memory = memory;
    await storageSet(updates);
    if (touchedMemory) {
      chrome.runtime.sendMessage({ type: "MIRROR_DATA_CHANGED", reason: "memory_links", action: "contact_delete", id }).catch(() => {});
    }
    broadcastMirrorDataChanged("contact", { action: "delete", id });
    return { contact: normalizeContactItem(removed), deleted: true };
  });
}

async function handleContactBatch({ ids = [], action = "update", patch = {} } = {}) {
  return enqueueStorageWrite(async () => {
    const actions = await loadActions();
    const memory = (await loadMemory()).map(normalizeMemoryItem);
    const contacts = actions.contacts || [];
    const targetIds = compactStringArray(ids);
    const batchAction = action === "delete" ? "delete" : "update";
    const results = [];
    const errors = [];
    if (batchAction === "update" && patch.leadStatus && !LEAD_STATUSES.has(patch.leadStatus)) {
      return { action: batchAction, requested: targetIds.length, succeeded: 0, failed: targetIds.length, results, errors: targetIds.map((id) => ({ id, error: "Invalid lead status" })) };
    }
    const now = new Date().toISOString();
    let touchedMemory = false;
    for (const id of targetIds) {
      const index = contacts.findIndex((contact) => contact.id === id);
      if (index === -1) {
        errors.push({ id, error: "Not found" });
        continue;
      }
      if (batchAction === "delete") {
        const [removed] = contacts.splice(index, 1);
        for (const item of memory) {
          if (item.contactId === id) {
            item.contactId = "";
            item.updatedAt = now;
            touchedMemory = true;
          }
          if (Array.isArray(item.contactIds) && item.contactIds.includes(id)) {
            item.contactIds = item.contactIds.filter((contactId) => contactId !== id);
            item.updatedAt = now;
            touchedMemory = true;
          }
        }
        results.push({ id, deleted: true, contact: normalizeContactItem(removed) });
      } else {
        contacts[index] = normalizeContactItem({ ...contacts[index], ...patch, id, updatedAt: now });
        results.push({ id, contact: contacts[index] });
      }
    }
    actions.contacts = contacts;
    const updates = { actions };
    if (touchedMemory) updates.memory = memory;
    await storageSet(updates);
    broadcastMirrorDataChanged("contact", { action: batchAction, ids: targetIds, touchedMemory });
    return { action: batchAction, requested: targetIds.length, succeeded: results.length, failed: errors.length, results, errors };
  });
}

async function handleTaskList({ status = "open", statuses, priority = "", priorities, sourceHost = "", sourceUrlKey = "", urlKey = "", memoryId = "", workspaceId = "", dueBucket = "", dueFrom = "", dueTo = "", q = "", query = "", sortBy = "updatedAt", sortDir = "desc", limit = 50, offset = 0 } = {}) {
  const explicitStatuses = normalizeFilterList(statuses);
  const statusList = explicitStatuses.length ? explicitStatuses : normalizeFilterList(status);
  if (statusList.some((item) => item !== "all" && !TASK_STATUSES.has(item))) return { error: "Invalid task status" };
  const explicitPriorities = normalizeFilterList(priorities);
  const priorityList = explicitPriorities.length ? explicitPriorities : normalizeFilterList(priority);
  if (priorityList.some((item) => item !== "all" && !TASK_PRIORITIES.has(item))) return { error: "Invalid task priority" };
  if (dueBucket && !["none", "overdue", "today", "week", "next_7_days", "upcoming"].includes(dueBucket)) return { error: "Invalid due bucket" };
  const actions = await loadActions();
  const memory = await loadMemory();
  const workspaces = await loadNoteWorkspaces();
  const indexes = buildListIndexes(memory, workspaces);
  const host = String(sourceHost || "").trim().toLowerCase();
  const normalizedUrlKey = normalizeSourceUrl(sourceUrlKey || urlKey);
  const workspaceIds = normalizeFilterList(workspaceId);
  const search = String(q || query || "").trim().toLowerCase();
  const window = normalizeListWindow(limit, offset);
  let tasks = actions.tasks || [];
  if (statusList.length && !statusList.includes("all")) tasks = tasks.filter((task) => statusList.includes(task.status));
  if (priorityList.length && !priorityList.includes("all")) tasks = tasks.filter((task) => priorityList.includes(task.priority));
  if (host) tasks = tasks.filter((task) => (task.sourceHost || "").toLowerCase() === host);
  if (normalizedUrlKey) tasks = tasks.filter((task) => normalizeSourceUrl(task.sourceUrl) === normalizedUrlKey);
  if (memoryId) tasks = tasks.filter((task) => (task.sourceMemoryIds || []).includes(memoryId));
  if (workspaceIds.length && !workspaceIds.includes("all")) {
    tasks = tasks.filter((task) => taskWorkspaceIds(task, indexes).some((id) => workspaceIds.includes(id)));
  }
  if (dueBucket) tasks = tasks.filter((task) => taskMatchesDueBucket(task, dueBucket));
  if (dueFrom || dueTo) tasks = tasks.filter((task) => dateInRange(task.dueDate, dueFrom, dueTo));
  if (search) tasks = tasks.filter((task) => taskSearchText(task).includes(search));
  tasks = sortTasks(tasks, sortBy, sortDir);
  const page = tasks.slice(window.offset, window.offset + window.limit);
  return {
    tasks: page,
    total: tasks.length,
    limit: window.limit,
    offset: window.offset,
    listMeta: pageMeta(tasks.length, window.limit, window.offset, page.length),
    filters: { statuses: statusList.length ? statusList : ["open"], priorities: priorityList, sourceHost: host, sourceUrlKey: normalizedUrlKey, memoryId, workspaceIds, dueBucket, dueFrom, dueTo, q: search },
    sort: normalizeTaskSort(sortBy, sortDir),
    facets: taskFacets(actions.tasks || [], indexes)
  };
}

async function handleTaskGet(id) {
  const actions = await loadActions();
  const task = (actions.tasks || []).find((item) => item.id === id);
  return task ? { task } : { error: "Not found" };
}

async function handleTaskUpdate(id, patch) {
  return enqueueStorageWrite(async () => {
    const actions = await loadActions();
    const tasks   = actions.tasks || [];
    const index   = tasks.findIndex((t) => t.id === id);
    if (index === -1) return { error: "Not found" };

    if (patch.status && !TASK_STATUSES.has(patch.status)) return { error: "Invalid task status" };
    if (patch.priority && !TASK_PRIORITIES.has(patch.priority)) return { error: "Invalid task priority" };
    const now = new Date().toISOString();
    const next = normalizeTaskItem(tasks[index]);
    const allowed = ["status", "title", "notes", "dueDate", "priority"];
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(patch, key) && patch[key] !== undefined) {
        next[key] = patch[key];
      }
    }
    if (Object.prototype.hasOwnProperty.call(patch, "status")) {
      next.completedAt = patch.status === "done" ? (patch.completedAt || next.completedAt || now) : "";
    }
    next.updatedAt = now;
    tasks[index] = normalizeTaskItem(next);
    actions.tasks = tasks;
    await storageSet({ actions });
    broadcastMirrorDataChanged("task", { action: "update", id });
    return { task: tasks[index] };
  });
}

async function handleTaskDelete(id) {
  return enqueueStorageWrite(async () => {
    const actions = await loadActions();
    const memory = (await loadMemory()).map(normalizeMemoryItem);
    const tasks = actions.tasks || [];
    const index = tasks.findIndex((task) => task.id === id);
    if (index === -1) return { error: "Not found" };
    const [removed] = tasks.splice(index, 1);
    actions.tasks = tasks;
    let touchedMemory = false;
    for (const item of memory) {
      if (!item.linkedTaskIds.includes(id)) continue;
      item.linkedTaskIds = item.linkedTaskIds.filter((taskId) => taskId !== id);
      item.updatedAt = new Date().toISOString();
      touchedMemory = true;
    }
    const updates = { actions };
    if (touchedMemory) updates.memory = memory;
    await storageSet(updates);
    broadcastMirrorDataChanged("task", { action: "delete", id, touchedMemory });
    return { task: normalizeTaskItem(removed), deleted: true };
  });
}

async function handleTaskBatch({ ids = [], action = "update", patch = {} } = {}) {
  return enqueueStorageWrite(async () => {
    const actions = await loadActions();
    const memory = (await loadMemory()).map(normalizeMemoryItem);
    const tasks = actions.tasks || [];
    const targetIds = compactStringArray(ids);
    const batchAction = action === "delete" ? "delete" : "update";
    const results = [];
    const errors = [];
    if (batchAction === "update" && patch.status && !TASK_STATUSES.has(patch.status)) {
      return { action: batchAction, requested: targetIds.length, succeeded: 0, failed: targetIds.length, results, errors: targetIds.map((id) => ({ id, error: "Invalid task status" })) };
    }
    if (batchAction === "update" && patch.priority && !TASK_PRIORITIES.has(patch.priority)) {
      return { action: batchAction, requested: targetIds.length, succeeded: 0, failed: targetIds.length, results, errors: targetIds.map((id) => ({ id, error: "Invalid task priority" })) };
    }
    const now = new Date().toISOString();
    let touchedMemory = false;
    for (const id of targetIds) {
      const index = tasks.findIndex((task) => task.id === id);
      if (index === -1) {
        errors.push({ id, error: "Not found" });
        continue;
      }
      if (batchAction === "delete") {
        const [removed] = tasks.splice(index, 1);
        for (const item of memory) {
          if (!item.linkedTaskIds.includes(id)) continue;
          item.linkedTaskIds = item.linkedTaskIds.filter((taskId) => taskId !== id);
          item.updatedAt = now;
          touchedMemory = true;
        }
        results.push({ id, deleted: true, task: normalizeTaskItem(removed) });
        continue;
      }

      const next = normalizeTaskItem(tasks[index]);
      for (const key of ["status", "title", "notes", "dueDate", "priority"]) {
        if (Object.prototype.hasOwnProperty.call(patch, key) && patch[key] !== undefined) next[key] = patch[key];
      }
      if (Object.prototype.hasOwnProperty.call(patch, "status")) {
        next.completedAt = patch.status === "done" ? (patch.completedAt || next.completedAt || now) : "";
      }
      next.updatedAt = now;
      tasks[index] = normalizeTaskItem(next);
      results.push({ id, task: tasks[index] });
    }
    actions.tasks = tasks;
    const updates = { actions };
    if (touchedMemory) updates.memory = memory;
    await storageSet(updates);
    broadcastMirrorDataChanged("task", { action: batchAction, ids: targetIds, touchedMemory });
    return { action: batchAction, requested: targetIds.length, succeeded: results.length, failed: errors.length, results, errors };
  });
}

async function handleTaskContext(id) {
  const actions = await loadActions();
  const task = (actions.tasks || []).find((item) => item.id === id);
  if (!task) return { error: "Not found" };
  const memory = (await loadMemory()).map(normalizeMemoryItem);
  const memoryById = new Map(memory.map((item) => [item.id, item]));
  return {
    task,
    items: (task.sourceMemoryIds || []).map((memoryId) => {
      const item = memoryById.get(memoryId);
      return item ? { id: memoryId, item, unavailable: false } : { id: memoryId, item: null, unavailable: true };
    })
  };
}

async function handleContextGraph(subject) {
  return buildContextGraph({
    memory: await loadMemory(),
    workspaces: await loadNoteWorkspaces(),
    actions: await loadActions()
  }, subject);
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
    case "LLM_HEALTH":     return handleLlmHealth();
    case "ANALYZE":        return handleAnalyze(message);
    case "MEMORY_SAVE":    return handleMemorySave(message);
    case "MEMORY_LIST":    return handleMemoryList(message);
    case "MEMORY_SOURCE":  return handleMemorySource(message);
    case "MEMORY_SEARCH":  return handleMemorySearch(message);
    case "MEMORY_DELETE":  return handleMemoryDelete(message.id);
    case "MEMORY_UPDATE":  return handleMemoryUpdate(message.id, message.patch);
    case "NOTE_WORKSPACE_LIST":   return handleNoteWorkspaceList(message);
    case "NOTE_WORKSPACE_CREATE": return handleNoteWorkspaceCreate(message);
    case "NOTE_WORKSPACE_UPDATE": return handleNoteWorkspaceUpdate(message.id, message.patch);
    case "NOTE_WORKSPACE_DELETE": return handleNoteWorkspaceDelete(message.id);
    case "NOTE_WORKSPACE_NOTES":  return handleNoteWorkspaceNotes(message);
    case "NOTE_WORKSPACE_UNASSIGNED_NOTES": return handleUnassignedWorkspaceNotes(message);
    case "NOTE_WORKSPACE_DASHBOARD": return handleWorkspaceDashboard(message);
    case "NOTE_WORKSPACE_UNASSIGNED_DASHBOARD": return handleUnassignedWorkspaceDashboard(message);
    case "DEDUPE_CANDIDATES": return handleDedupeCandidates(message);
    case "DEDUPE_PREVIEW": return handleDedupePreview(message);
    case "DEDUPE_APPLY": return handleDedupeApply(message);
    case "DEDUPE_AUDIT": return handleDedupeAudit(message);
    case "DEDUPE_UNDO": return handleDedupeUndo(message);
    case "DEDUPE_IGNORE": return handleDedupeIgnore(message);
    case "DEDUPE_UNIGNORE": return handleDedupeUnignore(message);
    case "BACKUP_EXPORT": return handleBackupExport(message);
    case "BACKUP_VALIDATE": return handleBackupValidate(message);
    case "BACKUP_RESTORE_POINT": return handleBackupRestorePoint(message);
    case "BACKUP_IMPORT": return handleBackupImport(message);
    case "ACTION_RUN":     return handleActionRun(message);
    case "ACTION_STATE":   return handleActionState();
    case "CONTACT_EXTRACT": return handleContactExtract(message);
    case "CONTACT_LIST":   return handleContactList(message);
    case "CONTACT_GET":    return handleContactGet(message.id);
    case "CONTACT_CREATE": return handleContactCreate(message);
    case "CONTACT_UPDATE": return handleContactUpdate(message.id, message.patch);
    case "CONTACT_DELETE": return handleContactDelete(message.id);
    case "CONTACT_BATCH":  return handleContactBatch(message);
    case "TASK_LIST":      return handleTaskList(message);
    case "TASK_DRAFT":     return handleTaskDraft(message);
    case "TASK_GET":       return handleTaskGet(message.id);
    case "TASK_UPDATE":    return handleTaskUpdate(message.id, message.patch);
    case "TASK_DELETE":    return handleTaskDelete(message.id);
    case "TASK_BATCH":     return handleTaskBatch(message);
    case "TASK_CONTEXT":   return handleTaskContext(message.id);
    case "CONTEXT_SOURCE": return handleContextGraph({ type: "source", urlKey: message.urlKey });
    case "CONTEXT_MEMORY": return handleContextGraph({ type: "memory", id: message.id });
    case "CONTEXT_CONTACT": return handleContextGraph({ type: "contact", id: message.id });
    case "CONTEXT_TASK":   return handleContextGraph({ type: "task", id: message.id });
    case "CONTEXT_WORKSPACE": return handleContextGraph({ type: "workspace", id: message.id });
    case "CONTEXT_SEARCH": return handleContextGraph({ type: "search", q: message.q || message.query || "", limit: message.limit || 20 });
    case "PRIVACY_SETTINGS_GET": return { settings: await loadPrivacySettings() };
    case "PRIVACY_SETTINGS_PATCH": return { settings: await patchPrivacySettings(message.patch) };
    case "PRIVACY_PROVENANCE_LIST": return listPrivacyEvents({ limit: message.limit || 50, offset: message.offset || 0 });
    case "PRIVACY_CLEAR_DATA": {
      const validated = privacyTools.validateClearBuckets ? privacyTools.validateClearBuckets(message.buckets) : { buckets: message.buckets };
      if (validated.error) throw new Error(validated.error);
      if (!message.confirmationToken) throw new Error("confirmationToken is required");
      const parsedBefore = privacyTools.parseBeforeTimestamp ? privacyTools.parseBeforeTimestamp(message.before) : null;
      if (parsedBefore && parsedBefore.error) throw new Error(parsedBefore.error);
      return clearBuiltInData({ buckets: validated.buckets, before: parsedBefore ? parsedBefore.before : null });
    }
    case "PRIVACY_RETENTION_RUN": return runBuiltInRetention();
    case "OPEN_OPTIONS":   return handleOpenOptions();
    default:               throw new Error(`Unknown message type: ${message.type}`);
  }
}

// chrome.runtime.openOptionsPage() is not exposed to content scripts, so the
// content script asks the service worker to open the options page on its behalf.
async function handleOpenOptions() {
  await chrome.runtime.openOptionsPage();
  return { ok: true };
}

// ============================================================
// Extension toolbar and Chrome commands — toggle/open the side panel
// ============================================================

// Chrome refuses content-script messaging and scripting injection on internal
// pages (chrome://, devtools://, the Web Store, etc.), surfacing uncaught
// "Cannot access a chrome:// URL" promise rejections. Filter those upstream.
function isSupportedPageUrl(value) {
  if (typeof value !== "string" || !value) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const scheme = url.protocol;
  if (scheme === "http:" || scheme === "https:" || scheme === "file:") return true;
  if (scheme === "chrome-extension:"
    && chrome.runtime
    && chrome.runtime.id
    && url.hostname === chrome.runtime.id) {
    return true;
  }
  return false;
}

function isInjectableTab(tab) {
  if (!tab || !tab.id) return false;
  return isSupportedPageUrl(tab.url || tab.pendingUrl || "");
}

async function ensurePanelScripts(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["privacy-utils.js", "selection-replacement.js", "shortcut-utils.js", "settings-utils.js", "content.js"]
  });
  await chrome.scripting.insertCSS({ target: { tabId }, files: ["styles.css"] });
}

async function sendPanelMessage(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (firstError) {
    await ensurePanelScripts(tabId);
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (secondError) {
      throw new Error(secondError && secondError.message || firstError && firstError.message || "Panel message failed");
    }
  }
}

async function getActiveTab() {
  if (!chrome.tabs || !chrome.tabs.query) return null;
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime && chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message || "Active tab lookup failed"));
        return;
      }
      resolve(tabs && tabs[0] || null);
    });
  });
}

async function sendPanelCommandToTab(tab, message) {
  if (!tab || !tab.id) return { ok: false, error: "No active tab" };
  if (!isInjectableTab(tab)) {
    return { ok: false, error: "Restricted page", reason: "unsupported_url" };
  }
  try {
    await sendPanelMessage(tab.id, message);
    return { ok: true };
  } catch (error) {
    console.warn("[aaw] panel command failed:", error && error.message || error);
    return { ok: false, error: error && error.message || "Panel command failed" };
  }
}

async function handleChromeCommand(command) {
  if (command !== "open-command-palette" && command !== "_execute_action") return { ok: false, ignored: true };
  const tab = await getActiveTab();
  const message = command === "open-command-palette"
    ? { type: "AAW_OPEN_COMMAND_PALETTE" }
    : { type: "TOGGLE_ASSISTANT" };
  return sendPanelCommandToTab(tab, message);
}

chrome.action.onClicked.addListener((tab) => {
  sendPanelCommandToTab(tab, { type: "TOGGLE_ASSISTANT" }).catch((error) => {
    console.warn("[aaw] toolbar toggle failed:", error && error.message || error);
  });
});

if (chrome.commands && chrome.commands.onCommand) {
  chrome.commands.onCommand.addListener((command) => {
    handleChromeCommand(command).catch((error) => {
      console.warn("[aaw] command failed:", error && error.message || error);
    });
  });
}

if (chrome.alarms) {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create("aaw-privacy-retention", { periodInMinutes: 24 * 60 });
  });
  chrome.runtime.onStartup.addListener(() => {
    chrome.alarms.create("aaw-privacy-retention", { periodInMinutes: 24 * 60 });
    runBuiltInRetention().catch(() => {});
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm && alarm.name === "aaw-privacy-retention") {
      runBuiltInRetention().catch(() => {});
    }
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    enqueueStorageWrite,
    buildMemoryItem,
    buildMemorySearchText,
    compactStringArray,
    contactDedupeKey,
    createOrMergeContact,
    buildTaskDraft,
    extractContactDrafts,
    mergeContactItems,
    normalizeContactItem,
    normalizeMemoryItem,
    normalizeMemoryMembershipInput,
    normalizeTaskItem,
    handleNoteWorkspaceCreate,
    handleNoteWorkspaceDelete,
    routeMessage,
    scoreMemoryKeyword,
    seedDefaultNoteWorkspaceItems,
    normalizeWorkspaceIdsInput,
    createLinkedTaskState,
    ensurePanelScripts,
    getActiveTab,
    handleChromeCommand,
    isInjectableTab,
    isSupportedPageUrl,
    sendPanelMessage
  };
}
