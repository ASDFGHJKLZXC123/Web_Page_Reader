"use strict";

(function initMirrorUtils(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.AssistantMirror = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function mirrorFactory() {
  const MIRROR_FORMAT = "aaw.folderMirror.v1";
  const MIRROR_SCHEMA_VERSION = 1;
  const MANIFEST_PATH = "aaw_mirror_manifest.json";

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

  function normalizeMirrorConfig(config = {}) {
    return {
      schemaVersion: MIRROR_SCHEMA_VERSION,
      includeContacts: Boolean(config.includeContacts),
      includeTasks: Boolean(config.includeTasks)
    };
  }

  function shortHash(value) {
    const text = String(value || "");
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function safePathSegment(value, fallback = "item") {
    const raw = String(value || "").trim();
    const safe = raw
      .replace(/[\\/]+/g, "_")
      .replace(/\.\.+/g, "_")
      .replace(/[^A-Za-z0-9._-]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "");
    const candidate = safe || fallback;
    if (!candidate || candidate === "." || candidate === ".." || candidate.includes("/") || candidate.includes("\\")) {
      throw new Error("Unsafe mirror path segment");
    }
    return candidate.slice(0, 120);
  }

  function uniqueSegment(value, fallback, used) {
    const base = safePathSegment(value, fallback);
    if (!used.has(base)) {
      used.add(base);
      return base;
    }
    const hashed = `${base}_${shortHash(value).slice(0, 8)}`;
    if (!used.has(hashed)) {
      used.add(hashed);
      return hashed;
    }
    let index = 2;
    while (used.has(`${hashed}_${index}`)) index++;
    const next = `${hashed}_${index}`;
    used.add(next);
    return next;
  }

  function assertSafeRelativePath(path) {
    if (typeof path !== "string" || !path.trim()) throw new Error("Mirror path is required");
    if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || path.includes("\\")) {
      throw new Error(`Unsafe mirror path: ${path}`);
    }
    const parts = path.split("/");
    if (parts.some((part) => !part || part === "." || part === "..")) {
      throw new Error(`Unsafe mirror path: ${path}`);
    }
    return path;
  }

  function memoryFileName(id) {
    const base = safePathSegment(id, `mem_${shortHash(id).slice(0, 8)}`);
    return base.endsWith(".json") ? base : `${base}.json`;
  }

  function prefixedFileName(prefix, id) {
    const base = safePathSegment(id, `${prefix}_${shortHash(id).slice(0, 8)}`);
    const withPrefix = base.startsWith(`${prefix}_`) ? base : `${prefix}_${base}`;
    return withPrefix.endsWith(".json") ? withPrefix : `${withPrefix}.json`;
  }

  function normalizeWorkspaceIds(item = {}) {
    if (Array.isArray(item.workspaceIds)) return compactStringArray(item.workspaceIds);
    return compactStringArray(item.taskIds);
  }

  function normalizeUrl(value) {
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

  function sourceParts(item = {}) {
    const normalized = normalizeUrl(item.urlKey || item.canonicalUrl || item.sourceUrl || "");
    if (!normalized) {
      return {
        urlKey: "",
        sourceHost: String(item.sourceHost || "").trim().toLowerCase(),
        sourceOrigin: "",
        sourcePath: "",
        sourceTitle: item.sourceTitle || item.title || ""
      };
    }
    const url = new URL(normalized);
    url.hash = "";
    return {
      urlKey: url.toString(),
      sourceHost: url.hostname,
      sourceOrigin: url.origin,
      sourcePath: url.pathname,
      sourceTitle: item.sourceTitle || item.title || ""
    };
  }

  function normalizeMemoryItem(item = {}) {
    const workspaceIds = normalizeWorkspaceIds(item);
    return {
      ...item,
      id: typeof item.id === "string" && item.id ? item.id : `mem_${shortHash(JSON.stringify(item)).slice(0, 10)}`,
      title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : "Untitled note",
      note: typeof item.note === "string" ? item.note : "",
      summary: typeof item.summary === "string" ? item.summary : "",
      snippet: typeof item.snippet === "string" ? item.snippet : "",
      pageExcerpt: typeof item.pageExcerpt === "string" ? item.pageExcerpt : "",
      tags: compactStringArray(item.tags),
      workspaceIds,
      taskIds: workspaceIds,
      linkedTaskIds: compactStringArray(item.linkedTaskIds),
      contactIds: compactStringArray(item.contactIds),
      contactId: typeof item.contactId === "string" ? item.contactId : ""
    };
  }

  function normalizeWorkspaceItem(workspace = {}) {
    return {
      ...workspace,
      id: typeof workspace.id === "string" && workspace.id ? workspace.id : `workspace_${shortHash(JSON.stringify(workspace)).slice(0, 10)}`,
      name: typeof workspace.name === "string" && workspace.name.trim() ? workspace.name.trim() : "Untitled workspace",
      status: workspace.status === "archived" ? "archived" : "open"
    };
  }

  function noteSummary(item) {
    const source = sourceParts(item);
    return {
      id: item.id,
      title: item.title,
      note: item.note,
      summary: item.summary,
      snippet: item.snippet,
      sourceUrl: item.sourceUrl || item.canonicalUrl || "",
      urlKey: source.urlKey,
      sourceHost: item.sourceHost || source.sourceHost,
      sourceTitle: item.sourceTitle || item.title || "",
      tags: item.tags || [],
      workspaceIds: item.workspaceIds || [],
      linkedTaskIds: item.linkedTaskIds || [],
      contactId: item.contactId || "",
      contactIds: item.contactIds || [],
      createdAt: item.createdAt || "",
      updatedAt: item.updatedAt || ""
    };
  }

  function contactSummary(contact = {}) {
    return {
      id: contact.id || "",
      name: contact.name || "Unknown contact",
      company: contact.company || "",
      roleTitle: contact.roleTitle || "",
      leadStatus: contact.leadStatus || "new",
      sourceUrl: contact.sourceUrl || "",
      sourceDomain: contact.sourceDomain || "",
      memoryIds: compactStringArray(contact.memoryIds),
      tags: compactStringArray(contact.tags),
      notes: typeof contact.notes === "string" ? contact.notes : "",
      createdAt: contact.createdAt || "",
      updatedAt: contact.updatedAt || ""
    };
  }

  function taskSummary(task = {}) {
    return {
      id: task.id || "",
      title: task.title || "Untitled task",
      status: task.status || "open",
      priority: task.priority || "none",
      dueDate: task.dueDate || "",
      sourceUrl: task.sourceUrl || "",
      sourceTitle: task.sourceTitle || "",
      sourceHost: task.sourceHost || "",
      sourceMemoryIds: compactStringArray(task.sourceMemoryIds),
      notes: typeof task.notes === "string" ? task.notes : "",
      createdAt: task.createdAt || "",
      updatedAt: task.updatedAt || "",
      completedAt: task.completedAt || ""
    };
  }

  function buildSourceIndex(memory) {
    const byKey = new Map();
    for (const item of memory) {
      const parts = sourceParts(item);
      const key = parts.urlKey || `unattributed:${item.sourceHost || "unknown"}`;
      if (!byKey.has(key)) {
        byKey.set(key, {
          urlKey: parts.urlKey,
          sourceUrl: item.sourceUrl || item.canonicalUrl || "",
          sourceHost: item.sourceHost || parts.sourceHost,
          sourceOrigin: parts.sourceOrigin,
          sourcePath: parts.sourcePath,
          title: parts.sourceTitle,
          noteCount: 0,
          memoryIds: [],
          updatedAt: ""
        });
      }
      const source = byKey.get(key);
      source.noteCount++;
      source.memoryIds.push(item.id);
      if (!source.title && parts.sourceTitle) source.title = parts.sourceTitle;
      if (!source.updatedAt || String(item.updatedAt || item.createdAt || "") > source.updatedAt) {
        source.updatedAt = item.updatedAt || item.createdAt || "";
      }
    }
    return [...byKey.values()].sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  }

  function addJsonFile(files, path, kind, json) {
    assertSafeRelativePath(path);
    if (files.some((file) => file.path === path)) throw new Error(`Duplicate mirror path: ${path}`);
    files.push({ path, kind, generated: true, json });
  }

  function buildMirrorPlan({ memory = [], noteWorkspaces = [], actions = {}, config = {}, generatedAt } = {}) {
    const mirrorConfig = normalizeMirrorConfig(config);
    const timestamp = generatedAt || new Date().toISOString();
    const normalizedMemory = (Array.isArray(memory) ? memory : []).map(normalizeMemoryItem);
    const normalizedWorkspaces = (Array.isArray(noteWorkspaces) ? noteWorkspaces : []).map(normalizeWorkspaceItem);
    const workspaceById = new Map(normalizedWorkspaces.map((workspace) => [workspace.id, workspace]));
    const notesByWorkspace = new Map();
    const unassigned = [];
    const files = [];

    for (const workspace of normalizedWorkspaces) notesByWorkspace.set(workspace.id, []);
    for (const item of normalizedMemory) {
      const ids = normalizeWorkspaceIds(item).filter((id) => workspaceById.has(id));
      if (!ids.length) {
        unassigned.push(item);
        continue;
      }
      for (const id of ids) {
        if (!notesByWorkspace.has(id)) notesByWorkspace.set(id, []);
        notesByWorkspace.get(id).push(item);
      }
    }

    for (const item of normalizedMemory) {
      addJsonFile(files, memoryFileName(item.id), "memory", item);
    }

    const usedWorkspaceDirs = new Set(["unassigned"]);
    const workspacePathById = new Map();
    for (const workspace of normalizedWorkspaces) {
      workspacePathById.set(workspace.id, uniqueSegment(workspace.id, "workspace", usedWorkspaceDirs));
    }

    const workspaceIndex = normalizedWorkspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      status: workspace.status,
      noteCount: (notesByWorkspace.get(workspace.id) || []).length,
      updatedAt: workspace.updatedAt || workspace.createdAt || "",
      path: `workspaces/${workspacePathById.get(workspace.id)}/index.json`
    }));

    addJsonFile(files, "indexes/workspaces.json", "workspace_index", {
      schemaVersion: MIRROR_SCHEMA_VERSION,
      generatedAt: timestamp,
      workspaces: workspaceIndex,
      unassigned: {
        id: "unassigned",
        name: "Unassigned",
        noteCount: unassigned.length,
        path: "workspaces/unassigned/index.json"
      }
    });

    addJsonFile(files, "indexes/sources.json", "source_index", {
      schemaVersion: MIRROR_SCHEMA_VERSION,
      generatedAt: timestamp,
      sources: buildSourceIndex(normalizedMemory)
    });

    for (const workspace of normalizedWorkspaces) {
      const segment = workspacePathById.get(workspace.id);
      const notes = notesByWorkspace.get(workspace.id) || [];
      addJsonFile(files, `workspaces/${segment}/index.json`, "workspace", {
        schemaVersion: MIRROR_SCHEMA_VERSION,
        generatedAt: timestamp,
        workspace,
        noteCount: notes.length,
        notes: notes.map(noteSummary)
      });
    }

    addJsonFile(files, "workspaces/unassigned/index.json", "workspace", {
      schemaVersion: MIRROR_SCHEMA_VERSION,
      generatedAt: timestamp,
      workspace: { id: "unassigned", name: "Unassigned", status: "open" },
      noteCount: unassigned.length,
      notes: unassigned.map(noteSummary)
    });

    if (mirrorConfig.includeContacts) {
      const usedContactNames = new Set();
      for (const contact of Array.isArray(actions.contacts) ? actions.contacts : []) {
        const name = uniqueSegment(prefixedFileName("contact", contact.id || contact.name || shortHash(JSON.stringify(contact))), "contact", usedContactNames);
        addJsonFile(files, `contacts/${name}`, "contact", {
          schemaVersion: MIRROR_SCHEMA_VERSION,
          generatedAt: timestamp,
          contact: contactSummary(contact)
        });
      }
    }

    if (mirrorConfig.includeTasks) {
      const usedTaskNames = new Set();
      for (const task of Array.isArray(actions.tasks) ? actions.tasks : []) {
        const name = uniqueSegment(prefixedFileName("task", task.id || task.title || shortHash(JSON.stringify(task))), "task", usedTaskNames);
        addJsonFile(files, `tasks/${name}`, "task", {
          schemaVersion: MIRROR_SCHEMA_VERSION,
          generatedAt: timestamp,
          task: taskSummary(task)
        });
      }
    }

    const manifest = {
      format: MIRROR_FORMAT,
      schemaVersion: MIRROR_SCHEMA_VERSION,
      generatedAt: timestamp,
      generator: "AI Assistant Across Websites",
      config: mirrorConfig,
      counts: {
        memory: normalizedMemory.length,
        workspaces: normalizedWorkspaces.length,
        sources: buildSourceIndex(normalizedMemory).length,
        contacts: mirrorConfig.includeContacts && Array.isArray(actions.contacts) ? actions.contacts.length : 0,
        tasks: mirrorConfig.includeTasks && Array.isArray(actions.tasks) ? actions.tasks.length : 0,
        files: files.length + 1
      },
      generatedPaths: files.map((file) => file.path).concat(MANIFEST_PATH),
      files: files.map((file) => ({ path: file.path, kind: file.kind }))
    };
    addJsonFile(files, MANIFEST_PATH, "manifest", manifest);

    return { manifest, files, config: mirrorConfig };
  }

  function extractGeneratedPaths(manifest) {
    if (!manifest || manifest.format !== MIRROR_FORMAT || manifest.schemaVersion !== MIRROR_SCHEMA_VERSION) return [];
    if (!Array.isArray(manifest.generatedPaths)) return [];
    return manifest.generatedPaths.filter((path) => {
      try {
        assertSafeRelativePath(path);
        return true;
      } catch {
        return false;
      }
    });
  }

  function plannedStaleGeneratedPaths(previousManifest, nextPlan, extraKnownPaths = []) {
    const nextPaths = new Set((nextPlan && nextPlan.files || []).map((file) => file.path));
    const known = new Set([
      ...extractGeneratedPaths(previousManifest),
      ...extraKnownPaths.filter((path) => {
        try {
          assertSafeRelativePath(path);
          return true;
        } catch {
          return false;
        }
      })
    ]);
    return [...known].filter((path) => !nextPaths.has(path)).sort();
  }

  function isLegacyMemoryFileName(name) {
    return /^mem_[A-Za-z0-9._-]+\.json$/.test(String(name || ""));
  }

  return {
    MANIFEST_PATH,
    MIRROR_FORMAT,
    MIRROR_SCHEMA_VERSION,
    assertSafeRelativePath,
    buildMirrorPlan,
    compactStringArray,
    extractGeneratedPaths,
    isLegacyMemoryFileName,
    memoryFileName,
    normalizeMirrorConfig,
    plannedStaleGeneratedPaths,
    safePathSegment
  };
});
