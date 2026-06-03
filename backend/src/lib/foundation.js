"use strict";

const { defaultPrivacySettings, normalizePrivacySettings, capPrivacyEvents, sanitizeProvenance } = require("./privacy");

const DEFAULT_ACTIONS = {
  tasks: [],
  tableRows: [],
  contacts: [],
  drafts: []
};

const DEFAULT_DB = {
  memory: [],
  noteWorkspaces: [],
  deletedWorkspaces: [],
  actions: { ...DEFAULT_ACTIONS },
  privacySettings: defaultPrivacySettings(),
  privacyEvents: [],
  dedupeAudit: [],
  dedupeIgnored: []
};

const DEFAULT_WORKSPACES = [
  { id: "nw_default_job_search", name: "Job Search" },
  { id: "nw_default_startup_ideas", name: "Startup Ideas" },
  { id: "nw_default_research", name: "Research" },
  { id: "nw_default_client_leads", name: "Client Leads" }
];

const LEAD_STATUSES = new Set(["new", "contacted", "qualified", "disqualified", "archived"]);
const TASK_STATUSES = new Set(["open", "in_progress", "done", "archived"]);
const TASK_PRIORITIES = new Set(["none", "low", "medium", "high"]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
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

function normalizeWorkspaceIds(item = {}) {
  // Canonical single-value workspaceId takes precedence over legacy arrays.
  if (typeof item.workspaceId === "string" && item.workspaceId.trim()) return [item.workspaceId.trim()];
  if (Array.isArray(item.workspaceIds)) return compactStringArray(item.workspaceIds);
  return compactStringArray(item.taskIds);
}

// Reduce any legacy multi-workspace membership to a single canonical workspaceId.
// When a workspaceIdSet is supplied, pick the first membership that still exists
// (the migration rule for previously multi-workspace memory); otherwise take the first.
function pickWorkspaceId(item, workspaceIdSet) {
  const ids = normalizeWorkspaceIds(item);
  // Only a real Set narrows to "first still-existing" membership; guards against
  // accidental array-map callbacks passing an index as the second argument.
  if (workspaceIdSet instanceof Set) return ids.find((id) => workspaceIdSet.has(id)) || "";
  return ids[0] || "";
}

function normalizeMemoryItem(item = {}, workspaceIdSet = null) {
  const workspaceId = pickWorkspaceId(item, workspaceIdSet);
  const workspaceIds = workspaceId ? [workspaceId] : [];
  return {
    ...item,
    tags: compactStringArray(item.tags),
    // Canonical single workspace assignment ("" means Inbox/Unassigned).
    workspaceId,
    // Legacy compatibility: existing UI/API still reads these arrays.
    workspaceIds,
    taskIds: workspaceIds,
    linkedTaskIds: compactStringArray(item.linkedTaskIds)
  };
}

function normalizeDeletedWorkspaces(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: typeof raw.name === "string" ? raw.name.trim() : "" });
  }
  return out;
}

function deriveContactWorkspaceId(contact, memoryById, memoryByContactId) {
  for (const memoryId of compactStringArray(contact.memoryIds)) {
    const item = memoryById.get(memoryId);
    if (item && item.workspaceId) return item.workspaceId;
  }
  for (const item of memoryByContactId.get(contact.id) || []) {
    if (item.workspaceId) return item.workspaceId;
  }
  return "";
}

function deriveTaskWorkspaceId(task, memoryById) {
  for (const memoryId of compactStringArray(task.sourceMemoryIds || task.memoryIds)) {
    const item = memoryById.get(memoryId);
    if (item && item.workspaceId) return item.workspaceId;
  }
  return "";
}

function normalizeWorkspaceItem(workspace = {}) {
  return {
    ...workspace,
    id: typeof workspace.id === "string" ? workspace.id : "",
    name: typeof workspace.name === "string" ? workspace.name : "",
    status: workspace.status === "archived" ? "archived" : "open"
  };
}

function seedDefaultWorkspaces(workspaces = [], deletedIds = [], now = new Date().toISOString()) {
  const existing = Array.isArray(workspaces) ? workspaces.map(normalizeWorkspaceItem) : [];
  const ids = new Set(existing.map((workspace) => workspace.id).filter(Boolean));
  const names = new Set(existing.map((workspace) => workspace.name.trim().toLowerCase()).filter(Boolean));
  const tombstoned = deletedIds instanceof Set ? deletedIds : new Set(deletedIds || []);
  const missing = [];

  for (const workspace of DEFAULT_WORKSPACES) {
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

  return {
    items: [...missing, ...existing],
    added: missing.length
  };
}

function countUnassignedNotes(memory = []) {
  return (Array.isArray(memory) ? memory : [])
    .map(normalizeMemoryItem)
    .filter((item) => item.workspaceIds.length === 0)
    .length;
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

function normalizeContactItem(contact = {}) {
  const emails = compactStringArray(contact.emails).map(normalizeEmail).filter(Boolean);
  if (typeof contact.email === "string" && contact.email.trim()) {
    emails.unshift(normalizeEmail(contact.email));
  }
  const phones = compactStringArray(contact.phones).map(normalizePhone).filter(Boolean);
  if (typeof contact.phone === "string" && contact.phone.trim()) {
    phones.unshift(normalizePhone(contact.phone));
  }
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
    sourceUrl,
    sourceTitle: typeof contact.sourceTitle === "string" ? contact.sourceTitle : "",
    sourceDomain,
    pageKind: typeof contact.pageKind === "string" ? contact.pageKind : "webpage",
    name,
    firstName: typeof contact.firstName === "string" && contact.firstName.trim() ? contact.firstName.trim() : (nameParts[0] || ""),
    lastName: typeof contact.lastName === "string" && contact.lastName.trim() ? contact.lastName.trim() : (nameParts.length > 1 ? nameParts.slice(1).join(" ") : ""),
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
    workspaceId,
    // Legacy compatibility: always [] or [workspaceId].
    workspaceIds,
    taskIds: workspaceIds,
    leadStatus: LEAD_STATUSES.has(contact.leadStatus) ? contact.leadStatus : "new",
    notes: typeof contact.notes === "string" ? contact.notes : "",
    confidence: typeof contact.confidence === "number" ? Math.max(0, Math.min(1, contact.confidence)) : 0.5,
    fieldConfidence: contact.fieldConfidence && typeof contact.fieldConfidence === "object" ? contact.fieldConfidence : {},
    tags: compactStringArray(contact.tags),
    memoryIds: compactStringArray(contact.memoryIds)
  };
}

function contactDedupeKey(contact = {}) {
  const normalized = normalizeContactItem(contact);
  if (normalized.email) return `email:${normalized.email}`;
  if (normalized.linkedInUrl) return `linkedin:${normalized.linkedInUrl}`;
  if (normalized.phone) return `phone:${normalized.phone}`;
  const name = normalized.name.toLowerCase();
  const companyOrDomain = (normalized.company || normalized.sourceDomain).toLowerCase();
  if (name && name !== "unknown contact" && companyOrDomain) return `name:${name}|${companyOrDomain}`;
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

function normalizeActions(actions = {}) {
  return {
    tasks: Array.isArray(actions.tasks) ? actions.tasks.map(normalizeTaskItem) : [],
    tableRows: Array.isArray(actions.tableRows) ? actions.tableRows : [],
    contacts: Array.isArray(actions.contacts) ? actions.contacts.map(normalizeContactItem) : [],
    drafts: Array.isArray(actions.drafts) ? actions.drafts : []
  };
}

function normalizeDbShape(db) {
  if (!db || typeof db !== "object") return clone(DEFAULT_DB);
  const memory = Array.isArray(db.memory) ? db.memory.map(normalizeMemoryItem) : [];
  const memoryById = new Map(memory.map((item) => [item.id, item]));
  const memoryByContactId = new Map();
  for (const item of memory) {
    if (!item.contactId) continue;
    if (!memoryByContactId.has(item.contactId)) memoryByContactId.set(item.contactId, []);
    memoryByContactId.get(item.contactId).push(item);
  }
  const actions = normalizeActions(db.actions);
  // Derive a canonical contact/task workspaceId from linked/source memory when the
  // item has no explicit assignment. Keeps single-workspace membership coherent.
  actions.contacts = actions.contacts.map((contact) => {
    if (contact.workspaceId) return contact;
    const derived = deriveContactWorkspaceId(contact, memoryById, memoryByContactId);
    return derived ? normalizeContactItem({ ...contact, workspaceId: derived }) : contact;
  });
  actions.tasks = actions.tasks.map((task) => {
    if (task.workspaceId) return task;
    const derived = deriveTaskWorkspaceId(task, memoryById);
    return derived ? normalizeTaskItem({ ...task, workspaceId: derived }) : task;
  });
  return {
    ...db,
    memory,
    noteWorkspaces: Array.isArray(db.noteWorkspaces) ? db.noteWorkspaces.map(normalizeWorkspaceItem) : [],
    deletedWorkspaces: normalizeDeletedWorkspaces(db.deletedWorkspaces),
    actions,
    privacySettings: normalizePrivacySettings(db.privacySettings),
    privacyEvents: capPrivacyEvents(Array.isArray(db.privacyEvents) ? db.privacyEvents.map(sanitizeProvenance) : []),
    dedupeAudit: Array.isArray(db.dedupeAudit) ? db.dedupeAudit : [],
    dedupeIgnored: Array.isArray(db.dedupeIgnored) ? db.dedupeIgnored : []
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

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function tokenizeSearchQuery(value) {
  return normalizeSearchText(value)
    .match(/[a-z0-9]{2,}/g) || [];
}

function buildMemorySearchFields(item = {}, workspaceNames = []) {
  return [
    { name: "title", label: "title", weight: 1, text: item.title },
    { name: "note", label: "note", weight: 0.95, text: item.note },
    { name: "tags", label: "tags", weight: 0.9, text: Array.isArray(item.tags) ? item.tags.join(" ") : "" },
    { name: "workspace", label: "workspace", weight: 0.85, text: Array.isArray(workspaceNames) ? workspaceNames.join(" ") : "" },
    { name: "summary", label: "summary", weight: 0.75, text: item.summary },
    { name: "snippet", label: "snippet", weight: 0.7, text: item.snippet },
    { name: "sourceHost", label: "hostname", weight: 0.6, text: item.sourceHost },
    { name: "sourceUrl", label: "source URL", weight: 0.5, text: item.sourceUrl },
    { name: "pageExcerpt", label: "page excerpt", weight: 0.45, text: item.pageExcerpt }
  ];
}

function scoreMemoryKeyword(query, item = {}, workspaceNames = []) {
  const terms = [...new Set(tokenizeSearchQuery(query))];
  if (terms.length === 0) {
    return {
      keywordScore: 0,
      matchedFields: [],
      matchedTerms: []
    };
  }

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

module.exports = {
  DEFAULT_ACTIONS,
  DEFAULT_DB,
  DEFAULT_WORKSPACES,
  LEAD_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  buildMemoryItem,
  buildMemorySearchText,
  buildMemorySearchFields,
  compactStringArray,
  contentHashFor,
  countUnassignedNotes,
  normalizeActions,
  normalizeContactItem,
  contactDedupeKey,
  normalizeDbShape,
  normalizeMemoryItem,
  normalizeSearchText,
  normalizeSourceUrl,
  normalizeTaskItem,
  normalizeWorkspaceIds,
  normalizeWorkspaceItem,
  seedDefaultWorkspaces,
  scoreMemoryKeyword,
  sourceParts,
  tokenizeSearchQuery,
  mergeContactItems,
  normalizeEmail,
  normalizePhone,
  normalizeUrlValue
};
