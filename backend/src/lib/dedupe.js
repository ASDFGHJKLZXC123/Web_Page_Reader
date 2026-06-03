"use strict";

const {
  compactStringArray,
  contactDedupeKey,
  contentHashFor,
  normalizeActions,
  normalizeContactItem,
  normalizeMemoryItem,
  normalizeSearchText,
  normalizeSourceUrl,
  normalizeTaskItem,
  sourceParts
} = require("./foundation");

const MAX_PREVIEW_CHARS = 280;
const MAX_AUDIT = 100;

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function stableHash(value) {
  const text = stableStringify(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0).toString(16);
}

function sourceKey(value) {
  const normalized = normalizeSourceUrl(value);
  return normalized ? sourceParts(normalized).urlKey : "";
}

function sourcePathKey(value) {
  const normalized = normalizeSourceUrl(value);
  if (!normalized) return "";
  try {
    const url = new URL(normalized);
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    const entries = [...url.searchParams.entries()].sort((a, b) => `${a[0]}=${a[1]}`.localeCompare(`${b[0]}=${b[1]}`));
    url.search = "";
    for (const [key, val] of entries) url.searchParams.append(key, val);
    return url.toString();
  } catch {
    return "";
  }
}

function dedupeText(value) {
  return normalizeSearchText(value).slice(0, 160);
}

function safePreviewText(...values) {
  const text = values.find((value) => typeof value === "string" && value.trim()) || "";
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_PREVIEW_CHARS);
}

function groupId(type, key) {
  return `${type}:${stableHash(key)}:${key.slice(0, 80)}`;
}

function addGroup(groups, type, reason, key, item) {
  if (!key || !item || !item.id) return;
  const id = groupId(type, key);
  if (!groups.has(id)) groups.set(id, { groupId: id, type, reason, key, itemIds: [], records: [] });
  const group = groups.get(id);
  if (group.itemIds.includes(item.id)) return;
  group.itemIds.push(item.id);
  group.records.push(item);
}

function contactPreview(contact) {
  return {
    id: contact.id,
    label: contact.name || contact.company || contact.email || "Contact",
    summary: safePreviewText([contact.company, contact.roleTitle, contact.email, contact.phone, contact.notes].filter(Boolean).join(" - ")),
    meta: { email: contact.email, phone: contact.phone, company: contact.company, status: contact.leadStatus }
  };
}

function taskPreview(task) {
  return {
    id: task.id,
    label: task.title || "Task",
    summary: safePreviewText(task.notes, task.sourceSnippet, task.sourceTitle),
    meta: { status: task.status, priority: task.priority, dueDate: task.dueDate, sourceUrl: task.sourceUrl }
  };
}

function memoryPreview(item) {
  return {
    id: item.id,
    label: item.title || "Saved note",
    summary: safePreviewText(item.note, item.summary, item.snippet),
    meta: { sourceUrl: item.sourceUrl, sourceType: item.sourceType, createdAt: item.createdAt }
  };
}

function sourcePreview(record) {
  return {
    id: record.id,
    label: record.title || record.sourceHost || record.urlKey || "Source",
    summary: safePreviewText(record.title, record.urlKey),
    meta: { urlKey: record.urlKey, recordCount: record.recordIds.length, recordIds: record.recordIds.slice(0, 8) }
  };
}

function normalizeDataset(dataset = {}) {
  const memory = (Array.isArray(dataset.memory) ? dataset.memory : []).map(normalizeMemoryItem);
  const actions = normalizeActions(dataset.actions || {});
  return {
    memory,
    contacts: actions.contacts.map(normalizeContactItem),
    tasks: actions.tasks.map(normalizeTaskItem),
    ignored: Array.isArray(dataset.ignored) ? dataset.ignored : dataset.dedupeIgnored || []
  };
}

function ignoredIds(ignored = []) {
  return new Set((Array.isArray(ignored) ? ignored : [])
    .map((item) => typeof item === "string" ? item : item && item.groupId)
    .filter(Boolean));
}

function buildDedupeCandidates(dataset = {}, { type = "all", includeIgnored = false } = {}) {
  const data = normalizeDataset(dataset);
  const groups = new Map();

  for (const contact of data.contacts) {
    addGroup(groups, "contact", "same normalized lead identity", contactDedupeKey(contact), contact);
  }

  for (const task of data.tasks) {
    if (task.clientRequestId) addGroup(groups, "task", "same client request", `client:${task.clientRequestId}`, task);
    const title = dedupeText(task.title);
    const source = sourceKey(task.sourceUrl);
    if (title && source) addGroup(groups, "task", "same title and source", `title-source:${title}|${source}`, task);
    if (title && task.dueDate && source) addGroup(groups, "task", "same title, due date, and source", `title-due-source:${title}|${task.dueDate}|${source}`, task);
  }

  for (const item of data.memory) {
    if (item.fingerprint) addGroup(groups, "memory", "same page fingerprint", `fingerprint:${item.fingerprint}`, item);
    if (item.contentHash) addGroup(groups, "memory", "same content hash", `content:${item.contentHash}`, item);
    const key = sourceKey(item.sourceUrl || item.canonicalUrl);
    const note = dedupeText(item.note || item.snippet);
    const title = dedupeText(item.title);
    if (key && note) addGroup(groups, "memory", "same source and note", `source-note:${key}|${note}`, item);
    if (key && title) addGroup(groups, "memory", "same title and source", `title-source:${title}|${key}`, item);
  }

  const sources = new Map();
  const addSource = (kind, item, title, url) => {
    const key = sourceKey(url);
    if (!key) return;
    if (!sources.has(key)) {
      sources.set(key, {
        id: `source:${stableHash(key)}`,
        urlKey: key,
        pathKey: sourcePathKey(key),
        title: title || sourceParts(key).sourceHost,
        hasTitle: Boolean(title),
        recordIds: [],
        sourceHost: sourceParts(key).sourceHost
      });
    }
    sources.get(key).recordIds.push(`${kind}:${item.id}`);
  };
  for (const item of data.memory) addSource("memory", item, item.sourceTitle || item.title, item.sourceUrl || item.canonicalUrl);
  for (const contact of data.contacts) addSource("contact", contact, contact.sourceTitle || contact.name, contact.sourceUrl);
  for (const task of data.tasks) addSource("task", task, task.sourceTitle || task.title, task.sourceUrl);
  for (const record of sources.values()) {
    addGroup(groups, "source", "same normalized source URL", `source:${record.urlKey}`, record);
    if (record.pathKey) addGroup(groups, "source", "same normalized source host/path", `source-path:${record.pathKey}`, record);
    const title = record.hasTitle ? dedupeText(record.title) : "";
    if (title && record.sourceHost) addGroup(groups, "source", "same source host and title", `source-title:${record.sourceHost}|${title}`, record);
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

  const ignored = ignoredIds(data.ignored);
  return [...consolidated.values()]
    .filter((group) => group.itemIds.length > 1 || (group.type === "source" && group.records.some((record) => (record.recordIds || []).length > 1)))
    .filter((group) => type === "all" || group.type === type)
    .map((group) => {
      const ignoredGroup = ignored.has(group.groupId);
      const preview = group.type === "contact" ? group.records.map(contactPreview)
        : group.type === "task" ? group.records.map(taskPreview)
        : group.type === "memory" ? group.records.map(memoryPreview)
        : group.records.map(sourcePreview);
      return {
        groupId: group.groupId,
        type: group.type,
        reason: group.reason,
        key: group.key,
        itemIds: [...group.itemIds].sort(),
        ignored: ignoredGroup,
        mergeable: group.type !== "source",
        preview
      };
    })
    .filter((group) => includeIgnored || !group.ignored)
    .sort((a, b) => `${a.type}:${a.key}`.localeCompare(`${b.type}:${b.key}`));
}

function recordFingerprint(type, records) {
  return records.map((record) => {
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

function buildMergePreview(dataset = {}, input = {}) {
  const candidates = buildDedupeCandidates(dataset, { includeIgnored: true, type: input.type || "all" });
  const candidate = input.groupId
    ? candidates.find((item) => item.groupId === input.groupId)
    : candidates.find((item) => item.type === input.type && (!input.itemIds || input.itemIds.every((id) => item.itemIds.includes(id))));
  if (!candidate) return { error: "Duplicate group not found" };
  const ids = [...candidate.itemIds].sort();
  const primaryId = input.primaryId && ids.includes(input.primaryId) ? input.primaryId : ids[0];
  const duplicateIds = ids.filter((id) => id !== primaryId);
  const data = normalizeDataset(dataset);
  const sourceRecords = candidate.type === "contact" ? data.contacts
    : candidate.type === "task" ? data.tasks
    : candidate.type === "memory" ? data.memory
    : candidate.preview;
  const records = candidate.type === "source"
    ? candidate.preview
    : ids.map((id) => sourceRecords.find((record) => record.id === id)).filter(Boolean);
  const planHash = stableHash({
    version: 1,
    type: candidate.type,
    groupId: candidate.groupId,
    primaryId,
    duplicateIds,
    records: recordFingerprint(candidate.type, records)
  });
  return {
    ...candidate,
    primaryId,
    duplicateIds,
    planHash,
    operations: candidate.type === "source"
      ? [{ action: "ignore_or_review", description: "Source groups are derived; no stored source record will be merged." }]
      : [
          { action: "keep", id: primaryId },
          ...duplicateIds.map((id) => ({ action: "merge_delete", id })),
          { action: "rewrite_links", description: "References to duplicate IDs will be rewritten to the kept record where applicable." }
        ]
  };
}

function capAudit(items = []) {
  return (Array.isArray(items) ? items : []).slice(0, MAX_AUDIT);
}

module.exports = {
  MAX_AUDIT,
  buildDedupeCandidates,
  buildMergePreview,
  capAudit,
  safePreviewText,
  sourceKey,
  stableHash
};
