"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

function loadStorageWithTempDir() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aaw-workspace-storage-"));
  process.env.NOTES_DIR = tmp;
  const storagePath = require.resolve("../backend/src/lib/storage");
  delete require.cache[storagePath];
  return { tmp, storage: require(storagePath) };
}

test("backend storage seeds default workspaces and normalizes memory membership", async () => {
  const { storage } = loadStorageWithTempDir();

  const workspaces = await storage.listNoteWorkspaces("all");
  assert.deepEqual(
    workspaces.slice(0, 4).map((workspace) => workspace.name),
    ["Job Search", "Startup Ideas", "Research", "Client Leads"]
  );

  const workspaceId = workspaces[0].id;
  const canonical = await storage.appendMemory({
    id: "mem_canonical",
    createdAt: "2026-01-01T00:00:00.000Z",
    title: "Canonical",
    workspaceIds: [workspaceId]
  });
  assert.deepEqual(canonical.workspaceIds, [workspaceId]);
  assert.deepEqual(canonical.taskIds, [workspaceId]);

  const legacy = await storage.appendMemory({
    id: "mem_legacy",
    createdAt: "2026-01-01T00:00:00.000Z",
    title: "Legacy",
    taskIds: [workspaceId]
  });
  assert.deepEqual(legacy.workspaceIds, [workspaceId]);
  assert.deepEqual(legacy.taskIds, [workspaceId]);

  const unassigned = await storage.appendMemory({
    id: "mem_unassigned",
    createdAt: "2026-01-01T00:00:00.000Z",
    title: "Unassigned"
  });
  assert.deepEqual(unassigned.workspaceIds, []);
  assert.deepEqual(unassigned.taskIds, []);

  const allMemory = await storage.listMemory();
  assert.equal(allMemory.filter((item) => item.workspaceIds.length === 0).length, 1);

  const updated = await storage.updateMemory("mem_unassigned", {
    note: "Reviewed",
    tags: [" lead ", "lead", "urgent"]
  });
  assert.equal(updated.note, "Reviewed");
  assert.deepEqual(updated.tags, ["lead", "urgent"]);
  assert.ok(updated.updatedAt);
});

test("backend storage updateMemory moves a note between workspaces and back to Inbox", async () => {
  const { storage } = loadStorageWithTempDir();

  const workspaces = await storage.listNoteWorkspaces("all");
  const workspaceA = workspaces[0].id;
  const workspaceB = workspaces[1].id;

  await storage.appendMemory({
    id: "mem_move",
    createdAt: "2026-01-01T00:00:00.000Z",
    title: "Movable",
    workspaceIds: [workspaceA]
  });

  const moved = await storage.updateMemory("mem_move", { workspaceIds: [workspaceB], taskIds: [workspaceB] });
  assert.equal(moved.workspaceId, workspaceB);
  assert.deepEqual(moved.workspaceIds, [workspaceB]);
  assert.deepEqual(moved.taskIds, [workspaceB]);

  const inbox = await storage.updateMemory("mem_move", { workspaceIds: [], taskIds: [] });
  assert.equal(inbox.workspaceId, "");
  assert.deepEqual(inbox.workspaceIds, []);
  assert.deepEqual(inbox.taskIds, []);
});

test("backend workspace update rejects duplicate names through server helper path", async () => {
  const { storage } = loadStorageWithTempDir();
  const { patchNoteWorkspace } = require("../backend/src/server");

  const workspaces = await storage.listNoteWorkspaces("all");
  const first = workspaces[0];
  const second = workspaces[1];

  const result = await patchNoteWorkspace(second.id, { name: first.name.toUpperCase() });
  assert.equal(result.error, "Workspace already exists");
});

test("backend storage deletes embeddings with memory entries", async () => {
  const { storage } = loadStorageWithTempDir();

  await storage.appendMemory({
    id: "mem_embedded",
    createdAt: "2026-01-01T00:00:00.000Z",
    title: "Embedded note",
    embedding: [0.25, 0.75]
  });

  assert.deepEqual(storage.loadAllEmbeddings().get("mem_embedded").embedding, [0.25, 0.75]);
  assert.equal(storage.loadAllEmbeddings().get("mem_embedded").meta.dimensions, 2);
  assert.equal(await storage.deleteMemory("mem_embedded"), "mem_embedded");
  assert.equal(storage.loadAllEmbeddings().has("mem_embedded"), false);
});

test("backend contact storage creates, merges, searches, updates, and deletes contacts", async () => {
  const { storage } = loadStorageWithTempDir();

  const first = await storage.createContact({
    name: "Ada Lovelace",
    email: "Ada@Example.com",
    phone: "(555) 111-2222",
    company: "Acme",
    memoryIds: ["mem_1"]
  });
  const merged = await storage.createContact({
    name: "Ada Lovelace",
    email: "ada@example.com",
    phones: ["555.333.4444"],
    roleTitle: "Founder",
    memoryIds: ["mem_2"]
  });

  assert.equal(first.id, merged.id);
  assert.equal(merged.email, "ada@example.com");
  assert.equal(merged.phone, "5551112222");
  assert.deepEqual(merged.phones, ["5551112222", "5553334444"]);
  assert.equal(merged.roleTitle, "Founder");
  assert.deepEqual(merged.memoryIds, ["mem_1", "mem_2"]);

  const listed = await storage.listContacts({ q: "founder" });
  assert.equal(listed.total, 1);
  assert.equal(listed.contacts[0].id, first.id);

  const updated = await storage.updateContact(first.id, { leadStatus: "qualified", notes: "Follow up" });
  assert.equal(updated.leadStatus, "qualified");
  assert.equal(updated.notes, "Follow up");

  const filtered = await storage.listContacts({ status: "qualified" });
  assert.equal(filtered.total, 1);
  const alternateSearch = await storage.listContacts({ q: "5553334444" });
  assert.equal(alternateSearch.total, 1);
  assert.equal((await storage.getContact(first.id)).leadStatus, "qualified");
  assert.equal((await storage.deleteContact(first.id)).id, first.id);
  assert.equal(await storage.getContact(first.id), null);
});

test("backend contact and task lists support advanced filters, batches, and delete cleanup", async () => {
  const { storage } = loadStorageWithTempDir();
  const workspace = (await storage.listNoteWorkspaces("all"))[0];

  const memory = await storage.appendMemory({
    id: "mem_acme_profile",
    createdAt: "2026-01-01T00:00:00.000Z",
    title: "Acme profile",
    sourceUrl: "https://acme.example/profile?utm_source=newsletter&keep=1",
    note: "Ada partnership lead",
    workspaceIds: [workspace.id],
    contactId: "contact_acme"
  });

  const contact = await storage.createContact({
    id: "contact_acme",
    name: "Ada Rivera",
    company: "Acme",
    email: "ada@acme.example",
    sourceUrl: "https://acme.example/profile?utm_source=newsletter&keep=1",
    memoryIds: [memory.id]
  });
  await storage.createContact({
    id: "contact_beta",
    name: "Ben Beta",
    company: "Beta",
    sourceUrl: "https://beta.example/contact",
    leadStatus: "contacted"
  });

  const filteredContacts = await storage.listContacts({
    workspaceId: workspace.id,
    sourceHost: "acme.example",
    sourceUrlKey: "https://acme.example/profile?utm_source=x&keep=1",
    limit: 1
  });
  assert.equal(filteredContacts.total, 1);
  assert.equal(filteredContacts.contacts[0].id, contact.id);
  assert.equal(filteredContacts.listMeta.count, 1);
  assert.equal(filteredContacts.facets.statuses.new, 1);
  assert.equal(filteredContacts.facets.workspaces[0].id, workspace.id);

  const contactBatch = await storage.batchContacts({
    ids: [contact.id, "missing_contact"],
    action: "update",
    patch: { leadStatus: "qualified" }
  });
  assert.equal(contactBatch.succeeded, 1);
  assert.equal(contactBatch.failed, 1);
  assert.equal((await storage.getContact(contact.id)).leadStatus, "qualified");
  const singleStatusContactFilter = await storage.listContacts({ status: "qualified", statuses: [] });
  assert.deepEqual(singleStatusContactFilter.contacts.map((item) => item.id), [contact.id]);

  const task = (await storage.createTaskWithLinks({
    id: "task_acme",
    title: "Follow up with Ada",
    notes: "Send Acme notes",
    dueDate: "2026-05-28",
    priority: "high",
    sourceMemoryIds: [memory.id]
  })).task;

  const filteredTasks = await storage.listTasks({
    status: "open",
    priority: "high",
    workspaceId: workspace.id,
    sourceHost: "acme.example",
    dueFrom: "2026-05-01",
    dueTo: "2026-05-31",
    q: "Acme"
  });
  assert.equal(filteredTasks.total, 1);
  assert.equal(filteredTasks.tasks[0].id, task.id);
  assert.equal(filteredTasks.facets.priorities.high, 1);
  assert.equal(filteredTasks.facets.workspaces[0].id, workspace.id);

  const taskBatch = await storage.batchTasks({
    ids: [task.id, "missing_task"],
    action: "update",
    patch: { status: "done", priority: "medium" }
  });
  assert.equal(taskBatch.succeeded, 1);
  assert.equal(taskBatch.failed, 1);
  assert.equal((await storage.getTask(task.id)).status, "done");
  const singleValueTaskFilter = await storage.listTasks({
    status: "done",
    statuses: [],
    priority: "medium",
    priorities: []
  });
  assert.deepEqual(singleValueTaskFilter.tasks.map((item) => item.id), [task.id]);

  const deletedTask = await storage.deleteTask(task.id);
  assert.equal(deletedTask.id, task.id);
  assert.deepEqual((await storage.listMemory()).find((item) => item.id === memory.id).linkedTaskIds, []);

  const deletedContact = await storage.deleteContact(contact.id);
  assert.equal(deletedContact.id, contact.id);
  assert.equal((await storage.listMemory()).find((item) => item.id === memory.id).contactId, "");
});

test("backend task storage links memory, dedupes client requests, filters, updates, and keeps missing context", async () => {
  const { storage } = loadStorageWithTempDir();

  const memory = await storage.appendMemory({
    id: "mem_task_source",
    createdAt: "2026-01-01T00:00:00.000Z",
    title: "Task source",
    sourceUrl: "https://example.com/source",
    note: "Important follow up",
    workspaceIds: []
  });

  const created = await storage.createTaskWithLinks({
    title: "Follow up",
    notes: "Email Ada",
    dueDate: "2026-02-01",
    priority: "high",
    sourceMemoryIds: [memory.id],
    clientRequestId: "task-click-1"
  });

  assert.equal(created.task.title, "Follow up");
  assert.equal(created.task.priority, "high");
  assert.equal(created.task.dueDate, "2026-02-01");
  assert.deepEqual(created.task.sourceMemoryIds, [memory.id]);
  assert.equal(created.linkedMemoryItems[0].linkedTaskIds[0], created.task.id);

  const duplicate = await storage.createTaskWithLinks({
    title: "Follow up",
    sourceMemoryIds: [memory.id],
    clientRequestId: "task-click-1"
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.task.id, created.task.id);
  assert.equal((await storage.listTasks({ status: "all" })).total, 1);

  const invalid = await storage.createTaskWithLinks({
    title: "Broken",
    sourceMemoryIds: ["missing_memory"]
  });
  assert.equal(invalid.error, "Unknown memory ID: missing_memory");
  assert.equal((await storage.listTasks({ status: "all" })).total, 1);

  const done = await storage.updateTask(created.task.id, { status: "done", priority: "medium" });
  assert.equal(done.status, "done");
  assert.equal(done.priority, "medium");
  assert.ok(done.completedAt);
  assert.equal((await storage.listTasks({ status: "done" })).total, 1);

  const reopened = await storage.updateTask(created.task.id, { status: "open", dueDate: "2026-03-01" });
  assert.equal(reopened.status, "open");
  assert.equal(reopened.completedAt, "");
  assert.equal(reopened.dueDate, "2026-03-01");

  assert.equal((await storage.getTaskContext(created.task.id)).items[0].unavailable, false);
  await storage.deleteMemory(memory.id);
  const context = await storage.getTaskContext(created.task.id);
  assert.equal(context.items[0].id, memory.id);
  assert.equal(context.items[0].unavailable, true);
});

test("backend deleteNoteWorkspace destroys assigned data, tombstones, and blocks default reseed", async () => {
  const { storage } = loadStorageWithTempDir();
  const workspace = (await storage.listNoteWorkspaces("all"))[0];

  const memory = await storage.appendMemory({
    id: "mem_ws_delete",
    createdAt: "2026-01-01T00:00:00.000Z",
    title: "Workspace note",
    workspaceIds: [workspace.id],
    embedding: [0.1, 0.2]
  });
  const contact = await storage.createContact({
    id: "contact_ws_delete",
    name: "Ada Workspace",
    email: "ada@ws.example",
    workspaceIds: [workspace.id],
    memoryIds: [memory.id]
  });
  const task = (await storage.createTaskWithLinks({
    id: "task_ws_delete",
    title: "Workspace task",
    workspaceIds: [workspace.id],
    sourceMemoryIds: [memory.id]
  })).task;

  // Unassigned data in another workspace must survive.
  const survivor = await storage.appendMemory({
    id: "mem_survivor",
    createdAt: "2026-01-01T00:00:00.000Z",
    title: "Survivor"
  });

  const result = await storage.deleteNoteWorkspace(workspace.id);
  assert.deepEqual(result, {
    deleted: true,
    workspaceId: workspace.id,
    counts: { notes: 1, contacts: 1, tasks: 1 }
  });

  const remaining = await storage.listNoteWorkspaces("all");
  assert.equal(remaining.some((item) => item.id === workspace.id), false);
  // Deleted default must not be reseeded on the next listing.
  assert.equal(remaining.length, 3);

  assert.equal((await storage.listMemory()).some((item) => item.id === memory.id), false);
  assert.equal((await storage.listMemory()).some((item) => item.id === survivor.id), true);
  assert.equal(storage.loadAllEmbeddings().has("mem_ws_delete"), false);
  assert.equal(await storage.getContact(contact.id), null);
  assert.equal(await storage.getTask(task.id), null);

  // Inbox/unassigned cannot be deleted; unknown workspaces return null.
  assert.equal((await storage.deleteNoteWorkspace("inbox")).error, "Unassigned cannot be deleted");
  assert.equal(await storage.deleteNoteWorkspace("nw_missing"), null);
});

test("backend restoreDeletedWorkspaceByName reuses a tombstoned workspace once", async () => {
  // Bind the server module to the same fresh temp storage so the helper path
  // and the test observe one data directory.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aaw-workspace-restore-"));
  process.env.NOTES_DIR = tmp;
  const storagePath = require.resolve("../backend/src/lib/storage");
  const serverPath = require.resolve("../backend/src/server");
  delete require.cache[storagePath];
  delete require.cache[serverPath];
  const storage = require(storagePath);
  const { createNoteWorkspace } = require(serverPath);
  const workspace = (await storage.listNoteWorkspaces("all")).find((item) => item.name === "Research");

  await storage.deleteNoteWorkspace(workspace.id);

  const created = await createNoteWorkspace({ name: "research" });
  assert.equal(created.restored, true);
  assert.equal(created.workspace.id, workspace.id);
  assert.equal(created.workspace.status, "open");
  // Tombstone is consumed: a duplicate active name now rejects.
  const duplicate = await createNoteWorkspace({ name: "Research" });
  assert.equal(duplicate.error, "Workspace already exists");
});

test("backend storage normalizes single-workspace arrays for contacts and tasks", async () => {
  const { storage } = loadStorageWithTempDir();
  const workspace = (await storage.listNoteWorkspaces("all"))[0];

  const contact = await storage.createContact({
    name: "Multi Workspace",
    email: "multi@ws.example",
    workspaceIds: [workspace.id, "nw_extra"]
  });
  assert.equal(contact.workspaceId, workspace.id);
  assert.deepEqual(contact.workspaceIds, [workspace.id]);
  assert.deepEqual(contact.taskIds, [workspace.id]);

  const task = (await storage.createTaskWithLinks({
    title: "Workspace task",
    workspaceIds: [workspace.id, "nw_extra"]
  })).task;
  assert.equal(task.workspaceId, workspace.id);
  assert.deepEqual(task.workspaceIds, [workspace.id]);
  assert.deepEqual(task.taskIds, [workspace.id]);
});

test("backend privacy storage retains settings and cleans selected buckets", async () => {
  const { storage } = loadStorageWithTempDir();

  const settings = await storage.patchPrivacySettings({
    aiMode: "local_only",
    retention: { enabled: true, memoryDays: 30, privacyEventsDays: 30 }
  });
  assert.equal(settings.aiMode, "local_only");

  await storage.appendMemory({
    id: "mem_old",
    createdAt: "2026-01-01T00:00:00.000Z",
    title: "Old memory",
    sourceUrl: "https://example.com/old",
    note: "Old",
    embedding: [0.1, 0.2]
  });
  await storage.appendMemory({
    id: "mem_new",
    createdAt: "2026-05-20T00:00:00.000Z",
    title: "New memory",
    sourceUrl: "https://example.com/new",
    note: "New",
    embedding: [0.3, 0.4]
  });
  await storage.appendPrivacyEvent({ operation: "summarize", timestamp: "2026-01-01T00:00:00.000Z", sentToProvider: false });
  await storage.appendPrivacyEvent({ operation: "rewrite", timestamp: "2026-05-20T00:00:00.000Z", sentToProvider: false });

  const retention = await storage.runRetention(Date.parse("2026-05-26T00:00:00.000Z"));
  assert.equal(retention.ran, true);
  assert.equal(retention.removed.memory, 1);
  assert.equal(retention.removed.privacyEvents, 1);
  assert.equal((await storage.listMemory()).length, 1);
  assert.equal(storage.loadAllEmbeddings().has("mem_old"), false);
  assert.equal(storage.loadAllEmbeddings().has("mem_new"), true);
  assert.equal((await storage.listPrivacyEvents()).total, 1);

  const cleared = await storage.clearData({ buckets: ["privacyEvents"] });
  assert.equal(cleared.cleared.privacyEvents, 1);
  assert.equal((await storage.getPrivacySettings()).aiMode, "local_only");
});
