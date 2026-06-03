"use strict";

const {
  compactStringArray,
  normalizeActions,
  normalizeContactItem,
  normalizeMemoryItem,
  normalizeSourceUrl,
  normalizeTaskItem,
  normalizeWorkspaceItem,
  sourceParts
} = require("./foundation");

function clampLimit(value, fallback, max = 50) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 1), max) : fallback;
}

function normalizeDashboardOptions(options = {}) {
  return {
    memoryLimit: clampLimit(options.memoryLimit, 12, 50),
    sourceLimit: clampLimit(options.sourceLimit, 12, 50),
    contactLimit: clampLimit(options.contactLimit, 10, 50),
    taskLimit: clampLimit(options.taskLimit, 10, 50),
    activityLimit: clampLimit(options.activityLimit, 20, 100),
    taskStatus: options.taskStatus || "all"
  };
}

function workspaceIdsFor(raw = {}) {
  if (Array.isArray(raw.workspaceIds)) return compactStringArray(raw.workspaceIds);
  return compactStringArray(raw.taskIds);
}

function sourceKeyFor(value) {
  const normalized = normalizeSourceUrl(value);
  return normalized ? sourceParts(normalized).urlKey : "";
}

function sourceHostFor(value) {
  const key = sourceKeyFor(value);
  return key ? sourceParts(key).sourceHost : "";
}

function byRecent(a, b) {
  const left = Date.parse(a.updatedAt || a.createdAt || a.completedAt || "") || 0;
  const right = Date.parse(b.updatedAt || b.createdAt || b.completedAt || "") || 0;
  return right - left;
}

function addWarning(warnings, code, message, entityType, entityId, missingId) {
  warnings.push({ code, message, entityType, entityId, missingId });
}

function makeBucket(key, item = {}) {
  if (key === "source:missing") {
    return {
      id: "source:missing",
      urlKey: "",
      sourceHost: "",
      title: "No source URL",
      memoryIds: [],
      contactIds: [],
      taskIds: [],
      count: 0
    };
  }
  return {
    id: `source:${key}`,
    urlKey: key,
    sourceHost: sourceHostFor(key),
    title: item.sourceTitle || item.title || sourceHostFor(key) || key,
    memoryIds: [],
    contactIds: [],
    taskIds: [],
    count: 0
  };
}

function pushActivity(activity, type, item, action, title, workspaceId = "") {
  const timestamp = item[action === "completed" ? "completedAt" : action === "created" ? "createdAt" : "updatedAt"] || "";
  if (!timestamp) return;
  activity.push({
    id: `${type}:${item.id}:${action}:${timestamp}`,
    type,
    entityId: item.id,
    action,
    title,
    timestamp,
    workspaceId
  });
}

function buildWorkspaceDashboard(dataset = {}, subject = {}, options = {}) {
  const opts = normalizeDashboardOptions(options);
  const rawMemory = Array.isArray(dataset.memory) ? dataset.memory : [];
  const memory = rawMemory.map((item) => ({
    ...normalizeMemoryItem(item),
    _workspaceIds: workspaceIdsFor(item)
  }));
  const workspaces = (Array.isArray(dataset.workspaces) ? dataset.workspaces : dataset.noteWorkspaces || [])
    .map(normalizeWorkspaceItem);
  const actions = normalizeActions(dataset.actions || {});
  const contacts = actions.contacts.map(normalizeContactItem);
  const tasks = actions.tasks.map(normalizeTaskItem);
  const workspaceId = subject && subject.type === "unassigned" ? "unassigned" : String(subject.workspaceId || subject.id || "");
  const unassigned = workspaceId === "unassigned";
  const workspace = unassigned
    ? { id: "unassigned", name: "Unassigned", status: "open", unassigned: true }
    : workspaces.find((item) => item.id === workspaceId);
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

  const workspaceMemory = memory
    .filter((item) => unassigned ? item._workspaceIds.length === 0 : item._workspaceIds.includes(workspace.id))
    .sort(byRecent);
  const memoryIds = new Set(workspaceMemory.map((item) => item.id));
  const memoryById = new Map(memory.map((item) => [item.id, item]));
  const workspaceSourceKeys = new Set(workspaceMemory.map((item) => sourceKeyFor(item.sourceUrl || item.canonicalUrl)).filter(Boolean));
  const sourceBuckets = new Map();

  for (const item of workspaceMemory) {
    const key = sourceKeyFor(item.sourceUrl || item.canonicalUrl) || "source:missing";
    if (!sourceBuckets.has(key)) sourceBuckets.set(key, makeBucket(key, item));
    const bucket = sourceBuckets.get(key);
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
    const sourceKey = sourceKeyFor(contact.sourceUrl);
    return linked || legacy || (sourceKey && workspaceSourceKeys.has(sourceKey));
  }).sort(byRecent);

  for (const contact of contacts) {
    for (const memoryId of contact.memoryIds || []) {
      if (!memoryById.has(memoryId)) addWarning(warnings, "missing_memory", `Contact ${contact.id} references missing memory ${memoryId}.`, "contact", contact.id, memoryId);
    }
  }

  const workspaceContactIds = new Set(workspaceContacts.map((contact) => contact.id));
  for (const contact of workspaceContacts) {
    const key = sourceKeyFor(contact.sourceUrl);
    if (!key || !sourceBuckets.has(key)) continue;
    sourceBuckets.get(key).contactIds.push(contact.id);
  }

  const linkedTaskIds = new Set();
  for (const item of workspaceMemory) {
    for (const taskId of item.linkedTaskIds || []) linkedTaskIds.add(taskId);
  }
  const workspaceTasksAll = tasks.filter((task) => {
    const viaSourceMemory = (task.sourceMemoryIds || []).some((id) => memoryIds.has(id));
    const viaLinkedMemory = linkedTaskIds.has(task.id);
    const sourceKey = sourceKeyFor(task.sourceUrl);
    return viaSourceMemory || viaLinkedMemory || (sourceKey && workspaceSourceKeys.has(sourceKey));
  }).sort(byRecent);
  const workspaceTasks = opts.taskStatus && opts.taskStatus !== "all"
    ? workspaceTasksAll.filter((task) => task.status === opts.taskStatus)
    : workspaceTasksAll;

  for (const task of tasks) {
    for (const memoryId of task.sourceMemoryIds || []) {
      if (!memoryById.has(memoryId)) addWarning(warnings, "missing_memory", `Task ${task.id} references missing memory ${memoryId}.`, "task", task.id, memoryId);
    }
  }

  for (const task of workspaceTasksAll) {
    const key = sourceKeyFor(task.sourceUrl);
    if (!key || !sourceBuckets.has(key)) continue;
    sourceBuckets.get(key).taskIds.push(task.id);
  }

  const activity = [];
  for (const item of workspaceMemory) {
    pushActivity(activity, "memory", item, "created", item.title || "Saved note", workspace.id);
    if (item.updatedAt && item.updatedAt !== item.createdAt) pushActivity(activity, "memory", item, "updated", item.title || "Saved note", workspace.id);
  }
  for (const contact of workspaceContacts) {
    pushActivity(activity, "contact", contact, "created", contact.name || "Contact", workspace.id);
    if (contact.updatedAt && contact.updatedAt !== contact.createdAt) pushActivity(activity, "contact", contact, "updated", contact.name || "Contact", workspace.id);
  }
  for (const task of workspaceTasksAll) {
    pushActivity(activity, "task", task, "created", task.title || "Task", workspace.id);
    if (task.updatedAt && task.updatedAt !== task.createdAt) pushActivity(activity, "task", task, "updated", task.title || "Task", workspace.id);
    if (task.completedAt) pushActivity(activity, "task", task, "completed", task.title || "Task", workspace.id);
  }
  activity.sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0));

  const sources = [...sourceBuckets.values()]
    .map((bucket) => ({
      ...bucket,
      contactCount: bucket.contactIds.length,
      taskCount: bucket.taskIds.length
    }))
    .sort((a, b) => (Date.parse(b.latestAt || "") || 0) - (Date.parse(a.latestAt || "") || 0));
  const openTasks = workspaceTasksAll.filter((task) => task.status === "open" || task.status === "in_progress").length;
  const doneTasks = workspaceTasksAll.filter((task) => task.status === "done").length;
  const canWrite = !unassigned && workspace.status !== "archived";

  return {
    workspace,
    permissions: {
      canWrite,
      canArchive: !unassigned && !workspace.missing,
      canCreateTask: canWrite,
      canCaptureLead: canWrite,
      canSaveCurrentPage: canWrite
    },
    metrics: {
      notes: workspaceMemory.length,
      sources: sources.length,
      contacts: workspaceContacts.length,
      tasks: workspaceTasksAll.length,
      openTasks,
      doneTasks,
      activity: activity.length,
      warnings: warnings.length
    },
    memory: {
      items: workspaceMemory.slice(0, opts.memoryLimit),
      total: workspaceMemory.length,
      limit: opts.memoryLimit
    },
    sources: sources.slice(0, opts.sourceLimit),
    contacts: {
      items: workspaceContacts.slice(0, opts.contactLimit),
      total: workspaceContacts.length,
      limit: opts.contactLimit
    },
    tasks: {
      items: workspaceTasks.slice(0, opts.taskLimit),
      total: workspaceTasks.length,
      allTotal: workspaceTasksAll.length,
      limit: opts.taskLimit,
      status: opts.taskStatus
    },
    activity: activity.slice(0, opts.activityLimit),
    warnings
  };
}

module.exports = {
  buildWorkspaceDashboard,
  normalizeDashboardOptions,
  sourceKeyFor
};
