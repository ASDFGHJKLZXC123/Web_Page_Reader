const fs = require("fs");
const path = require("path");
const {
  DEFAULT_DB,
  TASK_PRIORITIES,
  TASK_STATUSES,
  compactStringArray,
  contactDedupeKey,
  mergeContactItems,
  normalizeActions,
  normalizeContactItem,
  normalizeDbShape,
  normalizeMemoryItem,
  normalizeSourceUrl,
  normalizeTaskItem,
  normalizeWorkspaceItem,
  seedDefaultWorkspaces
} = require("./foundation");

const {
  capPrivacyEvents,
  mergePrivacySettings,
  normalizePrivacySettings,
  partitionByRetention,
  retentionCutoff,
  sanitizeProvenance
} = require("./privacy");

const {
  buildDedupeCandidates,
  buildMergePreview,
  capAudit
} = require("./dedupe");

function resolveDataDir() {
  if (!process.env.NOTES_DIR) {
    return path.join(__dirname, "..", "..", "data");
  }
  const resolved = path.resolve(process.env.NOTES_DIR);
  try {
    fs.mkdirSync(resolved, { recursive: true });
    fs.accessSync(resolved, fs.constants.W_OK);
  } catch (err) {
    console.error(`[storage] FATAL: NOTES_DIR=${resolved} cannot be created or is not writable.`);
    console.error(`[storage] Underlying error: ${err.message}`);
    process.exit(1);
  }
  return resolved;
}

const dataDir = resolveDataDir();
const dbFile = path.join(dataDir, "db.json");
const embeddingsFile = path.join(dataDir, "embeddings.ndjson");
const restorePointsDir = path.join(dataDir, "restore-points");
const BACKUP_FORMAT = "aaw.backup.v1";
const BACKUP_CONFIRMATION = "REPLACE";
const APP_VERSION = "0.1.0";

function getDataDir() {
  return dataDir;
}

// In-memory write-through cache. Populated on first load, stays warm.
let dbCache = null;

// Write queue: serializes all disk writes so concurrent requests never clobber each other.
let writeChain = Promise.resolve();
let defaultWorkspaceSeed = null;

function enqueueWrite(fn) {
  writeChain = writeChain.then(fn).catch(() => {});
  return writeChain;
}

async function ensureDb() {
  await fs.promises.mkdir(dataDir, { recursive: true });
  await fs.promises.mkdir(restorePointsDir, { recursive: true });

  try {
    await fs.promises.access(dbFile);
  } catch {
    await fs.promises.writeFile(dbFile, JSON.stringify(DEFAULT_DB, null, 2));
  }

  try {
    await fs.promises.access(embeddingsFile);
  } catch {
    await fs.promises.writeFile(embeddingsFile, "");
  }
}

async function loadDb() {
  if (dbCache !== null) return dbCache;

  await ensureDb();

  let raw;
  try {
    raw = await fs.promises.readFile(dbFile, "utf8");
  } catch {
    dbCache = structuredClone(DEFAULT_DB);
    await fs.promises.writeFile(dbFile, JSON.stringify(dbCache, null, 2));
    return dbCache;
  }

  try {
    dbCache = normalizeDbShape(JSON.parse(raw));
  } catch {
    // Rename corrupt file instead of silently overwriting — prevent data loss
    const backup = `${dbFile}.broken-${Date.now()}`;
    await fs.promises.rename(dbFile, backup).catch(() => {});
    console.error(`[storage] Corrupt db.json renamed to ${path.basename(backup)}. Starting fresh.`);
    dbCache = structuredClone(DEFAULT_DB);
    await fs.promises.writeFile(dbFile, JSON.stringify(dbCache, null, 2));
  }

  return dbCache;
}

async function saveDb(db) {
  await ensureDb();
  // Atomic write: write to temp file then rename
  const tmp = `${dbFile}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(db, null, 2));
  await fs.promises.rename(tmp, dbFile);
  dbCache = db;
}

async function deleteEmbedding(id) {
  await ensureDb();
  let content = "";
  try {
    content = await fs.promises.readFile(embeddingsFile, "utf8");
  } catch {
    return;
  }

  let removed = false;
  const kept = [];
  for (const rawLine of content.split("\n")) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed);
      if (entry.id === id) {
        removed = true;
        continue;
      }
    } catch {
      // Preserve malformed lines; loadAllEmbeddings already skips them.
    }
    kept.push(rawLine);
  }

  if (!removed) return;
  const tmp = `${embeddingsFile}.tmp`;
  await fs.promises.writeFile(tmp, kept.length ? `${kept.join("\n")}\n` : "", "utf8");
  await fs.promises.rename(tmp, embeddingsFile);
}

// Rewrites embeddings.ndjson keeping only lines whose id `keep(id)` returns true.
// When removeAll is true the file is emptied. Not enqueued itself — callers must
// run it inside enqueueWrite so it serializes with db.json writes.
async function compactEmbeddings({ removeAll = false, removeIds = null } = {}) {
  await ensureDb();
  if (removeAll) {
    const tmp = `${embeddingsFile}.tmp`;
    await fs.promises.writeFile(tmp, "", "utf8");
    await fs.promises.rename(tmp, embeddingsFile);
    return;
  }
  const ids = removeIds instanceof Set ? removeIds : new Set(removeIds || []);
  if (ids.size === 0) return;
  let content = "";
  try {
    content = await fs.promises.readFile(embeddingsFile, "utf8");
  } catch {
    return;
  }
  const kept = [];
  for (const rawLine of content.split("\n")) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed);
      if (ids.has(entry.id)) continue;
    } catch {
      // Preserve malformed lines.
    }
    kept.push(rawLine);
  }
  const tmp = `${embeddingsFile}.tmp`;
  await fs.promises.writeFile(tmp, kept.length ? `${kept.join("\n")}\n` : "", "utf8");
  await fs.promises.rename(tmp, embeddingsFile);
}

async function appendMemory(item) {
  return enqueueWrite(async () => {
    const db = await loadDb();

    // Separate embedding from the main item before persisting
    const { embedding, ...itemWithoutEmbedding } = item;

    if (embedding && Array.isArray(embedding) && embedding.length > 0) {
      const line = JSON.stringify({
        id: item.id,
        embedding,
        meta: item.embeddingMeta || {
          provider: "legacy",
          model: "unknown",
          dimensions: embedding.length,
          version: 0,
          createdAt: item.createdAt || new Date().toISOString()
        }
      }) + "\n";
      await fs.promises.appendFile(embeddingsFile, line, "utf8");
    }

    db.memory.unshift(normalizeMemoryItem(itemWithoutEmbedding));
    await saveDb(db);
    return normalizeMemoryItem(itemWithoutEmbedding);
  });
}

async function listMemory() {
  const db = await loadDb();
  return db.memory.map(normalizeMemoryItem);
}

async function updateMemory(id, patch) {
  return enqueueWrite(async () => {
    const db = await loadDb();
    const index = db.memory.findIndex((item) => item.id === id);
    if (index === -1) return null;

    const next = normalizeMemoryItem(db.memory[index]);
    if (
      Object.prototype.hasOwnProperty.call(patch, "workspaceIds") ||
      Object.prototype.hasOwnProperty.call(patch, "taskIds")
    ) {
      const ids = Object.prototype.hasOwnProperty.call(patch, "workspaceIds")
        ? patch.workspaceIds
        : patch.taskIds;
      next.workspaceIds = Array.isArray(ids) ? ids : [];
      next.taskIds = next.workspaceIds;
      // Clear stale singular workspaceId so normalizeMemoryItem honors the new arrays.
      next.workspaceId = next.workspaceIds[0] || "";
    }
    if (Object.prototype.hasOwnProperty.call(patch, "note")) {
      next.note = typeof patch.note === "string" ? patch.note : "";
    }
    if (Object.prototype.hasOwnProperty.call(patch, "tags")) {
      next.tags = compactStringArray(patch.tags);
    }
    next.updatedAt = new Date().toISOString();
    db.memory[index] = normalizeMemoryItem(next);
    await saveDb(db);
    return db.memory[index];
  });
}

async function deleteMemory(id) {
  return enqueueWrite(async () => {
    const db = await loadDb();
    const index = db.memory.findIndex((item) => item.id === id);
    if (index === -1) return null;
    db.memory.splice(index, 1);
    await deleteEmbedding(id);
    await saveDb(db);
    return id;
  });
}

async function appendAction(kind, item) {
  return enqueueWrite(async () => {
    const db = await loadDb();
    if (!db.actions[kind]) db.actions[kind] = [];
    db.actions[kind].unshift(item);
    await saveDb(db);
    return item;
  });
}

async function listNoteWorkspaces(status = "open") {
  await ensureDefaultNoteWorkspaces();
  const db = await loadDb();
  const items = (db.noteWorkspaces || []).map(normalizeWorkspaceItem);
  if (status === "all") return items;
  return items.filter((workspace) => workspace.status === status);
}

async function ensureDefaultNoteWorkspaces() {
  if (defaultWorkspaceSeed) return defaultWorkspaceSeed;
  defaultWorkspaceSeed = enqueueWrite(async () => {
    const db = await loadDb();
    const deletedIds = (Array.isArray(db.deletedWorkspaces) ? db.deletedWorkspaces : []).map((workspace) => workspace.id);
    const seeded = seedDefaultWorkspaces(db.noteWorkspaces, deletedIds);
    if (seeded.added > 0) {
      db.noteWorkspaces = seeded.items;
      await saveDb(db);
    }
    return db.noteWorkspaces;
  }).finally(() => {
    defaultWorkspaceSeed = null;
  });
  return defaultWorkspaceSeed;
}

async function appendNoteWorkspace(item) {
  return enqueueWrite(async () => {
    const db = await loadDb();
    if (!Array.isArray(db.noteWorkspaces)) db.noteWorkspaces = [];
    db.noteWorkspaces.unshift(item);
    await saveDb(db);
    return item;
  });
}

async function updateNoteWorkspace(id, patch) {
  return enqueueWrite(async () => {
    const db = await loadDb();
    if (!Array.isArray(db.noteWorkspaces)) db.noteWorkspaces = [];
    const index = db.noteWorkspaces.findIndex((workspace) => workspace.id === id);
    if (index === -1) return null;
    db.noteWorkspaces[index] = {
      ...db.noteWorkspaces[index],
      ...patch,
      updatedAt: new Date().toISOString()
    };
    await saveDb(db);
    return db.noteWorkspaces[index];
  });
}

// Destructively delete a workspace and everything assigned to it: memory notes
// (and their embeddings), contacts, tasks, plus any cross-links pointing at the
// removed records. The workspace id is tombstoned so deleted defaults are not
// reseeded. Inbox/Unassigned (no real workspace record) cannot be deleted.
async function deleteNoteWorkspace(id) {
  return enqueueWrite(async () => {
    const workspaceId = String(id || "").trim();
    if (!workspaceId || workspaceId === "inbox" || workspaceId === "unassigned") {
      return { error: "Unassigned cannot be deleted" };
    }
    const db = await loadDb();
    const workspaces = Array.isArray(db.noteWorkspaces) ? db.noteWorkspaces : [];
    const index = workspaces.findIndex((workspace) => workspace.id === workspaceId);
    if (index === -1) return null;
    const [removed] = workspaces.splice(index, 1);
    db.noteWorkspaces = workspaces;

    const now = new Date().toISOString();
    const memory = Array.isArray(db.memory) ? db.memory.map(normalizeMemoryItem) : [];
    const removedMemoryIds = new Set(memory.filter((item) => item.workspaceId === workspaceId).map((item) => item.id));
    const contacts = Array.isArray(db.actions.contacts) ? db.actions.contacts.map(normalizeContactItem) : [];
    const removedContactIds = new Set(contacts.filter((contact) => contact.workspaceId === workspaceId).map((contact) => contact.id));
    const tasks = Array.isArray(db.actions.tasks) ? db.actions.tasks.map(normalizeTaskItem) : [];
    const removedTaskIds = new Set(tasks.filter((task) => task.workspaceId === workspaceId).map((task) => task.id));

    db.memory = memory
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

    db.actions.contacts = contacts
      .filter((contact) => !removedContactIds.has(contact.id))
      .map((contact) => {
        const memoryIds = (contact.memoryIds || []).filter((mid) => !removedMemoryIds.has(mid));
        if (memoryIds.length === (contact.memoryIds || []).length) return contact;
        return normalizeContactItem({ ...contact, memoryIds, updatedAt: now });
      });

    db.actions.tasks = tasks
      .filter((task) => !removedTaskIds.has(task.id))
      .map((task) => {
        const sourceMemoryIds = (task.sourceMemoryIds || []).filter((mid) => !removedMemoryIds.has(mid));
        if (sourceMemoryIds.length === (task.sourceMemoryIds || []).length) return task;
        return normalizeTaskItem({ ...task, sourceMemoryIds, updatedAt: now });
      });

    const deleted = Array.isArray(db.deletedWorkspaces) ? db.deletedWorkspaces : [];
    if (!deleted.some((workspace) => workspace.id === workspaceId)) {
      deleted.unshift({ id: workspaceId, name: removed.name || "" });
    }
    db.deletedWorkspaces = deleted;

    if (removedMemoryIds.size) await compactEmbeddings({ removeIds: removedMemoryIds });
    await saveDb(db);
    return {
      deleted: true,
      workspaceId,
      counts: { notes: removedMemoryIds.size, contacts: removedContactIds.size, tasks: removedTaskIds.size }
    };
  });
}

// If a workspace with this name was previously deleted, clear its tombstone and
// return its id so it can be restored/reused. Otherwise null.
async function restoreDeletedWorkspaceByName(name) {
  return enqueueWrite(async () => {
    const target = String(name || "").trim().toLowerCase();
    if (!target) return null;
    const db = await loadDb();
    const deleted = Array.isArray(db.deletedWorkspaces) ? db.deletedWorkspaces : [];
    const match = deleted.find((workspace) => (workspace.name || "").trim().toLowerCase() === target);
    if (!match) return null;
    db.deletedWorkspaces = deleted.filter((workspace) => workspace.id !== match.id);
    await saveDb(db);
    return { id: match.id, name: match.name };
  });
}

async function getActions() {
  const db = await loadDb();
  return normalizeActions(db.actions);
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
    ...(contact.tags || [])
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

function normalizeSort(field, dir, allowed, fallback) {
  const sortField = allowed.includes(field) ? field : fallback;
  return { field: sortField, dir: String(dir || "desc").toLowerCase() === "asc" ? "asc" : "desc" };
}

function compareValues(a, b) {
  if (a === b) return 0;
  if (a === undefined || a === null || a === "") return 1;
  if (b === undefined || b === null || b === "") return -1;
  return String(a).localeCompare(String(b));
}

function normalizeContactSort(field, dir) {
  return normalizeSort(field, dir, ["updatedAt", "createdAt", "name", "company", "leadStatus", "source"], "updatedAt");
}

function normalizeTaskSort(field, dir) {
  return normalizeSort(field, dir, ["updatedAt", "createdAt", "dueDate", "priority", "status", "title", "source"], "updatedAt");
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
    .map((id) => ({
      id,
      name: workspaceById.get(id) ? workspaceById.get(id).name : id
    }));
}

function buildListIndexes(db) {
  const memory = Array.isArray(db.memory) ? db.memory.map(normalizeMemoryItem) : [];
  const noteWorkspaces = Array.isArray(db.noteWorkspaces) ? db.noteWorkspaces.map(normalizeWorkspaceItem) : [];
  const memoryById = new Map(memory.map((item) => [item.id, item]));
  const memoryByContactId = new Map();
  for (const item of memory) {
    if (!item.contactId) continue;
    if (!memoryByContactId.has(item.contactId)) memoryByContactId.set(item.contactId, []);
    memoryByContactId.get(item.contactId).push(item);
  }
  return {
    memory,
    memoryById,
    memoryByContactId,
    workspaceById: new Map(noteWorkspaces.map((workspace) => [workspace.id, workspace]))
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

async function listContacts({ limit = 50, offset = 0, q = "", status = "", statuses, sourceHost = "", sourceUrlKey = "", urlKey = "", memoryId = "", workspaceId = "", sortBy = "updatedAt", sortDir = "desc" } = {}) {
  const db = await loadDb();
  const actions = normalizeActions(db.actions);
  const indexes = buildListIndexes(db);
  const all = Array.isArray(actions.contacts) ? actions.contacts.map(normalizeContactItem) : [];
  const window = normalizeListWindow(limit, offset);
  const query = String(q || "").trim().toLowerCase();
  const explicitStatuses = normalizeFilterList(statuses);
  const statusList = explicitStatuses.length ? explicitStatuses : normalizeFilterList(status);
  const host = String(sourceHost || "").trim().toLowerCase();
  const normalizedUrlKey = normalizeSourceUrl(sourceUrlKey || urlKey);
  const workspaceIds = normalizeFilterList(workspaceId);
  let contacts = all;
  if (statusList.length && !statusList.includes("all")) contacts = contacts.filter((contact) => statusList.includes(contact.leadStatus));
  if (host) contacts = contacts.filter((contact) => (contact.sourceDomain || "").toLowerCase() === host);
  if (normalizedUrlKey) contacts = contacts.filter((contact) => normalizeSourceUrl(contact.sourceUrl) === normalizedUrlKey);
  if (memoryId) contacts = contacts.filter((contact) => (contact.memoryIds || []).includes(memoryId));
  if (workspaceIds.length && !workspaceIds.includes("all")) {
    contacts = contacts.filter((contact) => contactWorkspaceIds(contact, indexes).some((id) => workspaceIds.includes(id)));
  }
  if (query) contacts = contacts.filter((contact) => contactSearchText(contact).includes(query));
  contacts = sortContacts(contacts, sortBy, sortDir);
  const page = contacts.slice(window.offset, window.offset + window.limit);
  return {
    contacts: page,
    total: contacts.length,
    limit: window.limit,
    offset: window.offset,
    listMeta: pageMeta(contacts.length, window.limit, window.offset, page.length),
    filters: { q: query, statuses: statusList.length ? statusList : ["all"], status: statusList[0] || "all", sourceHost: host, sourceUrlKey: normalizedUrlKey, memoryId, workspaceIds },
    sort: normalizeContactSort(sortBy, sortDir),
    facets: contactFacets(all, indexes)
  };
}

async function getContact(id) {
  const actions = await getActions();
  return (actions.contacts || []).find((contact) => contact.id === id) || null;
}

async function listTasks({ status = "open", statuses, priority = "", priorities, sourceHost = "", sourceUrlKey = "", urlKey = "", memoryId = "", workspaceId = "", dueBucket = "", dueFrom = "", dueTo = "", q = "", sortBy = "updatedAt", sortDir = "desc", limit = 50, offset = 0 } = {}) {
  const db = await loadDb();
  const actions = normalizeActions(db.actions);
  const indexes = buildListIndexes(db);
  const all = Array.isArray(actions.tasks) ? actions.tasks.map(normalizeTaskItem) : [];
  const window = normalizeListWindow(limit, offset);
  const explicitStatuses = normalizeFilterList(statuses);
  const statusList = explicitStatuses.length ? explicitStatuses : normalizeFilterList(status);
  const explicitPriorities = normalizeFilterList(priorities);
  const priorityList = explicitPriorities.length ? explicitPriorities : normalizeFilterList(priority);
  const host = String(sourceHost || "").trim().toLowerCase();
  const normalizedUrlKey = normalizeSourceUrl(sourceUrlKey || urlKey);
  const workspaceIds = normalizeFilterList(workspaceId);
  const query = String(q || "").trim().toLowerCase();
  let tasks = all;
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
  if (query) tasks = tasks.filter((task) => taskSearchText(task).includes(query));
  tasks = sortTasks(tasks, sortBy, sortDir);
  const page = tasks.slice(window.offset, window.offset + window.limit);
  return {
    tasks: page,
    total: tasks.length,
    limit: window.limit,
    offset: window.offset,
    listMeta: pageMeta(tasks.length, window.limit, window.offset, page.length),
    filters: { statuses: statusList.length ? statusList : ["open"], priorities: priorityList, sourceHost: host, sourceUrlKey: normalizedUrlKey, memoryId, workspaceIds, dueBucket, dueFrom, dueTo, q: query },
    sort: normalizeTaskSort(sortBy, sortDir),
    facets: taskFacets(all, indexes)
  };
}

async function getTask(id) {
  const actions = await getActions();
  return (actions.tasks || []).find((task) => task.id === id) || null;
}

async function createContact(contact) {
  return enqueueWrite(async () => {
    const db = await loadDb();
    const now = new Date().toISOString();
    if (!db.actions) db.actions = { tasks: [], tableRows: [], contacts: [], drafts: [] };
    if (!Array.isArray(db.actions.contacts)) db.actions.contacts = [];
    const incoming = normalizeContactItem({
      ...contact,
      id: contact.id || `contact_${cryptoRandomId()}`,
      createdAt: contact.createdAt || now,
      updatedAt: now
    });
    const incomingKey = contactDedupeKey(incoming);
    const index = incomingKey
      ? db.actions.contacts.findIndex((item) => contactDedupeKey(item) === incomingKey)
      : -1;
    if (index >= 0) {
      const beforeContact = normalizeContactItem(db.actions.contacts[index]);
      db.actions.contacts[index] = mergeContactItems(db.actions.contacts[index], incoming, now);
      db.dedupeAudit = capAudit([{
        id: `dedupe_${cryptoRandomId()}`,
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
      }, ...(Array.isArray(db.dedupeAudit) ? db.dedupeAudit : [])]);
      await saveDb(db);
      return normalizeContactItem(db.actions.contacts[index]);
    }
    db.actions.contacts.unshift(incoming);
    await saveDb(db);
    return incoming;
  });
}

function cryptoRandomId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function createTaskWithLinks(task = {}) {
  return enqueueWrite(async () => {
    const db = await loadDb();
    const now = new Date().toISOString();
    if (!db.actions) db.actions = { tasks: [], tableRows: [], contacts: [], drafts: [] };
    if (!Array.isArray(db.actions.tasks)) db.actions.tasks = [];
    if (!Array.isArray(db.memory)) db.memory = [];

    const sourceMemoryIds = compactStringArray(task.sourceMemoryIds || task.memoryIds);
    const memoryById = new Map(db.memory.map((item) => [item.id, normalizeMemoryItem(item)]));
    const missingId = sourceMemoryIds.find((id) => !memoryById.has(id));
    if (missingId) return { error: `Unknown memory ID: ${missingId}` };

    const clientRequestId = typeof task.clientRequestId === "string" ? task.clientRequestId.trim() : "";
    if (clientRequestId) {
      const duplicate = db.actions.tasks.find((item) => item.clientRequestId === clientRequestId);
      if (duplicate) {
        return {
          task: normalizeTaskItem(duplicate),
          linkedMemoryItems: sourceMemoryIds.map((id) => memoryById.get(id)).filter(Boolean),
          duplicate: true
        };
      }
    }

    if (task.status && !TASK_STATUSES.has(task.status)) return { error: "Invalid task status" };
    if (task.priority && !TASK_PRIORITIES.has(task.priority)) return { error: "Invalid task priority" };

    const firstMemory = sourceMemoryIds.length ? memoryById.get(sourceMemoryIds[0]) : null;
    const next = normalizeTaskItem({
      ...task,
      id: task.id || `task_${cryptoRandomId()}`,
      createdAt: task.createdAt || now,
      updatedAt: now,
      status: task.status || "open",
      priority: task.priority || "none",
      sourceMemoryIds,
      sourceUrl: task.sourceUrl || (firstMemory && firstMemory.sourceUrl) || "",
      sourceTitle: task.sourceTitle || (firstMemory && firstMemory.title) || "",
      sourceSnippet: task.sourceSnippet || (firstMemory && (firstMemory.snippet || firstMemory.note || firstMemory.pageExcerpt)) || "",
      completedAt: task.status === "done" ? (task.completedAt || now) : "",
      clientRequestId
    });

    db.actions.tasks.unshift(next);
    const linkedMemoryItems = [];
    for (const id of sourceMemoryIds) {
      const index = db.memory.findIndex((item) => item.id === id);
      if (index === -1) continue;
      const item = normalizeMemoryItem(db.memory[index]);
      item.linkedTaskIds = compactStringArray([...(item.linkedTaskIds || []), next.id]);
      item.updatedAt = now;
      db.memory[index] = item;
      linkedMemoryItems.push(item);
    }

    await saveDb(db);
    return { task: next, linkedMemoryItems };
  });
}

async function updateContact(id, patch) {
  return enqueueWrite(async () => {
    const db = await loadDb();
    const contacts = db.actions.contacts || [];
    const index = contacts.findIndex((contact) => contact.id === id);
    if (index === -1) return null;
    contacts[index] = normalizeContactItem({
      ...contacts[index],
      ...patch,
      id,
      updatedAt: new Date().toISOString()
    });
    db.actions.contacts = contacts;
    await saveDb(db);
    return contacts[index];
  });
}

function cleanupContactLinks(db, id, now = new Date().toISOString()) {
  if (!Array.isArray(db.memory)) return 0;
  let changed = 0;
  db.memory = db.memory.map((item) => {
    const next = normalizeMemoryItem(item);
    let touched = false;
    if (next.contactId === id) {
      next.contactId = "";
      touched = true;
    }
    if (Array.isArray(next.contactIds) && next.contactIds.includes(id)) {
      next.contactIds = next.contactIds.filter((contactId) => contactId !== id);
      touched = true;
    }
    if (!touched) return item;
    changed += 1;
    next.updatedAt = now;
    return next;
  });
  return changed;
}

async function deleteContact(id) {
  return enqueueWrite(async () => {
    const db = await loadDb();
    const contacts = db.actions.contacts || [];
    const index = contacts.findIndex((contact) => contact.id === id);
    if (index === -1) return null;
    const [removed] = contacts.splice(index, 1);
    db.actions.contacts = contacts;
    cleanupContactLinks(db, id);
    await saveDb(db);
    return normalizeContactItem(removed);
  });
}

async function updateTask(id, patch) {
  return enqueueWrite(async () => {
    const db = await loadDb();
    const tasks = db.actions.tasks || [];
    const index = tasks.findIndex((task) => task.id === id);
    if (index === -1) return null;
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
    db.actions.tasks = tasks;
    await saveDb(db);
    return tasks[index];
  });
}

function cleanupTaskLinks(db, id, now = new Date().toISOString()) {
  if (!Array.isArray(db.memory)) return 0;
  let changed = 0;
  db.memory = db.memory.map((item) => {
    const next = normalizeMemoryItem(item);
    if (!next.linkedTaskIds.includes(id)) return item;
    next.linkedTaskIds = next.linkedTaskIds.filter((taskId) => taskId !== id);
    next.updatedAt = now;
    changed += 1;
    return next;
  });
  return changed;
}

async function deleteTask(id) {
  return enqueueWrite(async () => {
    const db = await loadDb();
    const tasks = db.actions.tasks || [];
    const index = tasks.findIndex((task) => task.id === id);
    if (index === -1) return null;
    const [removed] = tasks.splice(index, 1);
    db.actions.tasks = tasks;
    cleanupTaskLinks(db, id);
    await saveDb(db);
    return normalizeTaskItem(removed);
  });
}

function normalizeContactBatchPatch(patch = {}) {
  if (patch.leadStatus && !["new", "contacted", "qualified", "disqualified", "archived"].includes(patch.leadStatus)) {
    return { error: "Invalid lead status" };
  }
  return { patch };
}

function normalizeTaskBatchPatch(patch = {}) {
  if (patch.status && !TASK_STATUSES.has(patch.status)) return { error: "Invalid task status" };
  if (patch.priority && !TASK_PRIORITIES.has(patch.priority)) return { error: "Invalid task priority" };
  return { patch };
}

async function batchContacts({ ids = [], action = "update", patch = {} } = {}) {
  return enqueueWrite(async () => {
    const db = await loadDb();
    const targetIds = compactStringArray(ids);
    const contacts = db.actions.contacts || [];
    const results = [];
    const errors = [];
    const now = new Date().toISOString();
    const batchAction = action === "delete" ? "delete" : "update";
    const validation = normalizeContactBatchPatch(patch);
    if (batchAction === "update" && validation.error) {
      return { action: batchAction, requested: targetIds.length, succeeded: 0, failed: targetIds.length, results, errors: targetIds.map((id) => ({ id, error: validation.error })) };
    }

    for (const id of targetIds) {
      const index = contacts.findIndex((contact) => contact.id === id);
      if (index === -1) {
        errors.push({ id, error: "Not found" });
        continue;
      }
      if (batchAction === "delete") {
        const [removed] = contacts.splice(index, 1);
        cleanupContactLinks(db, id, now);
        results.push({ id, deleted: true, contact: normalizeContactItem(removed) });
      } else {
        contacts[index] = normalizeContactItem({
          ...contacts[index],
          ...validation.patch,
          id,
          updatedAt: now
        });
        results.push({ id, contact: contacts[index] });
      }
    }

    db.actions.contacts = contacts;
    await saveDb(db);
    return { action: batchAction, requested: targetIds.length, succeeded: results.length, failed: errors.length, results, errors };
  });
}

async function batchTasks({ ids = [], action = "update", patch = {} } = {}) {
  return enqueueWrite(async () => {
    const db = await loadDb();
    const targetIds = compactStringArray(ids);
    const tasks = db.actions.tasks || [];
    const results = [];
    const errors = [];
    const now = new Date().toISOString();
    const batchAction = action === "delete" ? "delete" : "update";
    const validation = normalizeTaskBatchPatch(patch);
    if (batchAction === "update" && validation.error) {
      return { action: batchAction, requested: targetIds.length, succeeded: 0, failed: targetIds.length, results, errors: targetIds.map((id) => ({ id, error: validation.error })) };
    }

    for (const id of targetIds) {
      const index = tasks.findIndex((task) => task.id === id);
      if (index === -1) {
        errors.push({ id, error: "Not found" });
        continue;
      }
      if (batchAction === "delete") {
        const [removed] = tasks.splice(index, 1);
        cleanupTaskLinks(db, id, now);
        results.push({ id, deleted: true, task: normalizeTaskItem(removed) });
        continue;
      }

      const next = normalizeTaskItem(tasks[index]);
      for (const key of ["status", "title", "notes", "dueDate", "priority"]) {
        if (Object.prototype.hasOwnProperty.call(validation.patch, key) && validation.patch[key] !== undefined) {
          next[key] = validation.patch[key];
        }
      }
      if (Object.prototype.hasOwnProperty.call(validation.patch, "status")) {
        next.completedAt = validation.patch.status === "done" ? (validation.patch.completedAt || next.completedAt || now) : "";
      }
      next.updatedAt = now;
      tasks[index] = normalizeTaskItem(next);
      results.push({ id, task: tasks[index] });
    }

    db.actions.tasks = tasks;
    await saveDb(db);
    return { action: batchAction, requested: targetIds.length, succeeded: results.length, failed: errors.length, results, errors };
  });
}

async function getTaskContext(id) {
  const task = await getTask(id);
  if (!task) return null;
  const memory = await listMemory();
  const memoryById = new Map(memory.map((item) => [item.id, item]));
  return {
    task,
    items: (task.sourceMemoryIds || []).map((memoryId) => {
      const item = memoryById.get(memoryId);
      return item ? { id: memoryId, item, unavailable: false } : { id: memoryId, item: null, unavailable: true };
    })
  };
}

function dedupeDataset(db) {
  return {
    memory: db.memory || [],
    actions: normalizeActions(db.actions),
    ignored: db.dedupeIgnored || []
  };
}

async function listDedupeCandidates(options = {}) {
  const db = await loadDb();
  return {
    candidates: buildDedupeCandidates(dedupeDataset(db), options),
    ignored: Array.isArray(db.dedupeIgnored) ? db.dedupeIgnored : []
  };
}

async function previewDedupeMerge(input = {}) {
  const db = await loadDb();
  const preview = buildMergePreview(dedupeDataset(db), input);
  return preview.error ? { error: preview.error } : { plan: preview };
}

function snapshotRecords(items, ids) {
  const wanted = new Set(ids);
  return (Array.isArray(items) ? items : [])
    .map((record, index) => ({ index, record: structuredClone(record) }))
    .filter((entry) => wanted.has(entry.record.id));
}

async function snapshotEmbeddings(ids) {
  const wanted = new Set(ids || []);
  if (wanted.size === 0) return [];
  await ensureDb();
  let content = "";
  try {
    content = await fs.promises.readFile(embeddingsFile, "utf8");
  } catch {
    return [];
  }
  const snapshots = [];
  for (const [index, rawLine] of content.split("\n").entries()) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed);
      if (entry && wanted.has(entry.id)) snapshots.push({ index, record: entry });
    } catch {
      // Ignore malformed embedding lines in merge audit snapshots.
    }
  }
  return snapshots;
}

function restoreRecords(current, snapshots) {
  const ids = new Set((snapshots || []).map((entry) => entry.record.id));
  const kept = (Array.isArray(current) ? current : []).filter((record) => !ids.has(record.id));
  const byIndex = new Map();
  for (const entry of [...(snapshots || [])].sort((a, b) => a.index - b.index)) {
    if (!byIndex.has(entry.index)) byIndex.set(entry.index, []);
    byIndex.get(entry.index).push(entry.record);
  }
  const maxIndex = Math.max(kept.length + byIndex.size - 1, ...byIndex.keys());
  const restored = [];
  let keptIndex = 0;
  for (let index = 0; index <= maxIndex; index++) {
    if (byIndex.has(index)) {
      restored.push(...byIndex.get(index));
    } else if (keptIndex < kept.length) {
      restored.push(kept[keptIndex++]);
    }
  }
  return restored.concat(kept.slice(keptIndex));
}

async function restoreEmbeddings(snapshots = []) {
  const records = [...snapshots].sort((a, b) => a.index - b.index).map((entry) => entry.record).filter((record) => record && record.id);
  if (!records.length) return;
  const ids = new Set(records.map((record) => record.id));
  await compactEmbeddings({ removeIds: ids });
  await fs.promises.appendFile(embeddingsFile, records.map((record) => `${JSON.stringify(record)}\n`).join(""), "utf8");
}

function rewriteIdList(list, duplicateIds, primaryId) {
  const duplicates = new Set(duplicateIds);
  return compactStringArray((Array.isArray(list) ? list : []).map((id) => duplicates.has(id) ? primaryId : id));
}

function publicDedupeAuditItem(item = {}) {
  const { before, ...safe } = item || {};
  return safe;
}

async function applyDedupeMerge(input = {}) {
  return enqueueWrite(async () => {
    const db = await loadDb();
    if (!input.planHash) return { error: "planHash is required", statusCode: 400 };
    const plan = buildMergePreview(dedupeDataset(db), input);
    if (plan.error) {
      const previous = (db.dedupeAudit || []).find((item) => item.groupId === input.groupId && item.planHash === input.planHash && !item.undoneAt);
      if (previous) {
        return { applied: true, idempotent: true, audit: publicDedupeAuditItem(previous), plan: null };
      }
      return { error: plan.error };
    }
    if (input.planHash !== plan.planHash) {
      return { error: "Stale dedupe plan", statusCode: 409, currentPlanHash: plan.planHash };
    }
    if (plan.type === "source") {
      return { error: "Source groups are derived; ignore or review this group instead." };
    }

    const now = new Date().toISOString();
    if (!db.actions) db.actions = { tasks: [], tableRows: [], contacts: [], drafts: [] };
    const ids = [plan.primaryId, ...plan.duplicateIds];
    const duplicateIds = plan.duplicateIds;
    const before = {};

    if (plan.type === "contact") {
      before.contacts = snapshotRecords(db.actions.contacts, ids);
      const affectedMemoryIds = (db.memory || [])
        .filter((item) => ids.includes(item.contactId) || (Array.isArray(item.contactIds) && item.contactIds.some((id) => ids.includes(id))))
        .map((item) => item.id);
      before.memory = snapshotRecords(db.memory, affectedMemoryIds);
      const contacts = db.actions.contacts || [];
      let primary = normalizeContactItem(contacts.find((contact) => contact.id === plan.primaryId));
      for (const id of duplicateIds) {
        const duplicate = contacts.find((contact) => contact.id === id);
        if (duplicate) primary = mergeContactItems(primary, duplicate, now);
      }
      db.actions.contacts = contacts
        .filter((contact) => !duplicateIds.includes(contact.id))
        .map((contact) => contact.id === plan.primaryId ? primary : contact);
      db.memory = (db.memory || []).map((item) => {
        const next = normalizeMemoryItem(item);
        if (duplicateIds.includes(next.contactId)) next.contactId = plan.primaryId;
        if (Array.isArray(next.contactIds)) next.contactIds = rewriteIdList(next.contactIds, duplicateIds, plan.primaryId);
        return next;
      });
    }

    if (plan.type === "task") {
      before.tasks = snapshotRecords(db.actions.tasks, ids);
      const affectedMemoryIds = (db.memory || [])
        .filter((item) => (item.linkedTaskIds || []).some((id) => ids.includes(id)))
        .map((item) => item.id);
      before.memory = snapshotRecords(db.memory, affectedMemoryIds);
      const tasks = db.actions.tasks || [];
      const primary = normalizeTaskItem(tasks.find((task) => task.id === plan.primaryId));
      for (const id of duplicateIds) {
        const duplicate = normalizeTaskItem(tasks.find((task) => task.id === id));
        if (!duplicate.id) continue;
        primary.sourceMemoryIds = compactStringArray([...(primary.sourceMemoryIds || []), ...(duplicate.sourceMemoryIds || [])]);
        if (!primary.notes && duplicate.notes) primary.notes = duplicate.notes;
        if (!primary.dueDate && duplicate.dueDate) primary.dueDate = duplicate.dueDate;
        if (primary.priority === "none" && duplicate.priority !== "none") primary.priority = duplicate.priority;
      }
      primary.updatedAt = now;
      db.actions.tasks = tasks
        .filter((task) => !duplicateIds.includes(task.id))
        .map((task) => task.id === plan.primaryId ? normalizeTaskItem(primary) : task);
      db.memory = (db.memory || []).map((item) => normalizeMemoryItem({
        ...item,
        linkedTaskIds: rewriteIdList(item.linkedTaskIds, duplicateIds, plan.primaryId)
      }));
    }

    if (plan.type === "memory") {
      before.memory = snapshotRecords(db.memory, ids);
      before.embeddings = await snapshotEmbeddings(duplicateIds);
      const affectedContactIds = (db.actions.contacts || [])
        .filter((contact) => (contact.memoryIds || []).some((id) => ids.includes(id)))
        .map((contact) => contact.id);
      const affectedTaskIds = (db.actions.tasks || [])
        .filter((task) => (task.sourceMemoryIds || []).some((id) => ids.includes(id)))
        .map((task) => task.id);
      before.contacts = snapshotRecords(db.actions.contacts, affectedContactIds);
      before.tasks = snapshotRecords(db.actions.tasks, affectedTaskIds);
      const memory = db.memory || [];
      const primary = normalizeMemoryItem(memory.find((item) => item.id === plan.primaryId));
      for (const id of duplicateIds) {
        const duplicate = normalizeMemoryItem(memory.find((item) => item.id === id));
        if (!duplicate.id) continue;
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
      db.memory = memory
        .filter((item) => !duplicateIds.includes(item.id))
        .map((item) => item.id === plan.primaryId ? normalizeMemoryItem(primary) : item);
      db.actions.contacts = (db.actions.contacts || []).map((contact) => normalizeContactItem({
        ...contact,
        memoryIds: rewriteIdList(contact.memoryIds, duplicateIds, plan.primaryId)
      }));
      db.actions.tasks = (db.actions.tasks || []).map((task) => normalizeTaskItem({
        ...task,
        sourceMemoryIds: rewriteIdList(task.sourceMemoryIds, duplicateIds, plan.primaryId)
      }));
      await compactEmbeddings({ removeIds: new Set(duplicateIds) });
    }

    const audit = {
      id: `dedupe_${cryptoRandomId()}`,
      createdAt: now,
      type: plan.type,
      groupId: plan.groupId,
      reason: plan.reason,
      planHash: plan.planHash,
      primaryId: plan.primaryId,
      duplicateIds: plan.duplicateIds,
      before,
      undoable: true
    };
    db.dedupeAudit = capAudit([audit, ...(Array.isArray(db.dedupeAudit) ? db.dedupeAudit : [])]);
    await saveDb(db);
    return { applied: true, audit: publicDedupeAuditItem(audit), plan };
  });
}

async function listDedupeAudit({ limit = 50, offset = 0 } = {}) {
  const db = await loadDb();
  const audit = capAudit(Array.isArray(db.dedupeAudit) ? db.dedupeAudit : []);
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  return {
    items: audit.slice(safeOffset, safeOffset + safeLimit).map(publicDedupeAuditItem),
    total: audit.length,
    limit: safeLimit,
    offset: safeOffset
  };
}

async function undoDedupeMerge({ auditId } = {}) {
  return enqueueWrite(async () => {
    const db = await loadDb();
    const audit = (db.dedupeAudit || []).find((item) => item.id === auditId);
    if (!audit) return { error: "Audit record not found" };
    if (!audit.undoable) return { error: "Audit record is not undoable" };
    const before = audit.before || {};
    if (before.memory) db.memory = restoreRecords(db.memory, before.memory).map(normalizeMemoryItem);
    if (before.contacts) db.actions.contacts = restoreRecords(db.actions.contacts, before.contacts).map(normalizeContactItem);
    if (before.tasks) db.actions.tasks = restoreRecords(db.actions.tasks, before.tasks).map(normalizeTaskItem);
    if (before.embeddings) await restoreEmbeddings(before.embeddings);
    audit.undoneAt = new Date().toISOString();
    audit.undoable = false;
    await saveDb(db);
    return { undone: true, auditId };
  });
}

async function ignoreDedupeGroup(input = {}) {
  return enqueueWrite(async () => {
    const db = await loadDb();
    const preview = buildMergePreview(dedupeDataset(db), input);
    const groupId = input.groupId || (preview && preview.groupId);
    if (!groupId) return { error: "groupId is required" };
    const existing = Array.isArray(db.dedupeIgnored) ? db.dedupeIgnored : [];
    if (!existing.some((item) => item.groupId === groupId)) {
      existing.unshift({
        groupId,
        type: input.type || preview.type || "",
        reason: input.reason || preview.reason || "",
        ignoredAt: new Date().toISOString()
      });
    }
    db.dedupeIgnored = existing.slice(0, 500);
    await saveDb(db);
    return { ignored: true, groupId };
  });
}

async function unignoreDedupeGroup({ groupId } = {}) {
  return enqueueWrite(async () => {
    if (!groupId) return { error: "groupId is required" };
    const db = await loadDb();
    db.dedupeIgnored = (Array.isArray(db.dedupeIgnored) ? db.dedupeIgnored : []).filter((item) => item.groupId !== groupId);
    await saveDb(db);
    return { unignored: true, groupId };
  });
}

// --- Backup: export, validate, restore point, import ---

function backupBool(value, fallback = false) {
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  return fallback;
}

function normalizeBackupOptions(options = {}) {
  return {
    includeEmbeddings: backupBool(options.includeEmbeddings, true),
    includeSettings: backupBool(options.includeSettings, false),
    includeSensitive: backupBool(options.includeSensitive, false),
    includeAudit: backupBool(options.includeAudit, false)
  };
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

function normalizeBackupActions(section = {}) {
  return normalizeActions({
    tasks: Array.isArray(section.tasks) ? section.tasks : [],
    contacts: Array.isArray(section.contacts) ? section.contacts : [],
    drafts: Array.isArray(section.drafts) ? section.drafts : [],
    tableRows: Array.isArray(section.tableRows) ? section.tableRows : []
  });
}

function validateEmbeddingItems(items = [], errors = []) {
  for (const [index, item] of items.entries()) {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.id) {
      errors.push(`sections.embeddings.items[${index}] must have an id`);
      continue;
    }
    if (!Array.isArray(item.embedding) || !item.embedding.every((n) => Number.isFinite(n))) {
      errors.push(`sections.embeddings.items[${index}].embedding must be a finite number array`);
      continue;
    }
    const dimensions = item.meta && Number(item.meta.dimensions);
    if (Number.isFinite(dimensions) && dimensions !== item.embedding.length) {
      errors.push(`sections.embeddings.items[${index}] dimensions do not match vector length`);
    }
  }
}

function validateBackupEnvelope(backup = {}) {
  const errors = [];
  const warnings = [];
  if (!backup || typeof backup !== "object" || Array.isArray(backup)) {
    return { valid: false, errors: ["Backup must be an object"], warnings };
  }
  const unsafe = unsafeBackupKeys(backup);
  if (unsafe.length) errors.push(`Backup contains unsafe keys: ${unsafe.slice(0, 5).join(", ")}`);
  if (backup.format !== BACKUP_FORMAT) errors.push(`Unsupported backup format: ${backup.format || "missing"}`);
  if (!backup.sections || typeof backup.sections !== "object" || Array.isArray(backup.sections)) {
    errors.push("sections object is required");
  }
  const sections = backup.sections || {};
  for (const [name, field] of [
    ["memory", "items"],
    ["noteWorkspaces", "items"],
    ["embeddings", "items"]
  ]) {
    if (sections[name] && sections[name].version !== 1) errors.push(`sections.${name}.version must be 1`);
    if (sections[name] && !Array.isArray(sections[name][field])) errors.push(`sections.${name}.${field} must be an array`);
  }
  if (sections.actions) {
    if (sections.actions.version !== 1) errors.push("sections.actions.version must be 1");
    for (const key of ["tasks", "contacts", "drafts", "tableRows"]) {
      if (!Array.isArray(sections.actions[key])) errors.push(`sections.actions.${key} must be an array`);
    }
  }
  if (sections.settings && sections.settings.version !== 1) errors.push("sections.settings.version must be 1");
  if (sections.privacy && sections.privacy.version !== 1) errors.push("sections.privacy.version must be 1");
  if (sections.dedupe) {
    if (sections.dedupe.version !== 1) errors.push("sections.dedupe.version must be 1");
    if (sections.dedupe.ignored && !Array.isArray(sections.dedupe.ignored)) errors.push("sections.dedupe.ignored must be an array");
    if (sections.dedupe.audit && !Array.isArray(sections.dedupe.audit)) errors.push("sections.dedupe.audit must be an array");
  }
  validateEmbeddingItems(backupArray(sections.embeddings), errors);
  if (backup.options && backup.options.includeSensitive) warnings.push("Backup declares sensitive settings.");
  const summary = {
    memory: backupArray(sections.memory).length,
    noteWorkspaces: backupArray(sections.noteWorkspaces).length,
    tasks: sections.actions && Array.isArray(sections.actions.tasks) ? sections.actions.tasks.length : 0,
    contacts: sections.actions && Array.isArray(sections.actions.contacts) ? sections.actions.contacts.length : 0,
    embeddings: backupArray(sections.embeddings).length,
    dedupeIgnored: sections.dedupe && Array.isArray(sections.dedupe.ignored) ? sections.dedupe.ignored.length : 0,
    dedupeAudit: sections.dedupe && Array.isArray(sections.dedupe.audit) ? sections.dedupe.audit.length : 0
  };
  return { valid: errors.length === 0, errors, warnings, summary };
}

function embeddingItemsFromMap(map) {
  return [...map.entries()].map(([id, record]) => ({
    id,
    embedding: Array.isArray(record.embedding) ? record.embedding : [],
    meta: record.meta || {
      provider: "legacy",
      model: "unknown",
      dimensions: Array.isArray(record.embedding) ? record.embedding.length : 0,
      version: 0,
      createdAt: null
    }
  }));
}

async function writeEmbeddingItems(items = []) {
  await ensureDb();
  const lines = [];
  for (const item of items) {
    if (!item || typeof item.id !== "string" || !Array.isArray(item.embedding)) continue;
    lines.push(`${JSON.stringify({ id: item.id, embedding: item.embedding, meta: item.meta || {} })}\n`);
  }
  const tmp = `${embeddingsFile}.tmp`;
  await fs.promises.writeFile(tmp, lines.join(""), "utf8");
  await fs.promises.rename(tmp, embeddingsFile);
}

async function exportBackup(options = {}) {
  const exportOptions = normalizeBackupOptions(options);
  const db = await loadDb();
  const actions = normalizeActions(db.actions);
  const envelope = {
    format: BACKUP_FORMAT,
    exportedAt: new Date().toISOString(),
    app: { name: "AI Assistant Across Websites", version: APP_VERSION },
    source: { mode: "backend", notesDir: getDataDir(), extensionVersion: "" },
    options: exportOptions,
    sections: {
      memory: { version: 1, items: (db.memory || []).map(normalizeMemoryItem) },
      noteWorkspaces: { version: 1, items: (db.noteWorkspaces || []).map(normalizeWorkspaceItem) },
      actions: { version: 1, tasks: actions.tasks, contacts: actions.contacts, drafts: actions.drafts, tableRows: actions.tableRows },
      embeddings: { version: 1, items: exportOptions.includeEmbeddings ? embeddingItemsFromMap(loadAllEmbeddings()) : [] },
      settings: { version: 1, items: exportOptions.includeSettings ? {} : {} },
      privacy: { version: 1, settings: exportOptions.includeSettings ? normalizePrivacySettings(db.privacySettings) : {} },
      dedupe: {
        version: 1,
        ignored: structuredClone(Array.isArray(db.dedupeIgnored) ? db.dedupeIgnored : []),
        audit: exportOptions.includeAudit ? structuredClone(capAudit(Array.isArray(db.dedupeAudit) ? db.dedupeAudit : []).map(publicDedupeAuditItem)) : []
      }
    }
  };
  return envelope;
}

function remapListIds(list, idMap) {
  return compactStringArray((Array.isArray(list) ? list : []).map((id) => idMap.get(id) || id));
}

function createIdMapper(existingIds, prefix) {
  const ids = new Set(existingIds);
  return (id) => {
    if (!ids.has(id)) {
      ids.add(id);
      return id;
    }
    let next;
    do {
      next = `${prefix}_${cryptoRandomId()}`;
    } while (ids.has(next));
    ids.add(next);
    return next;
  };
}

function buildMergedBackupState(db, backup, options) {
  const sections = backup.sections || {};
  const actions = normalizeActions(db.actions);
  const importedActions = normalizeBackupActions(sections.actions || {});
  const workspaceItems = (db.noteWorkspaces || []).map(normalizeWorkspaceItem);
  const memoryItems = (db.memory || []).map(normalizeMemoryItem);
  const workspaceIdMap = new Map();
  const memoryIdMap = new Map();
  const contactIdMap = new Map();
  const taskIdMap = new Map();
  const workspaceIdFor = createIdMapper(workspaceItems.map((item) => item.id), "nw_import");
  const memoryIdFor = createIdMapper(memoryItems.map((item) => item.id), "mem_import");
  const contactIdFor = createIdMapper(actions.contacts.map((item) => item.id), "contact_import");
  const taskIdFor = createIdMapper(actions.tasks.map((item) => item.id), "task_import");
  const workspaceNameToId = new Map(workspaceItems.map((item) => [item.name.trim().toLowerCase(), item.id]));
  const contactKeyToId = new Map(actions.contacts.map((item) => [contactDedupeKey(item), item.id]).filter(([key]) => key));
  const taskRequestToId = new Map(actions.tasks.map((item) => [item.clientRequestId, item.id]).filter(([key]) => key));
  const existingMemoryIds = new Set(memoryItems.map((item) => item.id));
  const existingMemoryById = new Map(memoryItems.map((item) => [item.id, item]));
  const importedContactById = new Map();
  const importedTaskById = new Map();

  for (const raw of backupArray(sections.noteWorkspaces)) {
    const workspace = normalizeWorkspaceItem(raw);
    if (!workspace.id) continue;
    const nameKey = workspace.name.trim().toLowerCase();
    if (workspaceNameToId.has(nameKey)) {
      workspaceIdMap.set(workspace.id, workspaceNameToId.get(nameKey));
      continue;
    }
    const nextId = workspaceIdFor(workspace.id);
    workspaceIdMap.set(workspace.id, nextId);
    workspaceItems.unshift({ ...workspace, id: nextId });
    workspaceNameToId.set(nameKey, nextId);
  }

  for (const raw of importedActions.contacts) {
    const contact = normalizeContactItem(raw);
    if (!contact.id) continue;
    importedContactById.set(contact.id, contact);
    const dedupeKey = contactDedupeKey(contact);
    if (dedupeKey && contactKeyToId.has(dedupeKey)) {
      contactIdMap.set(contact.id, contactKeyToId.get(dedupeKey));
      continue;
    }
    const nextId = contactIdFor(contact.id);
    contactIdMap.set(contact.id, nextId);
    actions.contacts.unshift({ ...contact, id: nextId });
    if (dedupeKey) contactKeyToId.set(dedupeKey, nextId);
  }

  for (const raw of importedActions.tasks) {
    const task = normalizeTaskItem(raw);
    if (!task.id) continue;
    importedTaskById.set(task.id, task);
    if (task.clientRequestId && taskRequestToId.has(task.clientRequestId)) {
      taskIdMap.set(task.id, taskRequestToId.get(task.clientRequestId));
      continue;
    }
    const nextId = taskIdFor(task.id);
    taskIdMap.set(task.id, nextId);
    actions.tasks.unshift({ ...task, id: nextId });
    if (task.clientRequestId) taskRequestToId.set(task.clientRequestId, nextId);
  }

  for (const raw of backupArray(sections.memory)) {
    const item = normalizeMemoryItem(raw);
    if (!item.id) continue;
    if (existingMemoryIds.has(item.id)) {
      const existing = existingMemoryById.get(item.id);
      if (existing && existing.title === item.title && existing.sourceUrl === item.sourceUrl && existing.note === item.note) {
        memoryIdMap.set(item.id, item.id);
        continue;
      }
    }
    const nextId = memoryIdFor(item.id);
    memoryIdMap.set(item.id, nextId);
    existingMemoryIds.add(nextId);
    memoryItems.unshift(normalizeMemoryItem({
      ...item,
      id: nextId,
      workspaceIds: remapListIds(item.workspaceIds || item.taskIds, workspaceIdMap),
      taskIds: remapListIds(item.workspaceIds || item.taskIds, workspaceIdMap),
      linkedTaskIds: remapListIds(item.linkedTaskIds, taskIdMap),
      contactId: item.contactId ? (contactIdMap.get(item.contactId) || item.contactId) : "",
      contactIds: remapListIds(item.contactIds, contactIdMap)
    }));
  }

  actions.contacts = actions.contacts.map((contact) => normalizeContactItem({
    ...contact,
    memoryIds: compactStringArray([
      ...remapListIds(contact.memoryIds, memoryIdMap),
      ...[...contactIdMap.entries()]
        .filter(([, mappedId]) => mappedId === contact.id)
        .flatMap(([oldId]) => remapListIds((importedContactById.get(oldId) || {}).memoryIds, memoryIdMap))
    ])
  }));
  actions.tasks = actions.tasks.map((task) => normalizeTaskItem({
    ...task,
    sourceMemoryIds: compactStringArray([
      ...remapListIds(task.sourceMemoryIds, memoryIdMap),
      ...[...taskIdMap.entries()]
        .filter(([, mappedId]) => mappedId === task.id)
        .flatMap(([oldId]) => remapListIds((importedTaskById.get(oldId) || {}).sourceMemoryIds, memoryIdMap))
    ])
  }));
  actions.drafts = [...importedActions.drafts, ...actions.drafts];
  actions.tableRows = [...importedActions.tableRows, ...actions.tableRows];

  const next = normalizeDbShape({
    ...db,
    memory: memoryItems,
    noteWorkspaces: workspaceItems,
    actions,
    privacySettings: options.includeSettings && sections.privacy && sections.privacy.settings
      ? mergePrivacySettings(db.privacySettings, sections.privacy.settings)
      : db.privacySettings,
    dedupeIgnored: options.mode === "replace"
      ? (sections.dedupe && Array.isArray(sections.dedupe.ignored) ? sections.dedupe.ignored : [])
      : [...(sections.dedupe && Array.isArray(sections.dedupe.ignored) ? sections.dedupe.ignored : []), ...(db.dedupeIgnored || [])].slice(0, 500),
    dedupeAudit: db.dedupeAudit || []
  });

  const embeddings = new Map(loadAllEmbeddings());
  if (options.includeEmbeddings) {
    for (const item of backupArray(sections.embeddings)) {
      const nextId = memoryIdMap.get(item.id);
      if (!nextId || embeddings.has(nextId)) continue;
      embeddings.set(nextId, { embedding: item.embedding || [], meta: item.meta || {} });
    }
  }
  return { db: next, embeddings: embeddingItemsFromMap(embeddings) };
}

function buildReplaceBackupState(backup, options) {
  const sections = backup.sections || {};
  const actions = normalizeBackupActions(sections.actions || {});
  const db = normalizeDbShape({
    ...DEFAULT_DB,
    memory: backupArray(sections.memory).map(normalizeMemoryItem),
    noteWorkspaces: backupArray(sections.noteWorkspaces).map(normalizeWorkspaceItem),
    actions,
    privacySettings: options.includeSettings && sections.privacy && sections.privacy.settings
      ? normalizePrivacySettings(sections.privacy.settings)
      : DEFAULT_DB.privacySettings,
    dedupeIgnored: sections.dedupe && Array.isArray(sections.dedupe.ignored) ? sections.dedupe.ignored : [],
    dedupeAudit: sections.dedupe && Array.isArray(sections.dedupe.audit) ? sections.dedupe.audit : []
  });
  return {
    db,
    embeddings: options.includeEmbeddings ? backupArray(sections.embeddings) : []
  };
}

async function createBackupRestorePoint() {
  await ensureDb();
  const backup = await exportBackup({ includeEmbeddings: true, includeSettings: true, includeAudit: true });
  const id = `restore_${cryptoRandomId()}`;
  const file = path.join(restorePointsDir, `${id}.json`);
  await fs.promises.writeFile(file, JSON.stringify(backup, null, 2), "utf8");
  return { restorePointId: id, createdAt: backup.exportedAt };
}

async function backupRestorePointExists(id) {
  if (!id || typeof id !== "string") return false;
  await ensureDb();
  try {
    await fs.promises.access(path.join(restorePointsDir, `${id}.json`));
    return true;
  } catch {
    return false;
  }
}

async function importBackup({ backup, mode = "merge", includeSettings = true, includeEmbeddings = true, restorePointId = "", confirmationToken = "" } = {}) {
  return enqueueWrite(async () => {
    const validation = validateBackupEnvelope(backup);
    if (!validation.valid) return { error: "Invalid backup", validation };
    const options = { includeSettings: backupBool(includeSettings, true), includeEmbeddings: backupBool(includeEmbeddings, true) };
    const db = await loadDb();
    const beforeDb = structuredClone(db);
    const beforeEmbeddings = embeddingItemsFromMap(loadAllEmbeddings());
    let next;
    if (mode === "replace") {
      if (confirmationToken !== BACKUP_CONFIRMATION) return { error: `Type ${BACKUP_CONFIRMATION} to replace data` };
      if (!(await backupRestorePointExists(restorePointId))) return { error: "Valid restore point is required for replace import" };
      next = buildReplaceBackupState(backup, options);
    } else if (mode === "merge") {
      next = buildMergedBackupState(db, backup, options);
    } else {
      return { error: "Import mode must be merge or replace" };
    }
    try {
      await saveDb(next.db);
      await writeEmbeddingItems(next.embeddings);
    } catch (error) {
      await saveDb(beforeDb);
      await writeEmbeddingItems(beforeEmbeddings);
      return { error: `Import failed and was rolled back: ${error.message}` };
    }
    return { imported: true, mode, summary: validateBackupEnvelope(await exportBackup({ includeEmbeddings: options.includeEmbeddings, includeSettings: true })).summary };
  });
}

// --- Privacy: settings, events, clear-data, retention ---

async function getPrivacySettings() {
  const db = await loadDb();
  return normalizePrivacySettings(db.privacySettings);
}

async function patchPrivacySettings(patch) {
  return enqueueWrite(async () => {
    const db = await loadDb();
    db.privacySettings = mergePrivacySettings(db.privacySettings, patch);
    await saveDb(db);
    return db.privacySettings;
  });
}

async function appendPrivacyEvent(meta) {
  return enqueueWrite(async () => {
    const db = await loadDb();
    if (!Array.isArray(db.privacyEvents)) db.privacyEvents = [];
    db.privacyEvents.unshift(sanitizeProvenance(meta));
    db.privacyEvents = capPrivacyEvents(db.privacyEvents);
    await saveDb(db);
    return db.privacyEvents[0];
  });
}

async function listPrivacyEvents({ limit = 50, offset = 0 } = {}) {
  const db = await loadDb();
  const events = capPrivacyEvents(Array.isArray(db.privacyEvents) ? db.privacyEvents : []);
  return {
    events: events.slice(offset, offset + limit),
    total: events.length,
    limit,
    offset
  };
}

// Clear selected buckets. `before` (ISO) limits removal to older items; when
// absent the whole bucket is cleared. Preserves privacySettings and never
// touches provider/API-key concerns (those are env-based on the backend).
async function clearData({ buckets = [], before = null } = {}) {
  return enqueueWrite(async () => {
    const db = await loadDb();
    const summary = {};
    const embeddingsPolicy = (db.privacySettings && db.privacySettings.retention && db.privacySettings.retention.embeddingsPolicy) || "with_memory";

    for (const bucket of buckets) {
      if (bucket === "memory") {
        const { kept, removedIds } = partitionByRetention(db.memory, before, "id");
        const removed = before ? removedIds : db.memory.map((item) => item.id).filter(Boolean);
        if (before) {
          db.memory = kept;
        } else {
          db.memory = [];
        }
        summary.memory = before ? removedIds.length : removed.length;
        if (embeddingsPolicy === "with_memory") {
          if (before) await compactEmbeddings({ removeIds: removedIds });
          else await compactEmbeddings({ removeAll: true });
        }
      } else if (bucket === "embeddings") {
        await compactEmbeddings({ removeAll: true });
        summary.embeddings = "cleared";
      } else if (bucket === "privacyEvents") {
        const events = Array.isArray(db.privacyEvents) ? db.privacyEvents : [];
        if (before) {
          const { kept, removedIds } = partitionByRetention(events, before, "timestamp");
          db.privacyEvents = kept;
          summary.privacyEvents = removedIds.length;
        } else {
          summary.privacyEvents = events.length;
          db.privacyEvents = [];
        }
      } else if (["contacts", "tasks", "drafts", "tableRows"].includes(bucket)) {
        if (!db.actions) db.actions = { tasks: [], tableRows: [], contacts: [], drafts: [] };
        const list = Array.isArray(db.actions[bucket]) ? db.actions[bucket] : [];
        if (before) {
          const { kept, removedIds } = partitionByRetention(list, before, "id");
          db.actions[bucket] = kept;
          summary[bucket] = removedIds.length;
        } else {
          summary[bucket] = list.length;
          db.actions[bucket] = [];
        }
      }
    }

    await saveDb(db);
    return { cleared: summary, before: before || null };
  });
}

// Apply the configured retention policy. No-op when retention is disabled.
async function runRetention(now = Date.now()) {
  return enqueueWrite(async () => {
    const db = await loadDb();
    const retention = (db.privacySettings && db.privacySettings.retention) || {};
    if (!retention.enabled) return { ran: false, removed: {} };

    const removed = {};
    const memoryCutoff = retentionCutoff(retention, "memory", now);
    if (memoryCutoff) {
      const { kept, removedIds } = partitionByRetention(db.memory, memoryCutoff, "id");
      db.memory = kept;
      removed.memory = removedIds.length;
      if (retention.embeddingsPolicy === "with_memory" && removedIds.length) {
        await compactEmbeddings({ removeIds: removedIds });
      }
    }

    if (!db.actions) db.actions = { tasks: [], tableRows: [], contacts: [], drafts: [] };
    for (const bucket of ["contacts", "tasks", "drafts", "tableRows"]) {
      const cutoff = retentionCutoff(retention, bucket, now);
      if (!cutoff) continue;
      const { kept, removedIds } = partitionByRetention(db.actions[bucket], cutoff, "id");
      db.actions[bucket] = kept;
      removed[bucket] = removedIds.length;
    }

    const eventsCutoff = retentionCutoff(retention, "privacyEvents", now);
    if (eventsCutoff && Array.isArray(db.privacyEvents)) {
      const { kept, removedIds } = partitionByRetention(db.privacyEvents, eventsCutoff, "timestamp");
      db.privacyEvents = kept;
      removed.privacyEvents = removedIds.length;
    }

    await saveDb(db);
    return { ran: true, removed };
  });
}

// Synchronous: reads embeddings.ndjson and returns a Map of id → float[].
// Kept sync because it's a separate file read used only during search.
function loadAllEmbeddings() {
  const map = new Map();
  try {
    if (!fs.existsSync(embeddingsFile)) return map;
    const content = fs.readFileSync(embeddingsFile, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const entry = JSON.parse(trimmed);
        if (entry.id) {
          const embedding = Array.isArray(entry.embedding) ? entry.embedding : [];
          map.set(entry.id, {
            embedding,
            meta: entry.meta || entry.embeddingMeta || {
              provider: "legacy",
              model: "unknown",
              dimensions: embedding.length,
              version: 0,
              createdAt: null
            }
          });
        }
      } catch {
        // skip malformed lines
      }
    }
  } catch {
    // return empty map on any read error
  }
  return map;
}

// One-time startup migration: move inline embeddings from db.json to embeddings.ndjson.
async function migrateEmbeddings() {
  await ensureDb();
  const db = await loadDb();
  let migrated = 0;
  const lines = [];

  for (const item of db.memory) {
    if (item.embedding && Array.isArray(item.embedding) && item.embedding.length > 0) {
      lines.push(JSON.stringify({
        id: item.id,
        embedding: item.embedding,
        meta: {
          provider: "legacy",
          model: "unknown",
          dimensions: item.embedding.length,
          version: 0,
          createdAt: item.createdAt || null
        }
      }) + "\n");
      delete item.embedding;
      migrated++;
    }
  }

  if (migrated > 0) {
    await fs.promises.appendFile(embeddingsFile, lines.join(""), "utf8");
    await saveDb(db);
    console.log(`[storage] Migrated ${migrated} embedding(s) from db.json to embeddings.ndjson`);
  }
}

migrateEmbeddings().catch((err) => console.error("[storage] Migration error:", err));

module.exports = {
  appendAction,
  appendMemory,
  appendNoteWorkspace,
  applyDedupeMerge,
  batchContacts,
  batchTasks,
  createBackupRestorePoint,
  createTaskWithLinks,
  deleteMemory,
  deleteContact,
  deleteNoteWorkspace,
  deleteTask,
  restoreDeletedWorkspaceByName,
  createContact,
  getContact,
  getTask,
  getTaskContext,
  getActions,
  getDataDir,
  ensureDefaultNoteWorkspaces,
  exportBackup,
  ignoreDedupeGroup,
  importBackup,
  listNoteWorkspaces,
  listContacts,
  listDedupeAudit,
  listDedupeCandidates,
  listTasks,
  listMemory,
  loadAllEmbeddings,
  normalizeDbShape,
  normalizeMemoryItem,
  previewDedupeMerge,
  getPrivacySettings,
  patchPrivacySettings,
  appendPrivacyEvent,
  listPrivacyEvents,
  clearData,
  runRetention,
  updateMemory,
  updateContact,
  updateNoteWorkspace,
  updateTask,
  validateBackupEnvelope,
  undoDedupeMerge,
  unignoreDedupeGroup
};
