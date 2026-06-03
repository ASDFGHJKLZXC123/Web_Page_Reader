"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { buildContextGraph, buildFullGraph } = require("../backend/src/lib/context-graph");

function graphDataset() {
  return {
    workspaces: [{ id: "nw_research", name: "Research", status: "open" }],
    memory: [{
      id: "mem_1",
      title: "Acme report",
      note: "Ada lead context",
      sourceUrl: "https://example.com/report?utm_source=x&keep=1",
      workspaceIds: ["nw_research"],
      linkedTaskIds: ["task_1"],
      contactId: "contact_1",
      structuredExtraction: { title: "Acme extraction", summary: "Key points" }
    }, {
      id: "mem_legacy",
      title: "Legacy workspace note",
      taskIds: ["nw_research"],
      sourceUrl: ""
    }],
    actions: {
      contacts: [{
        id: "contact_1",
        name: "Ada Rivera",
        email: "ada@example.com",
        sourceUrl: "https://example.com/report?keep=1",
        memoryIds: ["mem_1"]
      }],
      tasks: [{
        id: "task_1",
        title: "Follow up",
        status: "open",
        sourceUrl: "https://example.com/report?keep=1",
        sourceMemoryIds: ["mem_1"]
      }],
      tableRows: [],
      drafts: []
    }
  };
}

test("context graph derives memory, workspace, task, contact, source, and extraction links", () => {
  const graph = buildContextGraph(graphDataset(), { type: "memory", id: "mem_1" });
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const edgeTypes = new Set(graph.edges.map((edge) => edge.type));

  assert.equal(graph.subject.found, true);
  assert.ok(nodeIds.has("memory:mem_1"));
  assert.ok(nodeIds.has("workspace:nw_research"));
  assert.ok(nodeIds.has("task:task_1"));
  assert.ok(nodeIds.has("contact:contact_1"));
  assert.ok(nodeIds.has("source:https://example.com/report?keep=1"));
  assert.ok(nodeIds.has("extraction:mem_1"));
  assert.ok(edgeTypes.has("memory_workspace"));
  assert.ok(edgeTypes.has("memory_task"));
  assert.ok(edgeTypes.has("task_memory"));
  assert.ok(edgeTypes.has("contact_memory"));
  assert.ok(edgeTypes.has("memory_contact"));
  assert.ok(edgeTypes.has("memory_source"));
  assert.ok(edgeTypes.has("memory_extraction"));
});

test("context graph uses legacy taskIds only as workspace membership", () => {
  const graph = buildContextGraph(graphDataset(), { type: "memory", id: "mem_legacy" });
  const legacyEdge = graph.edges.find((edge) => edge.type === "memory_workspace" && edge.from === "memory:mem_legacy");
  assert.ok(legacyEdge);
  assert.equal(legacyEdge.relation, "legacy");
  assert.equal(graph.edges.some((edge) => edge.to === "task:nw_research" || edge.from === "task:nw_research"), false);
});

test("context graph source matching is exact after URL normalization", () => {
  const graph = buildContextGraph(graphDataset(), {
    type: "source",
    urlKey: "https://example.com/report?utm_campaign=x&keep=1"
  });
  assert.equal(graph.subject.found, true);
  assert.equal(graph.nodes.some((node) => node.id === "source:https://example.com/report?keep=1"), true);
  assert.equal(graph.nodes.some((node) => node.id === "source:https://example.com/other"), false);
});

test("context graph reports missing linked records without crashing", () => {
  const dataset = graphDataset();
  dataset.memory[0].linkedTaskIds = ["missing_task"];
  dataset.memory[0].workspaceIds = ["missing_workspace"];
  dataset.actions.contacts[0].memoryIds = ["missing_memory"];
  const graph = buildContextGraph(dataset, { type: "memory", id: "mem_1" });
  assert.equal(graph.subject.found, true);
  assert.ok(graph.warnings.some((warning) => warning.code === "missing_task"));
  assert.ok(graph.warnings.some((warning) => warning.code === "missing_workspace"));

  const full = buildFullGraph(dataset);
  assert.ok(full.warnings.some((warning) => warning.code === "missing_memory"));
});

test("context graph search returns matching nodes and direct neighbors", () => {
  const graph = buildContextGraph(graphDataset(), { type: "search", q: "Ada" });
  assert.equal(graph.subject.found, true);
  assert.ok(graph.nodes.some((node) => node.id === "contact:contact_1"));
  assert.ok(graph.nodes.some((node) => node.id === "memory:mem_1"));
});
