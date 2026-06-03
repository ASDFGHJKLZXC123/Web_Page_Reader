"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const mirror = require("../chrome-extension/mirror-utils.js");

function fileJson(plan, path) {
  const file = plan.files.find((item) => item.path === path);
  assert.ok(file, `expected mirror file ${path}`);
  return file.json;
}

function assertSafePlanPaths(plan) {
  for (const file of plan.files) {
    assert.equal(file.path.startsWith("/"), false, file.path);
    assert.equal(file.path.includes("\\"), false, file.path);
    assert.equal(file.path.split("/").includes(".."), false, file.path);
    assert.doesNotThrow(() => mirror.assertSafeRelativePath(file.path));
  }
}

test("mirror helper builds backward-compatible memory files and indexes", () => {
  const plan = mirror.buildMirrorPlan({
    generatedAt: "2026-05-26T00:00:00.000Z",
    memory: [
      {
        id: "mem_one",
        title: "Research note",
        sourceUrl: "https://Example.com/article?utm_source=x&keep=1#intro",
        workspaceIds: ["nw_research"],
        note: "Important source",
        tags: [" ai ", "ai"]
      },
      {
        id: "mem_two",
        title: "Loose note",
        sourceUrl: "https://example.com/loose",
        workspaceIds: []
      }
    ],
    noteWorkspaces: [{ id: "nw_research", name: "Research", status: "open" }],
    actions: {
      contacts: [{ id: "contact_ada", name: "Ada Lovelace" }],
      tasks: [{ id: "task_followup", title: "Follow up" }]
    }
  });

  assert.ok(plan.files.some((file) => file.path === "mem_one.json"));
  assert.ok(plan.files.some((file) => file.path === "mem_two.json"));
  assert.ok(plan.files.some((file) => file.path === "aaw_mirror_manifest.json"));
  assert.ok(plan.files.some((file) => file.path === "indexes/workspaces.json"));
  assert.ok(plan.files.some((file) => file.path === "indexes/sources.json"));
  assert.ok(plan.files.some((file) => file.path === "workspaces/nw_research/index.json"));
  assert.ok(plan.files.some((file) => file.path === "workspaces/unassigned/index.json"));
  assert.equal(plan.files.some((file) => file.path.startsWith("contacts/")), false);
  assert.equal(plan.files.some((file) => file.path.startsWith("tasks/")), false);

  const workspaces = fileJson(plan, "indexes/workspaces.json");
  assert.equal(workspaces.workspaces[0].noteCount, 1);
  assert.equal(workspaces.unassigned.noteCount, 1);

  const sources = fileJson(plan, "indexes/sources.json");
  assert.equal(sources.sources[0].sourceHost, "example.com");
  assert.ok(sources.sources.some((source) => source.urlKey === "https://example.com/article?keep=1"));

  const workspace = fileJson(plan, "workspaces/nw_research/index.json");
  assert.deepEqual(workspace.notes.map((item) => item.id), ["mem_one"]);
  assert.deepEqual(workspace.notes[0].tags, ["ai"]);
});

test("mirror helper writes optional contact and task summaries only when enabled", () => {
  const base = {
    memory: [],
    noteWorkspaces: [],
    actions: {
      contacts: [{ id: "contact_ada", name: "Ada Lovelace", email: "ada@example.com", company: "Analytical Engines" }],
      tasks: [{ id: "task_call", title: "Call Ada", priority: "high" }]
    }
  };

  const disabled = mirror.buildMirrorPlan(base);
  assert.equal(disabled.files.some((file) => file.path.startsWith("contacts/")), false);
  assert.equal(disabled.files.some((file) => file.path.startsWith("tasks/")), false);

  const enabled = mirror.buildMirrorPlan({ ...base, config: { includeContacts: true, includeTasks: true } });
  assert.ok(enabled.files.some((file) => file.path === "contacts/contact_ada.json"));
  assert.ok(enabled.files.some((file) => file.path === "tasks/task_call.json"));
  assert.equal(fileJson(enabled, "contacts/contact_ada.json").contact.name, "Ada Lovelace");
  assert.equal(fileJson(enabled, "tasks/task_call.json").task.priority, "high");
});

test("mirror helper sanitizes generated paths so unsafe IDs cannot escape the folder", () => {
  const plan = mirror.buildMirrorPlan({
    memory: [{ id: "mem_../../escape", title: "Unsafe memory", workspaceIds: ["../bad/workspace"] }],
    noteWorkspaces: [{ id: "../bad/workspace", name: "Bad Workspace" }],
    actions: {
      contacts: [{ id: "../contact", name: "Bad Contact" }],
      tasks: [{ id: "../task", title: "Bad Task" }]
    },
    config: { includeContacts: true, includeTasks: true }
  });

  assertSafePlanPaths(plan);
  assert.equal(plan.files.some((file) => file.path === "../escape.json"), false);
  assert.ok(plan.files.some((file) => file.path.startsWith("workspaces/bad_workspace")));
  assert.ok(plan.files.some((file) => file.path.startsWith("contacts/contact_")));
  assert.ok(plan.files.some((file) => file.path.startsWith("tasks/task_")));
});

test("mirror helper orphan plan deletes only known generated outputs", () => {
  const next = mirror.buildMirrorPlan({
    memory: [{ id: "mem_keep", title: "Keep" }],
    noteWorkspaces: []
  });
  const previousManifest = {
    format: mirror.MIRROR_FORMAT,
    schemaVersion: mirror.MIRROR_SCHEMA_VERSION,
    generatedPaths: [
      "mem_keep.json",
      "mem_stale.json",
      "indexes/old.json",
      "../unsafe.json"
    ]
  };

  const stale = mirror.plannedStaleGeneratedPaths(previousManifest, next, ["mem_legacy_stale.json"]);

  assert.deepEqual(stale, ["indexes/old.json", "mem_legacy_stale.json", "mem_stale.json"]);
});
