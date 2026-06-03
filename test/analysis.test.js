"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildResponse,
  buildSummaryObject,
  buildTaskDraft,
  extractStructuredInfo,
  normalizeExtractOutput,
  normalizeSummaryOutput
} = require("../backend/src/lib/analysis");

test("summary response returns structured research output", () => {
  const output = buildSummaryObject({
    content: "Alpha launched a product. It raised funding. What should happen next?",
    title: "Alpha update",
    url: "https://example.com/a",
    source: { sourceType: "page", originalCharCount: 73, submittedCharCount: 73 }
  });

  assert.equal(output.schemaVersion, 1);
  assert.match(output.tldr, /Alpha/);
  assert.ok(Array.isArray(output.keyPoints));
  assert.ok(output.openQuestions[0].includes("?"));
  assert.equal(output.source.title, "Alpha update");
  assert.equal(output.engine, "local");
});

test("extract response returns ExtractedPageInfo v2 with contacts, dates, links, and metadata", () => {
  const output = extractStructuredInfo(
    "Contact Ada at ada@example.com on 2026-06-01. Call 555-111-2222.",
    "Contact page",
    "https://example.com/contact",
    {
      canonicalUrl: "https://example.com/contact",
      metaDescription: "Contact us",
      timeDatetimes: ["2026-06-02T10:00:00Z"],
      organizations: ["Example Inc"],
      links: [
        { text: "About", url: "https://example.com/about", type: "page" },
        { text: "Unsafe", url: "javascript:alert(1)", type: "page" }
      ]
    }
  );

  assert.equal(output.schemaVersion, 2);
  assert.deepEqual(output.contacts.emails, ["ada@example.com"]);
  assert.deepEqual(output.contacts.organizations, ["Example Inc"]);
  assert.equal(output.dates[0].text, "2026-06-01");
  assert.equal(output.links.length, 1);
  assert.equal(output.extractionMeta.canonicalUrl, "https://example.com/contact");
  assert.equal(output.extractionMeta.engine, "local");
  assert.equal(output.extractionMeta.promptVersion, "page-info-v2");
});

test("normalize model outputs keeps local fallback metadata", () => {
  const summaryFallback = buildResponse({
    mode: "summarize",
    content: "One sentence. Another sentence.",
    title: "Fallback",
    url: "https://example.com"
  }).output;
  const summary = normalizeSummaryOutput({ tldr: "Short", keyPoints: ["A"] }, summaryFallback);
  assert.equal(summary.tldr, "Short");
  assert.deepEqual(summary.keyPoints, ["A"]);
  assert.equal(summary.source.title, "Fallback");

  const extractFallback = buildResponse({
    mode: "extract",
    content: "Email me@example.com",
    title: "Fallback",
    url: "https://example.com",
    pageMeta: { links: [{ text: "Home", url: "https://example.com" }] }
  }).output;
  const extract = normalizeExtractOutput(
    {
      dates: ["2026-07-01"],
      contacts: { emails: [], phones: [], people: ["Ada"], organizations: [] },
      links: [{ text: "Bad", url: "data:text/html,x" }],
      url: "https://evil.example/overwrite",
      extractionMeta: { canonicalUrl: "https://evil.example", linkCount: 99 },
      confidence: 4,
      fieldConfidence: { people: 0.8 }
    },
    extractFallback,
    { engine: "model_validated", provider: "gemini", model: "test-model" }
  );
  assert.equal(extract.schemaVersion, 2);
  assert.equal(extract.url, "https://example.com");
  assert.equal(extract.links.length, 1);
  assert.equal(extract.links[0].url, "https://example.com");
  assert.deepEqual(extract.contacts.emails, ["me@example.com"]);
  assert.deepEqual(extract.contacts.people, ["Ada"]);
  assert.ok(extract.dates.some((date) => date.text === "2026-07-01" && date.isoDate === "2026-07-01"));
  assert.equal(extract.extractionMeta.canonicalUrl, "");
  assert.equal(extract.extractionMeta.linkCount, 1);
  assert.equal(extract.extractionMeta.engine, "model_validated");
  assert.equal(extract.extractionMeta.provider, "gemini");
  assert.equal(extract.confidence, 1);
  assert.equal(extract.fieldConfidence.people, 0.8);
});

test("extract normalization clamps oversized contact arrays and sanitizes provenance", () => {
  const fallback = buildResponse({
    mode: "extract",
    content: "Email local@example.com",
    title: "Fallback",
    url: "https://example.com",
    pageMeta: {}
  }).output;
  const oversized = Array.from({ length: 80 }, (_, index) => `person-${index}`);
  const extract = normalizeExtractOutput(
    { contacts: { people: oversized } },
    fallback,
    {
      provenance: {
        operation: "extract",
        rawContent: "must not persist",
        url: "https://example.com/?secret=1",
        redactionCounts: { emails: 1 }
      }
    }
  );

  assert.equal(extract.contacts.people.length, 40);
  assert.equal(extract.extractionMeta.provenance.operation, "extract");
  assert.equal(extract.extractionMeta.provenance.rawContent, undefined);
  assert.equal(extract.extractionMeta.provenance.url, undefined);
  assert.equal(extract.extractionMeta.provenance.redactionCounts.emails, 1);
});

test("task draft fallback returns editable task fields", () => {
  const result = buildTaskDraft({
    title: "Launch notes",
    sourceUrl: "https://example.com/launch",
    content: "Follow up with Ada before 2026-08-15. Prepare rollout notes.",
    sourceMemoryIds: ["mem_1"]
  });

  assert.equal(result.draft.title, "Follow up: Launch notes");
  assert.equal(result.draft.dueDate, "2026-08-15");
  assert.equal(result.draft.priority, "none");
  assert.deepEqual(result.draft.sourceMemoryIds, ["mem_1"]);
  assert.equal(result.extractionMeta.promptVersion, "task-draft-v1");
});
