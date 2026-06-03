"use strict";

// ============================================================
// Privacy Controls Foundation — shared pure utilities.
//
// This module is the single owner of AI-send decisions. It is loaded in three
// contexts using the same browser/CommonJS dual-export pattern as
// selection-replacement.js:
//   - content.js  via window.AssistantPrivacy (manifest content script)
//   - background.js via importScripts("privacy-utils.js") -> self.AssistantPrivacy
//   - backend/built-in tests via require()
// It must stay free of DOM, chrome.*, fs, and network access.
//
// The whole module body is wrapped in an IIFE so its declarations are
// function-scoped, not top-level lexical bindings. The manifest injects this
// file as a content script AND background.js re-injects it via
// chrome.scripting.executeScript as a fallback; without the IIFE the second
// run into the same isolated world would throw "Identifier ... has already
// been declared" (mirrors settings-utils.js / shortcut-utils.js).
// ============================================================

(function definePrivacyUtils(globalScope) {

const PRIVACY_SCHEMA_VERSION = 1;
const AI_MODES = new Set(["auto", "ask", "local_only"]);
const REQUEST_AI_MODES = new Set(["auto", "ask", "local_only", "model_once"]);
const EMBEDDINGS_POLICIES = new Set(["with_memory"]);

// Buckets that clear-data / retention may operate on.
const CLEAR_DATA_BUCKETS = ["memory", "embeddings", "contacts", "tasks", "drafts", "tableRows", "privacyEvents"];

// chrome.storage.local keys that clear-data must never remove. API keys,
// provider/model selection, backend URL, folder mirror handle, and the privacy
// settings themselves survive a clear unless an explicit future action removes them.
const PRESERVED_STORAGE_KEYS = [
  "privacySettings",
  "llmProvider",
  "geminiApiKey", "openaiApiKey", "anthropicApiKey",
  "geminiModel", "openaiModel", "anthropicModel", "geminiEmbeddingModel",
  "assistantBackendUrl",
  "notesFolderName", "notesDirHandle"
];

const MAX_PRIVACY_EVENTS = 500;

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(?:\+?\d{1,2}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}/g;
// Token-like secrets: long runs that mix letters and digits, or known key prefixes.
const SECRET_PREFIX_RE = /\b(?:sk-|pk-|ghp_|gho_|xox[baprs]-|AKIA)[A-Za-z0-9_\-]{12,}\b/g;
const SECRET_GENERIC_RE = /\b(?=[A-Za-z0-9_\-]*[A-Za-z])(?=[A-Za-z0-9_\-]*\d)[A-Za-z0-9_\-]{24,}\b/g;

function toBool(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function toNonNegativeInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

function defaultPrivacySettings() {
  return {
    schemaVersion: PRIVACY_SCHEMA_VERSION,
    aiMode: "auto",
    redaction: {
      enabled: false,
      applyToModelPayload: true,
      redactEmails: true,
      redactPhones: true,
      redactTokenLikeSecrets: true,
      sendFullUrlToProvider: false
    },
    siteRules: {
      excludedHosts: [],
      hostOverrides: {}
    },
    retention: {
      enabled: false,
      memoryDays: 0,
      contactsDays: 0,
      tasksDays: 0,
      draftsDays: 0,
      tableRowsDays: 0,
      privacyEventsDays: 90,
      embeddingsPolicy: "with_memory"
    }
  };
}

// Lowercased, trimmed host with leading "www." and trailing dot removed.
function normalizeHost(value) {
  let host = String(value || "").trim().toLowerCase();
  if (!host) return "";
  // Accept full URLs and host:port too.
  if (host.includes("://")) {
    try { host = new URL(host).hostname.toLowerCase(); } catch { /* keep raw */ }
  }
  host = host.replace(/\/.*$/, "").replace(/:\d+$/, "").replace(/\.$/, "");
  if (host.startsWith("www.")) host = host.slice(4);
  return host;
}

// A rule is either an exact host or a "*.example.com" wildcard. The wildcard
// matches the apex and any subdomain.
function normalizeHostRule(value) {
  const raw = String(value || "").trim().toLowerCase().replace(/\.$/, "");
  if (!raw) return "";
  if (raw.startsWith("*.")) {
    const base = normalizeHost(raw.slice(2));
    return base ? `*.${base}` : "";
  }
  return normalizeHost(raw);
}

function hostMatchesRule(host, rule) {
  const h = normalizeHost(host);
  const r = normalizeHostRule(rule);
  if (!h || !r) return false;
  if (r.startsWith("*.")) {
    const base = r.slice(2);
    return h === base || h.endsWith(`.${base}`);
  }
  return h === r;
}

function normalizeHostList(value) {
  const out = [];
  const seen = new Set();
  if (!Array.isArray(value)) return out;
  for (const raw of value) {
    const rule = normalizeHostRule(raw);
    if (rule && !seen.has(rule)) {
      seen.add(rule);
      out.push(rule);
    }
  }
  return out;
}

function normalizeHostOverrides(value) {
  const out = {};
  if (!value || typeof value !== "object") return out;
  for (const key of Object.keys(value)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    const rule = normalizeHostRule(key);
    const mode = value[key];
    if (rule && AI_MODES.has(mode)) out[rule] = mode;
  }
  return out;
}

function normalizePrivacySettings(raw) {
  const base = defaultPrivacySettings();
  if (!raw || typeof raw !== "object") return base;

  const r = raw.redaction && typeof raw.redaction === "object" ? raw.redaction : {};
  const s = raw.siteRules && typeof raw.siteRules === "object" ? raw.siteRules : {};
  const t = raw.retention && typeof raw.retention === "object" ? raw.retention : {};

  return {
    schemaVersion: PRIVACY_SCHEMA_VERSION,
    aiMode: AI_MODES.has(raw.aiMode) ? raw.aiMode : base.aiMode,
    redaction: {
      enabled: toBool(r.enabled, base.redaction.enabled),
      applyToModelPayload: toBool(r.applyToModelPayload, base.redaction.applyToModelPayload),
      redactEmails: toBool(r.redactEmails, base.redaction.redactEmails),
      redactPhones: toBool(r.redactPhones, base.redaction.redactPhones),
      redactTokenLikeSecrets: toBool(r.redactTokenLikeSecrets, base.redaction.redactTokenLikeSecrets),
      sendFullUrlToProvider: toBool(r.sendFullUrlToProvider, base.redaction.sendFullUrlToProvider)
    },
    siteRules: {
      excludedHosts: normalizeHostList(s.excludedHosts),
      hostOverrides: normalizeHostOverrides(s.hostOverrides)
    },
    retention: {
      enabled: toBool(t.enabled, base.retention.enabled),
      memoryDays: toNonNegativeInt(t.memoryDays, base.retention.memoryDays),
      contactsDays: toNonNegativeInt(t.contactsDays, base.retention.contactsDays),
      tasksDays: toNonNegativeInt(t.tasksDays, base.retention.tasksDays),
      draftsDays: toNonNegativeInt(t.draftsDays, base.retention.draftsDays),
      tableRowsDays: toNonNegativeInt(t.tableRowsDays, base.retention.tableRowsDays),
      privacyEventsDays: toNonNegativeInt(t.privacyEventsDays, base.retention.privacyEventsDays),
      embeddingsPolicy: EMBEDDINGS_POLICIES.has(t.embeddingsPolicy) ? t.embeddingsPolicy : base.retention.embeddingsPolicy
    }
  };
}

// Deep-merge a PATCH onto existing settings, then normalize. Only known sub-objects merge.
function mergePrivacySettings(existing, patch) {
  const current = normalizePrivacySettings(existing);
  if (!patch || typeof patch !== "object") return current;
  const merged = {
    ...current,
    ...patch,
    redaction: { ...current.redaction, ...(patch.redaction && typeof patch.redaction === "object" ? patch.redaction : {}) },
    siteRules: { ...current.siteRules, ...(patch.siteRules && typeof patch.siteRules === "object" ? patch.siteRules : {}) },
    retention: { ...current.retention, ...(patch.retention && typeof patch.retention === "object" ? patch.retention : {}) }
  };
  return normalizePrivacySettings(merged);
}

// Precedence: matching host override > excluded host (forces local_only) > global aiMode.
function evaluatePrivacy({ settings, host } = {}) {
  const s = normalizePrivacySettings(settings);
  const h = normalizeHost(host);

  if (h) {
    for (const rule of Object.keys(s.siteRules.hostOverrides)) {
      if (hostMatchesRule(h, rule)) {
        return { effectiveAiMode: s.siteRules.hostOverrides[rule], siteRule: `override ${rule} → ${s.siteRules.hostOverrides[rule]}` };
      }
    }
    for (const rule of s.siteRules.excludedHosts) {
      if (hostMatchesRule(h, rule)) {
        return { effectiveAiMode: "local_only", siteRule: `excluded ${rule}` };
      }
    }
  }
  return { effectiveAiMode: s.aiMode, siteRule: `global ${s.aiMode}` };
}

function redactString(value, opts) {
  let text = String(value == null ? "" : value);
  const counts = { emails: 0, phones: 0, secrets: 0 };
  if (opts.redactEmails) {
    text = text.replace(EMAIL_RE, () => { counts.emails++; return "[redacted-email]"; });
  }
  if (opts.redactTokenLikeSecrets) {
    text = text.replace(SECRET_PREFIX_RE, () => { counts.secrets++; return "[redacted-secret]"; });
    text = text.replace(SECRET_GENERIC_RE, () => { counts.secrets++; return "[redacted-secret]"; });
  }
  if (opts.redactPhones) {
    text = text.replace(PHONE_RE, () => { counts.phones++; return "[redacted-phone]"; });
  }
  return { text, counts };
}

function mergeCounts(target, add) {
  for (const key of Object.keys(add)) target[key] = (target[key] || 0) + add[key];
  return target;
}

// Recursively redact every string field. Returns { value, counts }. Safe against
// prototype pollution and deep recursion.
function redactValue(value, opts, depth = 0) {
  const counts = { emails: 0, phones: 0, secrets: 0 };
  if (depth > 12) return { value, counts };
  if (typeof value === "string") {
    const r = redactString(value, opts);
    return { value: r.text, counts: r.counts };
  }
  if (Array.isArray(value)) {
    const out = value.map((item) => {
      const r = redactValue(item, opts, depth + 1);
      mergeCounts(counts, r.counts);
      return r.value;
    });
    return { value: out, counts };
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value)) {
      if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
      const r = redactValue(value[key], opts, depth + 1);
      mergeCounts(counts, r.counts);
      out[key] = r.value;
    }
    return { value: out, counts };
  }
  return { value, counts };
}

// Strip query and hash from a URL sent to a provider unless sendFullUrl is set.
function sanitizeUrlForProvider(url, sendFullUrl) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  if (sendFullUrl) return raw;
  try {
    const u = new URL(raw);
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    // Not a parseable URL — drop any ?/# tail defensively.
    return raw.split(/[?#]/)[0];
  }
}

// Redact + URL-sanitize an outbound model payload according to settings.
// Always sanitizes the URL (governed by sendFullUrlToProvider); only redacts
// content/pageMeta when redaction is enabled AND applyToModelPayload is true.
function prepareOutboundContent({ settings, content = "", pageMeta = {}, url = "" } = {}) {
  const s = normalizePrivacySettings(settings);
  const counts = { emails: 0, phones: 0, secrets: 0 };
  let outContent = String(content || "");
  let outPageMeta = pageMeta;

  if (s.redaction.enabled && s.redaction.applyToModelPayload) {
    const opts = s.redaction;
    const c = redactString(outContent, opts);
    outContent = c.text;
    mergeCounts(counts, c.counts);
    const m = redactValue(pageMeta || {}, opts);
    outPageMeta = m.value;
    mergeCounts(counts, m.counts);
  }

  return {
    content: outContent,
    pageMeta: outPageMeta,
    url: sanitizeUrlForProvider(url, s.redaction.sendFullUrlToProvider),
    redactionCounts: counts
  };
}

// Full client-side preflight. Returns a decision object describing whether the
// operation may reach a provider/backend-AI endpoint, the request-scoped aiMode,
// and the redacted payload to send.
function privacyPreflight({ settings, host, operation = "", contentSource = "page", content = "", pageMeta = {}, url = "", originalCharCount, confirmed = false } = {}) {
  const { effectiveAiMode, siteRule } = evaluatePrivacy({ settings, host });
  const prepared = prepareOutboundContent({ settings, content, pageMeta, url });
  const origCount = Number.isFinite(originalCharCount) ? originalCharCount : String(content || "").length;

  let blocked = false;            // must use local fallback, no provider/backend AI
  let requiresConfirmation = false;
  let requestAiMode = "auto";

  if (effectiveAiMode === "local_only") {
    blocked = true;
    requestAiMode = "local_only";
  } else if (effectiveAiMode === "ask") {
    requiresConfirmation = true;
    requestAiMode = confirmed ? "model_once" : null; // null => caller must abort
    if (!confirmed) blocked = true;
  } else {
    requestAiMode = "auto";
  }

  return {
    effectiveAiMode,
    siteRule,
    blocked,
    requiresConfirmation,
    requestAiMode,
    allowProviderSend: !blocked,
    allowBackendAi: !blocked,
    content: prepared.content,
    pageMeta: prepared.pageMeta,
    url: prepared.url,
    redactionCounts: prepared.redactionCounts,
    originalCharCount: origCount,
    submittedCharCount: String(prepared.content || "").length,
    contentSource,
    operation
  };
}

// Keep provenance metadata-only: no raw prompts, responses, page text, or URLs
// with content. URLs are reduced to host. redactionCounts coerced to numbers.
function sanitizeProvenance(meta = {}) {
  const m = meta && typeof meta === "object" ? meta : {};
  const counts = {};
  if (m.redactionCounts && typeof m.redactionCounts === "object") {
    for (const key of Object.keys(m.redactionCounts)) {
      const n = Number(m.redactionCounts[key]);
      if (Number.isFinite(n) && n > 0) counts[key] = n;
    }
  }
  return {
    operation: typeof m.operation === "string" ? m.operation : "",
    effectiveAiMode: REQUEST_AI_MODES.has(m.effectiveAiMode) ? m.effectiveAiMode : "",
    provider: typeof m.provider === "string" ? m.provider : "",
    model: typeof m.model === "string" ? m.model : "",
    sentToProvider: Boolean(m.sentToProvider),
    sentToBackend: Boolean(m.sentToBackend),
    contentSource: typeof m.contentSource === "string" ? m.contentSource : "",
    originalCharCount: toNonNegativeInt(m.originalCharCount, 0),
    submittedCharCount: toNonNegativeInt(m.submittedCharCount, 0),
    redactionCounts: counts,
    siteRule: typeof m.siteRule === "string" ? m.siteRule : "",
    host: normalizeHost(m.host),
    storedBuckets: Array.isArray(m.storedBuckets) ? m.storedBuckets.filter((b) => typeof b === "string") : [],
    timestamp: typeof m.timestamp === "string" && m.timestamp ? m.timestamp : new Date().toISOString()
  };
}

// --- clear-data / retention helpers ---

function validateClearBuckets(value) {
  if (!Array.isArray(value) || value.length === 0) return { error: "buckets must be a non-empty array" };
  const buckets = [];
  for (const bucket of value) {
    if (!CLEAR_DATA_BUCKETS.includes(bucket)) return { error: `Unknown bucket: ${bucket}` };
    if (!buckets.includes(bucket)) buckets.push(bucket);
  }
  return { buckets };
}

function parseBeforeTimestamp(value) {
  if (value === undefined || value === null || value === "") return null;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return { error: "Invalid 'before' timestamp" };
  return { before: new Date(time).toISOString() };
}

function itemTimestamp(item) {
  if (!item || typeof item !== "object") return null;
  return item.createdAt || item.updatedAt || item.timestamp || null;
}

function isOlderThan(item, cutoffIso) {
  if (!cutoffIso) return false;
  const ts = itemTimestamp(item);
  if (!ts) return false;
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return false;
  return t < Date.parse(cutoffIso);
}

// Returns kept array + removed-id list, removing items older than cutoff.
function partitionByRetention(items, cutoffIso, idKey = "id") {
  const kept = [];
  const removedIds = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (cutoffIso && isOlderThan(item, cutoffIso)) {
      if (item && item[idKey]) removedIds.push(item[idKey]);
    } else {
      kept.push(item);
    }
  }
  return { kept, removedIds };
}

const RETENTION_BUCKET_DAYS = {
  memory: "memoryDays",
  contacts: "contactsDays",
  tasks: "tasksDays",
  drafts: "draftsDays",
  tableRows: "tableRowsDays",
  privacyEvents: "privacyEventsDays"
};

function retentionCutoff(retention, bucket, now = Date.now()) {
  const field = RETENTION_BUCKET_DAYS[bucket];
  if (!field) return null;
  const days = toNonNegativeInt(retention && retention[field], 0);
  if (days <= 0) return null;
  return new Date(now - days * 86400000).toISOString();
}

function capPrivacyEvents(events) {
  const list = Array.isArray(events) ? events : [];
  if (list.length <= MAX_PRIVACY_EVENTS) return list;
  return list.slice(0, MAX_PRIVACY_EVENTS);
}

// Map a privacy HTTP route to its service-worker message. Returns null if the
// path is not a privacy route, so callers can fall through to other routing.
function buildPrivacyMessage(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  let url;
  try {
    url = new URL(path, "https://aaw.local");
  } catch {
    return null;
  }
  const pathname = url.pathname;
  const body = options.body ? JSON.parse(options.body) : {};

  if (pathname === "/api/privacy/settings") {
    if (method === "PATCH") return { type: "PRIVACY_SETTINGS_PATCH", patch: body };
    return { type: "PRIVACY_SETTINGS_GET" };
  }
  if (pathname === "/api/privacy/clear-data" && method === "POST") {
    return { type: "PRIVACY_CLEAR_DATA", buckets: body.buckets, before: body.before, confirmationToken: body.confirmationToken };
  }
  if (pathname === "/api/privacy/provenance" && method === "GET") {
    const limit = parseInt(url.searchParams.get("limit"), 10);
    const offset = parseInt(url.searchParams.get("offset"), 10);
    return {
      type: "PRIVACY_PROVENANCE_LIST",
      limit: Number.isFinite(limit) ? limit : 50,
      offset: Number.isFinite(offset) ? offset : 0
    };
  }
  if (pathname === "/api/privacy/retention/run" && method === "POST") {
    return { type: "PRIVACY_RETENTION_RUN" };
  }
  return null;
}

const API = {
  PRIVACY_SCHEMA_VERSION,
  AI_MODES,
  REQUEST_AI_MODES,
  CLEAR_DATA_BUCKETS,
  PRESERVED_STORAGE_KEYS,
  RETENTION_BUCKET_DAYS,
  MAX_PRIVACY_EVENTS,
  defaultPrivacySettings,
  normalizePrivacySettings,
  mergePrivacySettings,
  normalizeHost,
  normalizeHostRule,
  hostMatchesRule,
  normalizeHostList,
  normalizeHostOverrides,
  evaluatePrivacy,
  redactString,
  redactValue,
  sanitizeUrlForProvider,
  prepareOutboundContent,
  privacyPreflight,
  sanitizeProvenance,
  validateClearBuckets,
  parseBeforeTimestamp,
  isOlderThan,
  partitionByRetention,
  retentionCutoff,
  capPrivacyEvents,
  buildPrivacyMessage
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = API;
}

// Expose on the global object for content scripts (window) and the service
// worker (self). Node has neither `self` nor `window`, so globalScope is
// globalThis there and this stays harmless for require()-based tests.
if (globalScope) globalScope.AssistantPrivacy = API;

})(typeof self !== "undefined" ? self : (typeof window !== "undefined" ? window : globalThis));
