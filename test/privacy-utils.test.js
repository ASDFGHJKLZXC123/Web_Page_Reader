"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const privacy = require("../chrome-extension/privacy-utils.js");

test("privacy settings normalize defaults and host rules", () => {
  const settings = privacy.normalizePrivacySettings({
    aiMode: "ask",
    redaction: { enabled: false },
    siteRules: {
      excludedHosts: ["Example.com", "*.Sensitive.test", "https://www.Example.com/path"],
      hostOverrides: { "*.client.test": "local_only", "bad": "bogus" }
    },
    retention: { enabled: true, memoryDays: 7.8 }
  });

  assert.equal(settings.aiMode, "ask");
  assert.equal(settings.redaction.enabled, false);
  assert.deepEqual(settings.siteRules.excludedHosts, ["example.com", "*.sensitive.test"]);
  assert.equal(settings.siteRules.hostOverrides["*.client.test"], "local_only");
  assert.equal(settings.retention.enabled, true);
  assert.equal(settings.retention.memoryDays, 7);
});

test("privacy evaluation applies override then exclusion then global mode", () => {
  const settings = privacy.normalizePrivacySettings({
    aiMode: "auto",
    siteRules: {
      excludedHosts: ["*.example.com"],
      hostOverrides: { "docs.example.com": "ask" }
    }
  });

  assert.equal(privacy.evaluatePrivacy({ settings, host: "docs.example.com" }).effectiveAiMode, "ask");
  assert.equal(privacy.evaluatePrivacy({ settings, host: "mail.example.com" }).effectiveAiMode, "local_only");
  assert.equal(privacy.evaluatePrivacy({ settings, host: "other.test" }).effectiveAiMode, "auto");
});

test("redaction strips PII and token-like secrets from outbound content", () => {
  const settings = privacy.normalizePrivacySettings({
    redaction: { enabled: true },
  });
  const prepared = privacy.prepareOutboundContent({
    settings,
    content: "Email ada@example.com, call (415) 555-0198, token sk-test1234567890abcdef.",
    pageMeta: { contact: "bob@example.com" },
    url: "https://example.com/path?secret=1#hash"
  });

  assert.match(prepared.content, /\[redacted-email\]/);
  assert.match(prepared.content, /\[redacted-phone\]/);
  assert.match(prepared.content, /\[redacted-secret\]/);
  assert.equal(prepared.pageMeta.contact, "[redacted-email]");
  assert.equal(prepared.url, "https://example.com/path");
  assert.equal(prepared.redactionCounts.emails, 2);
});

test("privacy preflight blocks local-only and maps routes to messages", () => {
  const decision = privacy.privacyPreflight({
    settings: { aiMode: "local_only" },
    host: "example.com",
    operation: "summarize",
    content: "Page content"
  });

  assert.equal(decision.blocked, true);
  assert.equal(decision.requestAiMode, "local_only");
  assert.equal(decision.allowBackendAi, false);

  const message = privacy.buildPrivacyMessage("/api/privacy/settings", { method: "PATCH", body: JSON.stringify({ aiMode: "ask" }) });
  assert.deepEqual(message, { type: "PRIVACY_SETTINGS_PATCH", patch: { aiMode: "ask" } });

  const listMessage = privacy.buildPrivacyMessage("/api/privacy/provenance?limit=5&offset=10", { method: "GET" });
  assert.deepEqual(listMessage, { type: "PRIVACY_PROVENANCE_LIST", limit: 5, offset: 10 });
});
