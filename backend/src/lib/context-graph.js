"use strict";

const {
  buildMemorySearchText,
  compactStringArray,
  normalizeActions,
  normalizeContactItem,
  normalizeMemoryItem,
  normalizeSearchText,
  normalizeSourceUrl,
  normalizeTaskItem,
  normalizeWorkspaceItem,
  sourceParts
} = require("./foundation");

const MAX_GRAPH_NODES = 160;

function sourceNodeId(value) {
  const normalized = normalizeSourceUrl(value);
  return normalized ? `source:${sourceParts(normalized).urlKey}` : "";
}

function nodeLabelFor(item, fallback) {
  return String(item && (item.title || item.name || item.urlKey || item.sourceUrl) || fallback || "").trim();
}

function addNode(nodes, node) {
  if (!node || !node.id || nodes.has(node.id)) return;
  nodes.set(node.id, node);
}

function addEdge(edges, from, to, type, label, relation = "direct") {
  if (!from || !to || from === to) return;
  const id = `${type}:${from}->${to}`;
  if (edges.has(id)) return;
  edges.set(id, { id, from, to, type, label, relation });
}

function addWarning(warnings, code, message, nodeId, missingId) {
  warnings.push({ code, message, nodeId, missingId });
}

function workspaceIdsFor(raw = {}) {
  if (Array.isArray(raw.workspaceIds)) {
    return { ids: compactStringArray(raw.workspaceIds), relation: "direct" };
  }
  return { ids: compactStringArray(raw.taskIds), relation: "legacy" };
}

function normalizeDataset(dataset = {}) {
  const rawMemory = Array.isArray(dataset.memory) ? dataset.memory : [];
  const memory = rawMemory.map((item) => {
    const membership = workspaceIdsFor(item);
    return {
      ...normalizeMemoryItem(item),
      _workspaceIds: membership.ids,
      _workspaceRelation: membership.relation
    };
  });
  const workspaces = (Array.isArray(dataset.workspaces) ? dataset.workspaces : dataset.noteWorkspaces || [])
    .map(normalizeWorkspaceItem);
  const actions = normalizeActions(dataset.actions || {});
  return {
    memory,
    workspaces,
    contacts: actions.contacts.map(normalizeContactItem),
    tasks: actions.tasks.map(normalizeTaskItem)
  };
}

function addSourceNode(nodes, sourceUrl, title) {
  const normalized = normalizeSourceUrl(sourceUrl);
  if (!normalized) return "";
  const parts = sourceParts(normalized);
  const id = `source:${parts.urlKey}`;
  addNode(nodes, {
    id,
    type: "source",
    entityId: parts.urlKey,
    label: title || parts.sourceHost || parts.urlKey,
    subtitle: parts.sourceOrigin,
    url: parts.urlKey
  });
  return id;
}

function extractionLabel(memoryItem) {
  const extraction = memoryItem.structuredExtraction;
  if (!extraction || typeof extraction !== "object") return "";
  return extraction.title || extraction.summary || "Structured extraction";
}

function buildFullGraph(dataset = {}) {
  const data = normalizeDataset(dataset);
  const nodes = new Map();
  const edges = new Map();
  const warnings = [];
  const memoryById = new Map(data.memory.map((item) => [item.id, item]));
  const workspaceById = new Map(data.workspaces.map((item) => [item.id, item]));
  const contactById = new Map(data.contacts.map((item) => [item.id, item]));
  const taskById = new Map(data.tasks.map((item) => [item.id, item]));

  for (const workspace of data.workspaces) {
    addNode(nodes, {
      id: `workspace:${workspace.id}`,
      type: "workspace",
      entityId: workspace.id,
      label: workspace.name || workspace.id,
      subtitle: workspace.status || "open"
    });
  }

  for (const item of data.memory) {
    addNode(nodes, {
      id: `memory:${item.id}`,
      type: "memory",
      entityId: item.id,
      label: nodeLabelFor(item, "Untitled note"),
      subtitle: item.note || item.summary || item.snippet || "",
      url: item.sourceUrl,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    });
  }

  for (const contact of data.contacts) {
    addNode(nodes, {
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

  for (const task of data.tasks) {
    addNode(nodes, {
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

  for (const item of data.memory) {
    const memoryNode = `memory:${item.id}`;
    for (const workspaceId of item._workspaceIds || []) {
      const workspaceNode = `workspace:${workspaceId}`;
      if (!workspaceById.has(workspaceId)) {
        addWarning(warnings, "missing_workspace", `Memory ${item.id} references missing workspace ${workspaceId}.`, memoryNode, workspaceId);
        continue;
      }
      addEdge(edges, memoryNode, workspaceNode, "memory_workspace", item._workspaceRelation === "legacy" ? "Legacy workspace membership" : "Workspace membership", item._workspaceRelation || "direct");
    }

    for (const taskId of item.linkedTaskIds || []) {
      const taskNode = `task:${taskId}`;
      if (!taskById.has(taskId)) {
        addWarning(warnings, "missing_task", `Memory ${item.id} references missing linked task ${taskId}.`, memoryNode, taskId);
        continue;
      }
      addEdge(edges, memoryNode, taskNode, "memory_task", "Linked task", "direct");
    }

    if (item.contactId) {
      const contactNode = `contact:${item.contactId}`;
      if (!contactById.has(item.contactId)) {
        addWarning(warnings, "missing_contact", `Memory ${item.id} references missing contact ${item.contactId}.`, memoryNode, item.contactId);
      } else {
        addEdge(edges, memoryNode, contactNode, "memory_contact", "Legacy contact link", "legacy");
      }
    }

    const sourceId = addSourceNode(nodes, item.sourceUrl || item.canonicalUrl, item.sourceTitle || item.title);
    if (sourceId) addEdge(edges, memoryNode, sourceId, "memory_source", "Exact source URL", "direct");

    if (item.structuredExtraction && typeof item.structuredExtraction === "object") {
      const extractionNode = `extraction:${item.id}`;
      addNode(nodes, {
        id: extractionNode,
        type: "extraction",
        entityId: item.id,
        label: extractionLabel(item),
        subtitle: "Structured extraction"
      });
      addEdge(edges, memoryNode, extractionNode, "memory_extraction", "Structured extraction", "direct");
    }
  }

  for (const task of data.tasks) {
    const taskNode = `task:${task.id}`;
    for (const memoryId of task.sourceMemoryIds || []) {
      const memoryNode = `memory:${memoryId}`;
      if (!memoryById.has(memoryId)) {
        addWarning(warnings, "missing_memory", `Task ${task.id} references missing source memory ${memoryId}.`, taskNode, memoryId);
        continue;
      }
      addEdge(edges, taskNode, memoryNode, "task_memory", "Source memory", "direct");
    }
    const sourceId = addSourceNode(nodes, task.sourceUrl, task.sourceTitle || task.title);
    if (sourceId) addEdge(edges, taskNode, sourceId, "task_source", "Exact source URL", "direct");
  }

  for (const contact of data.contacts) {
    const contactNode = `contact:${contact.id}`;
    for (const memoryId of contact.memoryIds || []) {
      const memoryNode = `memory:${memoryId}`;
      if (!memoryById.has(memoryId)) {
        addWarning(warnings, "missing_memory", `Contact ${contact.id} references missing memory ${memoryId}.`, contactNode, memoryId);
        continue;
      }
      addEdge(edges, contactNode, memoryNode, "contact_memory", "Contact memory", "direct");
    }
    const sourceId = addSourceNode(nodes, contact.sourceUrl, contact.sourceTitle || contact.name);
    if (sourceId) addEdge(edges, contactNode, sourceId, "contact_source", "Exact source URL", "direct");
  }

  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    warnings,
    indexes: { memoryById, workspaceById, contactById, taskById }
  };
}

function nodeSearchText(node) {
  return normalizeSearchText([node.label, node.subtitle, node.url, node.entityId].filter(Boolean).join(" "));
}

function subjectNodeId(subject = {}) {
  const type = subject.type;
  if (type === "memory" || type === "contact" || type === "task" || type === "workspace") {
    return subject.id ? `${type}:${subject.id}` : "";
  }
  if (type === "source") return sourceNodeId(subject.urlKey || subject.sourceUrl || subject.id);
  return "";
}

function selectStartNodes(full, subject = {}) {
  if (subject.type === "search") {
    const query = normalizeSearchText(subject.q || subject.query || "");
    if (!query) return [];
    const limit = Math.min(Math.max(Number(subject.limit) || 20, 1), 50);
    return full.nodes
      .filter((node) => node.type !== "extraction" && nodeSearchText(node).includes(query))
      .slice(0, limit)
      .map((node) => node.id);
  }
  const id = subjectNodeId(subject);
  return id ? [id] : [];
}

function selectSubgraph(full, subject = {}) {
  const nodeMap = new Map(full.nodes.map((node) => [node.id, node]));
  const startIds = selectStartNodes(full, subject).filter((id) => nodeMap.has(id));
  const requestedId = subjectNodeId(subject);
  const warnings = [...full.warnings];
  if (requestedId && startIds.length === 0) {
    addWarning(warnings, "missing_subject", `No context node found for ${requestedId}.`, requestedId, requestedId);
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
        if (included.size >= MAX_GRAPH_NODES) break;
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

function buildContextGraph(dataset = {}, subject = {}) {
  return selectSubgraph(buildFullGraph(dataset), subject);
}

module.exports = {
  buildContextGraph,
  buildFullGraph,
  sourceNodeId
};
