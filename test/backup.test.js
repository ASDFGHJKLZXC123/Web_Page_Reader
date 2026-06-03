"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

function loadStorageWithTempDir() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aaw-backup-storage-"));
  process.env.NOTES_DIR = tmp;
  const storagePath = require.resolve("../backend/src/lib/storage");
  delete require.cache[storagePath];
  return { tmp, storage: require(storagePath) };
}

test("backend backup export validates envelope and excludes audit by default", async () => {
  const { storage } = loadStorageWithTempDir();
  await storage.appendMemory({
    id: "mem_backup",
    title: "Backup note",
    sourceUrl: "https://example.com/backup",
    note: "Backup note body",
    embedding: [0.1, 0.2]
  });
  await storage.patchPrivacySettings({ aiMode: "local_only" });
  await storage.ignoreDedupeGroup({ groupId: "memory:test", type: "memory", reason: "test ignored group" });

  const backup = await storage.exportBackup({ includeEmbeddings: true, includeSettings: true });
  assert.equal(backup.format, "aaw.backup.v1");
  assert.equal(backup.sections.memory.items.length, 1);
  assert.equal(backup.sections.embeddings.items.length, 1);
  assert.equal(backup.sections.privacy.settings.aiMode, "local_only");
  assert.equal(backup.sections.dedupe.ignored.length, 1);
  assert.deepEqual(backup.sections.dedupe.audit, []);
  assert.equal(storage.validateBackupEnvelope(backup).valid, true);

  const polluted = JSON.parse("{\"format\":\"aaw.backup.v1\",\"sections\":{\"memory\":{\"items\":[]},\"__proto__\":{\"polluted\":true}}}");
  const invalid = storage.validateBackupEnvelope(polluted);
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.join(" "), /unsafe keys/);

  const wrongVersion = structuredClone(backup);
  wrongVersion.sections.memory.version = 99;
  const versionResult = storage.validateBackupEnvelope(wrongVersion);
  assert.equal(versionResult.valid, false);
  assert.match(versionResult.errors.join(" "), /version must be 1/);
});

test("backend backup merge remaps IDs and preserves links", async () => {
  const source = loadStorageWithTempDir().storage;
  await source.appendNoteWorkspace({ id: "nw_project", name: "Project", status: "open" });
  await source.appendMemory({
    id: "mem_project",
    title: "Project note",
    workspaceIds: ["nw_project"],
    taskIds: ["nw_project"],
    linkedTaskIds: ["task_project"],
    contactId: "contact_project",
    embedding: [0.5]
  });
  await source.appendAction("contacts", {
    id: "contact_project",
    name: "Ada Project",
    email: "ada.project@example.com",
    memoryIds: ["mem_project"]
  });
  await source.appendAction("tasks", {
    id: "task_project",
    title: "Follow project",
    clientRequestId: "task-project-request",
    sourceUrl: "https://example.com/project",
    sourceMemoryIds: ["mem_project"]
  });
  const backup = await source.exportBackup({ includeEmbeddings: true });

  const target = loadStorageWithTempDir().storage;
  await target.appendMemory({ id: "mem_project", title: "Existing note" });
  await target.appendAction("contacts", {
    id: "contact_existing",
    name: "Ada Project",
    email: "ada.project@example.com",
    memoryIds: []
  });
  await target.appendAction("tasks", {
    id: "task_existing",
    title: "Follow project",
    clientRequestId: "task-project-request",
    sourceMemoryIds: []
  });
  const imported = await target.importBackup({ backup, mode: "merge", includeEmbeddings: true });
  assert.equal(imported.imported, true);

  const memory = await target.listMemory();
  assert.equal(memory.length, 2);
  const importedMemory = memory.find((item) => item.title === "Project note");
  assert.ok(importedMemory);
  assert.notEqual(importedMemory.id, "mem_project");
  assert.deepEqual(importedMemory.workspaceIds, ["nw_project"]);
  assert.deepEqual(importedMemory.linkedTaskIds, ["task_existing"]);
  assert.equal(importedMemory.contactId, "contact_existing");
  assert.equal(target.loadAllEmbeddings().has(importedMemory.id), true);
  assert.deepEqual((await target.getContact("contact_existing")).memoryIds, [importedMemory.id]);
  assert.deepEqual((await target.getTask("task_existing")).sourceMemoryIds, [importedMemory.id]);
});

test("backend backup replace requires restore point and confirmation", async () => {
  const { storage } = loadStorageWithTempDir();
  await storage.appendMemory({ id: "mem_before", title: "Before" });
  await storage.patchPrivacySettings({ aiMode: "local_only" });
  await storage.ignoreDedupeGroup({ groupId: "memory:backup", type: "memory" });
  const backup = await storage.exportBackup({ includeEmbeddings: true, includeSettings: true });
  await storage.appendMemory({ id: "mem_after", title: "After" });
  await storage.patchPrivacySettings({ aiMode: "auto" });
  await storage.ignoreDedupeGroup({ groupId: "memory:after", type: "memory" });

  const blocked = await storage.importBackup({ backup, mode: "replace", confirmationToken: "REPLACE" });
  assert.match(blocked.error, /restore point/i);

  const point = await storage.createBackupRestorePoint();
  const wrongToken = await storage.importBackup({ backup, mode: "replace", restorePointId: point.restorePointId, confirmationToken: "NOPE" });
  assert.match(wrongToken.error, /REPLACE/);

  const replaced = await storage.importBackup({ backup, mode: "replace", restorePointId: point.restorePointId, confirmationToken: "REPLACE" });
  assert.equal(replaced.imported, true);
  assert.deepEqual((await storage.listMemory()).map((item) => item.id), ["mem_before"]);
  assert.equal((await storage.getPrivacySettings()).aiMode, "local_only");
  const ignored = (await storage.listDedupeCandidates()).ignored;
  assert.equal(ignored.length, 1);
  assert.equal(ignored[0].groupId, "memory:backup");
  assert.equal(ignored[0].type, "memory");
  assert.equal(typeof ignored[0].ignoredAt, "string");
});
