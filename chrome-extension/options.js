"use strict";

// =============================================================================
// Notes folder mirror — File System Access API + IndexedDB-persisted handle.
//
// chrome.storage.local stays the source of truth. This page mirrors each saved
// memory entry to a user-chosen folder as `mem_<id>.json`. Two sync triggers:
//   1. On page load, syncAll() writes anything missing from the folder.
//   2. While the page is open, a MEMORY_SAVED runtime broadcast triggers a
//      single-entry write within ~1s of the original save.
// =============================================================================

const DB_NAME = "aaw-options";
const DB_STORE = "kv";
const DB_KEY_HANDLE = "dirHandle";

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
let elStatus, elLog, elDeleteOrphans;

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
  // Memory IDs are already `mem_<uuid>` — defensive prefix in case that changes.
  const safe = String(id).replace(/[^A-Za-z0-9_-]/g, "_");
  return safe.endsWith(".json") ? safe : `${safe}.json`;
}

// -----------------------------------------------------------------------------
// chrome.storage helpers
// -----------------------------------------------------------------------------

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(updates) {
  return new Promise((resolve) => chrome.storage.local.set(updates, resolve));
}

async function loadMemoryEntries() {
  const { memory } = await storageGet(["memory"]);
  return Array.isArray(memory) ? memory : [];
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

async function listExistingFileNames() {
  if (!dirHandle) return new Set();
  const names = new Set();
  for await (const [name, child] of dirHandle.entries()) {
    if (child.kind !== "file") continue;
    if (!name.startsWith("mem_") || !name.endsWith(".json")) continue;
    names.add(name);
  }
  return names;
}

// Mirror chrome.storage.local memory into the chosen folder.
// Skip files that already match by id; write missing ones; optionally delete orphans.
async function syncAll() {
  if (!dirHandle) {
    setStatus("Pick a folder first.");
    return;
  }
  if (permissionState !== "granted") {
    setStatus("Folder permission not granted.", "error");
    return;
  }

  setStatus("Syncing…");

  return enqueue(async () => {
    const entries = await loadMemoryEntries();
    const wantedByName = new Map(entries.map((e) => [fileNameForId(e.id), e]));
    const existing = await listExistingFileNames();

    let written = 0;
    let skipped = 0;
    let deleted = 0;
    let failed = 0;

    for (const [name, entry] of wantedByName) {
      if (existing.has(name)) {
        skipped++;
        continue;
      }
      try {
        await writeEntry(entry);
        written++;
      } catch (err) {
        failed++;
        log(`write failed for ${name}: ${err.message}`, true);
      }
    }

    if (elDeleteOrphans && elDeleteOrphans.checked) {
      for (const name of existing) {
        if (wantedByName.has(name)) continue;
        try {
          await dirHandle.removeEntry(name);
          deleted++;
        } catch (err) {
          failed++;
          log(`delete failed for ${name}: ${err.message}`, true);
        }
      }
    }

    const summary = `sync done — wrote ${written}, skipped ${skipped}, deleted ${deleted}, failed ${failed}`;
    log(summary);
    setStatus(summary, failed ? "error" : "success");
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

async function grantAccess() {
  if (!dirHandle) {
    setStatus("Pick a folder first.");
    return;
  }
  const state = await requestPermission(dirHandle);
  permissionState = state;
  if (state === "granted") {
    setStatus("Access granted.", "success");
    renderFolderState();
    await syncAll();
  } else {
    setStatus(`Access ${state}. Click Choose folder to reconnect.`, "error");
    renderFolderState();
  }
}

// -----------------------------------------------------------------------------
// Live save listener
// -----------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== "MEMORY_SAVED" || !message.item) return;
  if (!dirHandle || permissionState !== "granted") return;

  enqueue(async () => {
    try {
      await writeEntry(message.item);
      log(`live save: ${fileNameForId(message.item.id)}`);
    } catch (err) {
      log(`live save failed: ${err.message}`, true);
    }
  });
});

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

  elBtnPick.addEventListener("click", pickFolder);
  elBtnSync.addEventListener("click", () => syncAll());
  elBtnDisconnect.addEventListener("click", disconnectFolder);
  elBtnGrant.addEventListener("click", grantAccess);

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
    }
  } else {
    renderFolderState();
  }
}

document.addEventListener("DOMContentLoaded", init);
