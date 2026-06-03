"use strict";

// =============================================================================
// Shared settings helpers — provider configs, storage normalization, and the
// HTTP-path → service-worker message router. Loaded as a classic script in both
// the content panel and the options page so they share one source of truth.
// =============================================================================

(function defineSettingsUtils(globalScope) {
  const BACKEND_URL_KEY = "assistantBackendUrl";

  const PROVIDER_CONFIGS = {
    gemini: {
      label: "Google Gemini",
      keyPlaceholder: "AIza…",
      models: [
        { value: "gemini-2.5-flash",              label: "Gemini 2.5 Flash (recommended)" },
        { value: "gemini-2.5-pro",                label: "Gemini 2.5 Pro" },
        { value: "gemini-2.5-flash-lite",         label: "Gemini 2.5 Flash-Lite" },
        { value: "gemini-3.1-pro-preview",        label: "Gemini 3.1 Pro (preview)" },
        { value: "gemini-3-flash-preview",        label: "Gemini 3 Flash (preview)" },
        { value: "gemini-3.1-flash-lite-preview", label: "Gemini 3.1 Flash-Lite (preview)" }
      ]
    },
    openai: {
      label: "OpenAI",
      keyPlaceholder: "sk-…",
      models: [
        { value: "gpt-5.5",      label: "GPT-5.5 (recommended)" },
        { value: "gpt-5.4",      label: "GPT-5.4" },
        { value: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
        { value: "gpt-5.4-nano", label: "GPT-5.4 Nano" }
      ]
    },
    anthropic: {
      label: "Anthropic Claude",
      keyPlaceholder: "sk-ant-…",
      models: [
        { value: "claude-sonnet-4-6",         label: "Claude Sonnet 4.6 (recommended)" },
        { value: "claude-opus-4-7",           label: "Claude Opus 4.7" },
        { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
        { value: "claude-opus-4-6",           label: "Claude Opus 4.6 (legacy)" }
      ]
    }
  };

  const PROVIDER_KEY_FIELD = {
    gemini: "geminiApiKey",
    openai: "openaiApiKey",
    anthropic: "anthropicApiKey"
  };

  const PROVIDER_MODEL_FIELD = {
    gemini: "geminiModel",
    openai: "openaiModel",
    anthropic: "anthropicModel"
  };

  const DEFAULT_MODELS = {
    gemini: "gemini-2.5-flash",
    openai: "gpt-5.5",
    anthropic: "claude-sonnet-4-6"
  };

  function normalizeBackendUrl(value) {
    return String(value || "").trim().replace(/\/+$/, "");
  }

  function normalizeProviderName(value) {
    return PROVIDER_CONFIGS[value] ? value : "gemini";
  }

  function defaultSettings() {
    return {
      backendUrl: "",
      llmProvider: "gemini",
      geminiApiKey: "", openaiApiKey: "", anthropicApiKey: "",
      geminiModel: DEFAULT_MODELS.gemini,
      openaiModel: DEFAULT_MODELS.openai,
      anthropicModel: DEFAULT_MODELS.anthropic,
      privacySettings: null
    };
  }

  function getStorageArea() {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      return chrome.storage.local;
    }
    return null;
  }

  function loadSettings() {
    const storage = getStorageArea();
    const keys = [
      BACKEND_URL_KEY,
      "llmProvider",
      "geminiApiKey",   "openaiApiKey",   "anthropicApiKey",
      "geminiModel",    "openaiModel",    "anthropicModel",
      "privacySettings"
    ];
    if (!storage) return Promise.resolve(defaultSettings());
    return new Promise((resolve) => {
      storage.get(keys, (result) => {
        resolve({
          backendUrl:      normalizeBackendUrl(result[BACKEND_URL_KEY] || ""),
          llmProvider:     normalizeProviderName(result.llmProvider),
          geminiApiKey:    result.geminiApiKey    || "",
          openaiApiKey:    result.openaiApiKey    || "",
          anthropicApiKey: result.anthropicApiKey || "",
          geminiModel:     result.geminiModel     || DEFAULT_MODELS.gemini,
          openaiModel:     result.openaiModel     || DEFAULT_MODELS.openai,
          anthropicModel:  result.anthropicModel  || DEFAULT_MODELS.anthropic,
          privacySettings: result.privacySettings || null
        });
      });
    });
  }

  function saveAiSettings(provider, apiKey, model) {
    const storage = getStorageArea();
    if (!storage) return Promise.resolve();
    const p = normalizeProviderName(provider);
    return new Promise((resolve) => storage.set({
      llmProvider:               p,
      [PROVIDER_KEY_FIELD[p]]:   apiKey,
      [PROVIDER_MODEL_FIELD[p]]: model
    }, resolve));
  }

  function saveBackendUrl(value) {
    const storage = getStorageArea();
    const next = normalizeBackendUrl(value);
    if (!storage) return Promise.resolve(next);
    return new Promise((resolve) => storage.set({ [BACKEND_URL_KEY]: next }, () => resolve(next)));
  }

  function savePrivacySettings(settings) {
    const storage = getStorageArea();
    if (!storage) return Promise.resolve(settings);
    return new Promise((resolve) => storage.set({ privacySettings: settings }, () => resolve(settings)));
  }

  // ---------------------------------------------------------------------------
  // Appearance — Dark / Light / System. Shared so the options page and the
  // injected panel resolve the active theme the same way. Dark is the default.
  // ---------------------------------------------------------------------------

  const APPEARANCE_MODES = ["dark", "light", "system"];

  function defaultAppearanceSettings() {
    return { mode: "dark" };
  }

  function normalizeAppearanceSettings(value) {
    const mode = value && typeof value === "object" ? value.mode : value;
    return { mode: APPEARANCE_MODES.includes(mode) ? mode : "dark" };
  }

  function loadAppearanceSettings() {
    const storage = getStorageArea();
    if (!storage) return Promise.resolve(defaultAppearanceSettings());
    return new Promise((resolve) => {
      storage.get(["appearanceSettings"], (result) => {
        resolve(normalizeAppearanceSettings(result.appearanceSettings));
      });
    });
  }

  function saveAppearanceSettings(value) {
    const storage = getStorageArea();
    const next = normalizeAppearanceSettings(value);
    if (!storage) return Promise.resolve(next);
    return new Promise((resolve) => storage.set({ appearanceSettings: next }, () => resolve(next)));
  }

  function systemPrefersDark() {
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
    return true; // dark default when the platform can't be queried
  }

  // Returns the concrete theme ("light" | "dark") to apply as data-aaw-theme.
  // Pass prefersDark explicitly (e.g. from a media-query event) for determinism.
  function resolveAppearanceTheme(value, prefersDark) {
    const { mode } = normalizeAppearanceSettings(value);
    if (mode === "light") return "light";
    if (mode === "dark") return "dark";
    const dark = typeof prefersDark === "boolean" ? prefersDark : systemPrefersDark();
    return dark ? "dark" : "light";
  }

  // ---------------------------------------------------------------------------
  // Privacy host-list parsing — shared so panel and options agree on format.
  // ---------------------------------------------------------------------------

  function splitPrivacyList(value) {
    return String(value || "")
      .split(/\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function formatHostOverrides(overrides = {}) {
    return Object.keys(overrides || {})
      .sort()
      .map((host) => `${host}=${overrides[host]}`)
      .join("\n");
  }

  function parseHostOverrides(value, normalizeHostRule) {
    const out = {};
    for (const line of splitPrivacyList(value)) {
      const match = line.match(/^(.+?)(?:\s*=\s*|\s+)(auto|ask|local_only)$/);
      if (!match) continue;
      const host = match[1].trim();
      const mode = match[2].trim();
      if (host && typeof normalizeHostRule === "function") {
        const rule = normalizeHostRule(host);
        if (rule) out[rule] = mode;
      } else if (host) {
        out[host] = mode;
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // HTTP-path router. Translates fetch-style path+options into the
  // service-worker message envelope. Used by both the content panel and the
  // options page so they can share local/remote routing logic.
  // ---------------------------------------------------------------------------

  function buildRouteMessage(path, options = {}, deps = {}) {
    const method = (options.method || "GET").toUpperCase();
    const body = options.body ? JSON.parse(options.body) : {};
    const url = new URL(path, "https://aaw.local");
    const pathname = url.pathname;

    if (deps && typeof deps.buildPrivacyMessage === "function") {
      const privacyMessage = deps.buildPrivacyMessage(path, options);
      if (privacyMessage) return privacyMessage;
    }

    if (pathname === "/health") return { type: "HEALTH" };
    if (pathname === "/api/llm/health") return { type: "LLM_HEALTH" };

    if (pathname === "/api/dedupe/candidates") {
      return {
        type: "DEDUPE_CANDIDATES",
        typeFilter: url.searchParams.get("type") || "all",
        includeIgnored: url.searchParams.get("includeIgnored") === "true"
      };
    }
    if (pathname === "/api/dedupe/audit") {
      const limit = parseInt(url.searchParams.get("limit"), 10);
      const offset = parseInt(url.searchParams.get("offset"), 10);
      return {
        type: "DEDUPE_AUDIT",
        limit: Number.isFinite(limit) ? limit : 50,
        offset: Number.isFinite(offset) ? offset : 0
      };
    }
    if (method === "POST" && pathname === "/api/dedupe/preview") {
      const { type: dedupeType, ...payload } = body;
      return { type: "DEDUPE_PREVIEW", ...payload, dedupeType: dedupeType || "" };
    }
    if (method === "POST" && pathname === "/api/dedupe/apply") {
      const { type: dedupeType, ...payload } = body;
      return { type: "DEDUPE_APPLY", ...payload, dedupeType: dedupeType || "" };
    }
    if (method === "POST" && pathname === "/api/dedupe/undo") return { type: "DEDUPE_UNDO", ...body };
    if (method === "POST" && pathname === "/api/dedupe/ignore") {
      const { type: dedupeType, ...payload } = body;
      return { type: "DEDUPE_IGNORE", ...payload, dedupeType: dedupeType || "" };
    }
    if (method === "POST" && pathname === "/api/dedupe/unignore") {
      const { type: dedupeType, ...payload } = body;
      return { type: "DEDUPE_UNIGNORE", ...payload, dedupeType: dedupeType || "" };
    }

    if (pathname === "/api/backup/export") {
      return {
        type: "BACKUP_EXPORT",
        includeEmbeddings: url.searchParams.get("includeEmbeddings") !== "false",
        includeSettings: url.searchParams.get("includeSettings") === "true",
        includeSensitive: url.searchParams.get("includeSensitive") === "true",
        includeAudit: url.searchParams.get("includeAudit") === "true"
      };
    }
    if (method === "POST" && pathname === "/api/backup/validate") return { type: "BACKUP_VALIDATE", ...body };
    if (method === "POST" && pathname === "/api/backup/restore-point") return { type: "BACKUP_RESTORE_POINT", ...body };
    if (method === "POST" && pathname === "/api/backup/import") return { type: "BACKUP_IMPORT", ...body };

    return null;
  }

  function sendLocalMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response && response.error) {
          reject(new Error(response.error));
          return;
        }
        resolve(response);
      });
    });
  }

  const API = {
    BACKEND_URL_KEY,
    PROVIDER_CONFIGS,
    PROVIDER_KEY_FIELD,
    PROVIDER_MODEL_FIELD,
    DEFAULT_MODELS,
    normalizeBackendUrl,
    normalizeProviderName,
    defaultSettings,
    loadSettings,
    saveAiSettings,
    saveBackendUrl,
    savePrivacySettings,
    APPEARANCE_MODES,
    defaultAppearanceSettings,
    normalizeAppearanceSettings,
    loadAppearanceSettings,
    saveAppearanceSettings,
    resolveAppearanceTheme,
    splitPrivacyList,
    formatHostOverrides,
    parseHostOverrides,
    buildRouteMessage,
    sendLocalMessage
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = API;
  }
  if (globalScope) {
    globalScope.AssistantSettings = API;
  }
})(typeof self !== "undefined" ? self : (typeof window !== "undefined" ? window : globalThis));
