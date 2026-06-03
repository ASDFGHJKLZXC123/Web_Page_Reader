"use strict";

// Route contract tests exercising the real HTTP server through the shared
// backend harness. These prove the harness works and give later route-family
// milestones a reusable request helper. No provider API key is required.

const assert = require("node:assert/strict");
const test = require("node:test");

const { startBackend } = require("./helpers/backend-harness");

test("backend routes respond over HTTP without a provider key", async (t) => {
  let backend;
  try {
    backend = await startBackend();
  } catch (error) {
    if (error && error.code === "EPERM") {
      t.skip(`server listen blocked by sandbox: ${error.message}`);
      return;
    }
    throw error;
  }
  t.after(() => backend.close());

  await t.test("GET /health reports backend status and counts", async () => {
    const { status, json } = await backend.request("GET", "/health");
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.gemini.configured, false);
    assert.ok(json.counts && typeof json.counts.memory === "number");
  });

  await t.test("POST /api/assist/analyze summarize falls back locally", async () => {
    const { status, json } = await backend.request("POST", "/api/assist/analyze", {
      mode: "summarize",
      title: "Test Page",
      url: "https://example.com/article",
      content: "Climate policy shifted this year. ".repeat(20)
    });
    assert.equal(status, 200);
    assert.equal(json.mode, "summarize");
    assert.ok(json.output, "expected summarize output");
  });

  await t.test("POST /api/memory/save then GET /api/memory/list round-trips", async () => {
    const save = await backend.request("POST", "/api/memory/save", {
      title: "Saved note",
      note: "Remember this page.",
      sourceUrl: "https://example.com/article"
    });
    assert.equal(save.status, 201);
    assert.ok(save.json.item.id);

    const list = await backend.request("GET", "/api/memory/list");
    assert.equal(list.status, 200);
    assert.equal(list.json.total, 1);
    assert.equal(list.json.items[0].id, save.json.item.id);
  });

  await t.test("POST /api/actions/run create_task returns a task", async () => {
    const { status, json } = await backend.request("POST", "/api/actions/run", {
      type: "create_task",
      payload: { title: "Follow up", notes: "Do the thing" }
    });
    assert.equal(status, 201);
    assert.equal(json.type, "create_task");
    assert.equal(json.result.title, "Follow up");
  });

  await t.test("POST /api/actions/tasks/draft returns an editable task draft", async () => {
    const { status, json } = await backend.request("POST", "/api/actions/tasks/draft", {
      title: "Launch notes",
      sourceUrl: "https://example.com/launch",
      content: "Follow up with Ada before 2026-08-15. Prepare rollout notes.",
      sourceMemoryIds: ["mem_1"]
    });
    assert.equal(status, 200);
    assert.equal(json.draft.title, "Follow up: Launch notes");
    assert.equal(json.draft.dueDate, "2026-08-15");
    assert.equal(json.extractionMeta.promptVersion, "task-draft-v1");
  });

  await t.test("POST /api/contacts/extract falls back locally", async () => {
    const { status, json } = await backend.request("POST", "/api/contacts/extract", {
      title: "Acme Contact",
      sourceUrl: "https://example.com/contact",
      content: "Reach Ada at ada@example.com or (555) 111-2222."
    });
    assert.equal(status, 200);
    assert.equal(json.contacts[0].email, "ada@example.com");
    assert.equal(json.extractionMeta.contract, "lead_capture");
    assert.equal(json.extractionMeta.sourceDomain, "example.com");
  });

  await t.test("DELETE /api/note-workspaces/:id destroys workspace and tombstones it", async () => {
    const create = await backend.request("POST", "/api/note-workspaces", { name: "Disposable Workspace" });
    assert.equal(create.status, 201);
    const workspaceId = create.json.workspace.id;

    const del = await backend.request("DELETE", `/api/note-workspaces/${workspaceId}`);
    assert.equal(del.status, 200);
    assert.equal(del.json.deleted, true);
    assert.equal(del.json.workspaceId, workspaceId);
    assert.ok(del.json.counts && typeof del.json.counts.notes === "number");

    const list = await backend.request("GET", "/api/note-workspaces?status=all");
    assert.equal(list.json.items.some((workspace) => workspace.id === workspaceId), false);

    const missing = await backend.request("DELETE", "/api/note-workspaces/nw_missing");
    assert.equal(missing.status, 404);
  });

  await t.test("invalid action type is a 400 client error", async () => {
    const { status, json } = await backend.request("POST", "/api/actions/run", { type: "nope" });
    assert.equal(status, 400);
    assert.ok(json.error);
  });
});
