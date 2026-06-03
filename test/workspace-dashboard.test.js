"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { buildWorkspaceDashboard, sourceKeyFor } = require("../backend/src/lib/workspace-dashboard");

function dashboardDataset() {
  return {
    workspaces: [
      { id: "nw_research", name: "Research", status: "open" },
      { id: "nw_archived", name: "Archived", status: "archived" }
    ],
    memory: [{
      id: "mem_1",
      title: "Acme report",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
      sourceUrl: "https://example.com/report?utm_source=x&keep=1",
      workspaceIds: ["nw_research"],
      linkedTaskIds: ["task_linked"],
      contactId: "contact_legacy"
    }, {
      id: "mem_legacy",
      title: "Legacy membership",
      createdAt: "2026-04-01T00:00:00.000Z",
      sourceUrl: "",
      taskIds: ["nw_research"]
    }, {
      id: "mem_unassigned",
      title: "Unassigned note",
      createdAt: "2026-03-01T00:00:00.000Z"
    }],
    actions: {
      contacts: [{
        id: "contact_1",
        name: "Ada Rivera",
        email: "ada@example.com",
        createdAt: "2026-05-03T00:00:00.000Z",
        sourceUrl: "https://example.com/report?keep=1",
        memoryIds: ["mem_1"]
      }, {
        id: "contact_legacy",
        name: "Legacy Contact",
        createdAt: "2026-05-04T00:00:00.000Z"
      }, {
        id: "contact_missing",
        name: "Missing",
        memoryIds: ["missing_memory"]
      }],
      tasks: [{
        id: "task_1",
        title: "Source task",
        status: "open",
        priority: "high",
        createdAt: "2026-05-05T00:00:00.000Z",
        sourceUrl: "https://example.com/report?keep=1",
        sourceMemoryIds: ["mem_1"]
      }, {
        id: "task_linked",
        title: "Linked task",
        status: "done",
        createdAt: "2026-05-06T00:00:00.000Z",
        completedAt: "2026-05-07T00:00:00.000Z"
      }, {
        id: "task_missing",
        title: "Missing task",
        sourceMemoryIds: ["missing_memory"]
      }],
      tableRows: [],
      drafts: []
    }
  };
}

test("workspace dashboard derives notes, sources, contacts, tasks, activity, and metrics", () => {
  const dashboard = buildWorkspaceDashboard(dashboardDataset(), { workspaceId: "nw_research" });

  assert.equal(dashboard.workspace.name, "Research");
  assert.equal(dashboard.permissions.canWrite, true);
  assert.equal(dashboard.metrics.notes, 2);
  assert.equal(dashboard.metrics.sources, 2);
  assert.equal(dashboard.metrics.contacts, 2);
  assert.equal(dashboard.metrics.tasks, 2);
  assert.equal(dashboard.metrics.openTasks, 1);
  assert.equal(dashboard.metrics.doneTasks, 1);
  assert.equal(dashboard.sources.some((source) => source.id === "source:missing"), true);
  assert.equal(dashboard.sources.some((source) => source.urlKey === "https://example.com/report?keep=1"), true);
  assert.deepEqual(dashboard.memory.items.map((item) => item.id).sort(), ["mem_1", "mem_legacy"]);
  assert.ok(dashboard.activity.some((item) => item.type === "task" && item.action === "completed"));
});

test("workspace dashboard treats legacy taskIds only as workspace membership", () => {
  const dashboard = buildWorkspaceDashboard(dashboardDataset(), { workspaceId: "nw_research" });
  assert.ok(dashboard.memory.items.some((item) => item.id === "mem_legacy"));
  assert.equal(dashboard.tasks.items.some((task) => task.id === "nw_research"), false);
});

test("workspace dashboard supports unassigned, archived permissions, limits, and status filters", () => {
  const unassigned = buildWorkspaceDashboard(dashboardDataset(), { type: "unassigned" });
  assert.equal(unassigned.workspace.id, "unassigned");
  assert.equal(unassigned.permissions.canArchive, false);
  assert.deepEqual(unassigned.memory.items.map((item) => item.id), ["mem_unassigned"]);

  const archived = buildWorkspaceDashboard(dashboardDataset(), { workspaceId: "nw_archived" });
  assert.equal(archived.permissions.canWrite, false);
  assert.equal(archived.permissions.canArchive, true);

  const doneOnly = buildWorkspaceDashboard(dashboardDataset(), { workspaceId: "nw_research" }, { taskStatus: "done", taskLimit: 1, memoryLimit: 1 });
  assert.deepEqual(doneOnly.tasks.items.map((task) => task.id), ["task_linked"]);
  assert.equal(doneOnly.memory.items.length, 1);
});

test("workspace dashboard uses exact normalized source URLs and reports missing links", () => {
  const dashboard = buildWorkspaceDashboard(dashboardDataset(), { workspaceId: "nw_research" });
  assert.equal(sourceKeyFor("https://example.com/report?utm_campaign=x&keep=1"), "https://example.com/report?keep=1");
  assert.ok(dashboard.contacts.items.some((contact) => contact.id === "contact_1"));
  assert.ok(dashboard.tasks.items.some((task) => task.id === "task_1"));
  assert.ok(dashboard.warnings.some((warning) => warning.entityType === "contact" && warning.missingId === "missing_memory"));
  assert.ok(dashboard.warnings.some((warning) => warning.entityType === "task" && warning.missingId === "missing_memory"));
});
