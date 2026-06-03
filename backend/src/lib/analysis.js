function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateText(text, maxLength = 12000) {
  const normalized = normalizeText(text);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return normalized.slice(0, maxLength);
}

function splitSentences(text) {
  return normalizeText(text)
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function topSentences(text, count) {
  const sentences = splitSentences(text);
  const scored = sentences.map((sentence, index) => {
    const words = sentence.toLowerCase().match(/[a-z0-9]+/g) || [];
    const unique = new Set(words).size;
    const score = unique + clamp(sentence.length / 30, 0, 8) - index * 0.15;
    return { sentence, score, index };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.sentence);
}

function summarizeText(text) {
  const summary = topSentences(text, 3).join(" ");
  return summary || "No meaningful text was available to summarize.";
}

function keyPointsFromText(text, count = 5) {
  return topSentences(text, count);
}

function buildSummaryObject({ content, title, url, source = {}, engine = "local" } = {}) {
  const text = normalizeText(content);
  const questions = splitSentences(text)
    .filter((sentence) => sentence.includes("?"))
    .slice(0, 3);

  return {
    schemaVersion: 1,
    tldr: summarizeText(text),
    keyPoints: keyPointsFromText(text, 5),
    importantDetails: keyPointsFromText(text, 8).slice(3, 8),
    openQuestions: questions,
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
  if (sentences.length === 0) {
    return "No text was available to rewrite.";
  }

  const opener = instruction
    ? `Rewrite goal: ${instruction.trim()}.`
    : "Rewrite goal: clearer and shorter.";

  const bullets = sentences.map((sentence) => {
    const trimmed = sentence.replace(/\s+/g, " ").trim();
    const softened = trimmed.replace(/\b(is|are|was|were)\b/gi, "can be");
    return `- ${softened}`;
  });

  return [opener, ...bullets].join("\n");
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

function normalizeLinkType(url, fallback = "page") {
  const value = String(url || "").trim();
  if (/^mailto:/i.test(value)) return "email";
  if (/^tel:/i.test(value)) return "phone";
  return fallback || "page";
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
      type: normalizeLinkType(url, link.type),
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
  return clamp(n, 0, 1);
}

function normalizeFieldConfidence(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const out = {};
  for (const key of Object.keys(source)) {
    out[key] = normalizeConfidence(source[key], 0);
  }
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
  const matches = Array.from(
    new Set(
      String(text || "").match(
        /\b(?:\d{4}-\d{2}-\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]* \d{1,2}, \d{4})\b/gi
      ) || []
    )
  );
  return matches.map((value) => ({
    text: value,
    isoDate: /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "",
    context: "",
    type: "mentioned"
  }));
}

function extractStructuredInfo(text, title, url, pageMeta = {}) {
  const emails = Array.from(new Set(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []));
  const phones = Array.from(
    new Set(text.match(/(?:\+?\d{1,2}\s*)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}/g) || [])
  );
  const headings = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && line.length < 80)
    .slice(0, 8);

  return {
    schemaVersion: 2,
    title: title || "Untitled page",
    url: url || "",
    summary: summarizeText(text),
    keyPoints: headings,
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
  return normalizeText(text)
    .toLowerCase()
    .match(/[a-z0-9]{2,}/g) || [];
}

function buildEmbedding(text, dimensions = 48) {
  const vector = new Array(dimensions).fill(0);
  const tokens = tokenize(text);

  if (tokens.length === 0) {
    return vector;
  }

  for (const token of tokens) {
    let hash = 2166136261;
    for (let index = 0; index < token.length; index += 1) {
      hash ^= token.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }

    const slot = Math.abs(hash) % dimensions;
    vector[slot] += 1;
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => Number((value / magnitude).toFixed(6)));
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
    return 0;
  }

  let sum = 0;
  for (let index = 0; index < a.length; index += 1) {
    sum += a[index] * b[index];
  }
  return sum;
}

function buildResponse({ mode, content, instruction, title, url, pageMeta, source }) {
  const text = normalizeText(content);

  if (mode === "rewrite") {
    return {
      mode,
      output: {
        replacement: sanitizeRewriteText(rewriteText(text, instruction), content),
        source: "local-fallback"
      }
    };
  }

  if (mode === "extract") {
    return {
      mode,
      output: extractStructuredInfo(content, title, url, pageMeta)
    };
  }

  return {
    mode: "summarize",
    output: buildSummaryObject({ content: text, title, url, source, engine: "local" })
  };
}

module.exports = {
  buildEmbedding,
  buildResponse,
  buildSummaryObject,
  cosineSimilarity,
  extractStructuredInfo,
  buildTaskDraft,
  normalizeText,
  normalizeExtractOutput,
  normalizeSummaryOutput,
  sanitizeProvenanceShape,
  sanitizeRewriteText,
  summarizeText,
  tokenize,
  truncateText
};
