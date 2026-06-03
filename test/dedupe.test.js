"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

function loadStorageWithTempDir() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aaw-dedupe-storage-"));
  process.env.NOTES_DIR = tmp;
  const storagePath = require.resolve("../backend/src/lib/storage");
  delete require.cache[storagePath];
  return { tmp, storage: require(storagePath) };
}

test("dedupe candidates use safe previews and include derived source groups", () => {
  const {
    buildDedupeCandidates,
    buildMergePreview
  } = require("../backend/src/lib/dedupe");

  const dataset = {
    memory: [{
      id: "mem_1",
      title: "Acme report",
      sourceUrl: "https://example.com/report?utm_source=ad&keep=1",
      note: "Short useful note",
      pageExcerpt: "SECRET raw page excerpt should not appear"
    }, {
      id: "mem_2",
      title: "Acme report",
      sourceUrl: "https://example.com/report?keep=1",
      note: "Short useful note",
      pageExcerpt: "SECRET raw page excerpt should not appear"
    }],
    actions: {
      contacts: [{
        id: "contact_1",
        name: "Ada Lovelace",
        email: "Ada@Example.com",
        sourceUrl: "https://example.com/report?keep=1"
      }, {
        id: "contact_2",
        name: "Ada Lovelace",
        email: "ada@example.com"
      }],
      tasks: [],
      tableRows: [],
      drafts: []
    }
  };

  const candidates = buildDedupeCandidates(dataset, { includeIgnored: true });
  const memory = candidates.find((item) => item.type === "memory");
  const contact = candidates.find((item) => item.type === "contact");
  const source = candidates.find((item) => item.type === "source");

  assert.ok(memory);
  assert.ok(contact);
  assert.ok(source);
  assert.equal(source.mergeable, false);
  assert.equal(JSON.stringify(memory.preview).includes("SECRET raw page excerpt"), false);

  const plan = buildMergePreview(dataset, { groupId: memory.groupId, type: "memory" });
  assert.equal(plan.primaryId, "mem_1");
  assert.deepEqual(plan.duplicateIds, ["mem_2"]);
  assert.ok(plan.planHash);

  const sourceVariants = buildDedupeCandidates({
    memory: [{
      id: "source_1",
      title: "Shared source title",
      sourceUrl: "https://example.com/report?b=2&a=1",
      note: "First source"
    }, {
      id: "source_2",
      title: "Shared source title",
      sourceUrl: "https://example.com/report/?a=1&b=2",
      note: "Second source"
    }, {
      id: "source_3",
      title: "Shared source title",
      sourceUrl: "https://example.com/other",
      note: "Third source"
    }],
    actions: { contacts: [], tasks: [], tableRows: [], drafts: [] }
  }, { type: "source" });
  assert.ok(sourceVariants.some((item) => item.reason.includes("host/path")));
  assert.ok(sourceVariants.some((item) => item.reason.includes("title")));
});

test("storage dedupe merge supports stale-plan rejection, ignore, apply, and undo", async () => {
  const { storage } = loadStorageWithTempDir();

  await storage.appendMemory({
    id: "mem_keep",
    createdAt: "2026-01-01T00:00:00.000Z",
    title: "Acme report",
    sourceUrl: "https://example.com/report?keep=1",
    note: "Follow up with Acme",
    linkedTaskIds: ["task_dup"],
    embedding: [0.1, 0.2]
  });
  await storage.appendMemory({
    id: "mem_dup",
    createdAt: "2026-01-02T00:00:00.000Z",
    title: "Acme report",
    sourceUrl: "https://example.com/report?utm_campaign=x&keep=1",
    note: "Follow up with Acme",
    workspaceIds: ["nw_default_research"],
    embedding: [0.3, 0.4]
  });

  const candidates = await storage.listDedupeCandidates({ type: "memory" });
  assert.equal(candidates.candidates.length, 1);
  const group = candidates.candidates[0];

  await storage.ignoreDedupeGroup({ groupId: group.groupId, type: "memory" });
  assert.equal((await storage.listDedupeCandidates({ type: "memory" })).candidates.length, 0);
  assert.equal((await storage.listDedupeCandidates({ type: "memory", includeIgnored: true })).candidates[0].ignored, true);
  await storage.unignoreDedupeGroup({ groupId: group.groupId });

  const preview = await storage.previewDedupeMerge({ groupId: group.groupId, type: "memory", primaryId: "mem_keep" });
  assert.ok(preview.plan.planHash);
  const missingHash = await storage.applyDedupeMerge({ groupId: group.groupId, type: "memory", primaryId: "mem_keep" });
  assert.equal(missingHash.error, "planHash is required");
  assert.equal(missingHash.statusCode, 400);
  await storage.updateMemory("mem_dup", { tags: ["reviewed"] });
  const drift = await storage.applyDedupeMerge({
    groupId: group.groupId,
    type: "memory",
    primaryId: "mem_keep",
    planHash: preview.plan.planHash
  });
  assert.equal(drift.statusCode, 409);
  const refreshedPreview = await storage.previewDedupeMerge({ groupId: group.groupId, type: "memory", primaryId: "mem_keep" });
  const stale = await storage.applyDedupeMerge({ groupId: group.groupId, type: "memory", primaryId: "mem_keep", planHash: "stale" });
  assert.equal(stale.statusCode, 409);

  const applied = await storage.applyDedupeMerge({
    groupId: group.groupId,
    type: "memory",
    primaryId: "mem_keep",
    planHash: refreshedPreview.plan.planHash
  });
  assert.equal(applied.applied, true);
  assert.equal(applied.audit.before, undefined);
  assert.deepEqual((await storage.listMemory()).map((item) => item.id), ["mem_keep"]);
  assert.equal(storage.loadAllEmbeddings().has("mem_dup"), false);
  assert.deepEqual((await storage.listMemory())[0].workspaceIds, ["nw_default_research"]);

  const retried = await storage.applyDedupeMerge({
    groupId: group.groupId,
    type: "memory",
    primaryId: "mem_keep",
    planHash: refreshedPreview.plan.planHash
  });
  assert.equal(retried.applied, true);
  assert.equal(retried.idempotent, true);
  assert.equal(retried.audit.before, undefined);

  const audit = await storage.listDedupeAudit({ limit: 10, offset: 0 });
  assert.equal(audit.total, 1);
  assert.equal(audit.items[0].before, undefined);
  assert.equal(audit.items[0].undoable, true);

  const undone = await storage.undoDedupeMerge({ auditId: audit.items[0].id });
  assert.equal(undone.undone, true);
  assert.deepEqual((await storage.listMemory()).map((item) => item.id), ["mem_dup", "mem_keep"]);
  assert.deepEqual(storage.loadAllEmbeddings().get("mem_dup").embedding, [0.3, 0.4]);
});

test("storage dedupe merges contacts and tasks and rewrites linked memory", async () => {
  const { storage } = loadStorageWithTempDir();

  await storage.appendMemory({
    id: "mem_links",
    title: "Linked page",
    sourceUrl: "https://example.com/link",
    contactId: "contact_dup",
    contactIds: ["contact_dup"],
    linkedTaskIds: ["task_dup"]
  });
  await storage.appendAction("contacts", {
    id: "contact_keep",
    name: "Ada Lovelace",
    email: "ada@example.com",
    memoryIds: []
  });
  await storage.appendAction("contacts", {
    id: "contact_dup",
    name: "Ada Lovelace",
    email: "ADA@example.com",
    company: "Acme",
    memoryIds: ["mem_links"]
  });

  const contactGroup = (await storage.listDedupeCandidates({ type: "contact" })).candidates[0];
  const contactPreview = await storage.previewDedupeMerge({ groupId: contactGroup.groupId, type: "contact", primaryId: "contact_keep" });
  const contactApply = await storage.applyDedupeMerge({
    groupId: contactGroup.groupId,
    type: "contact",
    primaryId: "contact_keep",
    planHash: contactPreview.plan.planHash
  });
  assert.equal(contactApply.applied, true);
  const contact = await storage.getContact("contact_keep");
  assert.equal(contact.company, "Acme");
  assert.deepEqual(contact.memoryIds, ["mem_links"]);
  assert.equal((await storage.listMemory())[0].contactId, "contact_keep");
  assert.deepEqual((await storage.listMemory())[0].contactIds, ["contact_keep"]);

  await storage.appendAction("tasks", {
    id: "task_keep",
    title: "Call Ada",
    sourceUrl: "https://example.com/link",
    sourceMemoryIds: [],
    priority: "none"
  });
  await storage.appendAction("tasks", {
    id: "task_dup",
    title: "Call Ada",
    sourceUrl: "https://example.com/link?utm_source=x",
    sourceMemoryIds: ["mem_links"],
    priority: "high",
    dueDate: "2026-06-01",
    notes: "Send agenda"
  });
  const taskGroup = (await storage.listDedupeCandidates({ type: "task" })).candidates[0];
  const taskPreview = await storage.previewDedupeMerge({ groupId: taskGroup.groupId, type: "task", primaryId: "task_keep" });
  const taskApply = await storage.applyDedupeMerge({
    groupId: taskGroup.groupId,
    type: "task",
    primaryId: "task_keep",
    planHash: taskPreview.plan.planHash
  });
  assert.equal(taskApply.applied, true);
  const task = await storage.getTask("task_keep");
  assert.deepEqual(task.sourceMemoryIds, ["mem_links"]);
  assert.equal(task.priority, "high");
  assert.equal(task.dueDate, "2026-06-01");
  assert.equal(task.notes, "Send agenda");
  assert.deepEqual((await storage.listMemory())[0].linkedTaskIds, ["task_keep"]);
});
