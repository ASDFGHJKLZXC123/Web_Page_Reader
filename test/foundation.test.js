"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildMemoryItem,
  buildMemorySearchText,
  compactStringArray,
  contactDedupeKey,
  mergeContactItems,
  normalizeActions,
  normalizeContactItem,
  normalizeDbShape,
  normalizeMemoryItem,
  normalizeSearchText,
  normalizeSourceUrl,
  normalizeTaskItem,
  scoreMemoryKeyword,
  seedDefaultWorkspaces
} = require("../backend/src/lib/foundation");

test("compactStringArray trims, de-dupes, and drops non-strings", () => {
  assert.deepEqual(compactStringArray([" a ", "a", "", null, "b"]), ["a", "b"]);
});

test("normalizeMemoryItem reduces legacy multi-workspace taskIds to one canonical id", () => {
  const item = normalizeMemoryItem({
    id: "mem_1",
    taskIds: [" nw_1 ", "nw_1", "nw_2"],
    tags: [" lead ", "lead"],
    linkedTaskIds: ["task_1", "task_1"]
  });

  // Single-workspace simplification: only the first membership survives.
  assert.equal(item.workspaceId, "nw_1");
  assert.deepEqual(item.workspaceIds, ["nw_1"]);
  assert.deepEqual(item.taskIds, ["nw_1"]);
  assert.deepEqual(item.tags, ["lead"]);
  assert.deepEqual(item.linkedTaskIds, ["task_1"]);
});

test("normalizeMemoryItem prefers canonical workspaceId over legacy arrays", () => {
  const item = normalizeMemoryItem({
    workspaceId: "nw_new",
    workspaceIds: ["nw_old"],
    taskIds: ["nw_older"]
  });

  assert.equal(item.workspaceId, "nw_new");
  assert.deepEqual(item.workspaceIds, ["nw_new"]);
  assert.deepEqual(item.taskIds, ["nw_new"]);
});

test("normalizeContactItem and normalizeTaskItem expose canonical single-workspace arrays", () => {
  const contact = normalizeContactItem({ id: "contact_1", workspaceIds: ["nw_a", "nw_b"] });
  assert.equal(contact.workspaceId, "nw_a");
  assert.deepEqual(contact.workspaceIds, ["nw_a"]);
  assert.deepEqual(contact.taskIds, ["nw_a"]);

  const unassigned = normalizeContactItem({ id: "contact_2" });
  assert.equal(unassigned.workspaceId, "");
  assert.deepEqual(unassigned.workspaceIds, []);
  assert.deepEqual(unassigned.taskIds, []);

  const task = normalizeTaskItem({ id: "task_1", taskIds: ["nw_a", "nw_b"] });
  assert.equal(task.workspaceId, "nw_a");
  assert.deepEqual(task.workspaceIds, ["nw_a"]);
  assert.deepEqual(task.taskIds, ["nw_a"]);
});

test("normalizeContactItem preserves legacy minimal contacts", () => {
  const contact = normalizeContactItem({
    id: "contact_1",
    name: "",
    email: "person@example.com",
    emails: ["other@example.com", "person@example.com"],
    phone: "555-111-2222"
  });

  assert.equal(contact.name, "Unknown contact");
  assert.equal(contact.email, "person@example.com");
  assert.deepEqual(contact.emails, ["person@example.com", "other@example.com"]);
  assert.equal(contact.phone, "5551112222");
});

test("contact dedupe and merge use normalized lead identity", () => {
  const first = normalizeContactItem({
    id: "contact_1",
    name: "Ada Lovelace",
    email: " Ada@Example.COM ",
    phone: "(555) 111-2222",
    company: "Analytical Engines",
    tags: [" lead "],
    memoryIds: ["mem_1"]
  });
  const second = normalizeContactItem({
    id: "contact_2",
    name: "Ada Lovelace",
    email: "ada@example.com",
    phones: ["555.333.4444"],
    roleTitle: "Founder",
    tags: ["lead", "qualified"],
    memoryIds: ["mem_2"]
  });

  assert.equal(contactDedupeKey(first), "email:ada@example.com");
  assert.equal(contactDedupeKey(second), "email:ada@example.com");

  const merged = mergeContactItems(first, second, "2026-01-01T00:00:00.000Z");
  assert.deepEqual(merged.emails, ["ada@example.com"]);
  assert.deepEqual(merged.phones, ["5551112222", "5553334444"]);
  assert.equal(merged.roleTitle, "Founder");
  assert.deepEqual(merged.tags, ["lead", "qualified"]);
  assert.deepEqual(merged.memoryIds, ["mem_1", "mem_2"]);
  assert.equal(merged.updatedAt, "2026-01-01T00:00:00.000Z");
});

test("normalizeActions gives missing action buckets stable arrays", () => {
  const actions = normalizeActions({ contacts: [{ email: "a@example.com" }] });
  assert.deepEqual(actions.tasks, []);
  assert.deepEqual(actions.tableRows, []);
  assert.equal(actions.contacts[0].email, "a@example.com");
  assert.deepEqual(actions.drafts, []);
});

test("normalizeDbShape normalizes legacy memory and actions", () => {
  const db = normalizeDbShape({
    memory: [{ id: "mem_1", taskIds: ["nw_1"] }],
    actions: { tasks: [{ id: "task_1", title: "" }] }
  });

  assert.deepEqual(db.memory[0].workspaceIds, ["nw_1"]);
  assert.equal(db.actions.tasks[0].title, "Untitled task");
  assert.deepEqual(db.noteWorkspaces, []);
});

test("normalizeSourceUrl lowercases hosts and strips tracking params", () => {
  assert.equal(
    normalizeSourceUrl("https://Example.COM:443/path?utm_source=x&keep=1#section"),
    "https://example.com/path?keep=1#section"
  );
  assert.equal(normalizeSourceUrl("javascript:alert(1)"), "");
});

test("buildMemorySearchText combines searchable memory fields", () => {
  const text = buildMemorySearchText(
    {
      title: "Company page",
      note: "Follow up",
      snippet: "Seed stage startup",
      sourceHost: "example.com",
      tags: ["lead"]
    },
    ["Client Leads"]
  );

  assert.match(text, /Company page/);
  assert.match(text, /Follow up/);
  assert.match(text, /example\.com/);
  assert.match(text, /Client Leads/);
});

test("scoreMemoryKeyword finds accents, tags, workspace names, and host fields", () => {
  assert.equal(normalizeSearchText("Résumé café"), "resume cafe");
  const score = scoreMemoryKeyword(
    "resume client example",
    {
      title: "Company page",
      note: "Résumé follow up",
      sourceHost: "example.com",
      tags: ["lead"]
    },
    ["Client Leads"]
  );

  assert.ok(score.keywordScore > 0);
  assert.deepEqual(score.matchedTerms.sort(), ["client", "example", "resume"]);
  assert.ok(score.matchedFields.includes("note"));
  assert.ok(score.matchedFields.includes("workspace"));
  assert.ok(score.matchedFields.includes("sourceHost"));
});

test("buildMemoryItem creates canonical page memory fields", () => {
  const item = buildMemoryItem(
    {
      title: "Article",
      sourceUrl: "https://Example.com/path?utm_source=x&keep=1#intro",
      content: "Long page text",
      note: "Follow up",
      workspaceIds: [" nw_1 ", "nw_1"],
      tags: [" lead ", "lead"]
    },
    { id: "mem_1", now: "2026-01-01T00:00:00.000Z" }
  );

  assert.equal(item.schemaVersion, 2);
  assert.equal(item.id, "mem_1");
  assert.equal(item.createdAt, "2026-01-01T00:00:00.000Z");
  assert.equal(item.updatedAt, "2026-01-01T00:00:00.000Z");
  assert.equal(item.canonicalUrl, "https://example.com/path?keep=1#intro");
  assert.equal(item.urlKey, "https://example.com/path?keep=1");
  assert.equal(item.sourceHost, "example.com");
  assert.equal(item.sourceOrigin, "https://example.com");
  assert.equal(item.sourcePath, "/path");
  assert.equal(item.sourceHash, "intro");
  assert.equal(item.pageExcerpt, "Long page text");
  assert.equal(item.sourceType, "page");
  assert.equal(item.searchDocumentVersion, 1);
  assert.equal(item.content, undefined);
  assert.deepEqual(item.workspaceIds, ["nw_1"]);
  assert.deepEqual(item.tags, ["lead"]);
  assert.ok(item.contentHash);
});

test("seedDefaultWorkspaces adds defaults without duplicating matching names", () => {
  const seeded = seedDefaultWorkspaces(
    [{ id: "custom_research", name: "Research", status: "open" }],
    "2026-01-01T00:00:00.000Z"
  );

  assert.equal(seeded.added, 3);
  assert.equal(seeded.items[0].name, "Job Search");
  assert.equal(seeded.items[1].name, "Startup Ideas");
  assert.equal(seeded.items[2].name, "Client Leads");
  assert.equal(seeded.items[3].id, "custom_research");
});
