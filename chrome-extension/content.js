(function initAssistant() {
  if (window.__assistantAcrossWebsitesLoaded) {
    return;
  }
  window.__assistantAcrossWebsitesLoaded = true;

  // remoteBackendUrl is empty by default = use built-in service worker.
  // If the user sets a URL in Settings, all requests go there instead.
  const BACKEND_URL_KEY = "assistantBackendUrl";
  const selectionTools = window.AssistantSelectionReplacement || {};
  const privacyTools = window.AssistantPrivacy || {};
  const shortcutTools = window.AssistantShortcuts || {};
  const settingsTools = window.AssistantSettings || {};

  // Appearance — resolved theme applied to the panel root as data-aaw-theme.
  // Dark is the default; "system" follows the OS preference live.
  let appearanceMode = "dark";

  function applyPanelTheme() {
    if (!root) return;
    const theme = settingsTools.resolveAppearanceTheme
      ? settingsTools.resolveAppearanceTheme({ mode: appearanceMode })
      : (appearanceMode === "light" ? "light" : "dark");
    root.setAttribute("data-aaw-theme", theme);
  }

  async function loadAppearanceMode() {
    if (settingsTools.loadAppearanceSettings) {
      const settings = await settingsTools.loadAppearanceSettings();
      appearanceMode = settings.mode;
    }
  }

  // Provider configs — defines the dropdown options and key placeholder for each LLM.
  const PROVIDER_CONFIGS = {
    gemini: {
      label:          "Google Gemini",
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
      label:          "OpenAI",
      keyPlaceholder: "sk-…",
      models: [
        { value: "gpt-5.5",      label: "GPT-5.5 (recommended)" },
        { value: "gpt-5.4",      label: "GPT-5.4" },
        { value: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
        { value: "gpt-5.4-nano", label: "GPT-5.4 Nano" }
      ]
    },
    anthropic: {
      label:          "Anthropic Claude",
      keyPlaceholder: "sk-ant-…",
      models: [
        { value: "claude-sonnet-4-6",        label: "Claude Sonnet 4.6 (recommended)" },
        { value: "claude-opus-4-7",          label: "Claude Opus 4.7" },
        { value: "claude-haiku-4-5-20251001",label: "Claude Haiku 4.5" },
        { value: "claude-opus-4-6",          label: "Claude Opus 4.6 (legacy)" }
      ]
    }
  };
  const LEAD_STATUS_OPTIONS = [
    { value: "new", label: "New" },
    { value: "contacted", label: "Contacted" },
    { value: "qualified", label: "Qualified" },
    { value: "disqualified", label: "Disqualified" },
    { value: "archived", label: "Archived" }
  ];

  let root = null;
  let resultArea = null;
  let resultProvenance = null;
  let actionStatus = null;
  let searchInput = null;
  let searchStatus = null;
  let searchResults = null;
  let searchRequestSeq = 0;
  let searchDebounceTimer = null;
  let lastExtractResult = null;
  let lastPrivacyMeta = null;
  let rewriteGoal = "clearer";
  let rewriteStatus = null;
  let rewritePreview = null;
  let rewriteUndoButton = null;
  let rewriteCopyButton = null;
  let rewriteSnapshot = null;
  let rewriteUndo = null;
  let rewriteControls = null;
  let sourceHint = null;
  let resultCopyFeedback = null;
  let resultStatusChip = null;
  let resultExpandButton = null;
  let resultCopyButton = null;
  let resultClearButton = null;
  let resultExpanded = false;
  let searchClearButton = null;
  let privacyProvenanceList = null;
  let privacyStatusLine = null;
  let noteInput = null;
  let instructionInput = null;
  let pagePreviewTitle = null;
  let pagePreviewMeta = null;
  let pageMemoryList = null;
  let activeWorkspaceSelect = null;
  let workspaceCreatePanel = null;
  let workspaceCreateToggle = null;
  let workspaceStatus = null;
  let workspaceList = null;
  let workspaceDashboard = null;
  let workspaceNotes = null;
  let workspaceCache = [];
  let selectedWorkspaceId = "unassigned";
  let workspaceDashboardTab = "notes";
  let workspaceDashboardData = null;
  let leadDrafts = [];
  let leadDraftList = null;
  let leadStatus = null;
  let leadSaveMemoryCheckbox = null;
  let contactSearchInput = null;
  let contactStatusSelect = null;
  let contactList = null;
  let contactSearchDebounce = null;
  let contactOffset = 0;
  let contactTotal = 0;
  let contactListRequestId = 0;
  let contactPageInfo = null;
  let btnContactPrev = null;
  let btnContactNext = null;
  let lastSavedContext = null;
  let taskTitleInput = null;
  let taskDueInput = null;
  let taskPrioritySelect = null;
  let taskNotesInput = null;
  let taskStatus = null;
  let taskList = null;
  let taskFilter = "open";
  let taskListRequestId = 0;
  let taskTabButtonsRef = [];
  let contextDrawer = null;
  let contextDrawerBody = null;
  let contextDrawerTitle = null;
  let contextDrawerStatus = null;
  let dedupeTypeSelect = null;
  let dedupeIncludeIgnoredInput = null;
  let dedupeCandidateList = null;
  let dedupeAuditList = null;
  let dedupeStatusLine = null;
  let backupTextArea = null;
  let backupStatusLine = null;
  let backupIncludeEmbeddingsInput = null;
  let backupIncludeSettingsInput = null;
  let backupIncludeAuditInput = null;
  let backupRestorePointId = "";
  let commandPalette = null;
  let commandPaletteInput = null;
  let commandPaletteList = null;
  let commandPaletteStatus = null;
  let commandPalettePreviousFocus = null;
  let commandPaletteActiveIndex = 0;
  let commandPaletteMatches = [];
  let commandRegistry = [];
  let commandById = new Map();
  let shortcutSequence = null;
  let btnDraftTaskRef = null;
  let btnCreateTaskRef = null;

  // "" = built-in service worker mode; any URL = remote backend mode
  let remoteBackendUrl = "";

  // Button refs for disabling during in-flight requests
  let btnSummarize = null;
  let btnRewrite = null;
  let btnExtract = null;
  let btnSaveMemory = null;
  let btnRunAction = null;
  let btnCaptureLead = null;
  let actionTypeSelect = null; // holds createDropdown instance after buildPanel

  // Custom dropdown coordination — shared across all instances in this panel.
  let _ddCurrentOpen   = null;  // closureRef of whichever dropdown is open
  let _ddListenerReady = false; // capture-phase doc listener registered once
  let _ddUidSeq        = 0;     // monotonic id source for dynamically built dropdowns

  // Panel container + shared UI refs (settings live in the full-tab options page).
  let _viewMain      = null;
  let _liveRegion    = null;
  let _panelSettingsStatusEl = null;

  // Style the host page's scrollbar to match the panel's dark theme so it
  // blends into the panel's right edge instead of appearing as a light strip.
  function _applyHostScrollbarStyle() {
    if (document.getElementById("aaw-sb-style")) return;
    const s = document.createElement("style");
    s.id = "aaw-sb-style";
    // Use the same token values as --aaw-bg and --aaw-border-input.
    s.textContent = [
      "html::-webkit-scrollbar { background: #1a1a1f; }",
      "html::-webkit-scrollbar-track { background: #1a1a1f; }",
      "html::-webkit-scrollbar-thumb { background: #444452; border-radius: 2px; }",
      "html { scrollbar-color: #444452 #1a1a1f; scrollbar-width: thin; }"
    ].join("\n");
    (document.head || document.documentElement).appendChild(s);
  }

  function _removeHostScrollbarStyle() {
    const s = document.getElementById("aaw-sb-style");
    if (s) s.remove();
  }

  function _openPanel() {
    _applyHostScrollbarStyle();
    root.classList.remove("aaw-hidden");
  }

  function _closePanel() {
    closeContextDrawer();
    root.classList.add("aaw-hidden");
    _removeHostScrollbarStyle();
  }

  function debounce(fn, ms) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  function normalizeUrl(value) {
    return String(value || "").trim().replace(/\/+$/, "");
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
    if (!storage) {
      return Promise.resolve({
        backendUrl: "", llmProvider: "gemini",
        geminiApiKey: "", openaiApiKey: "", anthropicApiKey: "",
        geminiModel: "gemini-2.5-flash", openaiModel: "gpt-5.5",
        anthropicModel: "claude-sonnet-4-6",
        privacySettings: privacyTools.defaultPrivacySettings ? privacyTools.defaultPrivacySettings() : {}
      });
    }
    return new Promise((resolve) => {
      storage.get(keys, (result) => {
        resolve({
          backendUrl:     normalizeUrl(result[BACKEND_URL_KEY] || ""),
          llmProvider:    result.llmProvider    || "gemini",
          geminiApiKey:   result.geminiApiKey   || "",
          openaiApiKey:   result.openaiApiKey   || "",
          anthropicApiKey:result.anthropicApiKey|| "",
          geminiModel:    result.geminiModel    || "gemini-2.5-flash",
          openaiModel:    result.openaiModel    || "gpt-5.5",
          anthropicModel: result.anthropicModel || "claude-sonnet-4-6",
          privacySettings: privacyTools.normalizePrivacySettings
            ? privacyTools.normalizePrivacySettings(result.privacySettings)
            : (result.privacySettings || {})
        });
      });
    });
  }

  function savePrivacySettingsLocal(settings) {
    const storage = getStorageArea();
    if (!storage) return Promise.resolve(settings);
    return new Promise((resolve) => storage.set({ privacySettings: settings }, () => resolve(settings)));
  }

  function isLocalMode() {
    return !remoteBackendUrl;
  }

  function openOptionsPage() {
    // chrome.runtime.openOptionsPage is unavailable in content scripts, so we
    // delegate to the service worker via runtime messaging.
    try {
      chrome.runtime.sendMessage({ type: "OPEN_OPTIONS" }, () => {
        if (chrome.runtime.lastError) {
          console.warn("[aaw] openOptionsPage failed:", chrome.runtime.lastError.message);
        }
      });
    } catch (err) {
      console.warn("[aaw] openOptionsPage threw:", err && err.message);
    }
  }

  function renderNotesFolderHint(el, folderName, mirrorStatus = null) {
    if (!el) return;
    const base = folderName
      ? `Current folder: ${folderName}`
      : "Not set — click Configure to choose a folder.";
    if (!folderName || !mirrorStatus || typeof mirrorStatus !== "object") {
      el.textContent = base;
      return;
    }
    if (mirrorStatus.state === "synced" && mirrorStatus.lastSyncAt) {
      const counts = mirrorStatus.counts && typeof mirrorStatus.counts === "object" ? mirrorStatus.counts : {};
      el.textContent = `${base}. Last sync: ${new Date(mirrorStatus.lastSyncAt).toLocaleString()} (${counts.files || 0} files).`;
      return;
    }
    if (mirrorStatus.state === "error" && mirrorStatus.lastError) {
      el.textContent = `${base}. Last sync error: ${mirrorStatus.lastError}`;
      return;
    }
    if (mirrorStatus.state === "permission_prompt" || mirrorStatus.state === "permission_required") {
      el.textContent = `${base}. Permission required in Options.`;
      return;
    }
    el.textContent = base;
  }

  function refreshNotesFolderHint(el) {
    const storage = getStorageArea();
    if (!storage) {
      renderNotesFolderHint(el, "");
      return;
    }
    storage.get(["notesFolderName", "notesMirrorStatus"], (res) => {
      renderNotesFolderHint(el, res.notesFolderName || "", res.notesMirrorStatus || null);
    });
  }

  // Render a labeled status card row (reuses the health-card/row styling).
  function panelStatusRow(label, value) {
    const row = document.createElement("div");
    row.className = "aaw-health-row";
    const labelEl = document.createElement("span");
    labelEl.textContent = label;
    const valueEl = document.createElement("strong");
    valueEl.textContent = value;
    row.appendChild(labelEl);
    row.appendChild(valueEl);
    return row;
  }

  function refreshPanelSettingsStatus() {
    if (!_panelSettingsStatusEl) return;
    const storage = getStorageArea();
    if (!storage) {
      _panelSettingsStatusEl.textContent = "Settings unavailable (no storage).";
      return;
    }
    storage.get([
      "assistantBackendUrl",
      "llmProvider",
      "geminiApiKey", "openaiApiKey", "anthropicApiKey",
      "geminiModel", "openaiModel", "anthropicModel",
      "privacySettings",
      "notesFolderName", "notesMirrorStatus"
    ], (res) => {
      if (!_panelSettingsStatusEl) return;
      const backend = res.assistantBackendUrl ? `Remote (${res.assistantBackendUrl})` : "Built-in";
      const provider = res.llmProvider || "gemini";
      const keyMap = { gemini: res.geminiApiKey, openai: res.openaiApiKey, anthropic: res.anthropicApiKey };
      const modelMap = { gemini: res.geminiModel, openai: res.openaiModel, anthropic: res.anthropicModel };
      const hasKey = Boolean(keyMap[provider]);
      const model = modelMap[provider] || "default";
      const privacyMode = (res.privacySettings && res.privacySettings.aiMode) || "auto";
      const privacyLabel = privacyMode === "local_only" ? "Local" : privacyMode === "ask" ? "Ask" : "Auto";
      const notes = res.notesFolderName ? res.notesFolderName : "Not configured";

      // Replace the dense status sentence with a compact labeled status card.
      const card = document.createElement("div");
      card.className = "aaw-health-card aaw-settings-status-card";
      card.appendChild(panelStatusRow("Mode", backend));
      card.appendChild(panelStatusRow("Provider", hasKey ? provider : `${provider} (no key)`));
      card.appendChild(panelStatusRow("Model", model));
      card.appendChild(panelStatusRow("Privacy", privacyLabel));
      card.appendChild(panelStatusRow("Notes", notes));
      _panelSettingsStatusEl.textContent = "";
      _panelSettingsStatusEl.appendChild(card);
    });
  }

  function getPageText() {
    return getReadablePageSnapshot().content;
  }

  function getSelectedText() {
    const active = document.activeElement;
    if (
      active &&
      !root?.contains(active) &&
      selectionTools.snapshotFormControlSelection &&
      typeof active.selectionStart === "number" &&
      typeof active.selectionEnd === "number" &&
      active.selectionEnd > active.selectionStart
    ) {
      const snapshot = selectionTools.snapshotFormControlSelection(active);
      return snapshot && snapshot.ok ? snapshot.metadata.selectedText : "";
    }
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return "";
    const anchor = selection.anchorNode;
    const focus = selection.focusNode;
    if (
      root &&
      ((anchor && root.contains(anchor.nodeType === Node.ELEMENT_NODE ? anchor : anchor.parentNode)) ||
       (focus && root.contains(focus.nodeType === Node.ELEMENT_NODE ? focus : focus.parentNode)))
    ) {
      return "";
    }
    return String(selection).trim();
  }

  function captureRewriteSnapshot() {
    const active = document.activeElement;
    if (
      active &&
      !root?.contains(active) &&
      selectionTools.snapshotFormControlSelection &&
      typeof active.selectionStart === "number" &&
      typeof active.selectionEnd === "number" &&
      active.selectionEnd > active.selectionStart
    ) {
      return selectionTools.snapshotFormControlSelection(active);
    }
    return selectionTools.snapshotSelection
      ? selectionTools.snapshotSelection(window.getSelection())
      : null;
  }

  function selectedSourceType() {
    return getSelectedText() ? "selection" : "page";
  }

  function readableRoot() {
    const selectors = [
      "article",
      "main",
      "[role='main']",
      ".article",
      ".post",
      ".entry-content",
      ".markdown-body",
      ".doc-content"
    ];
    for (const selector of selectors) {
      const candidate = document.querySelector(selector);
      if (candidate && candidate.innerText && candidate.innerText.trim().length > 200) return candidate;
    }
    return document.body;
  }

  function textFromClone(source) {
    if (!source) return "";
    const clone = source.cloneNode(true);
    clone.querySelectorAll("script,style,noscript,nav,header,footer,aside,form,button,svg,iframe").forEach((node) => node.remove());
    clone.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li,blockquote,pre").forEach((node) => {
      node.appendChild(document.createTextNode("\n"));
    });
    return (clone.textContent || "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function getReadablePageSnapshot() {
    const source = readableRoot();
    const raw = textFromClone(source);
    const normalized = raw.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    return {
      content: normalized.slice(0, 20000),
      originalCharCount: normalized.length,
      submittedCharCount: Math.min(normalized.length, 20000)
    };
  }

  function safeAbsoluteUrl(value) {
    try {
      const url = new URL(value, location.href);
      if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:" || url.protocol === "tel:") {
        return url.toString();
      }
    } catch {
      return "";
    }
    return "";
  }

  function collectPageMeta() {
    const canonical = document.querySelector('link[rel="canonical"]');
    const description = document.querySelector('meta[name="description"], meta[property="og:description"]');
    const titleMeta = document.querySelector('meta[property="og:title"], meta[name="twitter:title"]');
    const openGraphDates = Array.from(document.querySelectorAll('meta[property*="date"], meta[property*="time"], meta[name*="date"], meta[name*="time"]'))
      .map((node) => node.content || "")
      .filter(Boolean)
      .slice(0, 12);
    const timeDatetimes = Array.from(document.querySelectorAll("time[datetime]"))
      .map((node) => node.getAttribute("datetime") || "")
      .filter(Boolean)
      .slice(0, 20);
    const links = Array.from(document.querySelectorAll("a[href]"))
      .map((anchor) => ({
        text: (anchor.innerText || anchor.textContent || anchor.href || "").trim().slice(0, 160),
        url: safeAbsoluteUrl(anchor.getAttribute("href")),
        type: anchor.href.startsWith("mailto:") ? "email" : (anchor.href.startsWith("tel:") ? "phone" : "page"),
        context: (anchor.closest("p,li,section,article")?.innerText || "").trim().slice(0, 240)
      }))
      .filter((link) => link.url)
      .slice(0, 60);
    const jsonLdTypes = [];
    const jsonLd = [];
    const people = [];
    const organizations = [];
    for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]')).slice(0, 6)) {
      try {
        const parsed = JSON.parse(script.textContent || "{}");
        jsonLd.push(parsed);
        const items = Array.isArray(parsed) ? parsed : [parsed];
        const visit = (item) => {
          if (!item || typeof item !== "object") return;
          if (Array.isArray(item)) {
            item.forEach(visit);
            return;
          }
          const type = item["@type"];
          const typeText = String(Array.isArray(type) ? type.join(",") : type || "");
          if (type) jsonLdTypes.push(typeText.slice(0, 80));
          if (item.name && /person|profilepage/i.test(typeText)) people.push(String(item.name).slice(0, 120));
          if (item.name && /organization|company|corporation|localbusiness/i.test(typeText)) organizations.push(String(item.name).slice(0, 120));
          for (const child of Object.values(item)) {
            if (child && typeof child === "object") visit(child);
          }
        };
        for (const item of items) visit(item);
      } catch {
        // Ignore invalid JSON-LD.
      }
    }
    const mailto = links
      .filter((link) => /^mailto:/i.test(link.url))
      .map((link) => link.url.replace(/^mailto:/i, "").split("?")[0])
      .filter(Boolean);
    const tel = links
      .filter((link) => /^tel:/i.test(link.url))
      .map((link) => link.url.replace(/^tel:/i, "").split("?")[0])
      .filter(Boolean);
    const headings = Array.from(document.querySelectorAll("h1,h2,h3"))
      .map((node) => (node.innerText || node.textContent || "").trim().replace(/\s+/g, " ").slice(0, 120))
      .filter(Boolean)
      .slice(0, 24);
    return {
      canonicalUrl: canonical && canonical.href ? canonical.href : location.href,
      sourceTitle: titleMeta && titleMeta.content ? titleMeta.content : document.title,
      metaDescription: description && description.content ? description.content : "",
      openGraphDates,
      timeDatetimes,
      mailto: Array.from(new Set(mailto)).slice(0, 20),
      tel: Array.from(new Set(tel)).slice(0, 20),
      people: Array.from(new Set(people)).slice(0, 20),
      jsonLdTypes: Array.from(new Set(jsonLdTypes)).slice(0, 20),
      organizations: Array.from(new Set(organizations)).slice(0, 20),
      headings: Array.from(new Set(headings)).slice(0, 24),
      jsonLd: jsonLd.slice(0, 6),
      pageKind: /linkedin\.com\/in\//i.test(location.href) ? "linkedin_profile" : (/linkedin\.com\/company\//i.test(location.href) ? "linkedin_company" : "webpage"),
      links
    };
  }

  function normalizeSourceUrl(value) {
    if (typeof value !== "string" || !value.trim()) return "";
    try {
      const url = new URL(value.trim());
      if (url.protocol !== "http:" && url.protocol !== "https:") return "";
      url.hostname = url.hostname.toLowerCase();
      if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) {
        url.port = "";
      }
      for (const key of [...url.searchParams.keys()]) {
        if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) url.searchParams.delete(key);
      }
      return url.toString();
    } catch {
      return "";
    }
  }

  function urlKeyFor(value) {
    const normalized = normalizeSourceUrl(value);
    if (!normalized) return "";
    const url = new URL(normalized);
    url.hash = "";
    return url.toString();
  }

  function currentPageUrlKey() {
    return urlKeyFor(location.href);
  }

  function currentPageHost() {
    try {
      return location.hostname || "";
    } catch {
      return "";
    }
  }

  function memoryMatchesCurrentPage(item) {
    const currentKey = currentPageUrlKey();
    if (!currentKey) return false;
    return (item.urlKey || urlKeyFor(item.sourceUrl || item.canonicalUrl)) === currentKey;
  }

  function updatePagePreview() {
    if (!pagePreviewTitle || !pagePreviewMeta) return;
    const selection = getSelectedText();
    pagePreviewTitle.textContent = document.title || "Untitled page";
    const sourceLabel = selection
      ? `Selected text (${selection.length.toLocaleString()} chars)`
      : "Full page";
    const host = currentPageHost();
    pagePreviewMeta.textContent = `${host || "Current page"} • ${sourceLabel}`;
  }

  function setResultState(state, label) {
    const safeState = ["ready", "working", "done", "error"].includes(state) ? state : "ready";
    if (resultStatusChip) {
      resultStatusChip.className = `aaw-result-chip aaw-result-chip--${safeState}`;
      resultStatusChip.textContent = label || safeState[0].toUpperCase() + safeState.slice(1);
    }
    if (resultArea) {
      resultArea.setAttribute("data-state", safeState);
      resultArea.setAttribute("aria-busy", String(safeState === "working"));
      if (resultArea.parentElement && resultArea.parentElement.classList.contains("aaw-result-wrap")) {
        resultArea.parentElement.setAttribute("data-state", safeState);
      }
    }
    refreshResultControls();
  }

  function sanitizePrivacyMeta(meta) {
    if (!meta) return null;
    return privacyTools.sanitizeProvenance ? privacyTools.sanitizeProvenance(meta) : meta;
  }

  function privacyDestinationLabel(meta = {}) {
    if (meta.sentToProvider) return [meta.provider || "Provider", meta.model].filter(Boolean).join(" ");
    if (meta.sentToBackend) return "Remote backend";
    return "Local only";
  }

  function privacyRedactionSummary(counts = {}) {
    const parts = [];
    if (counts.emails) parts.push(`${counts.emails} email${counts.emails === 1 ? "" : "s"}`);
    if (counts.phones) parts.push(`${counts.phones} phone${counts.phones === 1 ? "" : "s"}`);
    if (counts.secrets) parts.push(`${counts.secrets} secret${counts.secrets === 1 ? "" : "s"}`);
    return parts.length ? `Redacted ${parts.join(", ")}` : "No redactions";
  }

  function privacySummaryLabel(meta) {
    const m = sanitizePrivacyMeta(meta);
    if (!m) return "";
    return [
      privacyDestinationLabel(m),
      m.effectiveAiMode ? `Mode ${m.effectiveAiMode}` : "",
      m.contentSource || "",
      `${m.submittedCharCount || 0}/${m.originalCharCount || 0} chars`,
      privacyRedactionSummary(m.redactionCounts)
    ].filter(Boolean).join(" • ");
  }

  function makeProvenanceBadge(meta) {
    const label = privacySummaryLabel(meta);
    if (!label) return null;
    const badge = document.createElement("span");
    badge.className = "aaw-provenance-badge";
    badge.textContent = label;
    return badge;
  }

  function appendProvenanceBadge(parent, meta) {
    const badge = makeProvenanceBadge(meta);
    if (badge) parent.appendChild(badge);
  }

  function setResultProvenance(meta) {
    lastPrivacyMeta = sanitizePrivacyMeta(meta);
    if (!resultProvenance) return;
    resultProvenance.textContent = "";
    appendProvenanceBadge(resultProvenance, lastPrivacyMeta);
    resultProvenance.hidden = !lastPrivacyMeta;
    if (lastPrivacyMeta && privacyProvenanceList) {
      refreshPrivacyEvents(privacyProvenanceList, privacyStatusLine).catch(() => {});
    }
  }

  function activeProviderModelLabel(settings) {
    const provider = settings && settings.llmProvider || "gemini";
    const model = {
      gemini: settings && settings.geminiModel,
      openai: settings && settings.openaiModel,
      anthropic: settings && settings.anthropicModel
    }[provider] || (PROVIDER_CONFIGS[provider] && PROVIDER_CONFIGS[provider].models[0] && PROVIDER_CONFIGS[provider].models[0].value) || "";
    const providerLabel = (PROVIDER_CONFIGS[provider] || {}).label || provider;
    return [providerLabel, model].filter(Boolean).join(" ");
  }

  function privacyConfirmMessage(decision, settings) {
    const destination = decision.requiresConfirmation
      ? (isLocalMode() ? activeProviderModelLabel(settings) : "Remote backend")
      : (decision.allowBackendAi ? (isLocalMode() ? "Built-in provider" : "Remote backend") : "Local only");
    return [
      "Send page content for AI processing?",
      "",
      `Destination: ${destination}`,
      `Source: ${decision.contentSource || "page"}`,
      `Characters: ${decision.submittedCharCount}/${decision.originalCharCount}`,
      privacyRedactionSummary(decision.redactionCounts),
      `Rule: ${decision.siteRule || "global"}`
    ].join("\n");
  }

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

  function parseHostOverrides(value) {
    const out = {};
    for (const line of splitPrivacyList(value)) {
      const match = line.match(/^(.+?)(?:\s*=\s*|\s+)(auto|ask|local_only)$/);
      if (!match) continue;
      const host = match[1].trim();
      const mode = match[2].trim();
      if (host && privacyTools.normalizeHostRule) {
        const rule = privacyTools.normalizeHostRule(host);
        if (rule) out[rule] = mode;
      } else if (host) {
        out[host] = mode;
      }
    }
    return out;
  }

  function numberInput(id, value, testId) {
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.step = "1";
    input.id = id;
    input.value = String(Number.isFinite(Number(value)) ? Number(value) : 0);
    if (testId) input.setAttribute("data-aaw-test", testId);
    return input;
  }

  function intInputValue(input) {
    const n = Number(input && input.value);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  }

  function checkboxRow(text, checked, testId) {
    const label = document.createElement("label");
    label.className = "aaw-checkbox-row";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = Boolean(checked);
    if (testId) input.setAttribute("data-aaw-test", testId);
    label.appendChild(input);
    const span = document.createElement("span");
    span.textContent = text;
    label.appendChild(span);
    return { label, input };
  }

  function renderPrivacyEvents(container, events = []) {
    if (!container) return;
    container.textContent = "";
    if (!events.length) {
      container.textContent = "No provenance events yet.";
      return;
    }
    for (const event of events.slice(0, 8)) {
      const row = document.createElement("div");
      row.className = "aaw-privacy-event";
      const time = event.timestamp ? new Date(event.timestamp).toLocaleString() : "";
      row.textContent = [
        event.operation || "operation",
        privacyDestinationLabel(event),
        time
      ].filter(Boolean).join(" • ");
      appendProvenanceBadge(row, event);
      container.appendChild(row);
    }
  }

  async function refreshPrivacyEvents(container, statusEl) {
    if (!container) return;
    container.textContent = "Loading…";
    try {
      const data = await request("/api/privacy/provenance?limit=8&offset=0", { method: "GET" });
      let events = Array.isArray(data.events) ? data.events : [];
      if (!isLocalMode()) {
        try {
          const local = await sendLocalMessage({ type: "PRIVACY_PROVENANCE_LIST", limit: 8, offset: 0 });
          events = events.concat(Array.isArray(local && local.events) ? local.events : []);
        } catch {
          /* Remote settings view can still show backend provenance. */
        }
      }
      events.sort((a, b) => Date.parse(b.timestamp || 0) - Date.parse(a.timestamp || 0));
      renderPrivacyEvents(container, events.slice(0, 8));
      if (statusEl) statusEl.textContent = "";
    } catch (error) {
      container.textContent = "Provenance unavailable.";
      if (statusEl) statusEl.textContent = `Provenance failed: ${error.message}`;
    }
  }

  function dedupeLabel(value) {
    return String(value || "item").replace(/_/g, " ");
  }

  function setDedupeStatus(message) {
    if (dedupeStatusLine) dedupeStatusLine.textContent = message || "";
  }

  function dedupeTypeParam() {
    return dedupeTypeSelect ? dedupeTypeSelect.value : "all";
  }

  function dedupeIncludeIgnored() {
    return Boolean(dedupeIncludeIgnoredInput && dedupeIncludeIgnoredInput.checked);
  }

  function appendDedupeMeta(parent, meta = {}) {
    const values = [];
    for (const key of ["email", "phone", "company", "status", "priority", "dueDate", "sourceUrl", "urlKey"]) {
      if (meta[key]) values.push(String(meta[key]));
    }
    if (!values.length && meta.recordCount) values.push(`${meta.recordCount} linked records`);
    if (!values.length) return;
    const el = document.createElement("div");
    el.className = "aaw-dedupe-meta";
    el.textContent = values.slice(0, 4).join(" • ");
    parent.appendChild(el);
  }

  function renderDedupePreviewRecord(record = {}) {
    const row = document.createElement("div");
    row.className = "aaw-dedupe-record";
    const title = document.createElement("div");
    title.className = "aaw-dedupe-record-title";
    title.textContent = record.label || record.id || "Record";
    const summary = document.createElement("div");
    summary.className = "aaw-dedupe-record-summary";
    summary.textContent = record.summary || "No preview text.";
    row.appendChild(title);
    row.appendChild(summary);
    appendDedupeMeta(row, record.meta || {});
    return row;
  }

  async function renderDedupeAudit() {
    if (!dedupeAuditList) return;
    dedupeAuditList.textContent = "Loading audit…";
    try {
      const data = await request("/api/dedupe/audit?limit=10&offset=0", { method: "GET" });
      const items = Array.isArray(data.items) ? data.items : [];
      dedupeAuditList.textContent = "";
      if (!items.length) {
        dedupeAuditList.textContent = "No merge audit records yet.";
        return;
      }
      for (const item of items) {
        const row = document.createElement("div");
        row.className = "aaw-dedupe-audit-row";
        const text = document.createElement("div");
        text.className = "aaw-dedupe-audit-text";
        const time = item.createdAt ? new Date(item.createdAt).toLocaleString() : "";
        text.textContent = [
          `${dedupeLabel(item.type)} merge`,
          `${(item.duplicateIds || []).length} duplicate${(item.duplicateIds || []).length === 1 ? "" : "s"}`,
          time,
          item.undoneAt ? "undone" : ""
        ].filter(Boolean).join(" • ");
        row.appendChild(text);
        if (item.undoable) {
          const undo = createButton("Undo", async () => {
            undo.disabled = true;
            try {
              await request("/api/dedupe/undo", { method: "POST", body: JSON.stringify({ auditId: item.id }) });
              await refreshDedupeCandidates({ statusMessage: "Merge undone." });
            } catch (error) {
              setDedupeStatus(`Undo failed: ${error.message}`);
              undo.disabled = false;
            }
          }, "ghost");
          row.appendChild(undo);
        }
        dedupeAuditList.appendChild(row);
      }
    } catch (error) {
      dedupeAuditList.textContent = "Audit unavailable.";
      setDedupeStatus(`Audit failed: ${error.message}`);
    }
  }

  async function previewDedupeGroup(group, card) {
    const detail = card.querySelector(".aaw-dedupe-detail");
    if (!detail) return;
    detail.textContent = "Building preview…";
    try {
      const data = await request("/api/dedupe/preview", {
        method: "POST",
        body: JSON.stringify({ groupId: group.groupId, type: group.type })
      });
      const plan = data.plan;
      if (!plan) throw new Error("Preview was empty.");
      detail.textContent = "";
      const operations = document.createElement("div");
      operations.className = "aaw-dedupe-operations";
      operations.textContent = (plan.operations || []).map((op) => op.description || `${op.action}${op.id ? ` ${op.id}` : ""}`).join(" • ");
      detail.appendChild(operations);
      const planMeta = document.createElement("div");
      planMeta.className = "aaw-dedupe-meta";
      planMeta.textContent = `Keep ${plan.primaryId}. Plan ${plan.planHash}.`;
      detail.appendChild(planMeta);
      const actions = document.createElement("div");
      actions.className = "aaw-actions";
      const apply = createButton("Apply Merge", async () => {
        apply.disabled = true;
        try {
          await request("/api/dedupe/apply", {
            method: "POST",
            body: JSON.stringify({ groupId: plan.groupId, type: plan.type, primaryId: plan.primaryId, planHash: plan.planHash })
          });
          await Promise.all([
            refreshDedupeCandidates({ statusMessage: "Duplicate group merged." }),
            refreshPageMemoryList(),
            refreshContactList(),
            refreshTaskList()
          ]);
        } catch (error) {
          setDedupeStatus(`Merge failed: ${error.message}`);
          apply.disabled = false;
        }
      }, "accent");
      apply.disabled = !plan.mergeable;
      actions.appendChild(apply);
      detail.appendChild(actions);
    } catch (error) {
      detail.textContent = `Preview failed: ${error.message}`;
    }
  }

  function renderDedupeCandidate(group) {
    const card = document.createElement("div");
    card.className = "aaw-dedupe-card";
    card.setAttribute("data-aaw-test", "dedupe-candidate");

    const header = document.createElement("div");
    header.className = "aaw-dedupe-card-head";
    const title = document.createElement("div");
    title.className = "aaw-dedupe-title";
    title.textContent = `${dedupeLabel(group.type)} duplicates`;
    const meta = document.createElement("div");
    meta.className = "aaw-dedupe-meta";
    meta.textContent = [
      group.reason,
      `${(group.itemIds || []).length} records`,
      group.ignored ? "ignored" : ""
    ].filter(Boolean).join(" • ");
    header.appendChild(title);
    header.appendChild(meta);
    card.appendChild(header);

    const records = document.createElement("div");
    records.className = "aaw-dedupe-records";
    for (const record of (group.preview || []).slice(0, 4)) {
      records.appendChild(renderDedupePreviewRecord(record));
    }
    card.appendChild(records);

    const actions = document.createElement("div");
    actions.className = "aaw-actions";
    const preview = createButton(group.mergeable ? "Preview Merge" : "Review", () => previewDedupeGroup(group, card), "ghost");
    actions.appendChild(preview);
    if (group.ignored) {
      actions.appendChild(createButton("Unignore", async () => {
        try {
          await request("/api/dedupe/unignore", { method: "POST", body: JSON.stringify({ groupId: group.groupId }) });
          await refreshDedupeCandidates({ statusMessage: "Duplicate group restored." });
        } catch (error) {
          setDedupeStatus(`Unignore failed: ${error.message}`);
        }
      }, "ghost"));
    } else {
      actions.appendChild(createButton("Ignore", async () => {
        try {
          await request("/api/dedupe/ignore", { method: "POST", body: JSON.stringify({ groupId: group.groupId, type: group.type }) });
          await refreshDedupeCandidates({ statusMessage: "Duplicate group ignored." });
        } catch (error) {
          setDedupeStatus(`Ignore failed: ${error.message}`);
        }
      }, "ghost"));
    }
    card.appendChild(actions);

    const detail = document.createElement("div");
    detail.className = "aaw-dedupe-detail";
    card.appendChild(detail);
    return card;
  }

  async function refreshDedupeCandidates(options = {}) {
    if (!dedupeCandidateList) return;
    const finalStatus = options && typeof options === "object" && typeof options.statusMessage === "string"
      ? options.statusMessage
      : "";
    dedupeCandidateList.textContent = "Scanning duplicates…";
    setDedupeStatus("Scanning saved data.");
    try {
      const params = new URLSearchParams({
        type: dedupeTypeParam(),
        includeIgnored: dedupeIncludeIgnored() ? "true" : "false"
      });
      const data = await request(`/api/dedupe/candidates?${params.toString()}`, { method: "GET" });
      const candidates = Array.isArray(data.candidates) ? data.candidates : [];
      dedupeCandidateList.textContent = "";
      if (!candidates.length) {
        dedupeCandidateList.textContent = dedupeIncludeIgnored() ? "No duplicate groups found." : "No active duplicate groups found.";
      } else {
        for (const group of candidates) dedupeCandidateList.appendChild(renderDedupeCandidate(group));
      }
      const ignoredCount = Array.isArray(data.ignored) ? data.ignored.length : 0;
      setDedupeStatus(finalStatus || `${candidates.length} group${candidates.length === 1 ? "" : "s"} shown. ${ignoredCount} ignored.`);
      await renderDedupeAudit();
    } catch (error) {
      dedupeCandidateList.textContent = "Duplicate scan failed.";
      setDedupeStatus(`Duplicate scan failed: ${error.message}`);
    }
  }

  function setBackupStatus(message) {
    if (backupStatusLine) backupStatusLine.textContent = message || "";
  }

  function backupOptionsQuery() {
    const params = new URLSearchParams({
      includeEmbeddings: backupIncludeEmbeddingsInput && backupIncludeEmbeddingsInput.checked ? "true" : "false",
      includeSettings: backupIncludeSettingsInput && backupIncludeSettingsInput.checked ? "true" : "false",
      includeAudit: backupIncludeAuditInput && backupIncludeAuditInput.checked ? "true" : "false",
      includeSensitive: "false"
    });
    return params.toString();
  }

  function parseBackupText() {
    if (!backupTextArea) throw new Error("Backup editor is unavailable.");
    const text = backupTextArea.value.trim();
    if (!text) throw new Error("Paste or export backup JSON first.");
    return JSON.parse(text);
  }

  async function exportBackupToEditor() {
    try {
      setBackupStatus("Exporting backup…");
      const backup = await request(`/api/backup/export?${backupOptionsQuery()}`, { method: "GET" });
      if (backupTextArea) backupTextArea.value = JSON.stringify(backup, null, 2);
      backupRestorePointId = "";
      setBackupStatus(`Exported ${backup.sections && backup.sections.memory ? backup.sections.memory.items.length : 0} notes.`);
    } catch (error) {
      setBackupStatus(`Export failed: ${error.message}`);
    }
  }

  async function validateBackupEditor() {
    try {
      const backup = parseBackupText();
      const result = await request("/api/backup/validate", { method: "POST", body: JSON.stringify({ backup }) });
      const summary = result.summary || {};
      setBackupStatus(`Valid backup: ${summary.memory || 0} notes, ${summary.contacts || 0} contacts, ${summary.tasks || 0} tasks.`);
      return result;
    } catch (error) {
      setBackupStatus(`Validation failed: ${error.message}`);
      return null;
    }
  }

  async function createBackupRestorePointUi() {
    try {
      const result = await request("/api/backup/restore-point", { method: "POST", body: "{}" });
      backupRestorePointId = result.restorePointId || "";
      setBackupStatus(`Restore point ready: ${backupRestorePointId}`);
      return result;
    } catch (error) {
      setBackupStatus(`Restore point failed: ${error.message}`);
      return null;
    }
  }

  async function importBackupFromEditor(mode) {
    try {
      const backup = parseBackupText();
      let restorePointId = backupRestorePointId;
      let confirmationToken = "";
      if (mode === "replace") {
        confirmationToken = window.prompt("Type REPLACE to replace all assistant data with this backup.") || "";
        if (confirmationToken !== "REPLACE") {
          setBackupStatus("Replace import cancelled.");
          return null;
        }
      }
      if (mode === "replace" && !restorePointId) {
        const point = await createBackupRestorePointUi();
        restorePointId = point && point.restorePointId || "";
      }
      const result = await request("/api/backup/import", {
        method: "POST",
        body: JSON.stringify({
          backup,
          mode,
          includeSettings: Boolean(backupIncludeSettingsInput && backupIncludeSettingsInput.checked),
          includeEmbeddings: Boolean(backupIncludeEmbeddingsInput && backupIncludeEmbeddingsInput.checked),
          restorePointId,
          confirmationToken
        })
      });
      setBackupStatus(`${mode === "replace" ? "Replace" : "Merge"} import complete.`);
      await Promise.all([
        refreshWorkspaces(),
        refreshPageMemoryList(),
        refreshContactList(),
        refreshTaskList(),
        renderDedupeAudit()
      ]);
      return result;
    } catch (error) {
      setBackupStatus(`Import failed: ${error.message}`);
      return null;
    }
  }

  function setAnalyzeActive(mode) {
    const buttons = [btnSummarize, btnRewrite, btnExtract].filter(Boolean);
    for (const btn of buttons) {
      const active = Boolean(mode && btn.dataset.mode === mode);
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", String(active));
    }
  }

  function setRewriteStatus(message) {
    if (rewriteStatus) rewriteStatus.textContent = message || "";
  }

  function setRewritePreview(text) {
    if (!rewritePreview) return;
    rewritePreview.textContent = text || "";
    rewritePreview.hidden = !text;
    if (rewriteCopyButton) rewriteCopyButton.hidden = !text;
  }

  function updateSourceHint() {
    if (!sourceHint) return;
    const selection = getSelectedText();
    if (selection) {
      sourceHint.textContent = `Source: selected text • ${selection.length.toLocaleString()} chars`;
    } else {
      const snapshot = getReadablePageSnapshot();
      sourceHint.textContent = `Source: readable page • ${(snapshot.submittedCharCount || 0).toLocaleString()} chars`;
    }
  }

  function refreshRewriteSelectionStatus() {
    updateSourceHint();
    const selected = getSelectedText();
    if (rewriteControls) rewriteControls.classList.toggle("aaw-rewrite-controls--inactive", !selected);
    if (!selected) {
      setRewriteStatus("Select text on the page, then choose a goal to rewrite it.");
      return;
    }
    const snapshot = captureRewriteSnapshot();
    if (snapshot && snapshot.ok) rewriteSnapshot = snapshot;
    const meta = snapshot && snapshot.metadata;
    if (meta) {
      setRewriteStatus(`${meta.characterCount} chars selected • ${meta.replaceability === "direct" ? meta.targetType : "copy fallback"}`);
    } else {
      setRewriteStatus(`${selected.length} chars selected`);
    }
  }

  function setResultExpanded(nextExpanded) {
    resultExpanded = Boolean(nextExpanded);
    if (resultArea) resultArea.classList.toggle("aaw-result--expanded", resultExpanded);
    if (resultExpandButton) {
      resultExpandButton.textContent = resultExpanded ? "Collapse" : "Expand";
      resultExpandButton.setAttribute("aria-expanded", String(resultExpanded));
    }
    refreshResultControls();
  }

  // Copy/Expand/Clear stay visually subdued (and inert) until a real result
  // exists; Expand additionally only lights up when the output actually clips.
  function refreshResultControls() {
    const state = resultArea ? resultArea.getAttribute("data-state") : "ready";
    const hasOutput = state === "done" || state === "error";
    for (const btn of [resultCopyButton, resultClearButton]) {
      if (!btn) continue;
      btn.disabled = !hasOutput;
      btn.classList.toggle("aaw-btn--subdued", !hasOutput);
    }
    if (resultExpandButton) {
      const clips = Boolean(resultArea) && resultArea.scrollHeight > resultArea.clientHeight + 1;
      const showExpand = hasOutput && (clips || resultExpanded);
      resultExpandButton.disabled = !showExpand;
      resultExpandButton.classList.toggle("aaw-btn--subdued", !showExpand);
    }
  }

  async function copyResult() {
    if (!resultArea) return;
    const text = resultArea.textContent || "";
    if (!text.trim()) return;

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const copyBuffer = document.createElement("textarea");
        copyBuffer.value = text;
        copyBuffer.style.position = "fixed";
        copyBuffer.style.opacity = "0";
        document.documentElement.appendChild(copyBuffer);
        copyBuffer.select();
        document.execCommand("copy");
        copyBuffer.remove();
      }
      setResultCopyFeedback("Copied to clipboard.");
    } catch (error) {
      setResultCopyFeedback("Copy failed.", true);
    }
  }

  function setResultCopyFeedback(message, isError) {
    if (!resultCopyFeedback) return;
    resultCopyFeedback.textContent = message || "";
    resultCopyFeedback.classList.toggle("aaw-result-copy-feedback--error", Boolean(isError));
  }

  function clearResult() {
    if (!resultArea) return;
    lastExtractResult = null;
    setResultProvenance(null);
    setResultCopyFeedback("");
    renderResult("Select text or use the full page, then run an action.", "summarize");
    setResultExpanded(false);
    setAnalyzeActive(null);
    setResultState("ready", "Ready");
  }

  function formatSummaryOutput(value) {
    const lines = [];
    if (value.tldr) lines.push(`TL;DR\n${value.tldr}`);
    if (Array.isArray(value.keyPoints) && value.keyPoints.length) {
      lines.push("\nKey Points");
      for (const point of value.keyPoints) lines.push(`- ${point}`);
    }
    if (Array.isArray(value.importantDetails) && value.importantDetails.length) {
      lines.push("\nImportant Details");
      for (const detail of value.importantDetails) lines.push(`- ${detail}`);
    }
    if (Array.isArray(value.openQuestions) && value.openQuestions.length) {
      lines.push("\nOpen Questions");
      for (const question of value.openQuestions) lines.push(`- ${question}`);
    }
    const source = value.source || {};
    lines.push(`\nSource\n${source.title || document.title} • ${source.sourceType || "page"} • ${source.submittedCharCount || 0}/${source.originalCharCount || 0} chars`);
    if (value.engine) lines.push(`Engine: ${value.engine}`);
    return lines.join("\n");
  }

  function formatExtractOutput(value) {
    const lines = [];
    lines.push(`Title\n${value.title || document.title}`);
    if (value.summary) lines.push(`\nSummary\n${value.summary}`);
    if (Array.isArray(value.keyPoints) && value.keyPoints.length) {
      lines.push("\nKey Points");
      for (const point of value.keyPoints) lines.push(`- ${point}`);
    }
    const contacts = value.contacts || {};
    const contactLines = [];
    if (Array.isArray(contacts.emails) && contacts.emails.length) contactLines.push(`Emails: ${contacts.emails.join(", ")}`);
    if (Array.isArray(contacts.phones) && contacts.phones.length) contactLines.push(`Phones: ${contacts.phones.join(", ")}`);
    if (Array.isArray(contacts.people) && contacts.people.length) contactLines.push(`People: ${contacts.people.join(", ")}`);
    if (Array.isArray(contacts.organizations) && contacts.organizations.length) contactLines.push(`Organizations: ${contacts.organizations.join(", ")}`);
    if (contactLines.length) lines.push(`\nContacts\n${contactLines.join("\n")}`);
    if (Array.isArray(value.dates) && value.dates.length) {
      lines.push("\nDates");
      for (const date of value.dates.slice(0, 12)) {
        lines.push(`- ${date.text || date}${date.context ? ` (${date.context})` : ""}`);
      }
    }
    if (Array.isArray(value.links) && value.links.length) {
      lines.push("\nLinks");
      for (const link of value.links.slice(0, 12)) {
        if (!isSafeHttpUrl(link.url)) continue;
        lines.push(`- ${link.text || link.url}: ${link.url}`);
      }
    }
    const meta = value.extractionMeta || {};
    lines.push(`\nExtraction\nschema v${value.schemaVersion || 1}${meta.canonicalUrl ? ` • ${meta.canonicalUrl}` : ""}`);
    return lines.join("\n");
  }

  function renderResult(value, mode) {
    if (!resultArea) return;
    const isExtract = mode === "extract";
    resultArea.classList.toggle("aaw-result--prose", !isExtract);
    resultArea.classList.toggle("aaw-result--code", isExtract);

    if (mode !== "extract") lastExtractResult = null;

    if (typeof value === "string") {
      resultArea.textContent = value;
      return;
    }

    if (mode === "summarize" && value !== null && typeof value === "object") {
      resultArea.classList.add("aaw-result--prose");
      resultArea.classList.remove("aaw-result--code");
      resultArea.textContent = formatSummaryOutput(value);
      return;
    }

    if (mode === "extract" && value !== null && typeof value === "object") {
      lastExtractResult = value;
      resultArea.textContent = formatExtractOutput(value);
      return;
    }

    resultArea.textContent = JSON.stringify(value, null, 2);
  }

  // Translate an HTTP-style path + options into a service worker message.
  function buildMessage(path, options = {}) {
    const method = (options.method || "GET").toUpperCase();
    const body = options.body ? JSON.parse(options.body) : {};
    const url = new URL(path, "https://aaw.local");
    const pathname = url.pathname;

    if (privacyTools.buildPrivacyMessage) {
      const privacyMessage = privacyTools.buildPrivacyMessage(path, options);
      if (privacyMessage) return privacyMessage;
    }

    if (pathname === "/health") return { type: "HEALTH" };

    if (pathname === "/api/llm/health") return { type: "LLM_HEALTH" };

    if (pathname === "/api/assist/analyze") return { type: "ANALYZE", ...body };

    if (pathname === "/api/memory/save") return { type: "MEMORY_SAVE", ...body };

    if (pathname === "/api/memory/list") {
      const limit = parseInt(url.searchParams.get("limit"), 10);
      const offset = parseInt(url.searchParams.get("offset"), 10);
      return {
        type: "MEMORY_LIST",
        limit: Number.isFinite(limit) ? limit : 50,
        offset: Number.isFinite(offset) ? offset : 0
      };
    }

    if (pathname === "/api/memory/search") {
      const query = url.searchParams.get("q") || "";
      const limit = parseInt(url.searchParams.get("limit"), 10);
      const offset = parseInt(url.searchParams.get("offset"), 10);
      return {
        type: "MEMORY_SEARCH",
        query,
        limit: Number.isFinite(limit) ? limit : 10,
        offset: Number.isFinite(offset) ? offset : 0
      };
    }

    if (pathname === "/api/memory/source") {
      const limit = parseInt(url.searchParams.get("limit"), 10);
      const offset = parseInt(url.searchParams.get("offset"), 10);
      return {
        type: "MEMORY_SOURCE",
        urlKey: url.searchParams.get("urlKey") || "",
        limit: Number.isFinite(limit) ? limit : 50,
        offset: Number.isFinite(offset) ? offset : 0
      };
    }

    const memoryMatch = pathname.match(/^\/api\/memory\/([^/]+)$/);
    if (method === "PATCH" && memoryMatch) {
      return { type: "MEMORY_UPDATE", id: memoryMatch[1], patch: body };
    }

    if (method === "DELETE" && memoryMatch) {
      return { type: "MEMORY_DELETE", id: memoryMatch[1] };
    }

    if (pathname === "/api/note-workspaces") {
      if (method === "POST") return { type: "NOTE_WORKSPACE_CREATE", ...body };
      return { type: "NOTE_WORKSPACE_LIST", status: url.searchParams.get("status") || "open" };
    }

    if (pathname === "/api/note-workspaces/unassigned/notes") {
      const limit = parseInt(url.searchParams.get("limit"), 10);
      const offset = parseInt(url.searchParams.get("offset"), 10);
      return {
        type: "NOTE_WORKSPACE_UNASSIGNED_NOTES",
        limit: Number.isFinite(limit) ? limit : 50,
        offset: Number.isFinite(offset) ? offset : 0
      };
    }

    if (pathname === "/api/note-workspaces/unassigned/dashboard") {
      return {
        type: "NOTE_WORKSPACE_UNASSIGNED_DASHBOARD",
        memoryLimit: url.searchParams.get("memoryLimit") || "",
        sourceLimit: url.searchParams.get("sourceLimit") || "",
        contactLimit: url.searchParams.get("contactLimit") || "",
        taskLimit: url.searchParams.get("taskLimit") || "",
        activityLimit: url.searchParams.get("activityLimit") || "",
        taskStatus: url.searchParams.get("taskStatus") || "all"
      };
    }

    const workspaceNotesMatch = pathname.match(/^\/api\/note-workspaces\/([^/]+)\/notes$/);
    if (method === "GET" && workspaceNotesMatch) {
      const limit = parseInt(url.searchParams.get("limit"), 10);
      const offset = parseInt(url.searchParams.get("offset"), 10);
      return {
        type: "NOTE_WORKSPACE_NOTES",
        id: workspaceNotesMatch[1],
        limit: Number.isFinite(limit) ? limit : 50,
        offset: Number.isFinite(offset) ? offset : 0
      };
    }

    const workspaceDashboardMatch = pathname.match(/^\/api\/note-workspaces\/([^/]+)\/dashboard$/);
    if (method === "GET" && workspaceDashboardMatch) {
      return {
        type: "NOTE_WORKSPACE_DASHBOARD",
        id: workspaceDashboardMatch[1],
        memoryLimit: url.searchParams.get("memoryLimit") || "",
        sourceLimit: url.searchParams.get("sourceLimit") || "",
        contactLimit: url.searchParams.get("contactLimit") || "",
        taskLimit: url.searchParams.get("taskLimit") || "",
        activityLimit: url.searchParams.get("activityLimit") || "",
        taskStatus: url.searchParams.get("taskStatus") || "all"
      };
    }

    const workspaceMatch = pathname.match(/^\/api\/note-workspaces\/([^/]+)$/);
    if (method === "PATCH" && workspaceMatch) {
      return { type: "NOTE_WORKSPACE_UPDATE", id: workspaceMatch[1], patch: body };
    }

    if (method === "DELETE" && workspaceMatch) {
      return { type: "NOTE_WORKSPACE_DELETE", id: workspaceMatch[1] };
    }

    if (pathname === "/api/actions/run") {
      // body.type is the action type — rename to avoid conflict with message.type
      return { type: "ACTION_RUN", actionType: body.type, payload: body.payload };
    }

    if (pathname === "/api/actions/state") return { type: "ACTION_STATE" };

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
    if (method === "POST" && pathname === "/api/dedupe/unignore") return { type: "DEDUPE_UNIGNORE", ...body };

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

    if (pathname === "/api/actions/tasks") {
      const limit = parseInt(url.searchParams.get("limit"), 10);
      const offset = parseInt(url.searchParams.get("offset"), 10);
      const message = {
        type: "TASK_LIST",
        status: url.searchParams.get("status") || "open",
        priority: url.searchParams.get("priority") || "",
        sourceHost: url.searchParams.get("sourceHost") || "",
        sourceUrlKey: url.searchParams.get("sourceUrlKey") || url.searchParams.get("urlKey") || "",
        memoryId: url.searchParams.get("memoryId") || "",
        workspaceId: url.searchParams.get("workspaceId") || "",
        dueBucket: url.searchParams.get("dueBucket") || "",
        dueFrom: url.searchParams.get("dueFrom") || "",
        dueTo: url.searchParams.get("dueTo") || "",
        q: url.searchParams.get("q") || "",
        sortBy: url.searchParams.get("sortBy") || "updatedAt",
        sortDir: url.searchParams.get("sortDir") || "desc",
        limit: Number.isFinite(limit) ? limit : 50,
        offset: Number.isFinite(offset) ? offset : 0
      };
      const statuses = url.searchParams.get("statuses") || "";
      const priorities = url.searchParams.get("priorities") || "";
      if (statuses) message.statuses = statuses;
      if (priorities) message.priorities = priorities;
      return message;
    }

    if (method === "POST" && pathname === "/api/actions/tasks/batch") {
      return { type: "TASK_BATCH", ...body };
    }

    if (method === "POST" && pathname === "/api/actions/tasks/draft") {
      return { type: "TASK_DRAFT", ...body };
    }

    const taskContextMatch = pathname.match(/^\/api\/actions\/tasks\/([^/]+)\/context$/);
    if (method === "GET" && taskContextMatch) {
      return { type: "TASK_CONTEXT", id: taskContextMatch[1] };
    }

    if (method === "GET" && pathname === "/api/context/source") {
      return { type: "CONTEXT_SOURCE", urlKey: url.searchParams.get("urlKey") || "" };
    }

    if (method === "GET" && pathname === "/api/context/search") {
      const limit = parseInt(url.searchParams.get("limit"), 10);
      return {
        type: "CONTEXT_SEARCH",
        q: url.searchParams.get("q") || url.searchParams.get("query") || "",
        limit: Number.isFinite(limit) ? limit : 20
      };
    }

    const contextMatch = pathname.match(/^\/api\/context\/(memory|contact|task|workspace)\/([^/]+)$/);
    if (method === "GET" && contextMatch) {
      const messageTypes = {
        memory: "CONTEXT_MEMORY",
        contact: "CONTEXT_CONTACT",
        task: "CONTEXT_TASK",
        workspace: "CONTEXT_WORKSPACE"
      };
      return { type: messageTypes[contextMatch[1]], id: decodeURIComponent(contextMatch[2]) };
    }

    if (method === "DELETE" && pathname.startsWith("/api/actions/tasks/")) {
      return { type: "TASK_DELETE", id: pathname.replace("/api/actions/tasks/", "") };
    }

    if (method === "PATCH" && pathname.startsWith("/api/actions/tasks/")) {
      return { type: "TASK_UPDATE", id: pathname.replace("/api/actions/tasks/", ""), patch: body };
    }

    if (method === "POST" && pathname === "/api/contacts/extract") {
      return { type: "CONTACT_EXTRACT", ...body };
    }

    if (method === "POST" && pathname === "/api/contacts/batch") {
      return { type: "CONTACT_BATCH", ...body };
    }

    if (pathname === "/api/contacts") {
      if (method === "POST") return { type: "CONTACT_CREATE", contact: body };
      const limit = parseInt(url.searchParams.get("limit"), 10);
      const offset = parseInt(url.searchParams.get("offset"), 10);
      const message = {
        type: "CONTACT_LIST",
        q: url.searchParams.get("q") || "",
        status: url.searchParams.get("status") || "",
        sourceHost: url.searchParams.get("sourceHost") || "",
        sourceUrlKey: url.searchParams.get("sourceUrlKey") || url.searchParams.get("urlKey") || "",
        memoryId: url.searchParams.get("memoryId") || "",
        workspaceId: url.searchParams.get("workspaceId") || "",
        sortBy: url.searchParams.get("sortBy") || "updatedAt",
        sortDir: url.searchParams.get("sortDir") || "desc",
        limit: Number.isFinite(limit) ? limit : 50,
        offset: Number.isFinite(offset) ? offset : 0
      };
      const statuses = url.searchParams.get("statuses") || "";
      if (statuses) message.statuses = statuses;
      return message;
    }

    const contactMatch = pathname.match(/^\/api\/contacts\/([^/]+)$/);
    if (method === "GET" && contactMatch) return { type: "CONTACT_GET", id: contactMatch[1] };
    if (method === "PATCH" && contactMatch) return { type: "CONTACT_UPDATE", id: contactMatch[1], patch: body };
    if (method === "DELETE" && contactMatch) return { type: "CONTACT_DELETE", id: contactMatch[1] };

    throw new Error(`Unknown route: ${method} ${pathname}`);
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

  // Unified request function: routes to service worker (built-in) or remote backend.
  async function request(path, options = {}) {
    if (!isLocalMode()) {
      // Remote backend mode — standard fetch
      const response = await fetch(`${remoteBackendUrl}${path}`, {
        headers: { "Content-Type": "application/json" },
        ...options
      });
      let data;
      try {
        data = await response.json();
      } catch {
        throw new Error(`Server returned non-JSON response (status ${response.status})`);
      }
      if (!response.ok) throw new Error(data.error || "Request failed");
      return data;
    }

    // Built-in mode — send to service worker via chrome.runtime.sendMessage
    return sendLocalMessage(buildMessage(path, options));
  }

  function isAiContentRoute(path) {
    try {
      const pathname = new URL(path, "https://aaw.local").pathname;
      return pathname === "/api/assist/analyze" || pathname === "/api/contacts/extract" || pathname === "/api/actions/tasks/draft";
    } catch {
      return false;
    }
  }

  function isPrivacyContentRoute(path) {
    try {
      const pathname = new URL(path, "https://aaw.local").pathname;
      return isAiContentRoute(path) || pathname === "/api/memory/save" || pathname === "/api/actions/run" || pathname === "/api/actions/tasks/draft" || pathname === "/api/contacts";
    } catch {
      return false;
    }
  }

  function sanitizeUrlForPrivacy(value, privacySettings) {
    const normalized = privacyTools.normalizePrivacySettings
      ? privacyTools.normalizePrivacySettings(privacySettings)
      : (privacySettings || {});
    const sendFullUrl = Boolean(normalized.redaction && normalized.redaction.sendFullUrlToProvider);
    return privacyTools.sanitizeUrlForProvider
      ? privacyTools.sanitizeUrlForProvider(value, sendFullUrl)
      : String(value || "").split(/[?#]/)[0];
  }

  function redactTextForPrivacy(value, privacySettings) {
    const normalized = privacyTools.normalizePrivacySettings
      ? privacyTools.normalizePrivacySettings(privacySettings)
      : (privacySettings || {});
    if (!normalized.redaction || !normalized.redaction.enabled || !normalized.redaction.applyToModelPayload || !privacyTools.redactString) {
      return String(value || "");
    }
    return privacyTools.redactString(value, normalized.redaction).text;
  }

  function contentForPrivacyBody(body = {}, fallback = "") {
    if (typeof fallback === "string" && fallback) return fallback;
    if (typeof body.content === "string") return body.content;
    if (typeof body.pageExcerpt === "string") return body.pageExcerpt;
    if (typeof body.snippet === "string") return body.snippet;
    if (body.payload && typeof body.payload === "object") {
      return [
        body.payload.body,
        body.payload.notes,
        body.payload.sourceSnippet
      ].filter((value) => typeof value === "string" && value.trim()).join("\n");
    }
    return "";
  }

  function applyPrivacyDecisionToBody(path, body, decision, settings) {
    const next = { ...body };
    const pathname = new URL(path, "https://aaw.local").pathname;
    const primaryUrl = decision.url || body.url || body.sourceUrl || location.href;
    const sanitizeUrl = (value) => sanitizeUrlForPrivacy(value || primaryUrl, settings.privacySettings);

    if (Object.prototype.hasOwnProperty.call(next, "content")) next.content = decision.content;
    if (Object.prototype.hasOwnProperty.call(next, "pageMeta")) next.pageMeta = decision.pageMeta;
    if (Object.prototype.hasOwnProperty.call(next, "url")) next.url = sanitizeUrl(next.url);
    if (Object.prototype.hasOwnProperty.call(next, "sourceUrl")) next.sourceUrl = sanitizeUrl(next.sourceUrl);
    if (Object.prototype.hasOwnProperty.call(next, "canonicalUrl")) next.canonicalUrl = sanitizeUrl(next.canonicalUrl);
    if (next.source && typeof next.source === "object") {
      next.source = { ...next.source };
      if (Object.prototype.hasOwnProperty.call(next.source, "url")) next.source.url = sanitizeUrl(next.source.url);
    }

    if (pathname === "/api/memory/save") {
      if (Object.prototype.hasOwnProperty.call(next, "pageExcerpt")) next.pageExcerpt = String(decision.content || "").slice(0, 5000);
      if (Object.prototype.hasOwnProperty.call(next, "snippet") && (body.sourceType === "selection" || body.sourceType === "lead")) next.snippet = decision.content;
      if (Object.prototype.hasOwnProperty.call(next, "note")) {
        next.note = body.sourceType === "lead"
          ? decision.content
          : redactTextForPrivacy(next.note, settings.privacySettings);
      }
      if (!next.privacyMeta) next.privacyMeta = {};
    }

    if (pathname === "/api/actions/run" && next.payload && typeof next.payload === "object") {
      next.payload = { ...next.payload };
      if (Object.prototype.hasOwnProperty.call(next.payload, "sourceUrl")) next.payload.sourceUrl = sanitizeUrl(next.payload.sourceUrl);
      if (Object.prototype.hasOwnProperty.call(next.payload, "url")) next.payload.url = sanitizeUrl(next.payload.url);
      if (Object.prototype.hasOwnProperty.call(next.payload, "body")) next.payload.body = decision.content;
      else if (Object.prototype.hasOwnProperty.call(next.payload, "notes") && next.payload.sourceSnippet) {
        next.payload.notes = redactTextForPrivacy(next.payload.notes, settings.privacySettings);
        next.payload.sourceSnippet = redactTextForPrivacy(next.payload.sourceSnippet, settings.privacySettings);
      }
      else if (Object.prototype.hasOwnProperty.call(next.payload, "notes") && !next.payload.sourceSnippet) next.payload.notes = decision.content;
      else if (Object.prototype.hasOwnProperty.call(next.payload, "sourceSnippet") && !next.payload.notes) next.payload.sourceSnippet = decision.content;
      if (!next.payload.privacyMeta) next.payload.privacyMeta = {};
    }

    if (pathname === "/api/contacts") {
      for (const field of ["email", "phone", "notes", "name", "company", "roleTitle", "website", "linkedInUrl", "location", "address"]) {
        if (Object.prototype.hasOwnProperty.call(next, field)) {
          next[field] = redactTextForPrivacy(next[field], settings.privacySettings);
        }
      }
      for (const field of ["emails", "phones", "socialUrls", "tags"]) {
        if (Array.isArray(next[field])) {
          next[field] = next[field].map((value) => redactTextForPrivacy(value, settings.privacySettings));
        }
      }
    }

    return next;
  }

  async function requestWithPrivacy(path, options = {}, preflightInput = {}) {
    if (!privacyTools.privacyPreflight || !isPrivacyContentRoute(path)) return request(path, options);
    const settings = await loadSettings();
    const body = options.body ? JSON.parse(options.body) : {};
    const aiRoute = isAiContentRoute(path);
    const content = contentForPrivacyBody(body, preflightInput.content || "");
    const basePreflight = {
      settings: settings.privacySettings,
      host: location.hostname,
      operation: preflightInput.operation || body.mode || "ai",
      contentSource: preflightInput.contentSource || "page",
      content,
      pageMeta: body.pageMeta || {},
      url: body.url || body.sourceUrl || (body.payload && body.payload.sourceUrl) || location.href,
      originalCharCount: preflightInput.originalCharCount
    };
    const previewDecision = privacyTools.privacyPreflight({ ...basePreflight, confirmed: false });
    const confirmed = previewDecision.requiresConfirmation
      ? window.confirm(privacyConfirmMessage(previewDecision, settings))
      : false;
    const decision = previewDecision.requiresConfirmation
      ? privacyTools.privacyPreflight({ ...basePreflight, confirmed })
      : previewDecision;
    if (decision.requiresConfirmation && !confirmed) {
      throw new Error("Request cancelled by privacy settings.");
    }
    const preparedBody = applyPrivacyDecisionToBody(path, body, decision, settings);
    const nextBody = {
      ...preparedBody,
      aiMode: decision.requestAiMode || "local_only",
      privacyMeta: {
        operation: decision.operation,
        effectiveAiMode: decision.effectiveAiMode,
        sentToProvider: aiRoute && decision.allowProviderSend,
        sentToBackend: !isLocalMode() && decision.allowBackendAi,
        contentSource: decision.contentSource,
        originalCharCount: decision.originalCharCount,
        submittedCharCount: decision.submittedCharCount,
        redactionCounts: decision.redactionCounts,
        siteRule: decision.siteRule,
        host: location.hostname,
        timestamp: new Date().toISOString()
      }
    };
    if (nextBody.payload && typeof nextBody.payload === "object") {
      nextBody.payload = { ...nextBody.payload, privacyMeta: nextBody.payload.privacyMeta || nextBody.privacyMeta };
    }
    const nextOptions = { ...options, body: JSON.stringify(nextBody) };
    let response;
    if (!isLocalMode() && decision.blocked) {
      response = await sendLocalMessage(buildMessage(path, nextOptions));
    } else {
      response = await request(path, nextOptions);
    }
    return {
      ...response,
      privacyMeta: sanitizePrivacyMeta(response && response.privacyMeta ? response.privacyMeta : nextBody.privacyMeta)
    };
  }

  function isPanelOpen() {
    return Boolean(root && !root.classList.contains("aaw-hidden"));
  }

  function shortcutLabel(shortcut) {
    const normalized = shortcutTools.normalizeShortcut
      ? shortcutTools.normalizeShortcut(shortcut)
      : { label: String(shortcut || "") };
    return normalized.label || String(shortcut || "");
  }

  function shortcutAriaValue(shortcut) {
    const normalized = shortcutTools.normalizeShortcut
      ? shortcutTools.normalizeShortcut(shortcut)
      : { modifiers: [], key: String(shortcut || "") };
    if (normalized.sequence) {
      return normalized.sequence.map((part) => [...(part.modifiers || []), part.key].join("+")).join(" ");
    }
    const parts = [...(normalized.modifiers || []), normalized.key].filter(Boolean);
    const value = parts.join("+").replace(/\bCtrl\b/g, "Control").replace(/\bMeta\b/g, "Meta").replace(/\bMod\b/g, "Control");
    if ((normalized.modifiers || []).includes("Mod")) return `${value} ${value.replace("Control", "Meta")}`;
    return value;
  }

  function setCommandElementMetadata(element, command) {
    if (!element || !command) return;
    element.setAttribute("data-aaw-command-id", command.id);
    const firstShortcut = (command.shortcuts || [command.shortcut]).filter(Boolean)[0];
    if (firstShortcut) {
      element.setAttribute("aria-keyshortcuts", shortcutAriaValue(firstShortcut));
      const label = shortcutLabel(firstShortcut);
      const baseTitle = element.title || element.getAttribute("aria-label") || element.textContent || command.label;
      element.title = `${baseTitle} (${label})`;
    }
  }

  function sectionIsVisible(_sectionId) {
    return true;
  }

  function commandDisabled(command) {
    if (!command) return true;
    if (typeof command.enabled === "function" && !command.enabled()) return true;
    if (command.element && command.element.disabled) return true;
    return false;
  }

  async function runCommand(commandOrId) {
    const command = typeof commandOrId === "string" ? commandById.get(commandOrId) : commandOrId;
    if (!command || commandDisabled(command)) return false;
    await command.run();
    return true;
  }

  function focusFirstSectionControl(section) {
    if (!section) return;
    const focusable = section.querySelector("button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex='-1'])");
    if (focusable && focusable.focus) focusable.focus();
  }

  function focusSection(sectionId) {
    if (!root) return;
    const section = root.querySelector(`[data-aaw-section="${sectionId}"]`);
    if (!section) return;
    section.scrollIntoView({ block: "start", behavior: "smooth" });
    focusFirstSectionControl(section);
    if (_liveRegion) _liveRegion.textContent = `Section: ${sectionId}`;
  }

  function runFocusedSectionPrimary(event) {
    const target = event && event.target;
    const section = target && target.closest ? target.closest("[data-aaw-section]") : null;
    const sectionId = section ? section.getAttribute("data-aaw-section") : "";
    if (sectionId === "memory") return saveMemory();
    if (sectionId === "leads") return captureLead();
    if (sectionId === "tasks") return createTaskFromPage();
    if (sectionId === "search") return searchInput ? searchMemory(searchInput.value) : null;
    return analyze("summarize");
  }

  function buildCommandPalette() {
    if (commandPalette) return;

    commandPalette = document.createElement("div");
    commandPalette.className = "aaw-command-palette";
    commandPalette.hidden = true;
    commandPalette.setAttribute("data-aaw-test", "command-palette");
    commandPalette.setAttribute("role", "dialog");
    commandPalette.setAttribute("aria-modal", "true");
    commandPalette.setAttribute("aria-labelledby", "aaw-command-palette-title");

    const title = document.createElement("div");
    title.id = "aaw-command-palette-title";
    title.className = "aaw-command-palette__title";
    title.textContent = "Command palette";

    commandPaletteInput = document.createElement("input");
    commandPaletteInput.type = "search";
    commandPaletteInput.className = "aaw-command-palette__input";
    commandPaletteInput.setAttribute("data-aaw-test", "command-palette-input");
    commandPaletteInput.setAttribute("aria-label", "Search commands");
    commandPaletteInput.setAttribute("aria-controls", "aaw-command-palette-list");
    commandPaletteInput.setAttribute("role", "combobox");
    commandPaletteInput.setAttribute("aria-expanded", "true");
    commandPaletteInput.setAttribute("aria-autocomplete", "list");

    commandPaletteList = document.createElement("div");
    commandPaletteList.id = "aaw-command-palette-list";
    commandPaletteList.className = "aaw-command-palette__list";
    commandPaletteList.setAttribute("role", "listbox");
    commandPaletteList.setAttribute("data-aaw-test", "command-palette-list");

    commandPaletteStatus = document.createElement("div");
    commandPaletteStatus.className = "aaw-sr-only";
    commandPaletteStatus.setAttribute("aria-live", "polite");

    commandPalette.appendChild(title);
    commandPalette.appendChild(commandPaletteInput);
    commandPalette.appendChild(commandPaletteList);
    commandPalette.appendChild(commandPaletteStatus);
    root.appendChild(commandPalette);

    commandPaletteInput.addEventListener("input", () => renderCommandPalette());
    commandPaletteInput.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeCommandPalette();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        moveCommandPaletteActive(1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        moveCommandPaletteActive(-1);
      } else if (event.key === "Home") {
        event.preventDefault();
        setCommandPaletteActive(0);
      } else if (event.key === "End") {
        event.preventDefault();
        setCommandPaletteActive(commandPaletteMatches.length - 1);
      } else if (event.key === "Enter") {
        event.preventDefault();
        const command = commandPaletteMatches[commandPaletteActiveIndex];
        if (command) executePaletteCommand(command.id);
      }
    });
  }

  function renderCommandPalette() {
    if (!commandPaletteList || !commandPaletteInput) return;
    const query = commandPaletteInput.value.trim().toLowerCase();
    commandPaletteMatches = commandRegistry.filter((command) => {
      if (command.hidden && command.hidden()) return false;
      if (commandDisabled(command)) return false;
      if (!sectionIsVisible(command.section || "")) return false;
      const text = [command.label, command.id, command.section, command.hint].filter(Boolean).join(" ").toLowerCase();
      return !query || text.includes(query);
    });
    commandPaletteList.textContent = "";
    commandPaletteMatches.forEach((command, index) => {
      const option = document.createElement("button");
      option.type = "button";
      option.id = `aaw-command-option-${index}`;
      option.className = "aaw-command-palette__option";
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");
      option.setAttribute("data-aaw-test", `command-option-${command.id}`);
      option.addEventListener("click", () => executePaletteCommand(command.id));
      const label = document.createElement("span");
      label.className = "aaw-command-palette__label";
      label.textContent = command.label;
      const shortcut = document.createElement("span");
      shortcut.className = "aaw-command-palette__shortcut";
      shortcut.textContent = (command.shortcuts || [command.shortcut]).filter(Boolean).map(shortcutLabel).join(" / ");
      option.appendChild(label);
      option.appendChild(shortcut);
      commandPaletteList.appendChild(option);
    });
    setCommandPaletteActive(Math.min(commandPaletteActiveIndex, Math.max(commandPaletteMatches.length - 1, 0)));
    if (commandPaletteStatus) commandPaletteStatus.textContent = `${commandPaletteMatches.length} command${commandPaletteMatches.length === 1 ? "" : "s"}`;
  }

  function setCommandPaletteActive(index) {
    if (!commandPaletteList || !commandPaletteInput) return;
    commandPaletteActiveIndex = Math.max(0, Math.min(index, Math.max(commandPaletteMatches.length - 1, 0)));
    const options = [...commandPaletteList.querySelectorAll("[role='option']")];
    options.forEach((option, optionIndex) => {
      const active = optionIndex === commandPaletteActiveIndex;
      option.classList.toggle("is-active", active);
      option.setAttribute("aria-selected", String(active));
      if (active) {
        commandPaletteInput.setAttribute("aria-activedescendant", option.id);
        option.scrollIntoView({ block: "nearest" });
      }
    });
    if (!options.length) commandPaletteInput.removeAttribute("aria-activedescendant");
  }

  function moveCommandPaletteActive(delta) {
    if (!commandPaletteMatches.length) return;
    setCommandPaletteActive((commandPaletteActiveIndex + delta + commandPaletteMatches.length) % commandPaletteMatches.length);
  }

  function commandPaletteOpen() {
    return Boolean(commandPalette && !commandPalette.hidden);
  }

  async function openCommandPalette() {
    if (!root) await buildPanel();
    if (!isPanelOpen()) {
      updatePagePreview();
      refreshPageMemoryList();
      _openPanel();
    }
    buildCommandPalette();
    commandPalettePreviousFocus = document.activeElement;
    commandPalette.hidden = false;
    commandPaletteInput.value = "";
    commandPaletteActiveIndex = 0;
    renderCommandPalette();
    commandPaletteInput.focus();
  }

  function closeCommandPalette({ restoreFocus = true } = {}) {
    if (!commandPalette || commandPalette.hidden) return;
    commandPalette.hidden = true;
    if (commandPaletteInput) {
      commandPaletteInput.value = "";
      commandPaletteInput.removeAttribute("aria-activedescendant");
    }
    if (restoreFocus && commandPalettePreviousFocus && commandPalettePreviousFocus.focus) {
      try { commandPalettePreviousFocus.focus(); } catch {}
    }
    commandPalettePreviousFocus = null;
  }

  async function executePaletteCommand(commandId) {
    closeCommandPalette({ restoreFocus: false });
    await runCommand(commandId);
  }

  function closePanelFromCommand() {
    closeCommandPalette({ restoreFocus: false });
    _closePanel();
  }

  function registerCommandRegistry(sectionElements = {}) {
    const commands = [
      { id: "panel.openPalette", label: "Open command palette", section: "panel", shortcuts: ["Mod+K", "?"], run: openCommandPalette },
      { id: "panel.close", label: "Close panel", section: "panel", shortcut: "Escape", run: closePanelFromCommand },
      { id: "analyze.summarize", label: "Summarize page or selection", section: "analyze", shortcut: "1", run: () => analyze("summarize"), element: btnSummarize },
      { id: "analyze.rewrite", label: "Rewrite selected text", section: "analyze", shortcut: "2", run: runRewrite, element: btnRewrite },
      { id: "analyze.extract", label: "Extract structured info", section: "analyze", shortcut: "3", run: () => analyze("extract"), element: btnExtract },
      { id: "memory.save", label: "Save page memory", section: "memory", shortcut: "Mod+S", run: saveMemory, element: btnSaveMemory },
      { id: "lead.capture", label: "Capture lead", section: "leads", run: captureLead, element: btnCaptureLead },
      { id: "task.create", label: "Create task", section: "tasks", run: createTaskFromPage, element: btnCreateTaskRef },
      { id: "search.focus", label: "Focus memory search", section: "search", shortcut: "/", run: () => { focusSection("search"); if (searchInput) searchInput.focus(); }, element: searchInput },
      { id: "section.analyze", label: "Go to Analyze", section: "panel", shortcut: "g a", run: () => focusSection("analyze") },
      { id: "section.memory", label: "Go to Page Memory", section: "panel", shortcut: "g m", run: () => focusSection("memory") },
      { id: "section.leads", label: "Go to Lead Capture", section: "panel", shortcut: "g l", run: () => focusSection("leads") },
      { id: "section.tasks", label: "Go to Tasks", section: "panel", shortcut: "g t", run: () => focusSection("tasks") },
      { id: "section.workspaces", label: "Go to Workspaces", section: "panel", shortcut: "g w", run: () => focusSection("workspaces") },
      { id: "section.search", label: "Go to Search", section: "panel", run: () => focusSection("search") }
    ];
    commandRegistry = commands;
    commandById = new Map(commands.map((command) => [command.id, command]));
    for (const command of commands) setCommandElementMetadata(command.element, command);
    for (const [id, element] of Object.entries(sectionElements)) {
      if (element) element.setAttribute("data-aaw-section", id);
    }
    shortcutSequence = shortcutTools.createSequenceBuffer
      ? shortcutTools.createSequenceBuffer({ timeoutMs: 900 })
      : null;
  }

  function handleEscapeShortcut(event) {
    if (!event || event.key !== "Escape" || event.defaultPrevented) return false;
    if (commandPaletteOpen()) {
      event.preventDefault();
      event.stopPropagation();
      closeCommandPalette();
      return true;
    }
    if (_ddCurrentOpen) {
      event.preventDefault();
      event.stopPropagation();
      _ddCurrentOpen._close();
      return true;
    }
    if (contextDrawer && !contextDrawer.hidden) {
      event.preventDefault();
      event.stopPropagation();
      closeContextDrawer();
      return true;
    }
    event.preventDefault();
    event.stopPropagation();
    _closePanel();
    return true;
  }

  function handlePanelShortcut(event) {
    if (handleEscapeShortcut(event)) return;
    if (!shortcutTools.shouldHandlePanelShortcut || !shortcutTools.shouldHandlePanelShortcut({ event, panelRoot: root })) return;
    if (commandPaletteOpen()) return;

    if (shortcutTools.matchShortcut && shortcutTools.matchShortcut(event, "Mod+Enter")) {
      event.preventDefault();
      runFocusedSectionPrimary(event);
      return;
    }

    const direct = commandRegistry.find((command) =>
      shortcutTools.commandMatchesShortcut
        ? shortcutTools.commandMatchesShortcut(command, event)
        : false
    );
    if (direct) {
      event.preventDefault();
      if (shortcutSequence) shortcutSequence.reset();
      runCommand(direct);
      return;
    }

    if (!shortcutSequence || !shortcutTools.sequenceKeyFromEvent) return;
    const key = shortcutTools.sequenceKeyFromEvent(event);
    if (!key) {
      shortcutSequence.reset();
      return;
    }
    const sequence = shortcutSequence.push(event).join(" ");
    const sequenceCommands = commandRegistry
      .map((command) => ({ command, shortcut: (command.shortcuts || [command.shortcut]).filter(Boolean).find((shortcut) => String(shortcut).includes(" ")) }))
      .filter((item) => item.shortcut);
    const exact = sequenceCommands.find((item) => shortcutTools.normalizeShortcut(item.shortcut).id.toLowerCase() === sequence);
    const hasPrefix = sequenceCommands.some((item) => shortcutTools.normalizeShortcut(item.shortcut).id.toLowerCase().startsWith(`${sequence} `));
    if (exact && !commandDisabled(exact.command)) {
      event.preventDefault();
      shortcutSequence.reset();
      runCommand(exact.command);
    } else if (hasPrefix) {
      event.preventDefault();
      if (_liveRegion) _liveRegion.textContent = "Shortcut sequence started";
    } else {
      shortcutSequence.reset();
    }
  }

  async function analyze(mode) {
    const selection = getSelectedText();
    const snapshot = selection
      ? { content: selection, originalCharCount: selection.length, submittedCharCount: selection.length }
      : getReadablePageSnapshot();
    const content = snapshot.content;
    const sourceType = selection ? "selection" : "page";
    const instruction = instructionInput ? instructionInput.value.trim() : "";

    const analyzeButtons = [btnSummarize, btnRewrite, btnExtract].filter(Boolean);
    setAnalyzeActive(mode);
    for (const btn of analyzeButtons) btn.disabled = true;

    try {
      setResultProvenance(null);
      setResultCopyFeedback("");

      if ((mode === "summarize" || mode === "extract") && content.length < (sourceType === "selection" ? 80 : 200)) {
        renderResult(`Not enough readable text for ${mode}. Select more text or use a page with more content.`, "summarize");
        setResultState("error", "Too short");
        return;
      }

      setResultState("working", "Working");
      renderResult("Reading the page and preparing the response…", mode);
      const pageMeta = collectPageMeta();

      const data = await requestWithPrivacy("/api/assist/analyze", {
        method: "POST",
        body: JSON.stringify({
          mode,
          instruction,
          title: document.title,
          url: location.href,
          content,
          pageMeta,
          source: {
            title: document.title,
            url: location.href,
            sourceType,
            originalCharCount: snapshot.originalCharCount,
            submittedCharCount: snapshot.submittedCharCount
          }
        })
      }, { operation: mode, contentSource: sourceType, content, originalCharCount: snapshot.originalCharCount });
      renderResult(data.output, mode);
      setResultProvenance(data.privacyMeta || null);
      if (data.privacyMeta && data.privacyMeta.effectiveAiMode === "local_only") setResultState("done", "Local");
      else setResultState("done", "Done");
    } catch (error) {
      setAnalyzeActive(null);
      renderResult(`Error: ${error.message}`, "summarize");
      setResultState("error", "Error");
    } finally {
      for (const btn of analyzeButtons) btn.disabled = false;
    }
  }

  function rewriteInstruction(goal, extra) {
    const labels = {
      clearer: "Make the selected text clearer while preserving meaning.",
      shorter: "Make the selected text shorter while preserving key meaning.",
      professional: "Make the selected text more professional and polished."
    };
    return [labels[goal] || labels.clearer, extra].filter(Boolean).join(" ");
  }

  async function copyRewritePreview() {
    const text = rewritePreview ? rewritePreview.textContent || "" : "";
    if (!text.trim()) return;
    await navigator.clipboard.writeText(text);
    setRewriteStatus("Copied replacement text.");
  }

  function undoRewrite() {
    if (!rewriteUndo) return;
    rewriteUndo();
    rewriteUndo = null;
    if (rewriteUndoButton) rewriteUndoButton.hidden = true;
    setRewriteStatus("Undo complete.");
  }

  async function runRewrite() {
    const selection = getSelectedText();
    const snapshot = captureRewriteSnapshot();
    const rejectedCurrentSelection = snapshot && !snapshot.ok && snapshot.metadata && snapshot.metadata.characterCount > 0;
    const selectedText = snapshot && snapshot.ok
      ? snapshot.metadata.selectedText
      : (!rejectedCurrentSelection && rewriteSnapshot && rewriteSnapshot.ok && rewriteSnapshot.metadata
        ? rewriteSnapshot.metadata.selectedText
        : selection);
    if (!selectedText) {
      setResultProvenance(null);
      setResultCopyFeedback("");
      renderResult("No selection. Select text on the page to rewrite.", "rewrite");
      setRewriteStatus("No selection.");
      setResultState("error", "No selection");
      return;
    }
    if (snapshot && snapshot.ok) rewriteSnapshot = snapshot;
    const metadata = rewriteSnapshot && rewriteSnapshot.metadata
      ? rewriteSnapshot.metadata
      : { selectedText, characterCount: selectedText.length, replaceability: "copy-fallback", targetType: "unknown", timestamp: Date.now(), version: 1 };

    const instruction = rewriteInstruction(rewriteGoal, instructionInput ? instructionInput.value.trim() : "");
    setRewriteStatus(`${metadata.characterCount} chars selected • rewriting…`);
    setAnalyzeActive("rewrite");
    const analyzeButtons = [btnSummarize, btnRewrite, btnExtract].filter(Boolean);
    for (const btn of analyzeButtons) btn.disabled = true;
    setResultProvenance(null);
    setResultCopyFeedback("");
    setResultState("working", "Rewriting");
    renderResult("Rewriting selected text…", "rewrite");

    try {
      const data = await requestWithPrivacy("/api/assist/analyze", {
        method: "POST",
        body: JSON.stringify({
          mode: "rewrite",
          rewriteGoal,
          instruction,
          title: document.title,
          url: location.href,
          content: selectedText,
          beforeContext: "",
          afterContext: ""
        })
      }, { operation: "rewrite", contentSource: "selection", content: selectedText, originalCharCount: selectedText.length });
      const output = data.output || {};
      const replacement = typeof output === "string" ? output : output.replacement;
      const source = typeof output === "object" ? output.source : "local-fallback";
      renderResult(replacement || "", "rewrite");
      setResultProvenance(data.privacyMeta || null);
      setRewritePreview(replacement || "");

      if (
        replacement &&
        source === "model" &&
        rewriteSnapshot &&
        rewriteSnapshot.ok &&
        rewriteSnapshot.metadata.replaceability === "direct" &&
        selectionTools.applyReplacement
      ) {
        const applied = selectionTools.applyReplacement(rewriteSnapshot, replacement);
        if (applied.ok) {
          rewriteUndo = applied.undo;
          if (rewriteUndoButton) rewriteUndoButton.hidden = false;
          setRewriteStatus("Replaced. Undo is available.");
        } else {
          setRewriteStatus(`${applied.reason || "Not directly replaceable"}. Use copy fallback.`);
        }
      } else if (source !== "model") {
        setRewriteStatus("Preview ready. Local fallback results are copy-only.");
      } else {
        setRewriteStatus(`${rewriteSnapshot && rewriteSnapshot.reason || "Not directly replaceable"}. Use copy fallback.`);
      }
      setResultState("done", data.privacyMeta && data.privacyMeta.effectiveAiMode === "local_only" ? "Local" : "Done");
    } catch (error) {
      renderResult(`Rewrite failed: ${error.message}`, "summarize");
      setRewriteStatus(`Rewrite failed: ${error.message}`);
      setResultState("error", "Error");
    } finally {
      for (const btn of analyzeButtons) btn.disabled = false;
    }
  }

  function fingerprintText(value) {
    const text = String(value || "");
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return Math.abs(hash >>> 0).toString(16);
  }

  // The active workspace is the single write target. Inbox (no project) writes
  // empty compatibility arrays; a selected project writes its single id.
  function isInboxSelected() {
    return !selectedWorkspaceId || selectedWorkspaceId === "unassigned";
  }
  function activeWorkspaceWriteIds() {
    return isInboxSelected() ? [] : [selectedWorkspaceId];
  }

  function capturePageContext() {
    const selection = getSelectedText();
    const snapshot = getReadablePageSnapshot();
    const content = selection || snapshot.content;
    const note = noteInput ? noteInput.value.trim() : "";
    const workspaceIds = activeWorkspaceWriteIds();
    const canonicalLink = document.querySelector('link[rel="canonical"]');
    const iconLink = document.querySelector('link[rel~="icon"]');
    const sourceType = selection ? "selection" : "page";
    const fingerprint = fingerprintText([
      location.href,
      sourceType,
      content,
      note,
      workspaceIds.join(",")
    ].join("\n"));

    return {
      fingerprint,
      title: document.title,
      sourceUrl: location.href,
      canonicalUrl: canonicalLink && canonicalLink.href ? canonicalLink.href : location.href,
      faviconUrl: iconLink && iconLink.href ? iconLink.href : "",
      snippet: selection,
      content,
      pageExcerpt: content.slice(0, 5000),
      sourceType,
      structuredExtraction: lastExtractResult || undefined,
      privacyMeta: lastPrivacyMeta || undefined,
      note,
      workspaceIds,
      taskIds: workspaceIds
    };
  }

  async function saveContextSnapshot(context) {
    const data = await requestWithPrivacy("/api/memory/save", {
      method: "POST",
      body: JSON.stringify(context)
    }, {
      operation: "save_memory",
      contentSource: context.sourceType || "page",
      content: context.content || context.pageExcerpt || context.snippet || "",
      originalCharCount: String(context.content || context.pageExcerpt || context.snippet || "").length
    });
    lastSavedContext = {
      fingerprint: context.fingerprint,
      item: data.item,
      context
    };
    return data.item;
  }

  function setActionStatus(message, tone) {
    if (!actionStatus) return;
    actionStatus.className = `aaw-status aaw-memory-status-line${tone ? ` aaw-memory-status-line--${tone}` : ""}`;
    actionStatus.textContent = message || "";
  }

  function formatSavedDate(value) {
    if (!value) return "Saved date unavailable";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Saved date unavailable";
    return date.toLocaleString();
  }

  async function saveMemory() {
    const context = capturePageContext();

    if (btnSaveMemory) btnSaveMemory.disabled = true;
    setActionStatus("Saving page memory…", "saving");
    try {
      const item = await saveContextSnapshot(context);
      setActionStatus(`Saved: ${item.id}`, "saved");
      await refreshWorkspaces();
      await refreshPageMemoryList();
      return item;
    } catch (error) {
      setActionStatus(`Save failed: ${error.message}`, "error");
    } finally {
      if (btnSaveMemory) btnSaveMemory.disabled = false;
    }
  }

  async function runAction() {
    const text = getSelectedText() || getPageText();
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const title = lines[0] || document.title;
    const type = actionTypeSelect ? actionTypeSelect.getValue() : "create_task";
    const extract = lastExtractResult;

    let payload;
    if (type === "create_task") {
      payload = {
        title: extract && extract.summary ? `Follow up: ${extract.title || document.title}` : title,
        notes: extract ? formatExtractOutput(extract) : (noteInput ? noteInput.value.trim() : ""),
        privacyMeta: lastPrivacyMeta || undefined
      };
    }
    else if (type === "save_contact") {
      const contacts = extract && extract.contacts ? extract.contacts : {};
      payload = {
        sourceUrl: location.href,
        sourceTitle: document.title,
        name: (contacts.organizations && contacts.organizations[0]) || (contacts.people && contacts.people[0]) || title,
        email: contacts.emails && contacts.emails[0] || "",
        phone: contacts.phones && contacts.phones[0] || "",
        company: contacts.organizations && contacts.organizations[0] || "",
        leadStatus: "new",
        tags: ["lead"],
        notes: extract ? formatExtractOutput(extract) : (noteInput ? noteInput.value.trim() : ""),
        privacyMeta: lastPrivacyMeta || undefined
      };
    }
    else if (type === "open_draft") payload = { title: extract ? `Extract: ${extract.title || document.title}` : title, body: extract ? JSON.stringify(extract, null, 2) : text, privacyMeta: lastPrivacyMeta || undefined };
    else payload = { title };

    if (btnRunAction) btnRunAction.disabled = true;
    setActionStatus("Running action…", "saving");
    try {
      const data = await requestWithPrivacy("/api/actions/run", {
        method: "POST",
        body: JSON.stringify({ type, payload })
      }, {
        operation: `action_${type}`,
        contentSource: "page",
        content: payload.body || payload.notes || "",
        originalCharCount: String(payload.body || payload.notes || "").length
      });
      const result = data.result || {};
      const label = result.title || result.name || result.id || type;
      setActionStatus(`Done (${type}): ${label}`, "saved");
    } catch (error) {
      setActionStatus(`Action failed: ${error.message}`, "error");
    } finally {
      if (btnRunAction) btnRunAction.disabled = false;
    }
  }

  function setTaskStatus(message, tone) {
    if (!taskStatus) return;
    taskStatus.className = `aaw-status aaw-task-status-line${tone ? ` aaw-task-status-line--${tone}` : ""}`;
    taskStatus.textContent = message || "";
  }

  async function ensureSavedTaskContext() {
    const context = capturePageContext();
    if (lastSavedContext && lastSavedContext.fingerprint === context.fingerprint && lastSavedContext.item) {
      return lastSavedContext.item;
    }
    const reusable = await findReusablePageMemory(context);
    if (reusable) {
      lastSavedContext = { fingerprint: context.fingerprint, item: reusable, context };
      return reusable;
    }
    setTaskStatus("Saving page context…", "working");
    const item = await saveContextSnapshot(context);
    await refreshWorkspaces();
    await refreshPageMemoryList();
    return item;
  }

  function defaultTaskTitle(memoryItem) {
    const base = memoryItem && memoryItem.title ? memoryItem.title : document.title;
    return `Follow up: ${base || "current page"}`;
  }

  function sameIdSet(a = [], b = []) {
    const left = [...new Set((Array.isArray(a) ? a : []).filter(Boolean))].sort();
    const right = [...new Set((Array.isArray(b) ? b : []).filter(Boolean))].sort();
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }

  async function findReusablePageMemory(context) {
    const urlKey = currentPageUrlKey();
    if (!urlKey) return null;
    const data = await request(`/api/memory/source?urlKey=${encodeURIComponent(urlKey)}&limit=50&offset=0`, { method: "GET" });
    const notes = (Array.isArray(data.items) ? data.items : []).filter(memoryMatchesCurrentPage);
    return notes.find((item) => {
      const contextMatches = item.fingerprint
        ? item.fingerprint === context.fingerprint
        : (item.pageExcerpt || "") === (context.pageExcerpt || "");
      return contextMatches &&
        (item.sourceType || "page") === context.sourceType &&
        (item.note || "") === context.note &&
        (item.snippet || "") === (context.snippet || "") &&
        sameIdSet(item.workspaceIds || item.taskIds || [], context.workspaceIds);
    }) || null;
  }

  async function createTaskFromPage() {
    setTaskStatus("Creating task…", "working");
    try {
      const memoryItem = await ensureSavedTaskContext();
      const title = taskTitleInput && taskTitleInput.value.trim() ? taskTitleInput.value.trim() : defaultTaskTitle(memoryItem);
      const notes = taskNotesInput && taskNotesInput.value.trim()
        ? taskNotesInput.value.trim()
        : (noteInput ? noteInput.value.trim() : "");
      const dueDate = taskDueInput ? taskDueInput.value : "";
      const priority = taskPrioritySelect ? taskPrioritySelect.getValue() : "none";
      const contextFingerprint = lastSavedContext && lastSavedContext.fingerprint
        ? lastSavedContext.fingerprint
        : (memoryItem.contentHash || memoryItem.id);
      const clientRequestId = `task:${contextFingerprint}:${fingerprintText([title, notes, dueDate, priority].join("\n"))}`;
      const actionContent = [notes, memoryItem.sourceSnippet || ""].filter(Boolean).join("\n");
      const data = await requestWithPrivacy("/api/actions/run", {
        method: "POST",
        body: JSON.stringify({
          type: "create_task",
          payload: {
            title,
            notes,
            dueDate,
            priority,
            sourceUrl: memoryItem.sourceUrl || location.href,
            sourceTitle: memoryItem.title || document.title,
            sourceSnippet: memoryItem.snippet || memoryItem.note || memoryItem.pageExcerpt || "",
            sourceMemoryIds: [memoryItem.id],
            privacyMeta: memoryItem.privacyMeta || lastPrivacyMeta || undefined,
            clientRequestId
          }
        })
      }, {
        operation: "create_task",
        contentSource: "page",
        content: actionContent,
        originalCharCount: actionContent.length
      });
      const task = data.result || data.task;
      setTaskStatus(data.duplicate ? `Task already exists: ${task.title}` : `Task created: ${task.title}`, "done");
      await refreshTaskList();
      await refreshPageMemoryList();
    } catch (error) {
      setTaskStatus(`Task failed: ${error.message}`, "error");
    }
  }

  async function draftTaskFromPage() {
    setTaskStatus("Drafting task…", "working");
    try {
      const context = capturePageContext();
      const sourceMemoryIds = lastSavedContext && lastSavedContext.item && lastSavedContext.item.id
        ? [lastSavedContext.item.id]
        : [];
      const data = await requestWithPrivacy("/api/actions/tasks/draft", {
        method: "POST",
        body: JSON.stringify({
          title: context.title,
          sourceTitle: context.title,
          sourceUrl: context.sourceUrl,
          url: context.sourceUrl,
          content: context.content,
          pageMeta: collectPageMeta(),
          sourceMemoryIds
        })
      }, {
        operation: "task_draft",
        contentSource: context.sourceType || "page",
        content: context.content,
        originalCharCount: String(context.content || "").length
      });
      const draft = data.draft || {};
      if (taskTitleInput) taskTitleInput.value = draft.title || `Follow up: ${document.title || "current page"}`;
      if (taskNotesInput) taskNotesInput.value = draft.notes || "";
      if (taskDueInput) taskDueInput.value = draft.dueDate || "";
      if (taskPrioritySelect) taskPrioritySelect.setValue(draft.priority || "none");
      setResultProvenance(data.privacyMeta || null);
      setTaskStatus("Task draft ready.", "done");
    } catch (error) {
      setTaskStatus(`Draft failed: ${error.message}`, "error");
    }
  }

  function taskStatusLabel(value) {
    return ({
      open: "Open",
      in_progress: "In Progress",
      done: "Done",
      archived: "Archived",
      all: "All"
    })[value] || value;
  }

  function taskPriorityLabel(value) {
    return ({
      none: "No priority",
      low: "Low",
      medium: "Medium",
      high: "High"
    })[value] || value || "No priority";
  }

  function contextTypeLabel(value) {
    return ({
      memory: "Note",
      workspace: "Workspace",
      contact: "Contact",
      task: "Task",
      source: "Source",
      extraction: "Extraction"
    })[value] || value || "Context";
  }

  function closeContextDrawer() {
    if (!contextDrawer) return;
    contextDrawer.hidden = true;
    if (contextDrawerBody) contextDrawerBody.textContent = "";
    if (contextDrawerStatus) contextDrawerStatus.textContent = "";
  }

  function renderContextGraph(data) {
    if (!contextDrawerBody || !contextDrawerStatus) return;
    const nodes = Array.isArray(data.nodes) ? data.nodes : [];
    const edges = Array.isArray(data.edges) ? data.edges : [];
    const warnings = Array.isArray(data.warnings) ? data.warnings : [];
    contextDrawerBody.textContent = "";
    contextDrawerStatus.textContent = `${nodes.length} nodes, ${edges.length} links`;

    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const section = document.createElement("div");
    section.className = "aaw-context-section";
    for (const node of nodes) {
      const item = document.createElement("div");
      item.className = "aaw-context-node";
      const title = document.createElement("div");
      title.className = "aaw-context-node-title";
      title.textContent = `${contextTypeLabel(node.type)}: ${node.label || node.entityId || node.id}`;
      const meta = document.createElement("div");
      meta.className = "aaw-memory-meta";
      meta.textContent = [node.subtitle, node.url].filter(Boolean).join(" • ");
      item.appendChild(title);
      if (meta.textContent) item.appendChild(meta);
      section.appendChild(item);
    }

    const linkSection = document.createElement("div");
    linkSection.className = "aaw-context-section";
    for (const edge of edges) {
      const line = document.createElement("div");
      line.className = "aaw-context-edge";
      const from = nodeMap.get(edge.from);
      const to = nodeMap.get(edge.to);
      line.textContent = `${from ? from.label : edge.from} -> ${to ? to.label : edge.to} (${edge.label || edge.type}${edge.relation && edge.relation !== "direct" ? `, ${edge.relation}` : ""})`;
      linkSection.appendChild(line);
    }

    contextDrawerBody.appendChild(section);
    if (edges.length) contextDrawerBody.appendChild(linkSection);
    if (warnings.length) {
      const warningSection = document.createElement("div");
      warningSection.className = "aaw-context-section aaw-context-warnings";
      for (const warning of warnings) {
        const line = document.createElement("div");
        line.className = "aaw-context-warning";
        line.textContent = warning.message || warning.code || "Context warning";
        warningSection.appendChild(line);
      }
      contextDrawerBody.appendChild(warningSection);
    }
  }

  async function openContextDrawer(path, label) {
    if (!contextDrawer || !contextDrawerBody || !contextDrawerTitle || !contextDrawerStatus) return;
    contextDrawer.hidden = false;
    contextDrawerTitle.textContent = label || "Context";
    contextDrawerBody.textContent = "Loading context…";
    contextDrawerStatus.textContent = "";
    try {
      renderContextGraph(await request(path, { method: "GET" }));
    } catch (error) {
      contextDrawerBody.textContent = `Context failed: ${error.message}`;
      contextDrawerStatus.textContent = "Error";
    }
  }

  function renderTaskCard(task) {
    const card = document.createElement("div");
    card.className = "aaw-task-card";
    card.dataset.taskId = String(task.id);

    const title = document.createElement("div");
    title.className = "aaw-task-title aaw-task-title--clamp";
    title.textContent = task.title || "Untitled task";
    if (task.title) title.title = task.title;

    const meta = document.createElement("div");
    meta.className = "aaw-memory-meta";
    meta.textContent = [
      taskStatusLabel(task.status),
      taskPriorityLabel(task.priority),
      task.dueDate ? `Due ${task.dueDate}` : "",
      task.sourceHost || hostnameForUrl(task.sourceUrl)
    ].filter(Boolean).join(" • ");

    const body = document.createElement("div");
    body.className = "aaw-memory-body aaw-memory-body--clamp";
    body.textContent = task.notes || task.sourceSnippet || "";
    if (body.textContent) body.title = body.textContent;

    const controls = document.createElement("div");
    controls.className = "aaw-actions aaw-task-actions";
    const statusDropdown = createDropdown({
      id: `aaw-task-status-${task.id}-${++_ddUidSeq}`,
      ariaLabel: "Task status",
      options: ["open", "in_progress", "done", "archived"].map((status) => ({ value: status, label: taskStatusLabel(status) })),
      value: task.status || "open",
      controlAttr: "status",
      onChange: (value) => { updateTask(task.id, { status: value }, "status"); }
    });
    const statusSelect = statusDropdown.element;

    const priorityDropdown = createDropdown({
      id: `aaw-task-priority-${task.id}-${++_ddUidSeq}`,
      ariaLabel: "Task priority",
      options: ["none", "low", "medium", "high"].map((priority) => ({ value: priority, label: taskPriorityLabel(priority) })),
      value: task.priority || "none",
      controlAttr: "priority",
      onChange: (value) => { updateTask(task.id, { priority: value }, "priority"); }
    });
    const prioritySelect = priorityDropdown.element;

    const dueInput = document.createElement("input");
    dueInput.type = "date";
    dueInput.value = task.dueDate || "";
    dueInput.setAttribute("aria-label", "Task due date");
    dueInput.dataset.aawControl = "due";
    dueInput.addEventListener("change", async () => {
      await updateTask(task.id, { dueDate: dueInput.value }, "due");
    });

    const doneButton = createButton(task.status === "done" ? "Reopen" : "Mark Done", async () => {
      await updateTask(task.id, { status: task.status === "done" ? "open" : "done" }, "primary");
    }, "ghost");
    doneButton.dataset.aawControl = "primary";
    const contextButton = createButton("View Context", () => viewTaskContext(task.id), "ghost");
    const graphButton = createButton("Graph", () => openContextDrawer(`/api/context/task/${encodeURIComponent(task.id)}`, task.title || "Task context"), "ghost");
    const deleteButton = createButton("Delete", () => deleteTask(task.id, deleteButton), "ghost");
    deleteButton.dataset.aawTest = "task-delete";

    // Group controls into predictable clusters: metadata, primary state action,
    // context/source actions, then the destructive action.
    const metaGroup = document.createElement("div");
    metaGroup.className = "aaw-task-control-group aaw-task-control-group--meta";
    metaGroup.appendChild(statusSelect);
    metaGroup.appendChild(prioritySelect);
    metaGroup.appendChild(dueInput);

    const primaryGroup = document.createElement("div");
    primaryGroup.className = "aaw-task-control-group aaw-task-control-group--primary";
    primaryGroup.appendChild(doneButton);

    const contextGroup = document.createElement("div");
    contextGroup.className = "aaw-task-control-group aaw-task-control-group--context";
    contextGroup.appendChild(contextButton);
    contextGroup.appendChild(graphButton);
    if (isSafeHttpUrl(task.sourceUrl)) {
      const open = document.createElement("a");
      open.className = "aaw-btn ghost";
      open.href = task.sourceUrl;
      open.target = "_blank";
      open.rel = "noopener noreferrer";
      open.textContent = "Open Source";
      contextGroup.appendChild(open);
    }

    const dangerGroup = document.createElement("div");
    dangerGroup.className = "aaw-task-control-group aaw-task-control-group--danger";
    dangerGroup.appendChild(deleteButton);

    controls.appendChild(metaGroup);
    controls.appendChild(primaryGroup);
    controls.appendChild(contextGroup);
    controls.appendChild(dangerGroup);

    card.appendChild(title);
    card.appendChild(meta);
    appendProvenanceBadge(card, task.privacyMeta);
    if (body.textContent) card.appendChild(body);
    card.appendChild(controls);
    return card;
  }

  // Restore focus after a task list re-render. Fallback order: the origin
  // control on the same task's card (e.g. status→status, priority→priority,
  // Mark Done→the primary action) if it survived, then any focusable in that
  // card, the first remaining card, the active filter tab, the create button,
  // then the task list/status region.
  function focusAfterTaskMutation(taskId, originControl) {
    if (!taskList) return;
    const cards = taskList.querySelectorAll(".aaw-task-card");
    const focusableIn = (el) => el && el.querySelector("button, select, input, a[href]");
    if (taskId != null) {
      for (const card of cards) {
        if (card.dataset.taskId === String(taskId)) {
          if (originControl) {
            const origin = card.querySelector(`[data-aaw-control="${originControl}"]`);
            if (origin) { origin.focus(); return; }
          }
          const target = focusableIn(card);
          if (target) { target.focus(); return; }
        }
      }
    }
    const firstTarget = cards.length ? focusableIn(cards[0]) : null;
    if (firstTarget) { firstTarget.focus(); return; }
    const activeFilter = taskTabButtonsRef.find((tab) => tab.classList.contains("is-active"));
    if (activeFilter && activeFilter.isConnected) { activeFilter.focus(); return; }
    if (btnCreateTaskRef && btnCreateTaskRef.isConnected) { btnCreateTaskRef.focus(); return; }
    const fallback = (taskList && taskList.isConnected) ? taskList : taskStatus;
    if (fallback && fallback.isConnected) {
      fallback.setAttribute("tabindex", "-1");
      fallback.focus();
    }
  }

  async function updateTask(id, patch, originControl) {
    setTaskStatus("Updating task…", "working");
    try {
      await request(`/api/actions/tasks/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
      });
      await refreshTaskList();
      setTaskStatus("Task updated.", "done");
      focusAfterTaskMutation(id, originControl);
    } catch (error) {
      setTaskStatus(`Task update failed: ${error.message}`, "error");
    }
  }

  async function deleteTask(id, button) {
    if (!window.confirm("Delete this task?")) {
      // Cancelled: native confirm steals focus, so restore it to the Delete button.
      if (button && button.isConnected) button.focus();
      return;
    }
    setTaskStatus("Deleting task…", "working");
    try {
      await request(`/api/actions/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
      await refreshTaskList();
      setTaskStatus("Task deleted.", "done");
      // The deleted card is gone; focusAfterTaskMutation falls through to the
      // next card, active filter, create button, then the task list/status.
      focusAfterTaskMutation(id);
    } catch (error) {
      setTaskStatus(`Task delete failed: ${error.message}`, "error");
      if (button && button.isConnected) button.focus();
    }
  }

  async function viewTaskContext(id) {
    setTaskStatus("Loading task context…", "working");
    try {
      const context = await request(`/api/actions/tasks/${encodeURIComponent(id)}/context`, { method: "GET" });
      const lines = [`Task: ${context.task.title}`];
      for (const entry of Array.isArray(context.items) ? context.items : []) {
        if (entry.unavailable || !entry.item) {
          lines.push(`- Missing memory: ${entry.id}`);
        } else {
          lines.push(`- ${entry.item.title || entry.id}: ${entry.item.note || entry.item.snippet || entry.item.summary || entry.item.pageExcerpt || ""}`);
        }
      }
      renderResult(lines.join("\n"), "summarize");
      setResultState("done", "Context");
      setTaskStatus("Context loaded.", "done");
    } catch (error) {
      setTaskStatus(`Context failed: ${error.message}`, "error");
    }
  }

  async function refreshTaskList() {
    if (!taskList) return;
    const requestId = ++taskListRequestId;
    taskList.textContent = "";
    const loading = document.createElement("div");
    loading.className = "aaw-empty-note";
    loading.textContent = "Loading tasks…";
    taskList.appendChild(loading);
    try {
      const data = await request(`/api/actions/tasks?status=${encodeURIComponent(taskFilter)}&limit=20&offset=0`, { method: "GET" });
      if (requestId !== taskListRequestId) return;
      const tasks = Array.isArray(data.tasks) ? data.tasks : [];
      taskList.textContent = "";
      if (!tasks.length) {
        const empty = document.createElement("div");
        empty.className = "aaw-empty-note";
        empty.textContent = "No tasks in this view.";
        taskList.appendChild(empty);
        return;
      }
      for (const task of tasks) {
        taskList.appendChild(renderTaskCard(task));
      }
    } catch (error) {
      if (requestId !== taskListRequestId) return;
      taskList.textContent = "";
      const failed = document.createElement("div");
      failed.className = "aaw-empty-note";
      failed.textContent = `Tasks failed to load: ${error.message}`;
      taskList.appendChild(failed);
    }
  }

  function setLeadStatus(message, tone) {
    if (!leadStatus) return;
    leadStatus.className = `aaw-status aaw-lead-status-line${tone ? ` aaw-lead-status-line--${tone}` : ""}`;
    leadStatus.textContent = message || "";
  }

  function leadStatusLabel(value) {
    return (LEAD_STATUS_OPTIONS.find((option) => option.value === value) || LEAD_STATUS_OPTIONS[0]).label;
  }

  function shortId(value) {
    const text = String(value || "");
    return text.length > 14 ? `${text.slice(0, 10)}…` : text;
  }

  function createLeadStatusSelect(value, onChange) {
    const dropdown = createDropdown({
      id: `aaw-lead-status-${++_ddUidSeq}`,
      ariaLabel: "Lead status",
      options: LEAD_STATUS_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
      value: value || "new",
      onChange: (next) => onChange(next)
    });
    dropdown.element.classList.add("aaw-lead-status-select");
    return dropdown.element;
  }

  function makeLeadField(labelText, value, onInput, options = {}) {
    const wrap = document.createElement("label");
    wrap.className = "aaw-lead-field";
    const label = document.createElement("span");
    label.textContent = labelText;
    const input = options.multiline ? document.createElement("textarea") : document.createElement("input");
    if (!options.multiline) input.type = options.type || "text";
    input.value = value || "";
    if (options.placeholder) input.placeholder = options.placeholder;
    if (options.multiline) input.rows = options.rows || 2;
    input.addEventListener("input", () => onInput(input.value));
    // Long fields (Email/Company) span the full grid row once the card is dense,
    // so values aren't clipped into an unreadable single ellipsised column.
    if (options.denseWide) wrap.classList.add("aaw-lead-field--dense-wide");
    wrap.appendChild(label);
    wrap.appendChild(input);
    return wrap;
  }

  function collectLeadPageMeta() {
    const meta = collectPageMeta();
    return {
      ...meta,
      hostname: location.hostname,
      sourceTitle: meta.sourceTitle || document.title
    };
  }

  function contactFromDraft(draft = {}) {
    return {
      ...draft,
      sourceUrl: draft.sourceUrl || location.href,
      sourceTitle: draft.sourceTitle || document.title,
      name: String(draft.name || "").trim() || "Unknown contact",
      company: String(draft.company || "").trim(),
      email: String(draft.email || "").trim(),
      phone: String(draft.phone || "").trim(),
      roleTitle: String(draft.roleTitle || "").trim(),
      notes: String(draft.notes || "").trim(),
      leadStatus: draft.leadStatus || "new",
      tags: Array.isArray(draft.tags) && draft.tags.length ? draft.tags : ["lead"],
      privacyMeta: draft.privacyMeta || lastPrivacyMeta || undefined
    };
  }

  function buildLeadMemoryNote(contact) {
    const parts = [
      contact.name,
      contact.roleTitle,
      contact.company,
      contact.email,
      contact.phone,
      contact.notes
    ].filter(Boolean);
    return parts.join("\n");
  }

  function renderLeadDrafts(emptyMessage = "Capture a page to create editable lead drafts.") {
    if (!leadDraftList) return;
    leadDraftList.textContent = "";
    if (!leadDrafts.length) {
      const empty = document.createElement("div");
      empty.className = "aaw-empty-note";
      empty.textContent = emptyMessage;
      leadDraftList.appendChild(empty);
      return;
    }

    leadDrafts.forEach((draft, index) => {
      const card = document.createElement("div");
      card.className = "aaw-lead-card aaw-lead-draft-card";
      card.setAttribute("data-aaw-test", "lead-draft-card");

      const title = document.createElement("div");
      title.className = "aaw-lead-card-title";
      title.textContent = draft.name || draft.company || "Lead draft";

      const meta = document.createElement("div");
      meta.className = "aaw-memory-meta";
      meta.textContent = [draft.company, draft.email, draft.phone].filter(Boolean).join(" • ");

      const fields = document.createElement("div");
      fields.className = "aaw-lead-grid";
      fields.appendChild(makeLeadField("Name", draft.name, (value) => { leadDrafts[index].name = value; title.textContent = value || leadDrafts[index].company || "Lead draft"; }));
      fields.appendChild(makeLeadField("Company", draft.company, (value) => { leadDrafts[index].company = value; }, { denseWide: true }));
      fields.appendChild(makeLeadField("Email", draft.email, (value) => { leadDrafts[index].email = value; }, { type: "email", denseWide: true }));
      fields.appendChild(makeLeadField("Phone", draft.phone, (value) => { leadDrafts[index].phone = value; }, { type: "tel" }));
      fields.appendChild(makeLeadField("Role", draft.roleTitle, (value) => { leadDrafts[index].roleTitle = value; }));

      // <div> wrapper (not <label>): a label would re-activate the dropdown's
      // <button> trigger when an option is clicked.
      const statusWrap = document.createElement("div");
      statusWrap.className = "aaw-lead-field";
      const statusLabel = document.createElement("span");
      statusLabel.textContent = "Status";
      statusWrap.appendChild(statusLabel);
      statusWrap.appendChild(createLeadStatusSelect(draft.leadStatus, (value) => { leadDrafts[index].leadStatus = value; }));
      fields.appendChild(statusWrap);

      const notes = makeLeadField("Notes", draft.notes, (value) => { leadDrafts[index].notes = value; }, { multiline: true, rows: 3 });
      notes.classList.add("aaw-lead-field--wide");

      const actions = document.createElement("div");
      actions.className = "aaw-actions aaw-lead-card-actions";
      const saveLeadButton = createButton("Save Lead", () => saveLeadDraft(index, saveLeadButton), "accent");
      saveLeadButton.setAttribute("data-aaw-test", "lead-save");
      actions.appendChild(saveLeadButton);
      const deleteDraftButton = createButton("Delete", () => {
        leadDrafts.splice(index, 1);
        renderLeadDrafts();
        setLeadStatus("Lead draft deleted.", "done");
      }, "ghost danger");
      deleteDraftButton.setAttribute("data-aaw-test", "lead-delete");
      actions.appendChild(deleteDraftButton);

      card.appendChild(title);
      if (meta.textContent) card.appendChild(meta);
      appendProvenanceBadge(card, draft.privacyMeta);
      card.appendChild(fields);
      card.appendChild(notes);
      card.appendChild(actions);
      leadDraftList.appendChild(card);
    });
  }

  async function captureLead() {
    const selection = getSelectedText();
    const snapshot = getReadablePageSnapshot();
    const content = selection || snapshot.content;
    if (!content.trim()) {
      setLeadStatus("No page text available to capture.", "error");
      return;
    }

    if (btnCaptureLead) btnCaptureLead.disabled = true;
    setLeadStatus(selection ? "Capturing selected lead details…" : "Capturing lead details from page…", "working");
    try {
      const data = await requestWithPrivacy("/api/contacts/extract", {
        method: "POST",
        body: JSON.stringify({
          title: document.title,
          sourceTitle: document.title,
          sourceUrl: location.href,
          content,
          pageMeta: collectLeadPageMeta()
        })
      }, { operation: "lead_capture", contentSource: selection ? "selection" : "page", content, originalCharCount: content.length });
      const privacyMeta = sanitizePrivacyMeta(data.privacyMeta);
      leadDrafts = (Array.isArray(data.contacts) ? data.contacts : []).map((draft) => ({
        ...draft,
        privacyMeta
      }));
      setResultProvenance(privacyMeta);
      if (!leadDrafts.length) {
        renderLeadDrafts("No lead details found on this page.");
        setLeadStatus("No lead details found on this page.", "done");
      } else {
        renderLeadDrafts();
        setLeadStatus(`${leadDrafts.length} lead draft${leadDrafts.length === 1 ? "" : "s"} ready.`, "done");
      }
    } catch (error) {
      setLeadStatus(`Lead capture failed: ${error.message}`, "error");
    } finally {
      if (btnCaptureLead) btnCaptureLead.disabled = false;
    }
  }

  async function saveLeadDraft(index, saveButton) {
    const draft = leadDrafts[index];
    if (!draft) return;
    // Per-draft guard: block duplicate saves for this draft while one is pending.
    // Other draft cards keep their own buttons enabled.
    if (saveButton) {
      if (saveButton.disabled) return;
      saveButton.disabled = true;
    }
    const contactBody = contactFromDraft(draft);
    setLeadStatus("Saving lead…", "working");
    try {
      const contactPrivacyContent = buildLeadMemoryNote(contactBody);
      const created = await requestWithPrivacy("/api/contacts", {
        method: "POST",
        body: JSON.stringify(contactBody)
      }, {
        operation: "save_contact",
        contentSource: "lead",
        content: contactPrivacyContent,
        originalCharCount: contactPrivacyContent.length
      });
      let contact = created.contact || created.result || contactBody;

      if (leadSaveMemoryCheckbox && leadSaveMemoryCheckbox.checked) {
        const note = buildLeadMemoryNote(contact);
        const memoryBody = {
          kind: "lead",
          contactId: contact.id,
          title: contact.name || contact.company || document.title,
          sourceUrl: contact.sourceUrl || location.href,
          snippet: note,
          pageExcerpt: note.slice(0, 5000),
          sourceType: "lead",
          note,
          summary: contact.company ? `${contact.name} at ${contact.company}` : contact.name,
          tags: ["lead"],
          privacyMeta: contact.privacyMeta || draft.privacyMeta || lastPrivacyMeta || undefined,
          workspaceIds: activeWorkspaceWriteIds(),
          taskIds: activeWorkspaceWriteIds()
        };
        const memory = await requestWithPrivacy("/api/memory/save", {
          method: "POST",
          body: JSON.stringify(memoryBody)
        }, {
          operation: "save_lead_memory",
          contentSource: "lead",
          content: note,
          originalCharCount: note.length
        });
        const memoryIds = Array.from(new Set([...(contact.memoryIds || []), memory.item && memory.item.id].filter(Boolean)));
        if (contact.id && memoryIds.length) {
          const patched = await request(`/api/contacts/${encodeURIComponent(contact.id)}`, {
            method: "PATCH",
            body: JSON.stringify({ memoryIds })
          });
          contact = patched.contact || contact;
        }
        await refreshPageMemoryList();
      }

      leadDrafts.splice(index, 1);
      renderLeadDrafts();
      await refreshContactList();
      setLeadStatus(`Saved lead: ${contact.name || contact.id}`, "done");
    } catch (error) {
      setLeadStatus(`Save failed: ${error.message}`, "error");
      // Restore only the clicked draft's button so the user can retry.
      if (saveButton && saveButton.isConnected) saveButton.disabled = false;
    }
  }

  function renderContactCard(contact) {
    const card = document.createElement("div");
    card.className = "aaw-lead-card aaw-contact-card";
    const title = document.createElement("div");
    title.className = "aaw-lead-card-title";
    title.textContent = contact.name || contact.company || "Saved contact";

    const meta = document.createElement("div");
    meta.className = "aaw-memory-meta";
    meta.textContent = [
      contact.company,
      contact.email,
      contact.phone,
      contact.sourceDomain || hostnameForUrl(contact.sourceUrl)
    ].filter(Boolean).join(" • ");

    const patch = {};
    const fields = document.createElement("div");
    fields.className = "aaw-lead-grid";
    fields.appendChild(makeLeadField("Name", contact.name, (value) => { patch.name = value; title.textContent = value || "Saved contact"; }));
    fields.appendChild(makeLeadField("Company", contact.company, (value) => { patch.company = value; }, { denseWide: true }));
    fields.appendChild(makeLeadField("Email", contact.email, (value) => { patch.email = value; }, { type: "email", denseWide: true }));
    fields.appendChild(makeLeadField("Phone", contact.phone, (value) => { patch.phone = value; }, { type: "tel" }));
    fields.appendChild(makeLeadField("Role", contact.roleTitle, (value) => { patch.roleTitle = value; }));

    // A custom dropdown's trigger is a <button>, which a wrapping <label> would
    // re-activate on option click; use a plain <div> wrapper instead.
    const statusWrap = document.createElement("div");
    statusWrap.className = "aaw-lead-field";
    const statusLabel = document.createElement("span");
    statusLabel.textContent = "Status";
    statusWrap.appendChild(statusLabel);
    statusWrap.appendChild(createLeadStatusSelect(contact.leadStatus, (value) => { patch.leadStatus = value; }));
    fields.appendChild(statusWrap);

    const notes = makeLeadField("Notes", contact.notes, (value) => { patch.notes = value; }, { multiline: true, rows: 2 });
    notes.classList.add("aaw-lead-field--wide");

    const memoryIds = Array.isArray(contact.memoryIds) ? contact.memoryIds : [];
    const memoryWrap = document.createElement("div");
    memoryWrap.className = "aaw-linked-memory-row";
    const memoryLabel = document.createElement("span");
    memoryLabel.className = "aaw-linked-memory-label";
    memoryLabel.textContent = "Linked memory";
    memoryWrap.appendChild(memoryLabel);
    if (memoryIds.length) {
      for (const memoryId of memoryIds) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "aaw-linked-memory-chip";
        chip.title = `Unlink ${memoryId}`;
        chip.textContent = `${shortId(memoryId)} x`;
        chip.addEventListener("click", async () => {
          const nextIds = memoryIds.filter((id) => id !== memoryId);
          setLeadStatus("Unlinking memory…", "working");
          try {
            await request(`/api/contacts/${encodeURIComponent(contact.id)}`, {
              method: "PATCH",
              body: JSON.stringify({ memoryIds: nextIds })
            });
            await refreshContactList();
            setLeadStatus("Memory unlinked.", "done");
          } catch (error) {
            setLeadStatus(`Unlink failed: ${error.message}`, "error");
          }
        });
        memoryWrap.appendChild(chip);
      }
    } else {
      const empty = document.createElement("span");
      empty.className = "aaw-linked-memory-empty";
      empty.textContent = "None";
      memoryWrap.appendChild(empty);
    }

    const actions = document.createElement("div");
    actions.className = "aaw-actions aaw-lead-card-actions";
    actions.appendChild(createButton("Save", async () => {
      if (!Object.keys(patch).length) {
        setLeadStatus("No contact changes to save.");
        return;
      }
      setLeadStatus("Updating contact…", "working");
      try {
        await request(`/api/contacts/${encodeURIComponent(contact.id)}`, {
          method: "PATCH",
          body: JSON.stringify(patch)
        });
        await refreshContactList();
        setLeadStatus("Contact updated.", "done");
      } catch (error) {
        setLeadStatus(`Update failed: ${error.message}`, "error");
      }
    }, "ghost"));
    actions.appendChild(createButton("Delete", async () => {
      setLeadStatus("Deleting contact…", "working");
      try {
        await request(`/api/contacts/${encodeURIComponent(contact.id)}`, { method: "DELETE" });
        await refreshContactList();
        setLeadStatus("Contact deleted.", "done");
      } catch (error) {
        setLeadStatus(`Delete failed: ${error.message}`, "error");
      }
    }, "danger"));
    actions.appendChild(createButton("Graph", () => openContextDrawer(`/api/context/contact/${encodeURIComponent(contact.id)}`, contact.name || "Contact context"), "ghost"));
    if (isSafeHttpUrl(contact.sourceUrl)) {
      const open = document.createElement("a");
      open.className = "aaw-btn ghost";
      open.href = contact.sourceUrl;
      open.target = "_blank";
      open.rel = "noopener noreferrer";
      open.textContent = "Open Source";
      actions.appendChild(open);
    }

    card.appendChild(title);
    if (meta.textContent) card.appendChild(meta);
    appendProvenanceBadge(card, contact.privacyMeta);
    card.appendChild(fields);
    card.appendChild(notes);
    card.appendChild(memoryWrap);
    card.appendChild(actions);
    return card;
  }

  async function refreshContactList() {
    if (!contactList) return;
    const requestId = ++contactListRequestId;
    const q = contactSearchInput ? contactSearchInput.value.trim() : "";
    const status = contactStatusSelect ? contactStatusSelect.getValue() : "";
    const limit = 20;
    contactList.textContent = "";
    const loading = document.createElement("div");
    loading.className = "aaw-empty-note";
    loading.textContent = "Loading contacts…";
    contactList.appendChild(loading);

    try {
      const data = await request(`/api/contacts?q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}&limit=${limit}&offset=${contactOffset}`, { method: "GET" });
      if (requestId !== contactListRequestId) return;
      const contacts = Array.isArray(data.contacts) ? data.contacts : [];
      contactTotal = Number(data.total || 0);
      if (contactPageInfo) {
        const start = contactTotal === 0 ? 0 : contactOffset + 1;
        const end = Math.min(contactOffset + contacts.length, contactTotal);
        contactPageInfo.textContent = contactTotal ? `${start}-${end} of ${contactTotal}` : "0 contacts";
      }
      if (btnContactPrev) btnContactPrev.disabled = contactOffset <= 0;
      if (btnContactNext) btnContactNext.disabled = contactOffset + limit >= contactTotal;
      contactList.textContent = "";
      if (!contacts.length) {
        const empty = document.createElement("div");
        empty.className = "aaw-empty-note";
        empty.textContent = q || status ? "No contacts match this filter." : "No saved contacts yet.";
        contactList.appendChild(empty);
        return;
      }
      for (const contact of contacts) {
        contactList.appendChild(renderContactCard(contact));
      }
    } catch (error) {
      if (requestId !== contactListRequestId) return;
      if (contactPageInfo) contactPageInfo.textContent = "";
      contactList.textContent = "";
      const failed = document.createElement("div");
      failed.className = "aaw-empty-note";
      failed.textContent = `Contacts failed to load: ${error.message}`;
      contactList.appendChild(failed);
    }
  }

  // Idle copy: the status line stays short while the results surface carries the
  // longer guidance, so the same helper text is not echoed in both places. The
  // status still contains "Search saved notes" for assistive-tech continuity.
  const SEARCH_IDLE_STATUS_TEXT = "Search saved notes.";
  const SEARCH_IDLE_RESULTS_TEXT = "Type a keyword or concept to find saved memory.";

  function setSearchState(state, message) {
    if (!searchStatus) return;
    searchStatus.className = `aaw-status aaw-search-status aaw-search-status--${state || "idle"}`;
    searchStatus.textContent = message || "";
  }

  // Clear control is hidden until there is a query to clear.
  function updateSearchClearVisibility() {
    if (!searchClearButton) return;
    searchClearButton.hidden = !(searchInput && searchInput.value);
  }

  function isSafeHttpUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }

  function appendHighlightedText(parent, text, terms = []) {
    const value = String(text || "");
    const cleanTerms = [...new Set(terms.map((term) => String(term || "").trim()).filter(Boolean))]
      .sort((a, b) => b.length - a.length);
    if (!value || cleanTerms.length === 0) {
      parent.appendChild(document.createTextNode(value));
      return;
    }

    const lower = value.toLowerCase();
    let index = 0;
    while (index < value.length) {
      let match = null;
      for (const term of cleanTerms) {
        if (lower.startsWith(term.toLowerCase(), index)) {
          match = term;
          break;
        }
      }
      if (!match) {
        let next = value.length;
        for (const term of cleanTerms) {
          const found = lower.indexOf(term.toLowerCase(), index + 1);
          if (found !== -1) next = Math.min(next, found);
        }
        parent.appendChild(document.createTextNode(value.slice(index, next)));
        index = next;
        continue;
      }
      const mark = document.createElement("span");
      mark.className = "aaw-highlight";
      mark.textContent = value.slice(index, index + match.length);
      parent.appendChild(mark);
      index += match.length;
    }
  }

  function matchLabelFor(item, rankingMode) {
    if (item.matchType === "semantic") return "Semantic match";
    if (item.matchType === "mixed") return "Mixed match";
    if (rankingMode === "keyword") return "Keyword match";
    return "Match";
  }

  function renderSearchCard(item, rankingMode) {
    const card = document.createElement("div");
    // The search card is non-clickable (only the title link and Graph action are
    // interactive), so it carries a modifier that suppresses the hover lift.
    card.className = "aaw-memory-result aaw-memory-result--search";

    const titleEl = document.createElement("div");
    titleEl.className = "aaw-memory-title";
    const titleText = item.title || "Untitled note";
    if (isSafeHttpUrl(item.sourceUrl)) {
      const link = document.createElement("a");
      link.href = item.sourceUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      appendHighlightedText(link, titleText, item.matchedTerms);
      titleEl.appendChild(link);
    } else {
      appendHighlightedText(titleEl, titleText, item.matchedTerms);
    }

    const metaEl = document.createElement("div");
    metaEl.className = "aaw-memory-meta";
    const host = item.sourceHost || hostnameForUrl(item.sourceUrl);
    const savedAt = item.createdAt ? new Date(item.createdAt).toLocaleDateString() : "";
    metaEl.textContent = [host, savedAt, matchLabelFor(item, rankingMode)].filter(Boolean).join(" • ");

    const chips = document.createElement("div");
    chips.className = "aaw-workspace-chips";
    for (const label of Array.isArray(item.workspaceLabels) ? item.workspaceLabels : []) {
      const chip = document.createElement("span");
      chip.className = "aaw-workspace-chip";
      chip.textContent = label;
      chips.appendChild(chip);
    }

    const bodyEl = document.createElement("div");
    // Visually clamp long previews; the full saved content stays in the DOM
    // (data attribute + accessible title) so nothing is lost to assistive tech.
    bodyEl.className = "aaw-memory-body aaw-memory-body--clamp";
    const previewText = item.note || item.summary || item.snippet || item.pageExcerpt || "";
    appendHighlightedText(bodyEl, previewText, item.matchedTerms);
    if (previewText) {
      bodyEl.dataset.aawFull = previewText;
      bodyEl.title = previewText;
    }

    const actions = document.createElement("div");
    actions.className = "aaw-actions";
    actions.appendChild(createButton("Graph", () => openContextDrawer(`/api/context/memory/${encodeURIComponent(item.id)}`, item.title || "Note context"), "ghost"));

    card.appendChild(titleEl);
    card.appendChild(metaEl);
    appendProvenanceBadge(card, item.privacyMeta);
    if (chips.childElementCount > 0) card.appendChild(chips);
    card.appendChild(bodyEl);
    card.appendChild(actions);
    return card;
  }

  // Structured state row (idle / empty / no-match / error) rendered inside
  // `search-results` so the surface reads consistently instead of going blank.
  // These rows are intentionally silent: `search-status` is the single live
  // region, so the row carries no aria-live/role to avoid double announcements.
  function searchStateRow(kind, message) {
    const row = document.createElement("div");
    row.className = `aaw-empty-note aaw-search-state aaw-search-state--${kind}`;
    const icon = document.createElement("span");
    icon.className = "aaw-search-state-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = kind === "error" ? "⚠" : kind === "idle" ? "⌕" : "∅";
    const text = document.createElement("span");
    text.className = "aaw-search-state-text";
    text.textContent = message;
    row.appendChild(icon);
    row.appendChild(text);
    return row;
  }

  function renderSearchStateRow(kind, message) {
    if (!searchResults) return;
    searchResults.innerHTML = "";
    searchResults.appendChild(searchStateRow(kind, message));
  }

  async function searchMemory(query, options = {}) {
    if (!searchResults) return;
    const trimmed = String(query || "").trim();
    if (!trimmed) {
      searchRequestSeq++;
      updateSearchClearVisibility();
      renderSearchStateRow("idle", SEARCH_IDLE_RESULTS_TEXT);
      setSearchState("idle", SEARCH_IDLE_STATUS_TEXT);
      return;
    }
    updateSearchClearVisibility();

    const seq = ++searchRequestSeq;
    setSearchState("searching", "Searching…");
    try {
      const data = await request(`/api/memory/search?q=${encodeURIComponent(trimmed)}&limit=20&offset=0`, { method: "GET" });
      if (seq !== searchRequestSeq) return;
      searchResults.innerHTML = "";
      const items = Array.isArray(data.items) ? data.items : [];

      if (data.memoryTotal === 0) {
        renderSearchStateRow("empty", "No saved memory yet.");
        setSearchState("empty", "No saved memory yet.");
        return;
      }
      if (items.length === 0) {
        renderSearchStateRow("none", "No matches.");
        setSearchState("none", "No matches.");
        return;
      }

      for (const item of items) {
        searchResults.appendChild(renderSearchCard(item, data.rankingMode));
      }
      // Prefer the API's total match count (total, then memoryTotal); fall back to
      // rendered count only when no API total is supplied so the status reflects
      // matches beyond the page.
      const totalCount = Number.isFinite(data.total)
        ? data.total
        : Number.isFinite(data.memoryTotal)
          ? data.memoryTotal
          : items.length;
      const fallback = data.fallbackReason ? " Keyword fallback is active." : "";
      setSearchState(data.fallbackReason ? "degraded" : "done", `${totalCount} result${totalCount === 1 ? "" : "s"}.${fallback}`);
    } catch (error) {
      if (seq !== searchRequestSeq) return;
      searchResults.innerHTML = "";
      renderSearchStateRow("error", `Search failed: ${error.message}`);
      setSearchState("error", `Search failed: ${error.message}`);
    }
  }

  function createButton(label, onClick, tone) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.className = tone ? `aaw-btn ${tone}` : "aaw-btn";
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    button.addEventListener("click", onClick);
    return button;
  }

  const BRAND_MARK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5.8 16.2C8.7 11.1 12.6 8.3 18.6 7" stroke="currentColor" stroke-width="3.7" stroke-linecap="round"/><circle cx="6.9" cy="8.2" r="2.2" fill="#48d6b5"/></svg>';

  const COMMAND_ICONS = {
    summarize: '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></svg>',
    rewrite: '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    extract: '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/></svg>'
  };

  function createCommandButton(label, mode, onClick, ariaLabel) {
    const button = createButton("", onClick);
    button.classList.add("aaw-command-btn");
    button.dataset.mode = mode;
    button.setAttribute("data-aaw-test", `cmd-${mode}`);
    button.setAttribute("aria-label", ariaLabel || label);
    button.setAttribute("aria-pressed", "false");
    button.title = ariaLabel || label;

    const iconEl = document.createElement("span");
    iconEl.className = "aaw-command-icon";
    iconEl.innerHTML = COMMAND_ICONS[mode] || "";
    iconEl.setAttribute("aria-hidden", "true");

    const title = document.createElement("span");
    title.className = "aaw-command-title";
    title.textContent = label;

    button.appendChild(iconEl);
    button.appendChild(title);
    return button;
  }

  function makeSection(title, subtitle, className, options = {}) {
    const section = document.createElement("section");
    section.className = className ? `aaw-section ${className}` : "aaw-section";

    const header = document.createElement("div");
    header.className = "aaw-section-head";

    const copy = document.createElement("div");
    copy.className = "aaw-section-copy";

    const label = document.createElement("div");
    label.className = "aaw-section-label";
    label.textContent = title;
    copy.appendChild(label);

    if (subtitle) {
      const sub = document.createElement("div");
      sub.className = "aaw-section-subtitle";
      sub.textContent = subtitle;
      copy.appendChild(sub);
    }

    const actions = document.createElement("div");
    actions.className = "aaw-section-actions";

    const body = document.createElement("div");
    body.className = "aaw-section-body";

    header.appendChild(copy);
    header.appendChild(actions);
    section.appendChild(header);
    section.appendChild(body);

    // Optional collapsible behavior. The header (and any badge in actions) stays
    // visible while the body can be hidden; a toggle button drives the state with
    // accessible aria-expanded / hidden semantics.
    if (options.collapsible) {
      const bodyId = body.id || `aaw-section-body-${++_ddUidSeq}`;
      body.id = bodyId;
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "aaw-section-toggle";
      toggle.setAttribute("aria-controls", bodyId);
      if (options.toggleTestId) toggle.setAttribute("data-aaw-test", options.toggleTestId);
      const setCollapsed = (collapsed) => {
        toggle.setAttribute("aria-expanded", String(!collapsed));
        body.hidden = collapsed;
        // The hidden attribute alone is overridden by the section body's CSS
        // display rule, so also drive inline display to actually hide the body.
        body.style.display = collapsed ? "none" : "";
        section.classList.toggle("aaw-section--collapsed", collapsed);
        toggle.textContent = collapsed ? "Expand" : "Collapse";
      };
      toggle.addEventListener("click", () => setCollapsed(!body.hidden));
      actions.appendChild(toggle);
      setCollapsed(Boolean(options.collapsed));
    }

    return { element: section, body, actions };
  }

  function makeField(labelText, child) {
    const wrap = document.createElement("div");
    wrap.className = "aaw-field";
    const label = document.createElement("label");
    label.textContent = labelText;
    wrap.appendChild(label);
    if (child) wrap.appendChild(child);
    return wrap;
  }

  // ─── Custom Dropdown Factory ──────────────────────────────────────────────
  //
  // Replaces native <select> elements with a fully accessible, dark-themed
  // custom dropdown. Returns { element, getValue(), setValue(v), setOptions(opts) }.
  //
  // - id         → placed on the trigger so <label for="id"> works unchanged
  // - ariaLabel  → set only when there is no external <label> element
  // - onChange   → called with newValue string on every user selection

  function _ensureDropdownListener() {
    if (_ddListenerReady) return;
    _ddListenerReady = true;
    // Capture phase so host-page stopPropagation() can't swallow the event.
    document.addEventListener("click", (e) => {
      if (!_ddCurrentOpen) return;
      if (!_ddCurrentOpen._wrapper.contains(e.target)) {
        _ddCurrentOpen._close();
      }
    }, true);
  }

  function createDropdown({ id, ariaLabel, options, value: initialValue, onChange, testId, controlAttr }) {
    _ensureDropdownListener();

    let _options   = options.slice();
    let _value     = initialValue !== undefined ? initialValue : (_options[0]?.value ?? "");
    let _isOpen    = false;
    let _activeIdx = -1;

    const listId = `${id}-listbox`;

    // ── DOM construction ────────────────────────────────────────────────────
    const wrapper = document.createElement("div");
    wrapper.className = "aaw-dropdown";

    const trigger = document.createElement("button");
    trigger.type      = "button";
    trigger.id        = id;          // preserves <label for="…"> association
    trigger.className = "aaw-dropdown__trigger";
    trigger.setAttribute("role",          "combobox");
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", listId);
    if (ariaLabel) trigger.setAttribute("aria-label", ariaLabel);
    // When no ariaLabel is given the external <label for="id"> handles association.

    const valueSpan = document.createElement("span");
    valueSpan.className = "aaw-dropdown__value"; // CSS text-overflow ellipsis

    const chevron = document.createElement("span");
    chevron.className = "aaw-dropdown__chevron";
    chevron.setAttribute("aria-hidden", "true");
    // Visual chevron rendered entirely by CSS ::before/::after — no text content.

    trigger.appendChild(valueSpan);
    trigger.appendChild(chevron);

    const list = document.createElement("ul");
    list.id        = listId;
    list.className = "aaw-dropdown__list";
    list.setAttribute("role", "listbox");
    if (ariaLabel) list.setAttribute("aria-label", ariaLabel);

    // Test/automation hooks mirror the options-page dropdown convention so the
    // shared selectFromDropdown helper works for panel dropdowns too.
    if (testId) {
      trigger.setAttribute("data-aaw-test", `${testId}-dropdown`);
      list.setAttribute("data-aaw-test", `${testId}-opt-listbox`);
    }
    // Focus-restoration / control hooks (e.g. task-card status→status mapping).
    if (controlAttr) trigger.dataset.aawControl = controlAttr;

    wrapper.appendChild(trigger);
    wrapper.appendChild(list);

    // closureRef is the object stored in _ddCurrentOpen — a plain object (not a
    // DOM node) so there are no circular GC issues.
    const closureRef = { _wrapper: wrapper };

    // ── Option rendering ────────────────────────────────────────────────────
    function _buildOptionEl(opt, idx) {
      const li = document.createElement("li");
      li.className = "aaw-dropdown__option";
      li.setAttribute("role",          "option");
      li.setAttribute("aria-selected", String(opt.value === _value));
      li.id            = `${id}-opt-${idx}`;
      li.dataset.value = opt.value;
      li.textContent   = opt.label;
      li.addEventListener("click", (e) => {
        e.stopPropagation();
        _select(opt.value);
        _close();
        trigger.focus();
      });
      li.addEventListener("mouseenter", () => _setActiveIdx(idx));
      return li;
    }

    function _renderOptions() {
      list.textContent = "";
      for (let i = 0; i < _options.length; i++) {
        list.appendChild(_buildOptionEl(_options[i], i));
      }
      _syncLabel();
    }

    function _syncLabel() {
      const match = _options.find((o) => o.value === _value);
      valueSpan.textContent = match ? match.label : (_options[0]?.label ?? "");
    }

    function _syncAriaSelected() {
      for (const li of list.querySelectorAll(".aaw-dropdown__option")) {
        const sel = li.dataset.value === _value;
        li.setAttribute("aria-selected", String(sel));
        li.classList.toggle("aaw-dropdown__option--selected", sel);
      }
    }

    function _setActiveIdx(idx) {
      const items = list.querySelectorAll(".aaw-dropdown__option");
      if (_activeIdx >= 0 && items[_activeIdx]) {
        items[_activeIdx].classList.remove("aaw-dropdown__option--active");
      }
      _activeIdx = idx;
      if (_activeIdx >= 0 && items[_activeIdx]) {
        const el = items[_activeIdx];
        el.classList.add("aaw-dropdown__option--active");
        trigger.setAttribute("aria-activedescendant", el.id);
        el.scrollIntoView({ block: "nearest" });
      } else {
        trigger.removeAttribute("aria-activedescendant");
      }
    }

    // ── Open / close ────────────────────────────────────────────────────────
    function _open() {
      if (_isOpen) return;
      // Read _ddCurrentOpen at call time — never capture in a closure.
      if (_ddCurrentOpen && _ddCurrentOpen !== closureRef) {
        _ddCurrentOpen._close();
      }
      _isOpen = true;
      _ddCurrentOpen = closureRef;
      wrapper.classList.add("aaw-dropdown--open");
      trigger.setAttribute("aria-expanded", "true");
      const sel = _options.findIndex((o) => o.value === _value);
      _setActiveIdx(sel >= 0 ? sel : 0);
    }

    function _close() {
      if (!_isOpen) return;
      _isOpen = false;
      if (_ddCurrentOpen === closureRef) _ddCurrentOpen = null;
      wrapper.classList.remove("aaw-dropdown--open");
      trigger.setAttribute("aria-expanded", "false");
      trigger.removeAttribute("aria-activedescendant");
      _activeIdx = -1;
      for (const li of list.querySelectorAll(".aaw-dropdown__option--active")) {
        li.classList.remove("aaw-dropdown__option--active");
      }
    }

    // Attach _close to closureRef AFTER the function is defined.
    closureRef._close = _close;

    // ── Selection ───────────────────────────────────────────────────────────
    function _select(newValue) {
      if (newValue === _value) return;
      _value = newValue;
      _syncLabel();
      _syncAriaSelected();
      if (typeof onChange === "function") onChange(_value);
    }

    // ── Keyboard & mouse ────────────────────────────────────────────────────
    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      if (_isOpen) _close(); else _open();
    });

    trigger.addEventListener("keydown", (e) => {
      const count = _options.length;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          if (!_isOpen) { _open(); break; }
          _setActiveIdx(Math.min(_activeIdx + 1, count - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          if (!_isOpen) { _open(); break; }
          _setActiveIdx(Math.max(_activeIdx - 1, 0));
          break;
        case "Home":
          e.preventDefault();
          if (_isOpen) _setActiveIdx(0);
          break;
        case "End":
          e.preventDefault();
          if (_isOpen) _setActiveIdx(count - 1);
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          if (!_isOpen) { _open(); break; }
          if (_activeIdx >= 0 && _options[_activeIdx]) {
            _select(_options[_activeIdx].value);
            _close();
            trigger.focus();
          }
          break;
        case "Escape":
          e.preventDefault();
          e.stopPropagation(); // prevent bubbling to root Escape → settings handler
          _close();
          trigger.focus();
          break;
        case "Tab":
          // Close without changing selection; let focus move naturally.
          _close();
          break;
      }
    });

    // ── Public API ──────────────────────────────────────────────────────────
    function getValue() { return _value; }

    function setValue(v) {
      if (!_options.some((o) => o.value === v)) return;
      _value = v;
      _syncLabel();
      _syncAriaSelected();
    }

    function setOptions(opts) {
      // Must close before mutating to avoid stale activeIdx on detached nodes.
      if (_isOpen) _close();
      _options = opts.slice();
      const stillValid = _options.some((o) => o.value === _value);
      if (!stillValid) _value = _options[0]?.value ?? "";
      _renderOptions();
      _syncAriaSelected();
    }

    // ── Initial render ──────────────────────────────────────────────────────
    _renderOptions();
    _syncAriaSelected();

    function focus() { trigger.focus(); }

    return { element: wrapper, trigger, getValue, setValue, setOptions, focus };
  }
  // ──────────────────────────────────────────────────────────────────────────

  function normalizeNoteTaskIds(item) {
    if (Array.isArray(item.workspaceIds)) return item.workspaceIds;
    return Array.isArray(item.taskIds) ? item.taskIds : [];
  }

  async function loadNoteWorkspaces(status = "all") {
    const data = await request(`/api/note-workspaces?status=${encodeURIComponent(status)}`, { method: "GET" });
    return Array.isArray(data.items) ? data.items : [];
  }

  function openWorkspaces() {
    return workspaceCache.filter((workspace) => workspace.status === "open");
  }

  // Active workspace selector offers Inbox plus every open project. Inbox is the
  // single "unassigned" target; archived projects are never selectable here.
  function activeWorkspaceSelectOptions() {
    return [{ value: "unassigned", label: "Unassigned" }]
      .concat(openWorkspaces().map((workspace) => ({ value: workspace.id, label: workspace.name })));
  }

  // Keep the selection valid: Inbox always stays Inbox; a project that no longer
  // exists or was archived falls back to Inbox.
  function normalizeSelectedWorkspace() {
    if (isInboxSelected()) {
      selectedWorkspaceId = "unassigned";
      return;
    }
    const current = workspaceById(selectedWorkspaceId);
    if (!current || current.status !== "open") selectedWorkspaceId = "unassigned";
  }

  function syncActiveWorkspaceSelect() {
    if (!activeWorkspaceSelect) return;
    activeWorkspaceSelect.setOptions(activeWorkspaceSelectOptions());
    activeWorkspaceSelect.setValue(isInboxSelected() ? "unassigned" : selectedWorkspaceId);
  }

  async function refreshWorkspaces() {
    renderWorkspaceListState("loading", "Loading workspaces…");
    try {
      workspaceCache = await loadNoteWorkspaces("all");
      normalizeSelectedWorkspace();
      syncActiveWorkspaceSelect();
      renderWorkspaceList();
      await renderWorkspaceNotes();
    } catch (error) {
      if (workspaceStatus) workspaceStatus.textContent = `Workspace load failed: ${error.message}`;
      renderWorkspaceListState("error", `Workspaces failed to load: ${error.message}`);
    }
  }

  // Show/hide the collapsed Workspaces create control. Collapsed by default so
  // the create input stays out of the way until the user asks for it.
  function setWorkspaceCreateOpen(open) {
    if (workspaceCreatePanel) workspaceCreatePanel.hidden = !open;
    if (workspaceCreateToggle) workspaceCreateToggle.setAttribute("aria-expanded", String(open));
  }

  async function createNoteWorkspace(sourceInput, sourceButton) {
    const input = sourceInput;
    const button = sourceButton;
    if (!input) return;
    const name = input.value.trim();
    if (!name) {
      if (workspaceStatus) workspaceStatus.textContent = "Workspace name is required.";
      return;
    }

    if (button) button.disabled = true;
    try {
      const data = await request("/api/note-workspaces", {
        method: "POST",
        body: JSON.stringify({ name })
      });
      input.value = "";
      if (data.workspace) selectedWorkspaceId = data.workspace.id;
      workspaceDashboardTab = "notes";
      setWorkspaceCreateOpen(false);
      await refreshWorkspaces();
      await refreshPageMemoryList();
      if (workspaceStatus) workspaceStatus.textContent = `Workspace created: ${name}`;
    } catch (error) {
      if (workspaceStatus) workspaceStatus.textContent = `Create failed: ${error.message}`;
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function updateNoteWorkspace(id, patch) {
    const data = await request(`/api/note-workspaces/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch)
    });
    return data.workspace;
  }

  // Fetch the counts shown in the delete confirmation so the user knows exactly
  // what a project deletion removes (its notes, contacts, and tasks).
  async function workspaceDeleteCounts(id) {
    const counts = { notes: 0, contacts: 0, tasks: 0 };
    try {
      const notes = await request(`/api/note-workspaces/${encodeURIComponent(id)}/notes?limit=1&offset=0`, { method: "GET" });
      counts.notes = Number.isFinite(notes.total) ? notes.total : (Array.isArray(notes.items) ? notes.items.length : 0);
    } catch {}
    try {
      const contacts = await request(`/api/contacts?workspaceId=${encodeURIComponent(id)}`, { method: "GET" });
      counts.contacts = Number.isFinite(contacts.total) ? contacts.total : (Array.isArray(contacts.items) ? contacts.items.length : 0);
    } catch {}
    try {
      const tasks = await request(`/api/actions/tasks?workspaceId=${encodeURIComponent(id)}&statuses=open,in_progress,done,archived`, { method: "GET" });
      counts.tasks = Number.isFinite(tasks.total) ? tasks.total : (Array.isArray(tasks.items) ? tasks.items.length : 0);
    } catch {}
    return counts;
  }

  async function deleteSelectedWorkspace(workspace) {
    if (!workspace || workspace.unassigned) return;
    if (workspaceStatus) workspaceStatus.textContent = "Checking project contents…";
    const counts = await workspaceDeleteCounts(workspace.id);
    const message = `Delete "${workspace.name}"? This permanently deletes the project and its contained notes, contacts, and tasks (${counts.notes} notes, ${counts.contacts} contacts, ${counts.tasks} tasks). This cannot be undone.`;
    if (!window.confirm(message)) {
      if (workspaceStatus) workspaceStatus.textContent = "Delete cancelled.";
      return;
    }
    try {
      await request(`/api/note-workspaces/${encodeURIComponent(workspace.id)}`, { method: "DELETE" });
      selectedWorkspaceId = "unassigned";
      await refreshWorkspaces();
      await refreshPageMemoryList();
      if (workspaceStatus) workspaceStatus.textContent = `Project deleted: ${workspace.name}`;
    } catch (error) {
      if (workspaceStatus) workspaceStatus.textContent = `Delete failed: ${error.message}`;
    }
  }

  function workspaceById(id) {
    return workspaceCache.find((workspace) => workspace.id === id) || null;
  }

  function hostnameForUrl(value) {
    try {
      return value ? new URL(value).hostname : "";
    } catch {
      return "";
    }
  }

  // Structured state row (empty / loading / error) shared across the workspace
  // list, dashboard, and body so every async surface reads consistently instead
  // of dropping a bare text node.
  function workspaceStateRow(kind, message) {
    const row = document.createElement("div");
    row.className = `aaw-empty-note aaw-workspace-state aaw-workspace-state--${kind}`;
    if (kind === "loading") row.setAttribute("aria-busy", "true");
    if (kind === "error") row.setAttribute("role", "alert");
    const icon = document.createElement("span");
    icon.className = "aaw-workspace-state-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = kind === "error" ? "⚠" : kind === "loading" ? "…" : "∅";
    const text = document.createElement("span");
    text.className = "aaw-workspace-state-text";
    text.textContent = message;
    row.appendChild(icon);
    row.appendChild(text);
    return row;
  }

  function renderWorkspaceListState(kind, message) {
    if (!workspaceList) return;
    workspaceList.textContent = "";
    workspaceList.appendChild(workspaceStateRow(kind, message));
  }

  // A single selectable row. Inbox is always first; open projects follow. There
  // are no filter tabs and no per-row Graph/Archive/Reopen actions.
  function workspaceRow({ id, label, count, isActive, isInbox }) {
    const row = document.createElement("div");
    row.className = "aaw-workspace-row";
    row.classList.toggle("aaw-workspace-row--active", isActive);

    const select = document.createElement("button");
    select.type = "button";
    select.className = "aaw-workspace-select";
    select.setAttribute("data-aaw-test", isInbox ? "workspace-row-inbox" : "workspace-active-select");
    if (isActive) select.setAttribute("aria-current", "true");
    select.addEventListener("click", () => {
      selectedWorkspaceId = id;
      syncActiveWorkspaceSelect();
      renderWorkspaceList();
      renderWorkspaceNotes();
    });
    const name = document.createElement("span");
    name.className = "aaw-workspace-name";
    name.textContent = label;
    select.appendChild(name);
    if (Number.isFinite(count)) {
      const meta = document.createElement("span");
      meta.className = "aaw-workspace-count";
      meta.textContent = `${count}`;
      select.appendChild(meta);
    }
    row.appendChild(select);
    return row;
  }

  function renderWorkspaceList() {
    if (!workspaceList) return;
    workspaceList.textContent = "";

    workspaceList.appendChild(workspaceRow({
      id: "unassigned",
      label: "Unassigned",
      count: NaN,
      isActive: isInboxSelected(),
      isInbox: true
    }));

    for (const workspace of openWorkspaces()) {
      const rowEl = workspaceRow({
        id: workspace.id,
        label: workspace.name,
        count: workspace.noteCount || 0,
        isActive: workspace.id === selectedWorkspaceId,
        isInbox: false
      });
      rowEl.setAttribute("data-aaw-test", "workspace-row");
      workspaceList.appendChild(rowEl);
    }
  }

  function workspaceDashboardPath() {
    if (isInboxSelected()) return "/api/note-workspaces/unassigned/dashboard?taskStatus=all";
    return `/api/note-workspaces/${encodeURIComponent(selectedWorkspaceId)}/dashboard?taskStatus=all`;
  }

  async function loadWorkspaceDashboard() {
    const path = workspaceDashboardPath();
    if (!path) return null;
    const data = await request(path, { method: "GET" });
    workspaceDashboardData = data;
    return data;
  }

  function renderWorkspaceDashboardHeader(data) {
    if (!workspaceDashboard) return;
    workspaceDashboard.textContent = "";
    if (!data) return;
    workspaceDashboard.setAttribute("data-aaw-test", "workspace-dashboard");

    const inbox = isInboxSelected();

    const header = document.createElement("div");
    header.className = "aaw-workspace-dashboard-header";
    const title = document.createElement("div");
    title.className = "aaw-context-title";
    // Header is the selected project name or "Unassigned" — no metrics strip.
    title.textContent = inbox ? "Unassigned" : (data.workspace && data.workspace.name ? data.workspace.name : "Workspace");
    header.appendChild(title);

    // Refresh always; Delete only for a real project (never Inbox). The utility
    // actions sit beside the title inside the header row, not as a separate row.
    const utilityActions = document.createElement("div");
    utilityActions.className = "aaw-actions aaw-workspace-utility-actions";
    utilityActions.appendChild(createButton("Refresh", async () => {
      await refreshWorkspaces();
      await renderWorkspaceNotes();
    }, "ghost"));
    if (!inbox && data.workspace && !data.workspace.unassigned) {
      const deleteButton = createButton("Delete", () => deleteSelectedWorkspace(data.workspace), "ghost danger");
      deleteButton.setAttribute("data-aaw-test", "workspace-delete");
      utilityActions.appendChild(deleteButton);
    }
    header.appendChild(utilityActions);

    // Dashboard panes: Notes and Contacts only. Default/invalid tab => notes.
    const tabs = document.createElement("div");
    tabs.className = "aaw-workspace-dashboard-tabs";
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("data-aaw-test", "workspace-detail-tabs");
    for (const tab of ["notes", "contacts"]) {
      const button = createButton(tab[0].toUpperCase() + tab.slice(1), () => {
        workspaceDashboardTab = tab;
        renderWorkspaceDashboardHeader(workspaceDashboardData);
        renderWorkspaceDashboardBody(workspaceDashboardData);
      }, workspaceDashboardTab === tab ? "accent" : "ghost");
      button.setAttribute("role", "tab");
      button.setAttribute("data-aaw-test", `workspace-tab-${tab}`);
      button.setAttribute("aria-selected", String(workspaceDashboardTab === tab));
      tabs.appendChild(button);
    }

    workspaceDashboard.appendChild(header);
    workspaceDashboard.appendChild(tabs);
  }

  // Explain a disabled dashboard action: the Inbox bucket has no project to
  // write to, read-only projects block writes, otherwise the current page is
  // unavailable.
  function disabledActionReason(data, permissions, action) {
    const workspace = data.workspace || {};
    if (workspace.unassigned) return `Select a project to ${action}.`;
    if (!permissions.canWrite) return "This project is read-only.";
    return `The current page is unavailable to ${action}.`;
  }

  function workspaceItemCard(titleText, metaText, bodyText) {
    const card = document.createElement("div");
    card.className = "aaw-memory-result";
    const title = document.createElement("div");
    title.className = "aaw-memory-title";
    title.textContent = titleText || "Untitled";
    const meta = document.createElement("div");
    meta.className = "aaw-memory-meta";
    meta.textContent = metaText || "";
    const body = document.createElement("div");
    body.className = "aaw-memory-body";
    body.textContent = bodyText || "";
    card.appendChild(title);
    if (meta.textContent) card.appendChild(meta);
    if (body.textContent) card.appendChild(body);
    return card;
  }

  function renderWorkspaceDashboardBody(data) {
    if (!workspaceNotes) return;
    workspaceNotes.textContent = "";
    if (!data) {
      workspaceNotes.appendChild(workspaceStateRow("empty", "No dashboard data."));
      return;
    }
    if (workspaceDashboardTab === "contacts") {
      const contacts = data.contacts && Array.isArray(data.contacts.items) ? data.contacts.items : [];
      if (!contacts.length) workspaceNotes.appendChild(workspaceStateRow("empty", "No contacts linked to this project."));
      for (const contact of contacts) {
        workspaceNotes.appendChild(workspaceItemCard(
          contact.name || contact.company || "Contact",
          [contact.company, contact.email, contact.leadStatus].filter(Boolean).join(" - "),
          contact.notes || ""
        ));
      }
      return;
    }
    // Default (and any invalid tab) renders Notes.
    renderWorkspaceMemoryItems(data.memory && data.memory.items || []);
  }

  function renderWorkspaceMemoryItems(notes) {
    if (!workspaceNotes) return;
    if (!notes.length) {
      workspaceNotes.appendChild(workspaceStateRow("empty", "No notes yet."));
      return;
    }
    for (const item of notes) {
      const card = document.createElement("div");
      card.className = "aaw-memory-result";

      const titleEl = document.createElement("div");
      titleEl.className = "aaw-memory-title";
      titleEl.textContent = item.title || "Untitled note";

      const metaEl = document.createElement("div");
      metaEl.className = "aaw-memory-meta";
      const host = hostnameForUrl(item.sourceUrl);
      metaEl.textContent = `${new Date(item.createdAt).toLocaleString()}${host ? ` - ${host}` : ""}`;

      const bodyEl = document.createElement("div");
      bodyEl.className = "aaw-memory-body";
      bodyEl.textContent = item.note || item.summary || item.snippet || "";

      const actions = document.createElement("div");
      actions.className = "aaw-actions";
      const editNote = createButton("Edit Note", () => {
        card.querySelector(".aaw-membership-editor")?.remove();
        const existing = card.querySelector(".aaw-note-editor");
        if (existing) existing.remove();
        else renderNoteEditor(card, item);
      }, "ghost");
      const move = createButton("Move", () => {
        card.querySelector(".aaw-note-editor")?.remove();
        const existing = card.querySelector(".aaw-membership-editor");
        if (existing) existing.remove();
        else renderMoveEditor(card, item);
      }, "ghost");
      move.setAttribute("data-aaw-test", "memory-move");
      const remove = createButton("Delete", () => deleteWorkspaceNote(item, remove), "ghost danger");
      actions.appendChild(editNote);
      actions.appendChild(move);
      actions.appendChild(remove);

      card.appendChild(titleEl);
      card.appendChild(metaEl);
      appendProvenanceBadge(card, item.privacyMeta);
      card.appendChild(bodyEl);
      card.appendChild(actions);
      workspaceNotes.appendChild(card);
    }
  }

  // Move a note to a single destination: Inbox or one open project. Replaces the
  // old multi-checkbox membership editor; archived projects are never offered.
  function moveSelectOptions() {
    return [{ value: "unassigned", label: "Unassigned" }]
      .concat(openWorkspaces().map((workspace) => ({ value: workspace.id, label: workspace.name })));
  }

  function renderMoveEditor(card, item, trigger) {
    const editor = document.createElement("div");
    editor.className = "aaw-membership-editor";
    editor.id = `aaw-move-editor-${item.id}`;
    const closeEditor = (restoreToTrigger) => {
      editor.remove();
      if (trigger) {
        trigger.setAttribute("aria-expanded", "false");
        if (restoreToTrigger) trigger.focus();
      }
    };
    if (trigger) {
      trigger.setAttribute("aria-expanded", "true");
      trigger.setAttribute("aria-controls", editor.id);
    }

    const currentIds = new Set(normalizeNoteTaskIds(item));
    const currentOpen = openWorkspaces().find((workspace) => currentIds.has(workspace.id));

    // <div> wrapper (not <label>): the dropdown trigger is a <button>, which a
    // wrapping <label> would re-activate when an option is clicked.
    const label = document.createElement("div");
    label.className = "aaw-note-editor-label";
    label.textContent = "Move to";
    const dropdown = createDropdown({
      id: `aaw-move-select-${item.id}-${++_ddUidSeq}`,
      ariaLabel: "Move note to workspace",
      options: moveSelectOptions(),
      value: currentOpen ? currentOpen.id : "unassigned"
    });
    dropdown.element.setAttribute("data-aaw-test", "memory-move-select");
    label.appendChild(dropdown.element);

    const actions = document.createElement("div");
    actions.className = "aaw-actions";
    const save = createButton("Save", async () => {
      const workspaceIds = dropdown.getValue() === "unassigned" ? [] : [dropdown.getValue()];
      save.disabled = true;
      try {
        await request(`/api/memory/${encodeURIComponent(item.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ workspaceIds, taskIds: workspaceIds })
        });
        setActionStatus("Note moved.", "saved");
        await refreshWorkspaces();
        await refreshPageMemoryList();
        await renderWorkspaceNotes();
        if (btnSaveMemory) btnSaveMemory.focus();
      } catch (error) {
        setActionStatus(`Move failed: ${error.message}`, "error");
        save.disabled = false;
      }
    }, "accent");
    const cancel = createButton("Cancel", () => closeEditor(true), "ghost");
    actions.appendChild(save);
    actions.appendChild(cancel);
    editor.appendChild(label);
    editor.appendChild(actions);
    card.appendChild(editor);
    dropdown.focus();
  }

  function renderNoteEditor(card, item, trigger) {
    const editor = document.createElement("div");
    editor.className = "aaw-note-editor";
    editor.id = `aaw-note-editor-${item.id}`;
    const closeEditor = (restoreToTrigger) => {
      editor.remove();
      if (trigger) {
        trigger.setAttribute("aria-expanded", "false");
        if (restoreToTrigger) trigger.focus();
      }
    };
    if (trigger) {
      trigger.setAttribute("aria-expanded", "true");
      trigger.setAttribute("aria-controls", editor.id);
    }

    const noteLabel = document.createElement("label");
    noteLabel.className = "aaw-note-editor-label";
    noteLabel.textContent = "Note";
    const textarea = document.createElement("textarea");
    textarea.value = item.note || "";
    textarea.rows = 4;
    noteLabel.appendChild(textarea);

    const tagsLabel = document.createElement("label");
    tagsLabel.className = "aaw-note-editor-label";
    tagsLabel.textContent = "Tags";
    const tags = document.createElement("input");
    tags.type = "text";
    tags.value = Array.isArray(item.tags) ? item.tags.join(", ") : "";
    tagsLabel.appendChild(tags);

    const actions = document.createElement("div");
    actions.className = "aaw-actions";
    const save = createButton("Save", async () => {
      const nextTags = tags.value.split(",").map((tag) => tag.trim()).filter(Boolean);
      save.disabled = true;
      try {
        await request(`/api/memory/${encodeURIComponent(item.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ note: textarea.value, tags: nextTags })
        });
        setActionStatus("Note updated.", "saved");
        await refreshWorkspaces();
        await refreshPageMemoryList();
        if (btnSaveMemory) btnSaveMemory.focus();
      } catch (error) {
        setActionStatus(`Update failed: ${error.message}`, "error");
        save.disabled = false;
      }
    }, "accent");
    const cancel = createButton("Cancel", () => closeEditor(true), "ghost");
    actions.appendChild(save);
    actions.appendChild(cancel);

    editor.appendChild(noteLabel);
    editor.appendChild(tagsLabel);
    editor.appendChild(actions);
    card.appendChild(editor);
    textarea.focus();
  }

  async function deleteWorkspaceNote(item, button) {
    if (!window.confirm("Delete this saved note?")) {
      // Cancelled: native confirm steals focus, so restore it to the Delete button.
      if (button && button.isConnected) button.focus();
      return;
    }
    button.disabled = true;
    try {
      await request(`/api/memory/${encodeURIComponent(item.id)}`, { method: "DELETE" });
      setActionStatus("Note deleted.", "saved");
      await refreshWorkspaces();
      await refreshPageMemoryList();
      // The card (and its Delete button) is gone after refresh; fall back to a nearby control.
      if (btnSaveMemory) btnSaveMemory.focus();
    } catch (error) {
      setActionStatus(`Delete failed: ${error.message}`, "error");
      button.disabled = false;
      if (button && button.isConnected) button.focus();
    }
  }

  async function refreshPageMemoryList() {
    if (!pageMemoryList) return;
    pageMemoryList.textContent = "Loading…";
    try {
      const urlKey = currentPageUrlKey();
      if (!urlKey) {
        pageMemoryList.textContent = "Saved notes are unavailable for this page URL.";
        return;
      }
      const data = await request(`/api/memory/source?urlKey=${encodeURIComponent(urlKey)}&limit=50&offset=0`, { method: "GET" });
      const notes = (Array.isArray(data.items) ? data.items : [])
        .filter(memoryMatchesCurrentPage);

      pageMemoryList.textContent = "";
      if (notes.length === 0) {
        pageMemoryList.textContent = "No saved notes on this page.";
        return;
      }

      for (const item of notes) {
        const card = document.createElement("div");
        card.className = "aaw-memory-result aaw-page-memory-card";

        const titleEl = document.createElement("div");
        titleEl.className = "aaw-memory-title";
        titleEl.textContent = item.title || "Untitled note";

        const metaEl = document.createElement("div");
        metaEl.className = "aaw-memory-meta";
        const sourceLabel = item.sourceType === "selection" ? "Selection" : "Full page";
        metaEl.textContent = `${sourceLabel} • ${formatSavedDate(item.createdAt)}`;

        const bodyEl = document.createElement("div");
        bodyEl.className = "aaw-memory-body";
        bodyEl.textContent = item.note || item.summary || item.snippet || "";

        const actions = document.createElement("div");
        actions.className = "aaw-actions";
        const editNote = createButton("Edit Note", () => {
          card.querySelector(".aaw-membership-editor")?.remove();
          move.setAttribute("aria-expanded", "false");
          const existing = card.querySelector(".aaw-note-editor");
          if (existing) {
            existing.remove();
            editNote.setAttribute("aria-expanded", "false");
          } else {
            renderNoteEditor(card, item, editNote);
          }
        }, "ghost");
        editNote.setAttribute("aria-expanded", "false");
        const move = createButton("Move", () => {
          card.querySelector(".aaw-note-editor")?.remove();
          editNote.setAttribute("aria-expanded", "false");
          const existing = card.querySelector(".aaw-membership-editor");
          if (existing) {
            existing.remove();
            move.setAttribute("aria-expanded", "false");
          } else {
            renderMoveEditor(card, item, move);
          }
        }, "ghost");
        move.setAttribute("data-aaw-test", "memory-move");
        move.setAttribute("aria-expanded", "false");
        const remove = createButton("Delete", () => deleteWorkspaceNote(item, remove), "ghost danger");
        actions.appendChild(editNote);
        actions.appendChild(move);
        actions.appendChild(remove);

        card.appendChild(titleEl);
        card.appendChild(metaEl);
        appendProvenanceBadge(card, item.privacyMeta);
        card.appendChild(bodyEl);
        card.appendChild(actions);
        pageMemoryList.appendChild(card);
      }
    } catch (error) {
      pageMemoryList.textContent = `Saved notes failed: ${error.message}`;
    }
  }

  async function renderWorkspaceNotes() {
    if (!workspaceNotes) return;
    workspaceNotes.textContent = "";
    workspaceNotes.appendChild(workspaceStateRow("loading", "Loading workspace dashboard…"));
    if (workspaceDashboard) {
      workspaceDashboard.textContent = "";
      workspaceDashboard.appendChild(workspaceStateRow("loading", "Loading workspace…"));
    }
    try {
      const dashboard = await loadWorkspaceDashboard();
      if (!dashboard) {
        if (workspaceDashboard) {
          workspaceDashboard.textContent = "";
          workspaceDashboard.appendChild(workspaceStateRow("empty", "Select a workspace to view its dashboard."));
        }
        workspaceNotes.textContent = "";
        workspaceNotes.appendChild(workspaceStateRow("empty", "Select a workspace to view its dashboard."));
        return;
      }
      renderWorkspaceDashboardHeader(dashboard);
      renderWorkspaceDashboardBody(dashboard);
    } catch (error) {
      workspaceNotes.textContent = "";
      workspaceNotes.appendChild(workspaceStateRow("error", `Workspace dashboard failed: ${error.message}`));
      if (workspaceDashboard) {
        workspaceDashboard.textContent = "";
        workspaceDashboard.appendChild(workspaceStateRow("error", `Workspace failed to load: ${error.message}`));
      }
    }
  }

  async function buildPanel() {
    const settings = await loadSettings();
    remoteBackendUrl = settings.backendUrl;
    await loadAppearanceMode();

    root = document.createElement("aside");
    root.className = "aaw-root aaw-hidden";
    applyPanelTheme();
    root.setAttribute("data-aaw-test", "panel");
    root.setAttribute("role", "complementary");
    root.setAttribute("aria-label", "Workspace Assistant panel");

    // --- Header (unified — morphs between main and settings views) ---
    const header = document.createElement("div");
    header.className = "aaw-header";

    const headerLeftSlot = document.createElement("div");
    headerLeftSlot.className = "aaw-header-left-slot";

    const logoMark = document.createElement("div");
    logoMark.className = "aaw-logo-mark";
    logoMark.setAttribute("aria-hidden", "true");
    logoMark.innerHTML = BRAND_MARK_SVG;
    headerLeftSlot.appendChild(logoMark);
    header.appendChild(headerLeftSlot);

    // Brand group.
    const headerBrand = document.createElement("div");
    headerBrand.className = "aaw-header-brand";
    const kicker = document.createElement("div");
    kicker.className = "aaw-kicker";
    kicker.textContent = "Workspace Assistant";
    const titleEl = document.createElement("div");
    titleEl.className = "aaw-title";
    titleEl.textContent = "On-page AI";
    headerBrand.appendChild(kicker);
    headerBrand.appendChild(titleEl);
    header.appendChild(headerBrand);

    // Right-side controls: gear (opens full options page) + close.
    const headerRight = document.createElement("div");
    headerRight.className = "aaw-header-right";

    const gearButton = document.createElement("button");
    gearButton.type = "button";
    gearButton.className = "aaw-btn-icon";
    gearButton.setAttribute("data-aaw-test", "settings-open");
    gearButton.setAttribute("aria-label", "Open full settings");
    gearButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
    gearButton.addEventListener("click", openOptionsPage);
    headerRight.appendChild(gearButton);

    const closeButton = createButton("Close", () => { _closePanel(); }, "ghost");
    closeButton.setAttribute("aria-label", "Close panel");
    closeButton.setAttribute("data-aaw-test", "panel-close");
    headerRight.appendChild(closeButton);
    header.appendChild(headerRight);

    // --- Analyze ---
    const analyzeSection = makeSection("Analyze", "Run focused page commands against selected text or the full page.", "aaw-section--analyze");

    const actionsFieldWrap = document.createElement("div");
    actionsFieldWrap.className = "aaw-field aaw-field--compact";
    const actionsRow = document.createElement("div");
    actionsRow.className = "aaw-command-strip";
    btnSummarize = createCommandButton("Summarize", "summarize", () => analyze("summarize"));
    btnRewrite = createCommandButton("Rewrite", "rewrite", runRewrite);
    btnExtract = createCommandButton("Extract", "extract", () => analyze("extract"), "Extract structured data");
    actionsRow.appendChild(btnSummarize);
    actionsRow.appendChild(btnRewrite);
    actionsRow.appendChild(btnExtract);
    actionsFieldWrap.appendChild(actionsRow);

    sourceHint = document.createElement("div");
    sourceHint.className = "aaw-source-hint";
    sourceHint.setAttribute("data-aaw-test", "source-hint");
    sourceHint.setAttribute("aria-live", "polite");
    actionsFieldWrap.appendChild(sourceHint);

    instructionInput = document.createElement("textarea");
    instructionInput.placeholder = "Guidance for summarize, rewrite, or extract (optional)";
    instructionInput.rows = 2;
    const instructionWrap = makeField("Guidance", instructionInput);

    rewriteControls = document.createElement("div");
    rewriteControls.className = "aaw-rewrite-controls";
    const goalGroup = document.createElement("div");
    goalGroup.className = "aaw-segmented";
    for (const [value, label] of [["clearer", "Clearer"], ["shorter", "Shorter"], ["professional", "Professional"]]) {
      const goalButton = createButton(label, () => {
        rewriteGoal = value;
        goalGroup.querySelectorAll(".aaw-btn").forEach((button) => button.classList.toggle("accent", button.dataset.goal === value));
      }, value === rewriteGoal ? "accent" : "ghost");
      goalButton.dataset.goal = value;
      goalGroup.appendChild(goalButton);
    }
    rewriteStatus = document.createElement("div");
    rewriteStatus.className = "aaw-status";
    rewriteStatus.setAttribute("data-aaw-test", "rewrite-status");
    rewriteStatus.textContent = "Select text on the page, then choose a goal to rewrite it.";
    rewriteStatus.setAttribute("aria-live", "polite");
    rewritePreview = document.createElement("pre");
    rewritePreview.className = "aaw-result aaw-rewrite-preview";
    rewritePreview.setAttribute("data-aaw-test", "rewrite-preview");
    rewritePreview.hidden = true;
    const rewriteActions = document.createElement("div");
    rewriteActions.className = "aaw-actions";
    rewriteCopyButton = createButton("Copy Rewrite", copyRewritePreview, "ghost");
    rewriteCopyButton.hidden = true;
    rewriteUndoButton = createButton("Undo Replace", undoRewrite, "ghost");
    rewriteUndoButton.hidden = true;
    rewriteActions.appendChild(rewriteCopyButton);
    rewriteActions.appendChild(rewriteUndoButton);
    rewriteControls.appendChild(goalGroup);
    rewriteControls.appendChild(rewriteStatus);
    rewriteControls.appendChild(rewritePreview);
    rewriteControls.appendChild(rewriteActions);

    // Quiet nested panel so the rewrite controls read as a sub-group of Analyze
    // (command strip → Guidance → Rewrite options) rather than peer controls.
    const rewritePanel = document.createElement("div");
    rewritePanel.className = "aaw-rewrite-panel";
    const rewritePanelLabel = document.createElement("div");
    rewritePanelLabel.className = "aaw-rewrite-panel-label";
    rewritePanelLabel.textContent = "Rewrite options";
    rewritePanel.appendChild(rewritePanelLabel);
    rewritePanel.appendChild(rewriteControls);

    analyzeSection.body.appendChild(actionsFieldWrap);
    analyzeSection.body.appendChild(instructionWrap);
    analyzeSection.body.appendChild(rewritePanel);

    // --- Result area ---
    const resultSection = makeSection("Result", "Copy, expand, or clear the latest assistant output.", "aaw-section--result");
    resultStatusChip = document.createElement("span");
    resultStatusChip.className = "aaw-result-chip aaw-result-chip--ready";
    resultStatusChip.setAttribute("data-aaw-test", "result-chip");
    resultStatusChip.textContent = "Ready";
    resultSection.actions.appendChild(resultStatusChip);

    const resultWrap = document.createElement("div");
    resultWrap.className = "aaw-result-wrap";
    resultWrap.setAttribute("data-state", "ready");
    const resultToolbar = document.createElement("div");
    resultToolbar.className = "aaw-result-toolbar";
    resultCopyButton = createButton("Copy", copyResult, "ghost");
    resultCopyButton.setAttribute("data-aaw-test", "result-copy");
    resultToolbar.appendChild(resultCopyButton);
    resultExpandButton = createButton("Expand", () => setResultExpanded(!resultExpanded), "ghost");
    resultExpandButton.setAttribute("data-aaw-test", "result-expand");
    resultExpandButton.setAttribute("aria-expanded", "false");
    resultExpandButton.setAttribute("aria-controls", "aaw-result-output");
    resultToolbar.appendChild(resultExpandButton);
    resultClearButton = createButton("Clear", clearResult, "ghost");
    resultClearButton.setAttribute("data-aaw-test", "result-clear");
    resultToolbar.appendChild(resultClearButton);
    resultArea = document.createElement("pre");
    resultArea.id = "aaw-result-output";
    resultArea.className = "aaw-result aaw-result--prose";
    resultArea.setAttribute("data-aaw-test", "result-output");
    resultArea.setAttribute("data-state", "ready");
    resultArea.setAttribute("aria-busy", "false");
    resultArea.setAttribute("tabindex", "0");
    resultArea.textContent = "Select text or use the full page, then run an action.";
    resultArea.setAttribute("aria-live", "polite");
    resultArea.setAttribute("aria-label", "AI result output");
    resultCopyFeedback = document.createElement("div");
    resultCopyFeedback.className = "aaw-result-copy-feedback";
    resultCopyFeedback.setAttribute("data-aaw-test", "result-copy-feedback");
    resultCopyFeedback.setAttribute("aria-live", "polite");
    resultCopyFeedback.setAttribute("role", "status");
    resultProvenance = document.createElement("div");
    resultProvenance.className = "aaw-provenance-row";
    resultProvenance.setAttribute("data-aaw-test", "result-provenance");
    resultProvenance.hidden = true;
    resultWrap.appendChild(resultToolbar);
    resultWrap.appendChild(resultArea);
    resultWrap.appendChild(resultCopyFeedback);
    resultWrap.appendChild(resultProvenance);
    resultSection.body.appendChild(resultWrap);
    refreshResultControls();

    // --- Memory / actions ---
    const memorySection = makeSection("Page Memory", "Save page context to the active project or Unassigned.", "aaw-section--memory");
    const pagePreview = document.createElement("div");
    pagePreview.className = "aaw-page-preview";
    pagePreviewTitle = document.createElement("div");
    pagePreviewTitle.className = "aaw-page-preview-title";
    pagePreviewMeta = document.createElement("div");
    pagePreviewMeta.className = "aaw-page-preview-meta";
    pagePreview.appendChild(pagePreviewTitle);
    pagePreview.appendChild(pagePreviewMeta);
    updatePagePreview();

    noteInput = document.createElement("textarea");
    noteInput.placeholder = "Add a note or context for this page";
    noteInput.rows = 3;
    noteInput.setAttribute("data-aaw-test", "memory-note-input");
    const memoryWrap = makeField("Save to memory", noteInput);

    // Single active-workspace selector: Inbox plus every open project. Changing it
    // retargets writes (selectedWorkspaceId) and resets the dashboard to Notes.
    activeWorkspaceSelect = createDropdown({
      id: "aaw-active-workspace",
      ariaLabel: "Active workspace",
      options: activeWorkspaceSelectOptions(),
      value: isInboxSelected() ? "unassigned" : selectedWorkspaceId,
      onChange: (value) => {
        selectedWorkspaceId = value;
        normalizeSelectedWorkspace();
        workspaceDashboardTab = "notes";
        renderWorkspaceList();
        renderWorkspaceNotes();
      }
    });
    activeWorkspaceSelect.element.setAttribute("data-aaw-test", "active-workspace-selector");

    const memoryButtons = document.createElement("div");
    memoryButtons.className = "aaw-actions aaw-memory-actions";
    btnSaveMemory = createButton("Save Memory", saveMemory, "accent");
    btnSaveMemory.setAttribute("data-aaw-test", "save-memory");

    // Primary save row: active-workspace selector sits directly with Save Memory.
    const memorySaveRow = document.createElement("div");
    memorySaveRow.className = "aaw-memory-save-row";
    memorySaveRow.appendChild(activeWorkspaceSelect.element);
    memorySaveRow.appendChild(btnSaveMemory);

    const actionTypeDropdown = createDropdown({
      id: "aaw-action-type",
      ariaLabel: "Action type",
      options: [
        { value: "save_contact", label: "Save Contact" },
        { value: "open_draft",   label: "Open Draft" }
      ],
      value: "save_contact"
    });
    actionTypeSelect = actionTypeDropdown;

    btnRunAction = createButton("Run Action", runAction, "ghost");
    const pageGraphButton = createButton("Page Graph", () => {
      const urlKey = currentPageUrlKey();
      if (!urlKey) {
        setActionStatus("Page context is unavailable for this URL.", "error");
        return;
      }
      openContextDrawer(`/api/context/source?urlKey=${encodeURIComponent(urlKey)}`, document.title || "Page context");
    }, "ghost");
    pageGraphButton.setAttribute("data-aaw-test", "page-graph");
    const memorySecondaryActions = document.createElement("div");
    memorySecondaryActions.className = "aaw-memory-actions-secondary";
    memorySecondaryActions.appendChild(actionTypeDropdown.element);
    memorySecondaryActions.appendChild(btnRunAction);
    memorySecondaryActions.appendChild(pageGraphButton);
    memoryButtons.appendChild(memorySaveRow);
    memoryButtons.appendChild(memorySecondaryActions);
    memoryWrap.appendChild(memoryButtons);

    actionStatus = document.createElement("div");
    actionStatus.className = "aaw-status";
    actionStatus.setAttribute("data-aaw-test", "memory-status");
    actionStatus.setAttribute("aria-live", "polite");
    memoryWrap.appendChild(actionStatus);
    const pageSavedWrap = document.createElement("div");
    pageSavedWrap.className = "aaw-field aaw-field--compact";
    const pageSavedLabel = document.createElement("div");
    pageSavedLabel.className = "aaw-section-label";
    pageSavedLabel.textContent = "Saved on this page";
    pageMemoryList = document.createElement("div");
    pageMemoryList.className = "aaw-search-results aaw-page-memory-list";
    pageMemoryList.setAttribute("data-aaw-test", "page-memory-list");
    pageMemoryList.setAttribute("aria-live", "polite");
    pageSavedWrap.appendChild(pageSavedLabel);
    pageSavedWrap.appendChild(pageMemoryList);
    memorySection.body.appendChild(pagePreview);
    memorySection.body.appendChild(memoryWrap);
    memorySection.body.appendChild(pageSavedWrap);

    // --- Lead Capture ---
    const leadSection = makeSection("Lead Capture", "Extract people and companies from the current page.", "aaw-section--leads");
    const leadActions = document.createElement("div");
    leadActions.className = "aaw-actions aaw-lead-actions";
    btnCaptureLead = createButton("Capture Lead", captureLead, "accent");
    btnCaptureLead.setAttribute("data-aaw-test", "lead-capture");
    leadActions.appendChild(btnCaptureLead);
    leadSection.body.appendChild(leadActions);
    // The "linked memory" toggle gets its own row under Capture Lead so the
    // primary action stays dominant and the long label never crowds the button.
    const saveMemoryLabel = document.createElement("label");
    saveMemoryLabel.className = "aaw-checkbox-row aaw-lead-memory-option";
    leadSaveMemoryCheckbox = document.createElement("input");
    leadSaveMemoryCheckbox.type = "checkbox";
    leadSaveMemoryCheckbox.checked = true;
    saveMemoryLabel.appendChild(leadSaveMemoryCheckbox);
    const saveMemoryText = document.createElement("span");
    saveMemoryText.textContent = "Create linked memory on save";
    saveMemoryLabel.appendChild(saveMemoryText);
    leadSection.body.appendChild(saveMemoryLabel);

    leadStatus = document.createElement("div");
    leadStatus.className = "aaw-status aaw-lead-status-line";
    leadStatus.setAttribute("data-aaw-test", "lead-status");
    leadStatus.textContent = "Capture selected text or the full page.";
    leadStatus.setAttribute("aria-live", "polite");
    leadSection.body.appendChild(leadStatus);

    const leadDraftWrap = document.createElement("div");
    leadDraftWrap.className = "aaw-field aaw-field--compact";
    const leadDraftLabel = document.createElement("div");
    leadDraftLabel.className = "aaw-section-label";
    leadDraftLabel.textContent = "Drafts";
    leadDraftList = document.createElement("div");
    leadDraftList.className = "aaw-lead-list";
    leadDraftList.setAttribute("data-aaw-test", "lead-drafts");
    leadDraftList.setAttribute("aria-live", "polite");
    leadDraftWrap.appendChild(leadDraftLabel);
    leadDraftWrap.appendChild(leadDraftList);
    leadSection.body.appendChild(leadDraftWrap);
    renderLeadDrafts();

    const contactWrap = document.createElement("div");
    contactWrap.className = "aaw-field aaw-field--compact";
    const contactLabel = document.createElement("div");
    contactLabel.className = "aaw-section-label";
    contactLabel.textContent = "Saved Contacts";
    const contactFilters = document.createElement("div");
    contactFilters.className = "aaw-contact-filters";
    contactSearchInput = document.createElement("input");
    contactSearchInput.type = "search";
    contactSearchInput.placeholder = "Search contacts";
    contactSearchInput.setAttribute("aria-label", "Search contacts");
    contactSearchInput.addEventListener("input", () => {
      clearTimeout(contactSearchDebounce);
      contactOffset = 0;
      contactSearchDebounce = setTimeout(refreshContactList, 250);
    });
    contactStatusSelect = createDropdown({
      id: `aaw-contact-status-${++_ddUidSeq}`,
      ariaLabel: "Filter contacts by status",
      testId: "contact-status",
      options: [{ value: "", label: "All statuses" }]
        .concat(LEAD_STATUS_OPTIONS.map((option) => ({ value: option.value, label: option.label }))),
      value: "",
      onChange: () => {
        contactOffset = 0;
        refreshContactList();
      }
    });
    contactFilters.appendChild(contactSearchInput);
    contactFilters.appendChild(contactStatusSelect.element);
    const contactPager = document.createElement("div");
    contactPager.className = "aaw-contact-pager";
    btnContactPrev = createButton("Prev", () => {
      contactOffset = Math.max(0, contactOffset - 20);
      refreshContactList();
    }, "ghost");
    btnContactNext = createButton("Next", () => {
      if (contactOffset + 20 < contactTotal) {
        contactOffset += 20;
        refreshContactList();
      }
    }, "ghost");
    contactPageInfo = document.createElement("span");
    contactPageInfo.className = "aaw-contact-page-info";
    contactPageInfo.textContent = "";
    btnContactPrev.disabled = true;
    btnContactNext.disabled = true;
    contactPager.appendChild(btnContactPrev);
    contactPager.appendChild(contactPageInfo);
    contactPager.appendChild(btnContactNext);
    contactList = document.createElement("div");
    contactList.className = "aaw-lead-list";
    contactList.setAttribute("data-aaw-test", "contact-list");
    contactList.setAttribute("aria-live", "polite");
    contactWrap.appendChild(contactLabel);
    contactWrap.appendChild(contactFilters);
    contactWrap.appendChild(contactPager);
    contactWrap.appendChild(contactList);
    leadSection.body.appendChild(contactWrap);

    // --- Tasks ---
    const taskSection = makeSection("Tasks", "Experimental developer workflow — save page context and create follow-up work.", "aaw-section--tasks", { collapsible: true, collapsed: true, toggleTestId: "task-section-toggle" });
    const taskDevBadge = document.createElement("span");
    taskDevBadge.className = "aaw-dev-badge";
    taskDevBadge.setAttribute("data-aaw-test", "task-dev-badge");
    taskDevBadge.textContent = "Dev feature";
    taskDevBadge.title = "Experimental developer workflow";
    taskSection.actions.appendChild(taskDevBadge);
    const taskFields = document.createElement("div");
    taskFields.className = "aaw-task-create-grid";
    taskTitleInput = document.createElement("input");
    taskTitleInput.type = "text";
    taskTitleInput.placeholder = "Task title";
    taskTitleInput.value = `Follow up: ${document.title || "current page"}`;
    taskTitleInput.setAttribute("aria-label", "Task title");
    taskTitleInput.setAttribute("data-aaw-test", "task-title");
    taskFields.appendChild(taskTitleInput);

    taskDueInput = document.createElement("input");
    taskDueInput.type = "date";
    taskDueInput.setAttribute("aria-label", "Task due date");
    taskDueInput.setAttribute("data-aaw-test", "task-due");
    taskFields.appendChild(taskDueInput);

    taskPrioritySelect = createDropdown({
      id: `aaw-task-priority-create-${++_ddUidSeq}`,
      ariaLabel: "Task priority",
      options: [
        { value: "none", label: "No priority" },
        { value: "low", label: "Low" },
        { value: "medium", label: "Medium" },
        { value: "high", label: "High" }
      ],
      value: "none"
    });
    taskPrioritySelect.element.setAttribute("data-aaw-test", "task-priority");
    taskFields.appendChild(taskPrioritySelect.element);
    taskSection.body.appendChild(taskFields);

    taskNotesInput = document.createElement("textarea");
    taskNotesInput.rows = 2;
    taskNotesInput.placeholder = "Task notes";
    taskNotesInput.setAttribute("data-aaw-test", "task-notes");
    const taskNotesWrap = makeField("Follow-up notes", taskNotesInput);
    taskSection.body.appendChild(taskNotesWrap);

    const taskActions = document.createElement("div");
    taskActions.className = "aaw-actions";
    const btnDraftTask = createButton("Draft From Page", draftTaskFromPage, "ghost");
    btnDraftTaskRef = btnDraftTask;
    btnDraftTask.setAttribute("data-aaw-test", "task-draft");
    const btnCreateTask = createButton("Create Task", createTaskFromPage, "accent");
    btnCreateTaskRef = btnCreateTask;
    btnCreateTask.setAttribute("data-aaw-test", "task-create");
    taskActions.appendChild(btnDraftTask);
    taskActions.appendChild(btnCreateTask);
    taskSection.body.appendChild(taskActions);

    taskStatus = document.createElement("div");
    taskStatus.className = "aaw-status aaw-task-status-line";
    taskStatus.setAttribute("data-aaw-test", "task-status");
    taskStatus.textContent = "Create tasks linked to saved page context.";
    taskStatus.setAttribute("aria-live", "polite");
    taskSection.body.appendChild(taskStatus);

    // Compact segmented control: the lifecycle statuses sit together in one
    // segment, with "All" split off as a separate reset so it reads as a
    // distinct scope rather than just another status.
    const taskTabs = document.createElement("div");
    taskTabs.className = "aaw-task-tabs aaw-task-filter";
    taskTabs.setAttribute("role", "group");
    taskTabs.setAttribute("aria-label", "Filter tasks by status");
    const taskFilterSegment = document.createElement("div");
    taskFilterSegment.className = "aaw-task-filter-segment";
    taskTabs.appendChild(taskFilterSegment);
    const taskTabButtons = [];
    for (const status of ["open", "in_progress", "done", "archived", "all"]) {
      const button = createButton(taskStatusLabel(status), () => {
        taskFilter = status;
        for (const tab of taskTabButtons) {
          const active = tab.dataset.status === status;
          tab.classList.toggle("is-active", active);
          tab.setAttribute("aria-pressed", String(active));
        }
        refreshTaskList();
      }, "ghost");
      button.dataset.status = status;
      const active = status === taskFilter;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
      taskTabButtons.push(button);
      if (status === "all") {
        button.classList.add("aaw-task-filter-all");
        taskTabs.appendChild(button);
      } else {
        taskFilterSegment.appendChild(button);
      }
    }
    taskTabButtonsRef = taskTabButtons;
    taskSection.body.appendChild(taskTabs);

    taskList = document.createElement("div");
    taskList.className = "aaw-task-list";
    taskList.setAttribute("data-aaw-test", "task-list");
    taskList.setAttribute("aria-live", "polite");
    taskSection.body.appendChild(taskList);

    // --- Workspaces ---
    const workspaceSection = makeSection("Workspaces", "Organize saved notes into projects and folders.", "aaw-section--workspaces");
    const workspaceWrap = document.createElement("div");
    workspaceWrap.className = "aaw-field aaw-field--compact";
    // Create lives behind a collapsed toggle in the section header so the body
    // leads with the create panel; the input/button stay hidden until requested.
    workspaceCreateToggle = createButton("New Project", () => {
      const open = workspaceCreatePanel.hidden;
      setWorkspaceCreateOpen(open);
      if (open) workspaceSectionCreateInput.focus();
    }, "ghost");
    workspaceCreateToggle.setAttribute("data-aaw-test", "workspace-create-toggle");
    workspaceCreateToggle.setAttribute("aria-expanded", "false");
    workspaceCreateToggle.setAttribute("aria-controls", "aaw-workspace-create-panel");
    workspaceSection.actions.appendChild(workspaceCreateToggle);
    workspaceCreatePanel = document.createElement("div");
    workspaceCreatePanel.className = "aaw-workspace-create-panel";
    workspaceCreatePanel.id = "aaw-workspace-create-panel";
    workspaceCreatePanel.setAttribute("data-aaw-test", "workspace-create-panel");
    workspaceCreatePanel.hidden = true;
    const workspaceSectionCreateRow = document.createElement("div");
    workspaceSectionCreateRow.className = "aaw-workspace-create";
    const workspaceSectionCreateInput = document.createElement("input");
    workspaceSectionCreateInput.type = "text";
    workspaceSectionCreateInput.placeholder = "New workspace";
    workspaceSectionCreateInput.setAttribute("data-aaw-test", "workspace-section-create-input");
    workspaceSectionCreateInput.setAttribute("aria-label", "New note workspace name");
    const btnSectionCreateWorkspace = createButton(
      "Create",
      () => createNoteWorkspace(workspaceSectionCreateInput, btnSectionCreateWorkspace),
      "ghost"
    );
    btnSectionCreateWorkspace.setAttribute("data-aaw-test", "workspace-section-create");
    workspaceSectionCreateInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        createNoteWorkspace(workspaceSectionCreateInput, btnSectionCreateWorkspace);
      }
    });
    workspaceSectionCreateRow.appendChild(workspaceSectionCreateInput);
    workspaceSectionCreateRow.appendChild(btnSectionCreateWorkspace);
    workspaceCreatePanel.appendChild(workspaceSectionCreateRow);
    workspaceWrap.appendChild(workspaceCreatePanel);
    workspaceList = document.createElement("div");
    workspaceList.className = "aaw-workspace-list";
    workspaceList.setAttribute("data-aaw-test", "workspace-list");
    workspaceWrap.appendChild(workspaceList);
    workspaceDashboard = document.createElement("div");
    workspaceDashboard.className = "aaw-workspace-dashboard";
    workspaceDashboard.setAttribute("data-aaw-test", "workspace-dashboard");
    workspaceWrap.appendChild(workspaceDashboard);
    workspaceNotes = document.createElement("div");
    workspaceNotes.className = "aaw-search-results";
    workspaceNotes.setAttribute("data-aaw-test", "workspace-body");
    workspaceNotes.setAttribute("aria-live", "polite");
    workspaceWrap.appendChild(workspaceNotes);
    workspaceStatus = document.createElement("div");
    workspaceStatus.className = "aaw-status";
    workspaceStatus.setAttribute("data-aaw-test", "workspace-status");
    workspaceStatus.setAttribute("aria-live", "polite");
    workspaceWrap.appendChild(workspaceStatus);
    workspaceSection.body.appendChild(workspaceWrap);

    // --- Search ---
    const searchSection = makeSection("Search Saved Memory", "Find saved workspace memory by keyword or concept.", "aaw-section--search");
    const searchWrap = document.createElement("div");
    searchWrap.className = "aaw-field";
    const searchLabel = document.createElement("label");
    searchLabel.textContent = "Search workspace memory";
    searchLabel.setAttribute("for", "aaw-search-input");
    searchWrap.appendChild(searchLabel);
    searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.id = "aaw-search-input";
    searchInput.setAttribute("data-aaw-test", "search-input");
    searchInput.placeholder = "Keywords or concept";
    searchInput.setAttribute("aria-label", "Search workspace memory");
    searchInput.addEventListener("input", (event) => {
      clearTimeout(searchDebounceTimer);
      const value = event.target.value;
      updateSearchClearVisibility();
      searchDebounceTimer = setTimeout(() => searchMemory(value), 300);
    });
    searchInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        clearTimeout(searchDebounceTimer);
        searchMemory(searchInput.value);
      } else if (event.key === "Escape") {
        event.preventDefault();
        clearTimeout(searchDebounceTimer);
        searchInput.value = "";
        searchMemory("");
        searchInput.focus();
      }
    });
    const searchInputRow = document.createElement("div");
    searchInputRow.className = "aaw-search-input-row";
    searchInputRow.appendChild(searchInput);
    searchClearButton = document.createElement("button");
    const searchClear = searchClearButton;
    searchClear.type = "button";
    searchClear.className = "aaw-search-clear";
    searchClear.setAttribute("data-aaw-test", "search-clear");
    searchClear.setAttribute("aria-label", "Clear search");
    searchClear.title = "Clear search";
    searchClear.textContent = "Clear";
    searchClear.hidden = true; // revealed once the query is non-empty
    searchClear.addEventListener("mousedown", (event) => event.preventDefault());
    searchClear.addEventListener("click", () => {
      clearTimeout(searchDebounceTimer);
      searchInput.value = "";
      updateSearchClearVisibility();
      searchMemory("");
      searchInput.focus();
    });
    searchInputRow.appendChild(searchClear);
    searchWrap.appendChild(searchInputRow);
    searchStatus = document.createElement("div");
    searchStatus.className = "aaw-status aaw-search-status aaw-search-status--idle";
    searchStatus.setAttribute("data-aaw-test", "search-status");
    searchStatus.textContent = SEARCH_IDLE_STATUS_TEXT;
    searchStatus.setAttribute("aria-live", "polite");
    searchWrap.appendChild(searchStatus);
    searchResults = document.createElement("div");
    searchResults.className = "aaw-search-results";
    searchResults.setAttribute("data-aaw-test", "search-results");
    // search-status is the single live region; results are not announced to
    // avoid duplicate readouts of the same result-count change.
    searchResults.appendChild(searchStateRow("idle", SEARCH_IDLE_RESULTS_TEXT));
    searchWrap.appendChild(searchResults);
    searchSection.body.appendChild(searchWrap);

    // --- Panel-side settings status (read-only summary; full editor lives in options page) ---
    const panelSettingsSection = makeSection("Settings", "Manage AI provider, privacy, notes, duplicates, and backup from the full settings page.", "aaw-section--settings");
    const panelSettingsStatus = document.createElement("div");
    panelSettingsStatus.className = "aaw-settings-meta";
    panelSettingsStatus.setAttribute("data-aaw-test", "panel-settings-status");
    panelSettingsStatus.setAttribute("aria-live", "polite");
    panelSettingsStatus.textContent = "Loading settings…";
    panelSettingsSection.body.appendChild(panelSettingsStatus);
    const panelSettingsActions = document.createElement("div");
    panelSettingsActions.className = "aaw-actions";
    panelSettingsActions.appendChild(createButton("Open Settings", openOptionsPage, "accent"));
    panelSettingsSection.body.appendChild(panelSettingsActions);
    _panelSettingsStatusEl = panelSettingsStatus;

    // --- Two-view container ---
    const viewContainer = document.createElement("div");
    viewContainer.className = "aaw-view-container";

    // Main view: all the working-panel content.
    _viewMain = document.createElement("div");
    _viewMain.className = "aaw-view aaw-view--main";
    _viewMain.setAttribute("role", "region");
    _viewMain.setAttribute("aria-label", "Assistant tools");
    _viewMain.appendChild(analyzeSection.element);
    _viewMain.appendChild(resultSection.element);
    _viewMain.appendChild(memorySection.element);
    _viewMain.appendChild(workspaceSection.element);
    _viewMain.appendChild(leadSection.element);
    _viewMain.appendChild(taskSection.element);
    _viewMain.appendChild(searchSection.element);
    _viewMain.appendChild(panelSettingsSection.element);

    registerCommandRegistry({
      analyze: analyzeSection.element,
      result: resultSection.element,
      memory: memorySection.element,
      leads: leadSection.element,
      tasks: taskSection.element,
      workspaces: workspaceSection.element,
      search: searchSection.element
    });

    viewContainer.appendChild(_viewMain);

    contextDrawer = document.createElement("aside");
    contextDrawer.className = "aaw-context-drawer";
    contextDrawer.hidden = true;
    contextDrawer.setAttribute("data-aaw-test", "context-drawer");
    contextDrawer.setAttribute("aria-label", "Context graph");
    const contextHeader = document.createElement("div");
    contextHeader.className = "aaw-context-header";
    contextDrawerTitle = document.createElement("div");
    contextDrawerTitle.className = "aaw-context-title";
    contextDrawerTitle.textContent = "Context";
    const contextClose = createButton("Close", closeContextDrawer, "ghost");
    contextHeader.appendChild(contextDrawerTitle);
    contextHeader.appendChild(contextClose);
    contextDrawerStatus = document.createElement("div");
    contextDrawerStatus.className = "aaw-memory-meta";
    contextDrawerBody = document.createElement("div");
    contextDrawerBody.className = "aaw-context-body";
    contextDrawer.appendChild(contextHeader);
    contextDrawer.appendChild(contextDrawerStatus);
    contextDrawer.appendChild(contextDrawerBody);

    // Screen-reader live region for navigation announcements.
    _liveRegion = document.createElement("div");
    _liveRegion.setAttribute("role", "status");
    _liveRegion.setAttribute("aria-live", "polite");
    _liveRegion.setAttribute("aria-atomic", "true");
    _liveRegion.className = "aaw-sr-only";

    // Assemble root
    root.appendChild(header);
    root.appendChild(_liveRegion);
    root.appendChild(viewContainer);
    root.appendChild(contextDrawer);
    document.documentElement.appendChild(root);

    root.addEventListener("keydown", handlePanelShortcut);
    document.addEventListener("selectionchange", debounce(updatePagePreview, 150));
    document.addEventListener("selectionchange", debounce(refreshRewriteSelectionStatus, 150));
    refreshRewriteSelectionStatus();

    refreshPanelSettingsStatus();
    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local") return;
        const watched = ["assistantBackendUrl", "llmProvider", "geminiApiKey", "openaiApiKey", "anthropicApiKey", "geminiModel", "openaiModel", "anthropicModel", "privacySettings", "notesFolderName", "notesMirrorStatus", "appearanceSettings"];
        if (!watched.some((key) => Object.prototype.hasOwnProperty.call(changes, key))) return;
        if (changes.assistantBackendUrl) {
          remoteBackendUrl = changes.assistantBackendUrl.newValue || "";
        }
        if (changes.appearanceSettings) {
          appearanceMode = settingsTools.normalizeAppearanceSettings
            ? settingsTools.normalizeAppearanceSettings(changes.appearanceSettings.newValue).mode
            : ((changes.appearanceSettings.newValue && changes.appearanceSettings.newValue.mode) || "dark");
          applyPanelTheme();
        }
        refreshPanelSettingsStatus();
      });
    }

    // Follow OS light/dark changes live while the user is on "system".
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      const onSchemeChange = () => { if (appearanceMode === "system") applyPanelTheme(); };
      if (media.addEventListener) media.addEventListener("change", onSchemeChange);
      else if (media.addListener) media.addListener(onSchemeChange);
    }
    if (workspaceStatus) workspaceStatus.textContent = "Loading workspaces…";
    refreshWorkspaces();
    refreshPageMemoryList();
    refreshContactList();
    refreshTaskList();
  }

  async function togglePanel() {
    if (!root) await buildPanel();

    if (root.classList.contains("aaw-hidden")) {
      // Opening: reveal the panel and refresh the on-page preview/memory list.
      updatePagePreview();
      refreshPageMemoryList();
      _openPanel();
    } else {
      _closePanel();
    }
  }

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message && message.type === "TOGGLE_ASSISTANT") togglePanel();
    if (message && message.type === "AAW_OPEN_COMMAND_PALETTE") openCommandPalette();
  });
})();
