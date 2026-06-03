"use strict";

// =============================================================================
// Notes folder mirror — File System Access API + IndexedDB-persisted handle.
//
// chrome.storage.local stays the source of truth. This page mirrors saved memory
// and generated indexes to a user-chosen folder. Root `mem_<id>.json` files stay
// backward-compatible, while generated indexes live under `indexes/` and
// `workspaces/`.
// =============================================================================

const DB_NAME = "aaw-options";
const DB_STORE = "kv";
const DB_KEY_HANDLE = "dirHandle";
const mirrorTools = (typeof window !== "undefined" && window.AssistantMirror) || {};
const settingsTools = (typeof window !== "undefined" && window.AssistantSettings) || {};
const privacyTools = (typeof window !== "undefined" && window.AssistantPrivacy) || {};

// -----------------------------------------------------------------------------
// IndexedDB wrapper for a single key/value (the directory handle).
// -----------------------------------------------------------------------------

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(DB_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbPut(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readonly");
    const req = tx.objectStore(DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// -----------------------------------------------------------------------------
// State
// -----------------------------------------------------------------------------

let dirHandle = null;
let permissionState = "prompt"; // "granted" | "denied" | "prompt" | "unset"
let writeChain = Promise.resolve(); // serializes writes so concurrent triggers don't race

// Queue helper — concurrent saves and syncs flow through one chain.
function enqueue(fn) {
  writeChain = writeChain.then(fn).catch((err) => {
    log(`error: ${err && err.message || err}`, true);
  });
  return writeChain;
}

// -----------------------------------------------------------------------------
// DOM refs (populated on DOMContentLoaded)
// -----------------------------------------------------------------------------

let elFolderName, elFolderPerm, elBtnPick, elBtnSync, elBtnDisconnect, elBtnGrant;
let elStatus, elLog, elDeleteOrphans, elIncludeContacts, elIncludeTasks;

// -----------------------------------------------------------------------------
// Utilities
// -----------------------------------------------------------------------------

function setStatus(text, kind) {
  if (!elStatus) return;
  elStatus.textContent = text || "";
  elStatus.classList.remove("is-error", "is-success");
  if (kind === "error") elStatus.classList.add("is-error");
  else if (kind === "success") elStatus.classList.add("is-success");
}

function log(message, isError) {
  if (!elLog) return;
  const li = document.createElement("li");
  const time = document.createElement("span");
  time.className = "opt-log-time";
  time.textContent = new Date().toLocaleTimeString();
  const text = document.createElement("span");
  if (isError) text.className = "opt-log-error";
  text.textContent = message;
  li.appendChild(time);
  li.appendChild(text);
  elLog.insertBefore(li, elLog.firstChild);

  // Keep the log bounded.
  while (elLog.childElementCount > 100) elLog.removeChild(elLog.lastChild);
}

function fileNameForId(id) {
  if (mirrorTools.memoryFileName) return mirrorTools.memoryFileName(id);
  const safe = String(id).replace(/[^A-Za-z0-9._-]/g, "_");
  return safe.endsWith(".json") ? safe : `${safe}.json`;
}

// -----------------------------------------------------------------------------
// chrome.storage helpers
// -----------------------------------------------------------------------------

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

async function loadMemoryEntries() {
  const { memory } = await storageGet(["memory"]);
  return Array.isArray(memory) ? memory : [];
}

async function loadMirrorConfig() {
  const { notesMirrorConfig } = await storageGet(["notesMirrorConfig"]);
  return mirrorTools.normalizeMirrorConfig
    ? mirrorTools.normalizeMirrorConfig(notesMirrorConfig)
    : {
        schemaVersion: 1,
        includeContacts: Boolean(notesMirrorConfig && notesMirrorConfig.includeContacts),
        includeTasks: Boolean(notesMirrorConfig && notesMirrorConfig.includeTasks)
      };
}

async function saveMirrorConfig(patch = {}) {
  const current = await loadMirrorConfig();
  const next = mirrorTools.normalizeMirrorConfig
    ? mirrorTools.normalizeMirrorConfig({ ...current, ...patch })
    : { ...current, ...patch };
  await storageSet({ notesMirrorConfig: next });
  return next;
}

async function loadMirrorDataset() {
  const { memory, noteWorkspaces, actions, notesMirrorConfig } = await storageGet([
    "memory",
    "noteWorkspaces",
    "actions",
    "notesMirrorConfig"
  ]);
  return {
    memory: Array.isArray(memory) ? memory : [],
    noteWorkspaces: Array.isArray(noteWorkspaces) ? noteWorkspaces : [],
    actions: actions && typeof actions === "object" ? actions : { tasks: [], tableRows: [], contacts: [], drafts: [] },
    config: mirrorTools.normalizeMirrorConfig
      ? mirrorTools.normalizeMirrorConfig(notesMirrorConfig)
      : { schemaVersion: 1, includeContacts: Boolean(notesMirrorConfig && notesMirrorConfig.includeContacts), includeTasks: Boolean(notesMirrorConfig && notesMirrorConfig.includeTasks) }
  };
}

async function saveMirrorStatus(patch = {}) {
  const status = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    folderName: dirHandle && dirHandle.name ? dirHandle.name : "",
    permissionState,
    ...patch
  };
  await storageSet({ notesMirrorStatus: status });
  return status;
}

// -----------------------------------------------------------------------------
// File System Access API
// -----------------------------------------------------------------------------

async function pickFolder() {
  if (!window.showDirectoryPicker) {
    setStatus("This browser does not support the File System Access API.", "error");
    return;
  }
  try {
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    dirHandle = handle;
    permissionState = "granted";
    await idbPut(DB_KEY_HANDLE, handle);
    await storageSet({ notesFolderName: handle.name });
    log(`folder selected: ${handle.name}`);
    setStatus(`Folder set to "${handle.name}".`, "success");
    await saveMirrorStatus({ state: "folder_selected", lastError: "" }).catch(() => {});
    renderFolderState();
    await syncAll();
  } catch (err) {
    if (err && err.name === "AbortError") return; // user cancelled the picker
    setStatus(`Could not pick folder: ${err.message}`, "error");
    log(`pickFolder error: ${err.message}`, true);
  }
}

async function disconnectFolder() {
  dirHandle = null;
  permissionState = "unset";
  await idbDelete(DB_KEY_HANDLE);
  await storageSet({ notesFolderName: "" });
  await saveMirrorStatus({ state: "not_configured", folderName: "", lastError: "" }).catch(() => {});
  log("folder disconnected");
  setStatus("Folder disconnected. Notes are still saved in extension storage.");
  renderFolderState();
}

// Safe to call without user activation — only queries existing state.
async function queryPermission(handle) {
  if (!handle) return "unset";
  try {
    return await handle.queryPermission({ mode: "readwrite" });
  } catch (err) {
    log(`queryPermission error: ${err.message}`, true);
    return "denied";
  }
}

// Must be called from a user-gesture handler (e.g. button click).
async function requestPermission(handle) {
  if (!handle) return "unset";
  try {
    return await handle.requestPermission({ mode: "readwrite" });
  } catch (err) {
    log(`requestPermission error: ${err.message}`, true);
    return "denied";
  }
}

async function writeEntry(entry) {
  if (!dirHandle || permissionState !== "granted") return;
  const name = fileNameForId(entry.id);
  const fileHandle = await dirHandle.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(entry, null, 2));
  await writable.close();
}

async function deleteEntryById(id) {
  if (!dirHandle || permissionState !== "granted") return false;
  const name = fileNameForId(id);
  try {
    await dirHandle.removeEntry(name);
    return true;
  } catch (err) {
    if (err && err.name === "NotFoundError") return false;
    throw err;
  }
}

function splitMirrorPath(path) {
  if (mirrorTools.assertSafeRelativePath) mirrorTools.assertSafeRelativePath(path);
  if (path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Unsafe mirror path: ${path}`);
  }
  return path.split("/");
}

async function getDirectoryForParts(parts, create) {
  let current = dirHandle;
  for (const part of parts) {
    current = await current.getDirectoryHandle(part, { create });
  }
  return current;
}

async function writeMirrorFile(file) {
  if (!dirHandle || permissionState !== "granted") return;
  const parts = splitMirrorPath(file.path);
  const fileName = parts.pop();
  const parent = await getDirectoryForParts(parts, true);
  const fileHandle = await parent.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  const body = Object.prototype.hasOwnProperty.call(file, "json")
    ? JSON.stringify(file.json, null, 2)
    : String(file.content || "");
  await writable.write(body);
  await writable.close();
}

async function readMirrorJson(path) {
  if (!dirHandle || permissionState !== "granted") return null;
  try {
    const parts = splitMirrorPath(path);
    const fileName = parts.pop();
    const parent = await getDirectoryForParts(parts, false);
    const fileHandle = await parent.getFileHandle(fileName, { create: false });
    const file = await fileHandle.getFile();
    return JSON.parse(await file.text());
  } catch (err) {
    if (err && (err.name === "NotFoundError" || err.name === "SyntaxError")) return null;
    return null;
  }
}

async function removeMirrorPath(path) {
  if (!dirHandle || permissionState !== "granted") return false;
  const parts = splitMirrorPath(path);
  const fileName = parts.pop();
  try {
    const parent = await getDirectoryForParts(parts, false);
    await parent.removeEntry(fileName);
    return true;
  } catch (err) {
    if (err && err.name === "NotFoundError") return false;
    throw err;
  }
}

async function listLegacyMemoryFileNames() {
  if (!dirHandle) return new Set();
  const names = new Set();
  for await (const [name, child] of dirHandle.entries()) {
    if (child.kind !== "file") continue;
    if (mirrorTools.isLegacyMemoryFileName) {
      if (!mirrorTools.isLegacyMemoryFileName(name)) continue;
    } else if (!name.startsWith("mem_") || !name.endsWith(".json")) {
      continue;
    }
    names.add(name);
  }
  return names;
}

// Mirror chrome.storage.local memory into the chosen folder.
// Rewrites generated files so indexes and metadata stay current.
async function syncAll() {
  if (!dirHandle) {
    setStatus("Pick a folder first.");
    await saveMirrorStatus({ state: "not_configured", lastError: "" }).catch(() => {});
    return;
  }
  if (permissionState !== "granted") {
    setStatus("Folder permission not granted.", "error");
    await saveMirrorStatus({ state: "permission_required", lastError: "Folder permission not granted." }).catch(() => {});
    return;
  }
  if (!mirrorTools.buildMirrorPlan) {
    setStatus("Mirror helper failed to load.", "error");
    await saveMirrorStatus({ state: "error", lastError: "Mirror helper failed to load." }).catch(() => {});
    return;
  }

  setStatus("Syncing…");
  await saveMirrorStatus({ state: "syncing", lastError: "" }).catch(() => {});

  return enqueue(async () => {
    const dataset = await loadMirrorDataset();
    const plan = mirrorTools.buildMirrorPlan(dataset);
    const previousManifest = await readMirrorJson(mirrorTools.MANIFEST_PATH || "aaw_mirror_manifest.json");
    const legacyMemoryFiles = [...await listLegacyMemoryFileNames()];

    let written = 0;
    let deleted = 0;
    let failed = 0;

    for (const file of plan.files) {
      try {
        await writeMirrorFile(file);
        written++;
      } catch (err) {
        failed++;
        log(`write failed for ${file.path}: ${err.message}`, true);
      }
    }

    if (elDeleteOrphans && elDeleteOrphans.checked) {
      const stalePaths = mirrorTools.plannedStaleGeneratedPaths
        ? mirrorTools.plannedStaleGeneratedPaths(previousManifest, plan, legacyMemoryFiles)
        : [];
      for (const name of stalePaths) {
        try {
          const removed = await removeMirrorPath(name);
          if (!removed) continue;
          deleted++;
        } catch (err) {
          failed++;
          log(`delete failed for ${name}: ${err.message}`, true);
        }
      }
    }

    const summary = `sync done — wrote ${written}, deleted ${deleted}, failed ${failed}`;
    log(summary);
    setStatus(summary, failed ? "error" : "success");
    await saveMirrorStatus({
      state: failed ? "error" : "synced",
      lastError: failed ? `${failed} file operation(s) failed` : "",
      lastSyncAt: new Date().toISOString(),
      written,
      deleted,
      failed,
      counts: plan.manifest && plan.manifest.counts ? plan.manifest.counts : {}
    }).catch((err) => log(`status save failed: ${err.message}`, true));
  });
}

// -----------------------------------------------------------------------------
// UI rendering
// -----------------------------------------------------------------------------

function renderFolderState() {
  if (!elFolderName) return;

  if (!dirHandle) {
    elFolderName.textContent = "Not set";
    elFolderName.classList.add("is-empty");
    elFolderPerm.textContent = "";
    elFolderPerm.className = "opt-folder-perm";
    elBtnSync.disabled = true;
    elBtnDisconnect.disabled = true;
    return;
  }

  elFolderName.textContent = dirHandle.name;
  elFolderName.classList.remove("is-empty");

  if (permissionState === "granted") {
    elFolderPerm.textContent = "Read/write access granted.";
    elFolderPerm.className = "opt-folder-perm";
    elBtnSync.disabled = false;
    elBtnDisconnect.disabled = false;
  } else if (permissionState === "prompt") {
    elFolderPerm.textContent = "Permission not yet confirmed for this session.";
    elFolderPerm.className = "opt-folder-perm is-warn";
    elBtnSync.disabled = true;
    elBtnDisconnect.disabled = false;
    if (elBtnGrant) elBtnGrant.hidden = false;
  } else if (permissionState === "denied") {
    elFolderPerm.textContent = "Access denied. Click Choose folder to reconnect.";
    elFolderPerm.className = "opt-folder-perm is-error";
    elBtnSync.disabled = true;
    elBtnDisconnect.disabled = false;
    if (elBtnGrant) elBtnGrant.hidden = true;
  } else {
    elFolderPerm.textContent = "";
    elFolderPerm.className = "opt-folder-perm";
    elBtnSync.disabled = true;
    elBtnDisconnect.disabled = true;
    if (elBtnGrant) elBtnGrant.hidden = true;
  }
  if (permissionState === "granted" && elBtnGrant) elBtnGrant.hidden = true;
}

function renderMirrorConfig(config = {}) {
  if (elIncludeContacts) elIncludeContacts.checked = Boolean(config.includeContacts);
  if (elIncludeTasks) elIncludeTasks.checked = Boolean(config.includeTasks);
}

async function persistMirrorConfigFromUi() {
  const config = await saveMirrorConfig({
    includeContacts: Boolean(elIncludeContacts && elIncludeContacts.checked),
    includeTasks: Boolean(elIncludeTasks && elIncludeTasks.checked)
  });
  renderMirrorConfig(config);
  log("mirror export settings updated");
  if (dirHandle && permissionState === "granted") {
    await syncAll();
  }
  // Reflect contact/task include changes in an already-open preview.
  if (previewOpened) {
    await runMirrorPreview().catch((err) => log(`preview refresh failed: ${err.message}`, true));
  }
}

// -----------------------------------------------------------------------------
// Notes folder export preview — read-only. Builds the same plan syncAll() would
// write (mirrorTools.buildMirrorPlan) but never writes, changes, or deletes any
// file. The deletion preview only reads the existing manifest + legacy files.
// -----------------------------------------------------------------------------

let elPreviewRun, elPreviewSearch, elPreviewCounts, elPreviewFiles, elPreviewDetail, elPreviewJson, elPreviewDeletions;
let previewOpened = false;
let previewModelCache = null;
let previewSelectedPath = "";

const PREVIEW_GROUPS = [
  { key: "notes", label: "Root notes" },
  { key: "indexes", label: "Indexes" },
  { key: "workspaces", label: "Workspaces" },
  { key: "contacts", label: "Contacts" },
  { key: "tasks", label: "Tasks" },
  { key: "manifest", label: "Manifest" }
];

function previewGroupKey(file) {
  if (file.kind === "manifest") return "manifest";
  const path = String(file.path || "");
  if (path.startsWith("indexes/")) return "indexes";
  if (path.startsWith("workspaces/")) return "workspaces";
  if (path.startsWith("contacts/")) return "contacts";
  if (path.startsWith("tasks/")) return "tasks";
  return "notes";
}

function previewFileSummary(file) {
  const json = file && file.json ? file.json : {};
  switch (file.kind) {
    case "memory": {
      const source = json.sourceUrl || json.urlKey || json.sourceHost || "";
      const title = json.title || "Untitled note";
      return source ? `${title} — ${source}` : title;
    }
    case "workspace":
      return `${(json.workspace && json.workspace.name) || "Workspace"} · ${json.noteCount || 0} note(s)`;
    case "workspace_index":
      return `${(json.workspaces || []).length} workspace(s) indexed`;
    case "source_index":
      return `${(json.sources || []).length} source(s) indexed`;
    case "contact":
      return (json.contact && json.contact.name) || "Contact";
    case "task":
      return `${(json.task && json.task.title) || "Task"} · ${(json.task && json.task.status) || "open"}`;
    case "manifest":
      return `Manifest · ${(json.counts && json.counts.files) || 0} file(s)`;
    default:
      return file.path;
  }
}

// Pure: build the preview model (counts + grouped files) from a dataset.
function buildMirrorPreview(dataset) {
  const plan = mirrorTools.buildMirrorPlan(dataset);
  const counts0 = (plan.manifest && plan.manifest.counts) || {};
  const counts = {
    notes: counts0.memory || 0,
    workspaces: counts0.workspaces || 0,
    sources: counts0.sources || 0,
    contacts: counts0.contacts || 0,
    tasks: counts0.tasks || 0,
    files: counts0.files || (plan.files ? plan.files.length : 0)
  };
  const files = (plan.files || []).map((file) => ({
    path: file.path,
    kind: file.kind,
    summary: previewFileSummary(file),
    json: file.json,
    group: previewGroupKey(file)
  }));
  const groups = PREVIEW_GROUPS
    .map((group) => ({ key: group.key, label: group.label, files: files.filter((f) => f.group === group.key) }))
    .filter((group) => group.files.length);
  return { plan, counts, files, groups };
}

// Pure: deletion preview model. Returns an unavailable/disabled state unless a
// granted folder is connected with one-way sync enabled.
function buildDeletionPreview(opts = {}) {
  const { hasFolder, permissionState: perm, deleteOrphans, previousManifest, plan, legacyMemoryFiles = [] } = opts;
  if (!hasFolder) return { available: false, reason: "Connect a folder to preview deletions." };
  if (perm !== "granted") return { available: false, reason: "Grant folder access to preview deletions." };
  if (!deleteOrphans) return { available: false, reason: "Enable one-way sync to preview deletions." };
  if (!mirrorTools.plannedStaleGeneratedPaths) return { available: false, reason: "Mirror helper unavailable." };
  return { available: true, paths: mirrorTools.plannedStaleGeneratedPaths(previousManifest, plan, legacyMemoryFiles) };
}

function renderPreviewCounts(counts) {
  if (!elPreviewCounts) return;
  elPreviewCounts.textContent = "";
  const entries = [
    ["Notes", counts.notes],
    ["Workspaces", counts.workspaces],
    ["Sources", counts.sources],
    ["Contacts", counts.contacts],
    ["Tasks", counts.tasks],
    ["Files", counts.files]
  ];
  for (const [label, value] of entries) {
    const chip = document.createElement("div");
    chip.className = "opt-preview-count";
    const num = document.createElement("span");
    num.className = "opt-preview-count-value";
    num.textContent = String(value);
    const name = document.createElement("span");
    name.className = "opt-preview-count-label";
    name.textContent = label;
    chip.appendChild(num);
    chip.appendChild(name);
    elPreviewCounts.appendChild(chip);
  }
}

function renderPreviewDetail(file) {
  if (!elPreviewDetail || !elPreviewJson) return;
  elPreviewDetail.textContent = "";
  if (!file) {
    elPreviewDetail.textContent = "Select a file to inspect its contents.";
    elPreviewJson.textContent = "";
    return;
  }
  const pathRow = document.createElement("div");
  pathRow.className = "opt-preview-detail-path";
  pathRow.textContent = file.path;
  const kindRow = document.createElement("div");
  kindRow.className = "opt-preview-detail-kind";
  kindRow.textContent = file.kind;
  const summaryRow = document.createElement("div");
  summaryRow.className = "opt-preview-detail-summary";
  summaryRow.textContent = file.summary;
  elPreviewDetail.appendChild(pathRow);
  elPreviewDetail.appendChild(kindRow);
  elPreviewDetail.appendChild(summaryRow);
  elPreviewJson.textContent = JSON.stringify(file.json, null, 2);
}

function renderPreviewFiles(groups, query) {
  if (!elPreviewFiles) return;
  elPreviewFiles.textContent = "";
  const q = String(query || "").trim().toLowerCase();
  let visible = 0;
  for (const group of groups) {
    const matching = group.files.filter((file) =>
      !q || file.path.toLowerCase().includes(q) || file.summary.toLowerCase().includes(q));
    if (!matching.length) continue;
    const groupEl = document.createElement("div");
    groupEl.className = "opt-preview-group";
    const heading = document.createElement("div");
    heading.className = "opt-preview-group-label";
    heading.textContent = `${group.label} (${matching.length})`;
    groupEl.appendChild(heading);
    for (const file of matching) {
      visible++;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "opt-preview-file";
      if (file.path === previewSelectedPath) button.classList.add("is-selected");
      button.textContent = file.path;
      button.addEventListener("click", () => {
        previewSelectedPath = file.path;
        renderPreviewDetail(file);
        for (const el of elPreviewFiles.querySelectorAll(".opt-preview-file")) el.classList.remove("is-selected");
        button.classList.add("is-selected");
      });
      groupEl.appendChild(button);
    }
    elPreviewFiles.appendChild(groupEl);
  }
  if (!visible) elPreviewFiles.textContent = q ? "No files match the search." : "No generated files.";
}

function renderPreviewDeletions(result) {
  if (!elPreviewDeletions) return;
  elPreviewDeletions.textContent = "";
  elPreviewDeletions.classList.toggle("is-disabled", !result.available);
  if (!result.available) {
    elPreviewDeletions.textContent = result.reason || "Deletion preview unavailable.";
    return;
  }
  if (!result.paths.length) {
    elPreviewDeletions.textContent = "No stale files would be deleted.";
    return;
  }
  const heading = document.createElement("div");
  heading.className = "opt-preview-group-label";
  heading.textContent = `${result.paths.length} file(s) would be deleted`;
  elPreviewDeletions.appendChild(heading);
  for (const path of result.paths) {
    const row = document.createElement("div");
    row.className = "opt-preview-deletion";
    row.textContent = path;
    elPreviewDeletions.appendChild(row);
  }
}

async function runMirrorPreview() {
  if (!mirrorTools.buildMirrorPlan) {
    setStatus("Mirror helper failed to load.", "error");
    return;
  }
  previewOpened = true;
  const dataset = await loadMirrorDataset();
  const preview = buildMirrorPreview(dataset);
  previewModelCache = preview;

  renderPreviewCounts(preview.counts);
  if (!preview.files.some((file) => file.path === previewSelectedPath)) {
    previewSelectedPath = "";
    renderPreviewDetail(null);
  }
  renderPreviewFiles(preview.groups, elPreviewSearch ? elPreviewSearch.value : "");

  // Deletion preview reads (but never writes) the existing manifest + legacy files.
  const deleteOrphans = Boolean(elDeleteOrphans && elDeleteOrphans.checked);
  let previousManifest = null;
  let legacyMemoryFiles = [];
  if (dirHandle && permissionState === "granted" && deleteOrphans) {
    previousManifest = await readMirrorJson(mirrorTools.MANIFEST_PATH || "aaw_mirror_manifest.json");
    legacyMemoryFiles = [...await listLegacyMemoryFileNames()];
  }
  renderPreviewDeletions(buildDeletionPreview({
    hasFolder: Boolean(dirHandle),
    permissionState,
    deleteOrphans,
    previousManifest,
    plan: preview.plan,
    legacyMemoryFiles
  }));
}

async function grantAccess() {
  if (!dirHandle) {
    setStatus("Pick a folder first.");
    return;
  }
  const state = await requestPermission(dirHandle);
  permissionState = state;
  if (state === "granted") {
    setStatus("Access granted.", "success");
    await saveMirrorStatus({ state: "permission_granted", lastError: "" }).catch(() => {});
    renderFolderState();
    await syncAll();
  } else {
    setStatus(`Access ${state}. Click Choose folder to reconnect.`, "error");
    await saveMirrorStatus({
      state: state === "denied" ? "permission_denied" : "permission_prompt",
      lastError: state === "denied" ? "Folder access denied." : ""
    }).catch(() => {});
    renderFolderState();
  }
}

// -----------------------------------------------------------------------------
// Live save listener
// -----------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message) => {
  if (!message || !message.type) return;
  if (!dirHandle || permissionState !== "granted") return;

  if (message.type === "BACKUP_IMPORTED" || message.type === "MIRROR_DATA_CHANGED" || message.type === "MEMORY_CLEARED") {
    syncAll().catch((err) => log(`full mirror resync failed: ${err.message}`, true));
    return;
  }

  if ((message.type === "MEMORY_SAVED" || message.type === "MEMORY_UPDATED") && !message.item) return;
  if (message.type === "MEMORY_DELETED" && !message.id) return;
  if (message.type !== "MEMORY_SAVED" && message.type !== "MEMORY_UPDATED" && message.type !== "MEMORY_DELETED") return;

  if (message.type === "MEMORY_DELETED") {
    enqueue(async () => {
      try {
        const removed = await deleteEntryById(message.id);
        log(`live delete: ${fileNameForId(message.id)}${removed ? "" : " (already absent)"}`);
      } catch (err) {
        log(`live delete failed: ${err.message}`, true);
      }
    }).then(() => syncAll()).catch((err) => log(`delete resync failed: ${err.message}`, true));
    return;
  }

  syncAll().catch((err) => log(`live mirror resync failed: ${err.message}`, true));
});

// =============================================================================
// Settings hub — AI, backend, privacy, duplicates, backup, shortcuts.
//
// All sections share one request() helper. In remote mode it fetches the
// configured backend; otherwise it sends a message to the service worker via
// AssistantSettings.buildRouteMessage (with AssistantPrivacy.buildPrivacyMessage
// for privacy routes). chrome.storage.local is the source of truth for settings
// — we also write `privacySettings` locally so any open content panels notice.
// =============================================================================

const SETTINGS_KEYS = [
  "assistantBackendUrl",
  "llmProvider",
  "geminiApiKey", "openaiApiKey", "anthropicApiKey",
  "geminiModel",  "openaiModel",  "anthropicModel",
  "privacySettings"
];

let settingsState = null;          // last-loaded settings snapshot
let liveApiKeys = { gemini: "", openai: "", anthropic: "" }; // per-provider draft keys
let backupRestorePointId = "";     // remembered between Restore Point and Replace Import

async function loadAllSettings() {
  if (settingsTools.loadSettings) {
    return settingsTools.loadSettings();
  }
  const result = await storageGet(SETTINGS_KEYS);
  return {
    backendUrl: String(result.assistantBackendUrl || "").trim().replace(/\/+$/, ""),
    llmProvider: result.llmProvider || "gemini",
    geminiApiKey: result.geminiApiKey || "",
    openaiApiKey: result.openaiApiKey || "",
    anthropicApiKey: result.anthropicApiKey || "",
    geminiModel: result.geminiModel || "gemini-2.5-flash",
    openaiModel: result.openaiModel || "gpt-5.5",
    anthropicModel: result.anthropicModel || "claude-sonnet-4-6",
    privacySettings: result.privacySettings || null
  };
}

// HTTP-style request router: fetch when a backend URL is set, otherwise route
// through the service worker. This lets every section be backend-agnostic.
async function request(path, options = {}) {
  if (settingsState && settingsState.backendUrl) {
    const response = await fetch(`${settingsState.backendUrl}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options
    });
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error(`Server returned non-JSON response (status ${response.status})`);
    }
    if (!response.ok) throw new Error(data.error || "Request failed");
    return data;
  }
  if (!settingsTools.buildRouteMessage) throw new Error("Settings helper unavailable.");
  const message = settingsTools.buildRouteMessage(path, options, {
    buildPrivacyMessage: privacyTools.buildPrivacyMessage
  });
  if (!message) throw new Error(`Unknown route: ${(options.method || "GET").toUpperCase()} ${path}`);
  if (!settingsTools.sendLocalMessage) throw new Error("Local message helper unavailable.");
  return settingsTools.sendLocalMessage(message);
}

// ---------------------------------------------------------------------------
// Custom dropdown for settings <select>s
//
// The native <select> stays in the DOM (same id + data-aaw-test) but is visually
// hidden. A combobox/listbox UI mirrors it, and selecting an option writes the
// native `.value` and dispatches a `change` event so existing logic keeps working.
// Programmatic changes call syncDropdown(id) to refresh the visible UI.
// ---------------------------------------------------------------------------

const optDropdowns = new Map();
let openOptDropdown = null; // { wrapper, close } for the dropdown currently open

function ensureOptDropdownListener() {
  if (ensureOptDropdownListener._wired || typeof document === "undefined") return;
  ensureOptDropdownListener._wired = true;
  document.addEventListener("click", (e) => {
    if (openOptDropdown && !openOptDropdown.wrapper.contains(e.target)) openOptDropdown.close();
  });
}

function enhanceSelect(select) {
  if (!select || select.dataset.optEnhanced) return optDropdowns.get(select && select.id) || null;
  ensureOptDropdownListener();
  select.dataset.optEnhanced = "true";

  const field = select.closest(".opt-field");
  const labelEl = field ? field.querySelector(".opt-label") : null;
  const labelText = labelEl ? labelEl.textContent.trim() : "";
  const listId = `${select.id}-opt-listbox`;

  const wrapper = document.createElement("div");
  wrapper.className = "opt-dropdown";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "opt-dropdown__trigger";
  trigger.setAttribute("role", "combobox");
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", listId);
  trigger.setAttribute("data-aaw-test", `${select.id}-dropdown`);
  if (labelText) trigger.setAttribute("aria-label", labelText);

  const valueSpan = document.createElement("span");
  valueSpan.className = "opt-dropdown__value";
  const chevron = document.createElement("span");
  chevron.className = "opt-dropdown__chevron";
  chevron.setAttribute("aria-hidden", "true");
  trigger.append(valueSpan, chevron);

  const list = document.createElement("ul");
  list.id = listId;
  list.className = "opt-dropdown__list";
  list.setAttribute("role", "listbox");
  list.setAttribute("data-aaw-test", listId);
  if (labelText) list.setAttribute("aria-label", labelText);

  wrapper.append(trigger, list);

  // Hide the native select but keep it for value/change contract + label association.
  select.classList.add("opt-select-hidden");
  select.setAttribute("tabindex", "-1");
  select.setAttribute("aria-hidden", "true");
  select.insertAdjacentElement("afterend", wrapper);

  let isOpen = false;
  let activeIdx = -1;
  const items = () => list.querySelectorAll(".opt-dropdown__option");

  function syncDisabled() {
    wrapper.classList.toggle("opt-dropdown--disabled", select.disabled);
    trigger.disabled = select.disabled;
  }

  function syncLabel() {
    const sel = select.options[select.selectedIndex];
    valueSpan.textContent = sel ? sel.textContent : "";
  }

  function syncSelected() {
    items().forEach((li, i) => {
      const sel = i === select.selectedIndex;
      li.setAttribute("aria-selected", String(sel));
      li.classList.toggle("opt-dropdown__option--selected", sel);
    });
    syncLabel();
  }

  function setActiveIdx(idx) {
    const list2 = items();
    if (activeIdx >= 0 && list2[activeIdx]) list2[activeIdx].classList.remove("opt-dropdown__option--active");
    activeIdx = idx;
    if (activeIdx >= 0 && list2[activeIdx]) {
      const el = list2[activeIdx];
      el.classList.add("opt-dropdown__option--active");
      trigger.setAttribute("aria-activedescendant", el.id);
      el.scrollIntoView({ block: "nearest" });
    } else {
      trigger.removeAttribute("aria-activedescendant");
    }
  }

  function choose(idx) {
    if (idx < 0 || idx >= select.options.length || idx === select.selectedIndex) return;
    select.selectedIndex = idx;
    syncSelected();
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function renderOptions() {
    list.textContent = "";
    Array.from(select.options).forEach((o, i) => {
      const li = document.createElement("li");
      li.className = "opt-dropdown__option";
      li.setAttribute("role", "option");
      li.id = `${select.id}-opt-${i}`;
      li.dataset.value = o.value;
      li.textContent = o.textContent;
      li.addEventListener("click", (e) => { e.stopPropagation(); choose(i); close(); trigger.focus(); });
      li.addEventListener("mouseenter", () => setActiveIdx(i));
      list.appendChild(li);
    });
    syncSelected();
  }

  function open() {
    if (isOpen || select.disabled) return;
    if (openOptDropdown && openOptDropdown.wrapper !== wrapper) openOptDropdown.close();
    isOpen = true;
    openOptDropdown = { wrapper, close };
    wrapper.classList.add("opt-dropdown--open");
    trigger.setAttribute("aria-expanded", "true");
    setActiveIdx(select.selectedIndex >= 0 ? select.selectedIndex : 0);
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    if (openOptDropdown && openOptDropdown.wrapper === wrapper) openOptDropdown = null;
    wrapper.classList.remove("opt-dropdown--open");
    trigger.setAttribute("aria-expanded", "false");
    trigger.removeAttribute("aria-activedescendant");
    activeIdx = -1;
    items().forEach((li) => li.classList.remove("opt-dropdown__option--active"));
  }

  trigger.addEventListener("click", (e) => { e.stopPropagation(); if (isOpen) close(); else open(); });
  trigger.addEventListener("keydown", (e) => {
    const count = select.options.length;
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); if (!isOpen) open(); else setActiveIdx(Math.min(activeIdx + 1, count - 1)); break;
      case "ArrowUp": e.preventDefault(); if (!isOpen) open(); else setActiveIdx(Math.max(activeIdx - 1, 0)); break;
      case "Home": if (isOpen) { e.preventDefault(); setActiveIdx(0); } break;
      case "End": if (isOpen) { e.preventDefault(); setActiveIdx(count - 1); } break;
      case "Enter": case " ":
        e.preventDefault();
        if (!isOpen) { open(); break; }
        if (activeIdx >= 0) { choose(activeIdx); close(); trigger.focus(); }
        break;
      case "Escape": if (isOpen) { e.preventDefault(); e.stopPropagation(); close(); trigger.focus(); } break;
      case "Tab": close(); break;
    }
  });

  const instance = {
    wrapper,
    close,
    // Rebuild from the native select after options or value change programmatically.
    refresh() { if (isOpen) close(); renderOptions(); syncDisabled(); }
  };
  renderOptions();
  syncDisabled();
  optDropdowns.set(select.id, instance);
  return instance;
}

function syncDropdown(id) {
  const inst = optDropdowns.get(id);
  if (inst) inst.refresh();
}

// ---------------------------------------------------------------------------
// AI section
// ---------------------------------------------------------------------------

function getProviderConfigs() {
  return settingsTools.PROVIDER_CONFIGS || {
    gemini: { label: "Google Gemini", keyPlaceholder: "AIza…", models: [{ value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" }] },
    openai: { label: "OpenAI", keyPlaceholder: "sk-…", models: [{ value: "gpt-5.5", label: "GPT-5.5" }] },
    anthropic: { label: "Anthropic Claude", keyPlaceholder: "sk-ant-…", models: [{ value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" }] }
  };
}

function populateModelDropdown(modelEl, provider, currentValue) {
  const config = getProviderConfigs()[provider];
  if (!modelEl || !config) return;
  modelEl.textContent = "";
  for (const option of config.models) {
    const opt = document.createElement("option");
    opt.value = option.value;
    opt.textContent = option.label;
    modelEl.appendChild(opt);
  }
  if (currentValue && config.models.some((m) => m.value === currentValue)) {
    modelEl.value = currentValue;
  }
  syncDropdown("ai-model");
}

function applyProviderToUi(provider) {
  const configs = getProviderConfigs();
  const config = configs[provider] || configs.gemini;
  const providerEl = document.getElementById("ai-provider");
  const keyEl = document.getElementById("ai-api-key");
  const modelEl = document.getElementById("ai-model");
  if (providerEl) { providerEl.value = provider; syncDropdown("ai-provider"); }
  if (keyEl) {
    keyEl.placeholder = config.keyPlaceholder;
    keyEl.value = liveApiKeys[provider] || "";
  }
  const modelField = (settingsTools.PROVIDER_MODEL_FIELD || { gemini: "geminiModel", openai: "openaiModel", anthropic: "anthropicModel" })[provider];
  const currentModel = settingsState ? settingsState[modelField] : "";
  populateModelDropdown(modelEl, provider, currentModel);
}

function setStatusEl(id, text, kind) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text || "";
  el.classList.remove("is-error", "is-success");
  if (kind === "error") el.classList.add("is-error");
  else if (kind === "success") el.classList.add("is-success");
}

function initAiSection() {
  const providerEl = document.getElementById("ai-provider");
  const keyEl = document.getElementById("ai-api-key");
  const modelEl = document.getElementById("ai-model");
  const saveEl = document.getElementById("ai-save");
  if (!providerEl) return;

  const configs = getProviderConfigs();
  providerEl.textContent = "";
  for (const [value, cfg] of Object.entries(configs)) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = cfg.label;
    providerEl.appendChild(opt);
  }

  // Snapshot keys for "switch-provider-and-restore-entered-key" behavior.
  liveApiKeys = {
    gemini: settingsState ? settingsState.geminiApiKey : "",
    openai: settingsState ? settingsState.openaiApiKey : "",
    anthropic: settingsState ? settingsState.anthropicApiKey : ""
  };
  applyProviderToUi(settingsState ? settingsState.llmProvider : "gemini");

  providerEl.addEventListener("change", () => {
    if (keyEl) liveApiKeys[providerEl.value === keyEl.dataset.lastProvider ? providerEl.value : (keyEl.dataset.lastProvider || providerEl.value)] = keyEl.value;
    applyProviderToUi(providerEl.value);
    if (keyEl) keyEl.dataset.lastProvider = providerEl.value;
  });
  if (keyEl) {
    keyEl.dataset.lastProvider = providerEl.value;
    keyEl.addEventListener("input", () => {
      liveApiKeys[providerEl.value] = keyEl.value;
    });
  }

  if (saveEl) saveEl.addEventListener("click", async () => {
    const provider = providerEl.value;
    const apiKey = keyEl ? keyEl.value : "";
    const model = modelEl ? modelEl.value : "";
    try {
      if (settingsTools.saveAiSettings) {
        await settingsTools.saveAiSettings(provider, apiKey, model);
      } else {
        const keyField = { gemini: "geminiApiKey", openai: "openaiApiKey", anthropic: "anthropicApiKey" }[provider];
        const modelField = { gemini: "geminiModel", openai: "openaiModel", anthropic: "anthropicModel" }[provider];
        await storageSet({ llmProvider: provider, [keyField]: apiKey, [modelField]: model });
      }
      settingsState = await loadAllSettings();
      setStatusEl("ai-status", "Saved.", "success");
    } catch (error) {
      setStatusEl("ai-status", `Save failed: ${error.message}`, "error");
    }
  });
}

// ---------------------------------------------------------------------------
// Backend section
// ---------------------------------------------------------------------------

function updateModeBadge() {
  const badge = document.getElementById("opt-mode-badge");
  if (!badge) return;
  if (settingsState && settingsState.backendUrl) {
    badge.textContent = `Remote — ${settingsState.backendUrl}`;
  } else {
    badge.textContent = "Built-in (no server)";
  }
}

function initBackendSection() {
  const urlEl = document.getElementById("backend-url");
  const saveEl = document.getElementById("backend-save");
  const testEl = document.getElementById("backend-test");
  if (!urlEl) return;

  urlEl.value = settingsState ? settingsState.backendUrl : "";

  if (saveEl) saveEl.addEventListener("click", async () => {
    try {
      const next = settingsTools.saveBackendUrl
        ? await settingsTools.saveBackendUrl(urlEl.value)
        : String(urlEl.value || "").trim().replace(/\/+$/, "");
      if (!settingsTools.saveBackendUrl) await storageSet({ assistantBackendUrl: next });
      settingsState = await loadAllSettings();
      urlEl.value = next;
      updateModeBadge();
      setStatusEl("backend-status", next ? "Saved. Using remote backend." : "Saved. Built-in mode.", "success");
    } catch (error) {
      setStatusEl("backend-status", `Save failed: ${error.message}`, "error");
    }
  });

  if (testEl) testEl.addEventListener("click", async () => {
    setStatusEl("backend-status", "Testing…");
    try {
      const result = await request("/api/llm/health", { method: "GET" });
      if (result && (result.ok || result.status === "ok" || result.provider)) {
        setStatusEl("backend-status", "Connection OK.", "success");
      } else {
        setStatusEl("backend-status", `Response: ${JSON.stringify(result).slice(0, 200)}`);
      }
    } catch (error) {
      // Fall back to /health so a missing /api/llm/health still gives a useful signal.
      try {
        await request("/health", { method: "GET" });
        setStatusEl("backend-status", "Reached /health (no LLM info).", "success");
      } catch (err2) {
        setStatusEl("backend-status", `Test failed: ${error.message}`, "error");
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Privacy section
// ---------------------------------------------------------------------------

function privacyDefaults() {
  return privacyTools.defaultPrivacySettings ? privacyTools.defaultPrivacySettings() : {
    aiMode: "auto",
    redaction: { enabled: false, applyToModelPayload: true, redactEmails: true, redactPhones: true, redactTokenLikeSecrets: true, sendFullUrlToProvider: false },
    siteRules: { excludedHosts: [], hostOverrides: {} },
    retention: { enabled: false, memoryDays: 0, contactsDays: 0, tasksDays: 0, draftsDays: 0, tableRowsDays: 0, privacyEventsDays: 90 }
  };
}

function privacyNormalize(value) {
  return privacyTools.normalizePrivacySettings ? privacyTools.normalizePrivacySettings(value) : (value || privacyDefaults());
}

function privacyMerge(existing, patch) {
  return privacyTools.mergePrivacySettings ? privacyTools.mergePrivacySettings(existing, patch) : { ...existing, ...patch };
}

function applyPrivacyToUi(settings) {
  const s = privacyNormalize(settings);
  const r = s.redaction || {};
  const rules = s.siteRules || {};
  const ret = s.retention || {};
  const set = (id, value) => { const el = document.getElementById(id); if (el) el.value = value; };
  const check = (id, value) => { const el = document.getElementById(id); if (el) el.checked = Boolean(value); };
  set("privacy-mode", s.aiMode || "auto");
  syncDropdown("privacy-mode");
  check("privacy-redaction-enabled", r.enabled);
  check("privacy-redaction-payload", r.applyToModelPayload);
  check("privacy-redact-emails", r.redactEmails);
  check("privacy-redact-phones", r.redactPhones);
  check("privacy-redact-secrets", r.redactTokenLikeSecrets);
  check("privacy-full-url", r.sendFullUrlToProvider);
  set("privacy-excluded-hosts", (rules.excludedHosts || []).join("\n"));
  const overrides = settingsTools.formatHostOverrides
    ? settingsTools.formatHostOverrides(rules.hostOverrides || {})
    : Object.entries(rules.hostOverrides || {}).map(([k, v]) => `${k}=${v}`).join("\n");
  set("privacy-host-overrides", overrides);
  check("privacy-retention-enabled", ret.enabled);
  set("privacy-retention-memory", String(ret.memoryDays || 0));
  set("privacy-retention-contacts", String(ret.contactsDays || 0));
  set("privacy-retention-tasks", String(ret.tasksDays || 0));
  set("privacy-retention-drafts", String(ret.draftsDays || 0));
  set("privacy-retention-table", String(ret.tableRowsDays || 0));
  set("privacy-retention-events", String(ret.privacyEventsDays || 0));
}

function readPrivacyForm() {
  const checked = (id) => Boolean(document.getElementById(id) && document.getElementById(id).checked);
  const val = (id) => (document.getElementById(id) ? document.getElementById(id).value : "");
  const intVal = (id) => {
    const n = Number(val(id));
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  };
  const split = settingsTools.splitPrivacyList || ((v) => String(v || "").split(/\n|,/).map((x) => x.trim()).filter(Boolean));
  const parseOverrides = (v) => settingsTools.parseHostOverrides
    ? settingsTools.parseHostOverrides(v, privacyTools.normalizeHostRule)
    : {};
  return {
    aiMode: val("privacy-mode"),
    redaction: {
      enabled: checked("privacy-redaction-enabled"),
      applyToModelPayload: checked("privacy-redaction-payload"),
      redactEmails: checked("privacy-redact-emails"),
      redactPhones: checked("privacy-redact-phones"),
      redactTokenLikeSecrets: checked("privacy-redact-secrets"),
      sendFullUrlToProvider: checked("privacy-full-url")
    },
    siteRules: {
      excludedHosts: split(val("privacy-excluded-hosts")),
      hostOverrides: parseOverrides(val("privacy-host-overrides"))
    },
    retention: {
      enabled: checked("privacy-retention-enabled"),
      memoryDays: intVal("privacy-retention-memory"),
      contactsDays: intVal("privacy-retention-contacts"),
      tasksDays: intVal("privacy-retention-tasks"),
      draftsDays: intVal("privacy-retention-drafts"),
      tableRowsDays: intVal("privacy-retention-table"),
      privacyEventsDays: intVal("privacy-retention-events"),
      embeddingsPolicy: "with_memory"
    }
  };
}

function renderProvenanceList(events) {
  const list = document.getElementById("privacy-provenance-list");
  if (!list) return;
  list.textContent = "";
  if (!events.length) {
    list.textContent = "No provenance events yet.";
    return;
  }
  for (const event of events.slice(0, 12)) {
    const row = document.createElement("div");
    row.className = "opt-privacy-event";
    const time = event.timestamp ? new Date(event.timestamp).toLocaleString() : "";
    row.textContent = [
      event.operation || "operation",
      event.effectiveAiMode || "",
      event.sentToProvider ? `→ ${event.provider || "provider"}` : "(local)",
      time
    ].filter(Boolean).join(" • ");
    list.appendChild(row);
  }
}

async function refreshProvenance() {
  const list = document.getElementById("privacy-provenance-list");
  if (list) list.textContent = "Loading…";
  try {
    const data = await request("/api/privacy/provenance?limit=8&offset=0", { method: "GET" });
    const events = Array.isArray(data && data.events) ? data.events : [];
    events.sort((a, b) => Date.parse(b.timestamp || 0) - Date.parse(a.timestamp || 0));
    renderProvenanceList(events);
  } catch (error) {
    if (list) list.textContent = "Provenance unavailable.";
    setStatusEl("privacy-status", `Provenance failed: ${error.message}`, "error");
  }
}

function initPrivacySection() {
  applyPrivacyToUi(settingsState ? settingsState.privacySettings : null);

  const saveEl = document.getElementById("privacy-save");
  if (saveEl) saveEl.addEventListener("click", async () => {
    const patch = readPrivacyForm();
    const next = privacyMerge(settingsState ? settingsState.privacySettings : null, patch);
    try {
      // Save locally first so open content panels see it via storage.onChanged.
      if (settingsTools.savePrivacySettings) await settingsTools.savePrivacySettings(next);
      else await storageSet({ privacySettings: next });
      // If a backend is configured, also PATCH the server.
      if (settingsState && settingsState.backendUrl) {
        await request("/api/privacy/settings", { method: "PATCH", body: JSON.stringify(next) });
      } else {
        // In built-in mode the service worker also owns privacy settings; mirror the PATCH.
        try { await request("/api/privacy/settings", { method: "PATCH", body: JSON.stringify(next) }); } catch { /* ignore — local copy is canonical */ }
      }
      settingsState = await loadAllSettings();
      applyPrivacyToUi(settingsState.privacySettings);
      setStatusEl("privacy-status", "Privacy settings saved.", "success");
    } catch (error) {
      setStatusEl("privacy-status", `Privacy save failed: ${error.message}`, "error");
    }
  });

  const refreshEl = document.getElementById("privacy-provenance-refresh");
  if (refreshEl) refreshEl.addEventListener("click", () => refreshProvenance());

  const retentionEl = document.getElementById("privacy-retention-run");
  if (retentionEl) retentionEl.addEventListener("click", async () => {
    try {
      const result = await request("/api/privacy/retention/run", { method: "POST", body: "{}" });
      setStatusEl("privacy-status", result && result.ran ? `Retention ran: ${JSON.stringify(result.removed || {})}` : "Retention is disabled.", result && result.ran ? "success" : undefined);
      await refreshProvenance();
    } catch (error) {
      setStatusEl("privacy-status", `Retention failed: ${error.message}`, "error");
    }
  });

  const clearEl = document.getElementById("privacy-clear-run");
  if (clearEl) clearEl.addEventListener("click", async () => {
    const buckets = Array.from(document.querySelectorAll("#privacy input[data-bucket]"))
      .filter((el) => el.checked)
      .map((el) => el.dataset.bucket);
    if (!buckets.length) {
      setStatusEl("privacy-status", "Select at least one bucket to clear.", "error");
      return;
    }
    const confirmEl = document.getElementById("privacy-clear-confirm");
    if (!confirmEl || confirmEl.value.trim() !== "CLEAR") {
      setStatusEl("privacy-status", "Type CLEAR before clearing data.", "error");
      return;
    }
    const beforeEl = document.getElementById("privacy-clear-before");
    const before = beforeEl && beforeEl.value ? new Date(`${beforeEl.value}T00:00:00`).toISOString() : "";
    try {
      const result = await request("/api/privacy/clear-data", { method: "POST", body: JSON.stringify({ buckets, before, confirmationToken: confirmEl.value.trim() }) });
      setStatusEl("privacy-status", `Cleared: ${JSON.stringify(result && result.cleared || {})}`, "success");
    } catch (error) {
      setStatusEl("privacy-status", `Clear failed: ${error.message}`, "error");
    }
  });

  refreshProvenance().catch(() => {});
}

// ---------------------------------------------------------------------------
// Duplicate review section
// ---------------------------------------------------------------------------

function dedupeLabel(value) { return String(value || "item").replace(/_/g, " "); }

function setDedupeStatus(message) {
  const el = document.getElementById("dedupe-status");
  if (el) el.textContent = message || "";
}

function appendDedupeMeta(parent, meta = {}) {
  const values = [];
  for (const key of ["email", "phone", "company", "status", "priority", "dueDate", "sourceUrl", "urlKey"]) {
    if (meta[key]) values.push(String(meta[key]));
  }
  if (!values.length && meta.recordCount) values.push(`${meta.recordCount} linked records`);
  if (!values.length) return;
  const el = document.createElement("div");
  el.className = "opt-dedupe-meta";
  el.textContent = values.slice(0, 4).join(" • ");
  parent.appendChild(el);
}

function renderDedupePreviewRecord(record = {}) {
  const row = document.createElement("div");
  row.className = "opt-dedupe-record";
  const title = document.createElement("div");
  title.className = "opt-dedupe-record-title";
  title.textContent = record.label || record.id || "Record";
  const summary = document.createElement("div");
  summary.className = "opt-dedupe-record-summary";
  summary.textContent = record.summary || "No preview text.";
  row.appendChild(title);
  row.appendChild(summary);
  appendDedupeMeta(row, record.meta || {});
  return row;
}

async function previewDedupeGroup(group, card) {
  const detail = card.querySelector(".opt-dedupe-detail");
  if (!detail) return;
  detail.textContent = "Building preview…";
  try {
    const data = await request("/api/dedupe/preview", { method: "POST", body: JSON.stringify({ groupId: group.groupId, type: group.type }) });
    const plan = data && data.plan;
    if (!plan) throw new Error("Preview was empty.");
    detail.textContent = "";
    const operations = document.createElement("div");
    operations.className = "opt-dedupe-meta";
    operations.textContent = (plan.operations || []).map((op) => op.description || `${op.action}${op.id ? ` ${op.id}` : ""}`).join(" • ");
    detail.appendChild(operations);
    const planMeta = document.createElement("div");
    planMeta.className = "opt-dedupe-meta";
    planMeta.textContent = `Keep ${plan.primaryId}. Plan ${plan.planHash}.`;
    detail.appendChild(planMeta);
    const apply = document.createElement("button");
    apply.type = "button";
    apply.className = "opt-btn opt-btn-accent";
    apply.textContent = "Apply Merge";
    apply.disabled = !plan.mergeable;
    apply.addEventListener("click", async () => {
      apply.disabled = true;
      try {
        await request("/api/dedupe/apply", { method: "POST", body: JSON.stringify({ groupId: plan.groupId, type: plan.type, primaryId: plan.primaryId, planHash: plan.planHash }) });
        await refreshDedupeCandidates({ statusMessage: "Duplicate group merged." });
      } catch (error) {
        setDedupeStatus(`Merge failed: ${error.message}`);
        apply.disabled = false;
      }
    });
    detail.appendChild(apply);
  } catch (error) {
    detail.textContent = `Preview failed: ${error.message}`;
  }
}

function renderDedupeCandidate(group) {
  const card = document.createElement("div");
  card.className = "opt-dedupe-card";
  card.setAttribute("data-aaw-test", "dedupe-candidate");

  const head = document.createElement("div");
  head.className = "opt-dedupe-card-head";
  const title = document.createElement("div");
  title.className = "opt-dedupe-title";
  title.textContent = `${dedupeLabel(group.type)} duplicates`;
  const meta = document.createElement("div");
  meta.className = "opt-dedupe-meta";
  meta.textContent = [group.reason, `${(group.itemIds || []).length} records`, group.ignored ? "ignored" : ""].filter(Boolean).join(" • ");
  head.appendChild(title);
  head.appendChild(meta);
  card.appendChild(head);

  for (const record of (group.preview || []).slice(0, 4)) {
    card.appendChild(renderDedupePreviewRecord(record));
  }

  const actions = document.createElement("div");
  actions.className = "opt-actions";
  const previewBtn = document.createElement("button");
  previewBtn.type = "button";
  previewBtn.className = "opt-btn";
  previewBtn.textContent = group.mergeable ? "Preview Merge" : "Review";
  previewBtn.addEventListener("click", () => previewDedupeGroup(group, card));
  actions.appendChild(previewBtn);

  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "opt-btn";
  toggleBtn.textContent = group.ignored ? "Unignore" : "Ignore";
  toggleBtn.addEventListener("click", async () => {
    try {
      const path = group.ignored ? "/api/dedupe/unignore" : "/api/dedupe/ignore";
      await request(path, { method: "POST", body: JSON.stringify({ groupId: group.groupId, type: group.type }) });
      await refreshDedupeCandidates({ statusMessage: group.ignored ? "Duplicate group restored." : "Duplicate group ignored." });
    } catch (error) {
      setDedupeStatus(`${group.ignored ? "Unignore" : "Ignore"} failed: ${error.message}`);
    }
  });
  actions.appendChild(toggleBtn);
  card.appendChild(actions);

  const detail = document.createElement("div");
  detail.className = "opt-dedupe-detail";
  card.appendChild(detail);
  return card;
}

async function refreshDedupeCandidates(opts = {}) {
  const list = document.getElementById("dedupe-candidates");
  if (!list) return;
  const typeEl = document.getElementById("dedupe-type");
  const ignoredEl = document.getElementById("dedupe-show-ignored");
  const statusMessage = opts && typeof opts.statusMessage === "string" ? opts.statusMessage : "";
  list.textContent = "Scanning duplicates…";
  setDedupeStatus("Scanning saved data.");
  try {
    const params = new URLSearchParams({
      type: typeEl ? typeEl.value : "all",
      includeIgnored: ignoredEl && ignoredEl.checked ? "true" : "false"
    });
    const data = await request(`/api/dedupe/candidates?${params.toString()}`, { method: "GET" });
    const candidates = Array.isArray(data && data.candidates) ? data.candidates : [];
    list.textContent = "";
    if (!candidates.length) {
      list.textContent = ignoredEl && ignoredEl.checked ? "No duplicate groups found." : "No active duplicate groups found.";
    } else {
      for (const group of candidates) list.appendChild(renderDedupeCandidate(group));
    }
    const ignoredCount = Array.isArray(data && data.ignored) ? data.ignored.length : 0;
    setDedupeStatus(statusMessage || `${candidates.length} group${candidates.length === 1 ? "" : "s"} shown. ${ignoredCount} ignored.`);
    await renderDedupeAudit();
  } catch (error) {
    list.textContent = "Duplicate scan failed.";
    setDedupeStatus(`Duplicate scan failed: ${error.message}`);
  }
}

async function renderDedupeAudit() {
  const list = document.getElementById("dedupe-audit");
  if (!list) return;
  list.textContent = "Loading audit…";
  try {
    const data = await request("/api/dedupe/audit?limit=10&offset=0", { method: "GET" });
    const items = Array.isArray(data && data.items) ? data.items : [];
    list.textContent = "";
    if (!items.length) {
      list.textContent = "No merge audit records yet.";
      return;
    }
    for (const item of items) {
      const row = document.createElement("div");
      row.className = "opt-dedupe-record";
      const time = item.createdAt ? new Date(item.createdAt).toLocaleString() : "";
      const text = document.createElement("div");
      text.className = "opt-dedupe-record-summary";
      text.textContent = [
        `${dedupeLabel(item.type)} merge`,
        `${(item.duplicateIds || []).length} duplicate${(item.duplicateIds || []).length === 1 ? "" : "s"}`,
        time,
        item.undoneAt ? "undone" : ""
      ].filter(Boolean).join(" • ");
      row.appendChild(text);
      if (item.undoable) {
        const undo = document.createElement("button");
        undo.type = "button";
        undo.className = "opt-btn";
        undo.textContent = "Undo";
        undo.addEventListener("click", async () => {
          undo.disabled = true;
          try {
            await request("/api/dedupe/undo", { method: "POST", body: JSON.stringify({ auditId: item.id }) });
            await refreshDedupeCandidates({ statusMessage: "Merge undone." });
          } catch (error) {
            setDedupeStatus(`Undo failed: ${error.message}`);
            undo.disabled = false;
          }
        });
        row.appendChild(undo);
      }
      list.appendChild(row);
    }
  } catch (error) {
    list.textContent = "Audit unavailable.";
    setDedupeStatus(`Audit failed: ${error.message}`);
  }
}

function initDedupeSection() {
  const typeEl = document.getElementById("dedupe-type");
  const ignoredEl = document.getElementById("dedupe-show-ignored");
  const scanEl = document.getElementById("dedupe-scan");
  if (typeEl) typeEl.addEventListener("change", () => refreshDedupeCandidates());
  if (ignoredEl) ignoredEl.addEventListener("change", () => refreshDedupeCandidates());
  if (scanEl) scanEl.addEventListener("click", () => refreshDedupeCandidates());
  renderDedupeAudit().catch(() => {});
}

// ---------------------------------------------------------------------------
// Backup section
// ---------------------------------------------------------------------------

function setBackupStatus(message) {
  const el = document.getElementById("backup-status");
  if (el) el.textContent = message || "";
}

function backupOptionsQuery() {
  const checked = (id) => Boolean(document.getElementById(id) && document.getElementById(id).checked);
  const params = new URLSearchParams({
    includeEmbeddings: checked("backup-include-embeddings") ? "true" : "false",
    includeSettings: checked("backup-include-settings") ? "true" : "false",
    includeAudit: checked("backup-include-audit") ? "true" : "false",
    includeSensitive: "false"
  });
  return params.toString();
}

function parseBackupText() {
  const editor = document.getElementById("backup-json");
  if (!editor) throw new Error("Backup editor unavailable.");
  const text = editor.value.trim();
  if (!text) throw new Error("Paste or export backup JSON first.");
  return JSON.parse(text);
}

function initBackupSection() {
  const exportEl = document.getElementById("backup-export");
  const validateEl = document.getElementById("backup-validate");
  const restoreEl = document.getElementById("backup-restore-point");
  const mergeEl = document.getElementById("backup-import-merge");
  const replaceEl = document.getElementById("backup-import-replace");

  if (exportEl) exportEl.addEventListener("click", async () => {
    try {
      setBackupStatus("Exporting backup…");
      const backup = await request(`/api/backup/export?${backupOptionsQuery()}`, { method: "GET" });
      const editor = document.getElementById("backup-json");
      if (editor) editor.value = JSON.stringify(backup, null, 2);
      backupRestorePointId = "";
      const memCount = backup && backup.sections && backup.sections.memory ? (backup.sections.memory.items || []).length : 0;
      setBackupStatus(`Exported ${memCount} notes.`);
    } catch (error) {
      setBackupStatus(`Export failed: ${error.message}`);
    }
  });

  if (validateEl) validateEl.addEventListener("click", async () => {
    try {
      const backup = parseBackupText();
      const result = await request("/api/backup/validate", { method: "POST", body: JSON.stringify({ backup }) });
      const summary = (result && result.summary) || {};
      setBackupStatus(`Valid backup: ${summary.memory || 0} notes, ${summary.contacts || 0} contacts, ${summary.tasks || 0} tasks.`);
    } catch (error) {
      setBackupStatus(`Validation failed: ${error.message}`);
    }
  });

  if (restoreEl) restoreEl.addEventListener("click", async () => {
    try {
      const result = await request("/api/backup/restore-point", { method: "POST", body: "{}" });
      backupRestorePointId = (result && result.restorePointId) || "";
      setBackupStatus(`Restore point ready: ${backupRestorePointId}`);
    } catch (error) {
      setBackupStatus(`Restore point failed: ${error.message}`);
    }
  });

  async function importBackup(mode) {
    try {
      const backup = parseBackupText();
      let confirmationToken = "";
      let restorePointId = backupRestorePointId;
      if (mode === "replace") {
        confirmationToken = window.prompt("Type REPLACE to replace all assistant data with this backup.") || "";
        if (confirmationToken !== "REPLACE") {
          setBackupStatus("Replace import cancelled.");
          return;
        }
        if (!restorePointId) {
          const result = await request("/api/backup/restore-point", { method: "POST", body: "{}" });
          restorePointId = (result && result.restorePointId) || "";
          backupRestorePointId = restorePointId;
        }
      }
      const includeSettings = Boolean(document.getElementById("backup-include-settings") && document.getElementById("backup-include-settings").checked);
      const includeEmbeddings = Boolean(document.getElementById("backup-include-embeddings") && document.getElementById("backup-include-embeddings").checked);
      await request("/api/backup/import", {
        method: "POST",
        body: JSON.stringify({ backup, mode, includeSettings, includeEmbeddings, restorePointId, confirmationToken })
      });
      setBackupStatus(`${mode === "replace" ? "Replace" : "Merge"} import complete.`);
    } catch (error) {
      setBackupStatus(`Import failed: ${error.message}`);
    }
  }

  if (mergeEl) mergeEl.addEventListener("click", () => importBackup("merge"));
  if (replaceEl) replaceEl.addEventListener("click", () => importBackup("replace"));
}

// ---------------------------------------------------------------------------
// Appearance section — Dark / Light / System theme.
// ---------------------------------------------------------------------------

let appearanceState = settingsTools.defaultAppearanceSettings
  ? settingsTools.defaultAppearanceSettings()
  : { mode: "dark" };

function applyAppearanceTheme() {
  const theme = settingsTools.resolveAppearanceTheme
    ? settingsTools.resolveAppearanceTheme(appearanceState)
    : (appearanceState.mode === "light" ? "light" : "dark");
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.setAttribute("data-aaw-theme", theme);
  }
}

function renderAppearanceUi() {
  const radios = document.querySelectorAll('input[name="appearance-mode"]');
  radios.forEach((radio) => { radio.checked = radio.value === appearanceState.mode; });
}

async function initAppearanceSection() {
  if (settingsTools.loadAppearanceSettings) {
    appearanceState = await settingsTools.loadAppearanceSettings();
  }
  renderAppearanceUi();
  applyAppearanceTheme();

  const radios = document.querySelectorAll('input[name="appearance-mode"]');
  radios.forEach((radio) => radio.addEventListener("change", async () => {
    if (!radio.checked) return;
    appearanceState = { mode: radio.value };
    applyAppearanceTheme();
    try {
      if (settingsTools.saveAppearanceSettings) await settingsTools.saveAppearanceSettings(appearanceState);
      else await storageSet({ appearanceSettings: appearanceState });
    } catch { /* storage write failure is non-fatal for the live preview */ }
  }));

  // Re-resolve when the OS scheme flips and the user is on System.
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onSchemeChange = () => { if (appearanceState.mode === "system") applyAppearanceTheme(); };
    if (media.addEventListener) media.addEventListener("change", onSchemeChange);
    else if (media.addListener) media.addListener(onSchemeChange);
  }
}

// ---------------------------------------------------------------------------
// Shortcuts section — live chrome.commands + shared panel metadata (read-only).
// ---------------------------------------------------------------------------

function renderShortcutRow(container, keys, description) {
  const row = document.createElement("div");
  row.className = "opt-shortcut-row";
  const keyWrap = document.createElement("span");
  keyWrap.className = "opt-shortcut-keys";
  const list = (Array.isArray(keys) ? keys : [keys]).filter(Boolean);
  list.forEach((value, index) => {
    if (index > 0) {
      const sep = document.createElement("span");
      sep.className = "opt-shortcut-sep";
      sep.textContent = "/";
      keyWrap.appendChild(sep);
    }
    const kbd = document.createElement("kbd");
    kbd.textContent = value;
    keyWrap.appendChild(kbd);
  });
  const desc = document.createElement("span");
  desc.textContent = description || "";
  row.appendChild(keyWrap);
  row.appendChild(desc);
  container.appendChild(row);
}

function openChromeShortcuts() {
  const url = "chrome://extensions/shortcuts";
  const fallback = () =>
    setStatusEl("shortcut-status", `Could not open the page automatically. Visit ${url} in your browser to edit shortcuts.`);
  try {
    if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url }, () => {
        if (chrome.runtime && chrome.runtime.lastError) fallback();
      });
      return;
    }
  } catch { /* fall through to the manual instruction below */ }
  fallback();
}

async function initShortcutsSection() {
  const commandsEl = document.getElementById("shortcut-commands");
  if (commandsEl) {
    let commands = [];
    try {
      if (typeof chrome !== "undefined" && chrome.commands && chrome.commands.getAll) {
        commands = await new Promise((resolve) => chrome.commands.getAll((result) => resolve(result || [])));
      }
    } catch { commands = []; }
    commandsEl.textContent = "";
    if (!commands.length) {
      commandsEl.textContent = "No browser commands registered.";
    } else {
      for (const command of commands) {
        renderShortcutRow(commandsEl, command.shortcut || "Unassigned", command.description || command.name || "Command");
      }
    }
  }

  const panelEl = document.getElementById("shortcut-panel");
  if (panelEl) {
    panelEl.textContent = "";
    const shortcuts = (typeof window !== "undefined" && window.AssistantShortcuts && window.AssistantShortcuts.PANEL_SHORTCUTS) || [];
    for (const item of shortcuts) renderShortcutRow(panelEl, item.keys, item.description);
  }

  const openBtn = document.getElementById("shortcut-open-chrome");
  if (openBtn) openBtn.addEventListener("click", openChromeShortcuts);
}

// ---------------------------------------------------------------------------
// Sidebar deep-links + active highlighting
// ---------------------------------------------------------------------------

function initSidebarNav() {
  const links = Array.from(document.querySelectorAll(".opt-nav-link"));
  const ids = links.map((link) => link.dataset.section).filter(Boolean);

  function setActive(id) {
    for (const link of links) {
      const isActive = link.dataset.section === id;
      if (isActive) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    }
  }

  function applyHash() {
    const id = (location.hash || "").replace(/^#/, "") || ids[0];
    setActive(ids.includes(id) ? id : ids[0]);
    const target = id ? document.getElementById(id) : null;
    if (target && typeof target.scrollIntoView === "function") target.scrollIntoView({ block: "start", behavior: "auto" });
  }

  window.addEventListener("hashchange", applyHash);
  applyHash();
}

// ---------------------------------------------------------------------------
// Initial settings load — runs from init() before section wiring.
// ---------------------------------------------------------------------------

async function loadSettingsState() {
  settingsState = await loadAllSettings();
  updateModeBadge();
}

// -----------------------------------------------------------------------------
// Boot
// -----------------------------------------------------------------------------

async function init() {
  elFolderName     = document.getElementById("folder-name");
  elFolderPerm     = document.getElementById("folder-perm");
  elBtnPick        = document.getElementById("btn-pick");
  elBtnSync        = document.getElementById("btn-sync");
  elBtnDisconnect  = document.getElementById("btn-disconnect");
  elBtnGrant       = document.getElementById("btn-grant");
  elStatus         = document.getElementById("status");
  elLog            = document.getElementById("log");
  elDeleteOrphans  = document.getElementById("opt-delete-orphans");
  elIncludeContacts = document.getElementById("opt-include-contacts");
  elIncludeTasks    = document.getElementById("opt-include-tasks");
  elPreviewRun      = document.getElementById("mirror-preview-run");
  elPreviewSearch   = document.getElementById("mirror-preview-search");
  elPreviewCounts   = document.getElementById("mirror-preview-counts");
  elPreviewFiles    = document.getElementById("mirror-preview-files");
  elPreviewDetail   = document.getElementById("mirror-preview-detail");
  elPreviewJson     = document.getElementById("mirror-preview-json");
  elPreviewDeletions = document.getElementById("mirror-preview-deletions");

  elBtnPick.addEventListener("click", pickFolder);
  elBtnSync.addEventListener("click", () => syncAll());
  elBtnDisconnect.addEventListener("click", disconnectFolder);
  elBtnGrant.addEventListener("click", grantAccess);
  if (elIncludeContacts) elIncludeContacts.addEventListener("change", () => persistMirrorConfigFromUi().catch((err) => log(`settings save failed: ${err.message}`, true)));
  if (elIncludeTasks) elIncludeTasks.addEventListener("change", () => persistMirrorConfigFromUi().catch((err) => log(`settings save failed: ${err.message}`, true)));
  if (elPreviewRun) elPreviewRun.addEventListener("click", () => runMirrorPreview().catch((err) => log(`preview failed: ${err.message}`, true)));
  if (elPreviewSearch) elPreviewSearch.addEventListener("input", () => {
    if (previewModelCache) renderPreviewFiles(previewModelCache.groups, elPreviewSearch.value);
  });

  // Settings hub sections — load shared settings first, then wire each section.
  await loadSettingsState();
  await initAppearanceSection();
  initAiSection();
  initBackendSection();
  initPrivacySection();
  initDedupeSection();
  initBackupSection();
  await initShortcutsSection();

  // Replace the native settings <select>s with custom dropdowns once their
  // sections have populated options and applied current values.
  ["ai-provider", "ai-model", "privacy-mode", "dedupe-type"].forEach((id) => enhanceSelect(document.getElementById(id)));

  initSidebarNav();

  // React to settings changed elsewhere (other tabs, the panel) without reload.
  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes.appearanceSettings) return;
      appearanceState = settingsTools.normalizeAppearanceSettings
        ? settingsTools.normalizeAppearanceSettings(changes.appearanceSettings.newValue)
        : (changes.appearanceSettings.newValue || { mode: "dark" });
      renderAppearanceUi();
      applyAppearanceTheme();
    });
  }

  renderMirrorConfig(await loadMirrorConfig());

  // Restore saved handle, if any. Only QUERY the permission here — do not
  // request, since this code path has no user activation. The user clicks
  // "Grant access" if needed, which calls requestPermission with a real gesture.
  const stored = await idbGet(DB_KEY_HANDLE).catch(() => null);
  if (stored) {
    dirHandle = stored;
    permissionState = await queryPermission(dirHandle);
    if (permissionState === "granted") {
      log(`restored folder: ${dirHandle.name}`);
      renderFolderState();
      await syncAll();
    } else {
      renderFolderState();
      setStatus(
        permissionState === "denied"
          ? "Folder access was denied. Reconnect with Choose folder."
          : `Folder "${dirHandle.name}" restored — click "Grant access" to enable sync.`,
        permissionState === "denied" ? "error" : undefined
      );
      await saveMirrorStatus({
        state: permissionState === "denied" ? "permission_denied" : "permission_prompt",
        lastError: permissionState === "denied" ? "Folder access was denied." : ""
      }).catch(() => {});
    }
  } else {
    renderFolderState();
    await saveMirrorStatus({ state: "not_configured", lastError: "" }).catch(() => {});
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    __test: {
      fileNameForId,
      get state() {
        return { dirHandle, permissionState };
      },
      setDirectoryHandle(handle, state = "granted") {
        dirHandle = handle;
        permissionState = state;
      },
      setDeleteOrphansChecked(value) {
        elDeleteOrphans = { checked: Boolean(value) };
      },
      syncAll,
      // Read-only export preview helpers (no DOM required).
      buildMirrorPreview,
      buildDeletionPreview,
      previewFileSummary,
      previewGroupKey,
      loadMirrorDataset
    },
    __settings: {
      loadAllSettings,
      privacyDefaults,
      privacyNormalize,
      privacyMerge,
      backupOptionsQuery,
      getSettingsState: () => settingsState,
      setSettingsState: (next) => { settingsState = next; },
      getLiveApiKeys: () => ({ ...liveApiKeys }),
      setLiveApiKeys: (next) => { liveApiKeys = { ...liveApiKeys, ...next }; }
    }
  };
}

if (typeof document !== "undefined" && document.addEventListener) {
  document.addEventListener("DOMContentLoaded", init);
}
