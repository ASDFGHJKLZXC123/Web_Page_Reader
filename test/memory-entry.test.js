"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

function loadServerWithTempDir() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aaw-memory-entry-"));
  process.env.NOTES_DIR = tmp;
  for (const modulePath of [
    "../backend/src/server",
    "../backend/src/lib/storage"
  ]) {
    const resolved = require.resolve(modulePath);
    delete require.cache[resolved];
  }
  return require("../backend/src/server");
}

test("server creates canonical memory entries and patches note/tags", async () => {
  const { createMemoryEntry, handleSearch, updateMemoryEntry } = loadServerWithTempDir();

  const item = await createMemoryEntry({
    title: "Company page",
    sourceUrl: "https://Example.com/company?utm_source=newsletter#team",
    content: "Company details and contacts",
    note: "Initial note",
    tags: [" lead ", "lead"],
    workspaceIds: []
  });

  assert.equal(item.schemaVersion, 2);
  assert.equal(item.title, "Company page");
  assert.equal(item.canonicalUrl, "https://example.com/company#team");
  assert.equal(item.urlKey, "https://example.com/company");
  assert.equal(item.sourceHost, "example.com");
  assert.equal(item.pageExcerpt, "Company details and contacts");
  assert.equal(item.content, undefined);
  assert.deepEqual(item.tags, ["lead"]);

  const result = await updateMemoryEntry(item.id, {
    note: "Updated note",
    tags: [" client ", "client", "warm"]
  });

  assert.equal(result.item.note, "Updated note");
  assert.deepEqual(result.item.tags, ["client", "warm"]);
  assert.ok(result.item.updatedAt);

  const search = await handleSearch("client example", { limit: 5, offset: 0 });
  assert.equal(search.query, "client example");
  assert.equal(search.limit, 5);
  assert.equal(search.offset, 0);
  assert.ok(["keyword", "mixed"].includes(search.rankingMode));
  assert.equal(search.items[0].id, item.id);
  assert.ok(search.items[0].matchedFields.includes("tags"));
  assert.ok(search.items[0].matchedFields.includes("sourceHost"));
  assert.deepEqual(search.items[0].workspaceLabels, []);
});

test("server search matches workspace labels and returns Milestone 3 metadata", async () => {
  const { createMemoryEntry, handleSearch } = loadServerWithTempDir();

  await createMemoryEntry({
    title: "Lead list",
    sourceUrl: "https://leads.example.com/profile",
    note: "Follow up next week",
    workspaceIds: ["nw_default_client_leads"],
    tags: ["prospect"]
  });

  const search = await handleSearch("client prospect", { limit: 10, offset: 0 });
  assert.equal(search.total, 1);
  assert.equal(search.memoryTotal, 1);
  assert.ok(search.embeddingProvider);
  assert.ok(Object.prototype.hasOwnProperty.call(search, "fallbackReason"));
  assert.deepEqual(search.items[0].workspaceLabels, ["Client Leads"]);
  assert.ok(search.items[0].matchedFields.includes("workspace"));
  assert.ok(search.items[0].matchedFields.includes("tags"));
  assert.equal(typeof search.items[0].vectorAvailable, "boolean");
  assert.ok(["keyword", "mixed", "semantic"].includes(search.items[0].matchType));
});

test("server linked lead memory appears in memory search", async () => {
  const { createMemoryEntry, handleSearch } = loadServerWithTempDir();

  const item = await createMemoryEntry({
    kind: "lead",
    contactId: "contact_ada",
    title: "Ada Lovelace",
    sourceUrl: "https://example.com/profile",
    note: "Ada Lovelace Founder at Acme",
    snippet: "Ada Lovelace Founder at Acme",
    workspaceIds: ["nw_default_client_leads"],
    tags: ["lead"]
  });

  const search = await handleSearch("Ada Acme Client", { limit: 10, offset: 0 });
  assert.equal(search.total, 1);
  assert.equal(search.items[0].id, item.id);
  assert.equal(search.items[0].kind, "lead");
  assert.equal(search.items[0].contactId, "contact_ada");
  assert.deepEqual(search.items[0].workspaceLabels, ["Client Leads"]);
});
