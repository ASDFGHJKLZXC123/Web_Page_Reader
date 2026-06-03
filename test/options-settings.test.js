"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const privacy = require("../chrome-extension/privacy-utils.js");
const settingsUtils = require("../chrome-extension/settings-utils.js");

function installChromeMock(seed = {}) {
  const state = { ...seed };
  global.window = {
    AssistantMirror: require("../chrome-extension/mirror-utils.js"),
    AssistantPrivacy: privacy,
    AssistantSettings: settingsUtils
  };
  global.chrome = {
    storage: {
      local: {
        get(keys, callback) {
          const out = {};
          for (const key of keys) out[key] = state[key];
          callback(out);
        },
        set(updates, callback) {
          Object.assign(state, updates);
          if (callback) callback();
        }
      }
    },
    runtime: { lastError: undefined, onMessage: { addListener() {} } }
  };
  return state;
}

function loadOptions() {
  const path = require.resolve("../chrome-extension/options.js");
  delete require.cache[path];
  const mod = require(path);
  return mod.__settings;
}

test("settings hub: loadAllSettings normalizes backend URL and provider defaults", async () => {
  installChromeMock({
    assistantBackendUrl: "http://example.com/",
    llmProvider: "openai",
    openaiApiKey: "sk-xyz",
    openaiModel: "gpt-5.4",
    privacySettings: null
  });
  const settings = loadOptions();
  const loaded = await settings.loadAllSettings();
  assert.equal(loaded.backendUrl, "http://example.com");
  assert.equal(loaded.llmProvider, "openai");
  assert.equal(loaded.openaiApiKey, "sk-xyz");
  assert.equal(loaded.openaiModel, "gpt-5.4");
  // Other providers fall back to defaults
  assert.equal(loaded.geminiModel, settingsUtils.DEFAULT_MODELS.gemini);
});

test("settings hub: privacy defaults match privacy-utils defaults", () => {
  installChromeMock();
  const settings = loadOptions();
  const fromOptions = settings.privacyDefaults();
  const fromUtil = privacy.defaultPrivacySettings();
  assert.deepEqual(fromOptions, fromUtil);
  assert.equal(fromOptions.aiMode, "auto");
  assert.equal(fromOptions.retention.privacyEventsDays, 90);
});

test("settings hub: privacyMerge normalizes a partial PATCH", () => {
  installChromeMock();
  const settings = loadOptions();
  const merged = settings.privacyMerge(null, {
    aiMode: "ask",
    redaction: { enabled: true },
    siteRules: { excludedHosts: ["Example.com", "*.client.test"] }
  });
  assert.equal(merged.aiMode, "ask");
  assert.equal(merged.redaction.enabled, true);
  assert.equal(merged.redaction.applyToModelPayload, true); // default preserved
  assert.deepEqual(merged.siteRules.excludedHosts, ["example.com", "*.client.test"]);
  // bogus aiMode is rejected by normalization → reverts to default "auto".
  const merged2 = settings.privacyMerge(merged, { aiMode: "nonsense" });
  assert.equal(merged2.aiMode, "auto");
});

test("settings hub: live API keys persist across provider switches", () => {
  installChromeMock();
  const settings = loadOptions();
  settings.setLiveApiKeys({ openai: "sk-OPENAI", anthropic: "sk-ant-ABC" });
  const keys = settings.getLiveApiKeys();
  assert.equal(keys.openai, "sk-OPENAI");
  assert.equal(keys.anthropic, "sk-ant-ABC");
});

test("settings hub: buildRouteMessage preserves envelope type for dedupe unignore", () => {
  const msg = settingsUtils.buildRouteMessage("/api/dedupe/unignore", {
    method: "POST",
    body: JSON.stringify({ groupId: "g", type: "memory" })
  });
  assert.equal(msg.type, "DEDUPE_UNIGNORE");
  assert.equal(msg.dedupeType, "memory");
  assert.equal(msg.groupId, "g");
});

test("settings hub: buildRouteMessage routes dedupe undo with auditId", () => {
  const msg = settingsUtils.buildRouteMessage("/api/dedupe/undo", {
    method: "POST",
    body: JSON.stringify({ auditId: "a-1" })
  });
  assert.equal(msg.type, "DEDUPE_UNDO");
  assert.equal(msg.auditId, "a-1");
});

test("settings hub: backupOptionsQuery defaults exclude sensitive data", () => {
  installChromeMock();
  // Without a DOM the checkboxes are absent → all toggles default off.
  global.document = { getElementById: () => null };
  const settings = loadOptions();
  const query = settings.backupOptionsQuery();
  const params = new URLSearchParams(query);
  assert.equal(params.get("includeSensitive"), "false");
  assert.equal(params.get("includeSettings"), "false");
  assert.equal(params.get("includeEmbeddings"), "false");
  assert.equal(params.get("includeAudit"), "false");
  delete global.document;
});
