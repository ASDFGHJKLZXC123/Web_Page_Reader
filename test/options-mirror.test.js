"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const mirror = require("../chrome-extension/mirror-utils.js");

class MockFileHandle {
  constructor(name, content = "") {
    this.kind = "file";
    this.name = name;
    this.content = content;
  }

  async createWritable() {
    return {
      write: async (value) => {
        this.content = String(value);
      },
      close: async () => {}
    };
  }

  async getFile() {
    return {
      text: async () => this.content
    };
  }
}

class MockDirectoryHandle {
  constructor(name) {
    this.kind = "directory";
    this.name = name;
    this.children = new Map();
  }

  notFound(name) {
    const error = new Error(`${name} not found`);
    error.name = "NotFoundError";
    return error;
  }

  async getFileHandle(name, options = {}) {
    const current = this.children.get(name);
    if (current && current.kind === "file") return current;
    if (current) throw new Error(`${name} is not a file`);
    if (!options.create) throw this.notFound(name);
    const next = new MockFileHandle(name);
    this.children.set(name, next);
    return next;
  }

  async getDirectoryHandle(name, options = {}) {
    const current = this.children.get(name);
    if (current && current.kind === "directory") return current;
    if (current) throw new Error(`${name} is not a directory`);
    if (!options.create) throw this.notFound(name);
    const next = new MockDirectoryHandle(name);
    this.children.set(name, next);
    return next;
  }

  async removeEntry(name) {
    if (!this.children.has(name)) throw this.notFound(name);
    this.children.delete(name);
  }

  async *entries() {
    for (const entry of this.children.entries()) yield entry;
  }
}

async function readJson(root, path) {
  const parts = path.split("/");
  const fileName = parts.pop();
  let current = root;
  for (const part of parts) current = await current.getDirectoryHandle(part);
  const file = await current.getFileHandle(fileName);
  return JSON.parse(await (await file.getFile()).text());
}

async function exists(root, path) {
  try {
    await readJson(root, path);
    return true;
  } catch {
    return false;
  }
}

function installOptionsChromeMock(seed = {}) {
  const state = {
    memory: [],
    noteWorkspaces: [],
    actions: { tasks: [], tableRows: [], contacts: [], drafts: [] },
    notesMirrorConfig: { includeContacts: false, includeTasks: false },
    ...seed
  };

  global.window = { AssistantMirror: mirror };
  global.chrome = {
    storage: {
      local: {
        get(keys, callback) {
          const out = {};
          for (const key of keys) out[key] = state[key];
          callback(out);
        },
        set(updates, callback) {
          Object.assign(state, updates);
          if (callback) callback();
        }
      }
    },
    runtime: {
      lastError: undefined,
      onMessage: { addListener() {} }
    }
  };

  return state;
}

function loadOptions() {
  const path = require.resolve("../chrome-extension/options.js");
  delete require.cache[path];
  return require(path).__test;
}

test("options mirror sync writes generated file plan to mocked directory handle", async () => {
  const state = installOptionsChromeMock({
    memory: [{ id: "mem_one", title: "One", sourceUrl: "https://example.com/a", workspaceIds: ["nw_research"] }],
    noteWorkspaces: [{ id: "nw_research", name: "Research", status: "open" }],
    actions: {
      tasks: [{ id: "task_one", title: "Follow up" }],
      tableRows: [],
      contacts: [{ id: "contact_one", name: "Ada" }],
      drafts: []
    },
    notesMirrorConfig: { includeContacts: true, includeTasks: true }
  });
  const options = loadOptions();
  const dir = new MockDirectoryHandle("Mirror");

  options.setDirectoryHandle(dir, "granted");
  options.setDeleteOrphansChecked(false);
  await options.syncAll();

  assert.equal((await readJson(dir, "mem_one.json")).title, "One");
  assert.equal((await readJson(dir, "indexes/workspaces.json")).workspaces[0].noteCount, 1);
  assert.equal((await readJson(dir, "workspaces/nw_research/index.json")).notes[0].id, "mem_one");
  assert.equal((await readJson(dir, "contacts/contact_one.json")).contact.name, "Ada");
  assert.equal((await readJson(dir, "tasks/task_one.json")).task.title, "Follow up");
  assert.equal(state.notesMirrorStatus.state, "synced");
  assert.equal(state.notesMirrorStatus.counts.files > 0, true);
});

test("options mirror sync removes only manifest-known generated orphans when enabled", async () => {
  installOptionsChromeMock({
    memory: [{ id: "mem_keep", title: "Keep" }],
    noteWorkspaces: [],
    actions: { tasks: [], tableRows: [], contacts: [], drafts: [] }
  });
  const options = loadOptions();
  const dir = new MockDirectoryHandle("Mirror");
  const manifest = await dir.getFileHandle("aaw_mirror_manifest.json", { create: true });
  manifest.content = JSON.stringify({
    format: mirror.MIRROR_FORMAT,
    schemaVersion: mirror.MIRROR_SCHEMA_VERSION,
    generatedPaths: ["mem_stale.json", "indexes/stale.json", "user_note.json"]
  });
  const staleMemory = await dir.getFileHandle("mem_stale.json", { create: true });
  staleMemory.content = "{}";
  const userNote = await dir.getFileHandle("user_note.json", { create: true });
  userNote.content = "{}";
  const external = await dir.getFileHandle("external.json", { create: true });
  external.content = "{}";
  const indexes = await dir.getDirectoryHandle("indexes", { create: true });
  const staleIndex = await indexes.getFileHandle("stale.json", { create: true });
  staleIndex.content = "{}";

  options.setDirectoryHandle(dir, "granted");
  options.setDeleteOrphansChecked(true);
  await options.syncAll();

  assert.equal(await exists(dir, "mem_keep.json"), true);
  assert.equal(await exists(dir, "mem_stale.json"), false);
  assert.equal(await exists(dir, "indexes/stale.json"), false);
  assert.equal(await exists(dir, "user_note.json"), false);
  assert.equal(await exists(dir, "external.json"), true);
});

test("options mirror sync records permission prompt state without writing files", async () => {
  const state = installOptionsChromeMock({
    memory: [{ id: "mem_one", title: "One" }]
  });
  const options = loadOptions();
  const dir = new MockDirectoryHandle("Mirror");

  options.setDirectoryHandle(dir, "prompt");
  options.setDeleteOrphansChecked(false);
  await options.syncAll();

  assert.equal(await exists(dir, "mem_one.json"), false);
  assert.equal(state.notesMirrorStatus.state, "permission_required");
});

// --- Export preview (read-only) ---------------------------------------------

function previewDataset(overrides = {}) {
  return {
    memory: [{ id: "mem_one", title: "One", sourceUrl: "https://example.com/a", workspaceIds: ["nw_research"] }],
    noteWorkspaces: [{ id: "nw_research", name: "Research", status: "open" }],
    actions: {
      tasks: [{ id: "task_one", title: "Follow up", status: "open" }],
      tableRows: [],
      contacts: [{ id: "contact_one", name: "Ada" }],
      drafts: []
    },
    config: { includeContacts: true, includeTasks: true },
    ...overrides
  };
}

function findGroup(model, key) {
  return model.groups.find((group) => group.key === key);
}

test("export preview reports counts and grouped generated paths", () => {
  installOptionsChromeMock();
  const options = loadOptions();
  const model = options.buildMirrorPreview(previewDataset());

  assert.equal(model.counts.notes, 1);
  assert.equal(model.counts.workspaces, 1);
  assert.equal(model.counts.contacts, 1);
  assert.equal(model.counts.tasks, 1);
  assert.equal(model.counts.sources, 1);
  assert.equal(model.counts.files, model.files.length);

  // Every plan file is grouped under one of the six known roots.
  const groupKeys = model.groups.map((group) => group.key);
  assert.ok(groupKeys.includes("notes"));
  assert.ok(groupKeys.includes("indexes"));
  assert.ok(groupKeys.includes("workspaces"));
  assert.ok(groupKeys.includes("contacts"));
  assert.ok(groupKeys.includes("tasks"));
  assert.ok(groupKeys.includes("manifest"));

  assert.ok(findGroup(model, "notes").files.some((file) => file.path === "mem_one.json"));
  assert.ok(findGroup(model, "indexes").files.some((file) => file.path === "indexes/workspaces.json"));
  assert.ok(findGroup(model, "manifest").files.some((file) => file.path === "aaw_mirror_manifest.json"));

  // Selecting a memory file exposes a readable summary plus its raw JSON.
  const memoryFile = findGroup(model, "notes").files.find((file) => file.path === "mem_one.json");
  assert.match(memoryFile.summary, /One/);
  assert.equal(memoryFile.kind, "memory");
  assert.equal(memoryFile.json.title, "One");
});

test("export preview omits contacts and tasks when include toggles are off", () => {
  installOptionsChromeMock();
  const options = loadOptions();
  const model = options.buildMirrorPreview(previewDataset({ config: { includeContacts: false, includeTasks: false } }));

  assert.equal(model.counts.contacts, 0);
  assert.equal(model.counts.tasks, 0);
  assert.equal(findGroup(model, "contacts"), undefined);
  assert.equal(findGroup(model, "tasks"), undefined);
});

test("deletion preview lists stale generated paths when one-way sync is available", () => {
  installOptionsChromeMock();
  const options = loadOptions();
  const plan = options.buildMirrorPreview(previewDataset()).plan;
  const previousManifest = {
    format: mirror.MIRROR_FORMAT,
    schemaVersion: mirror.MIRROR_SCHEMA_VERSION,
    generatedPaths: ["mem_one.json", "mem_stale.json", "indexes/stale.json"]
  };

  const result = options.buildDeletionPreview({
    hasFolder: true,
    permissionState: "granted",
    deleteOrphans: true,
    previousManifest,
    plan,
    legacyMemoryFiles: ["mem_legacy.json"]
  });

  assert.equal(result.available, true);
  assert.ok(result.paths.includes("mem_stale.json"));
  assert.ok(result.paths.includes("indexes/stale.json"));
  assert.ok(result.paths.includes("mem_legacy.json"));
  assert.ok(!result.paths.includes("mem_one.json"));
});

test("deletion preview is unavailable without folder access or one-way sync", () => {
  installOptionsChromeMock();
  const options = loadOptions();
  const plan = options.buildMirrorPreview(previewDataset()).plan;

  const noFolder = options.buildDeletionPreview({ hasFolder: false, permissionState: "unset", deleteOrphans: true, plan });
  assert.equal(noFolder.available, false);
  assert.match(noFolder.reason, /folder/i);

  const notGranted = options.buildDeletionPreview({ hasFolder: true, permissionState: "prompt", deleteOrphans: true, plan });
  assert.equal(notGranted.available, false);
  assert.match(notGranted.reason, /access/i);

  const noOrphans = options.buildDeletionPreview({ hasFolder: true, permissionState: "granted", deleteOrphans: false, plan });
  assert.equal(noOrphans.available, false);
  assert.match(noOrphans.reason, /one-way sync/i);
});
