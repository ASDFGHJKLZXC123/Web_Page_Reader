(function initAssistant() {
  if (window.__assistantAcrossWebsitesLoaded) {
    return;
  }
  window.__assistantAcrossWebsitesLoaded = true;

  // remoteBackendUrl is empty by default = use built-in service worker.
  // If the user sets a URL in Settings, all requests go there instead.
  const BACKEND_URL_KEY = "assistantBackendUrl";

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

  let root = null;
  let resultArea = null;
  let actionStatus = null;
  let searchResults = null;
  let settingsStatus = null;
  let settingsMeta = null;
  let backendUrlInput = null;
  let providerSelect = null;
  let apiKeyInput = null;
  let modelSelect = null;
  let noteInput = null;
  let instructionInput = null;

  // "" = built-in service worker mode; any URL = remote backend mode
  let remoteBackendUrl = "";

  // Button refs for disabling during in-flight requests
  let btnSummarize = null;
  let btnRewrite = null;
  let btnExtract = null;
  let btnSaveMemory = null;
  let btnRunAction = null;
  let actionTypeSelect = null; // holds createDropdown instance after buildPanel

  // Custom dropdown coordination — shared across all instances in this panel.
  let _ddCurrentOpen   = null;  // closureRef of whichever dropdown is open
  let _ddListenerReady = false; // capture-phase doc listener registered once
  // Tracks the latest saved key per provider so switching providers restores it.
  let _liveApiKeys = { gemini: "", openai: "", anthropic: "" };

  // Two-view navigation state
  let _settingsOpen  = false;
  let _viewMain      = null;
  let _viewSettings  = null;
  let _gearButton    = null;
  let _backButton    = null;
  let _headerBrand   = null;
  let _settingsTitleEl = null;
  let _liveRegion    = null;

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
      "geminiModel",    "openaiModel",    "anthropicModel"
    ];
    if (!storage) {
      return Promise.resolve({
        backendUrl: "", llmProvider: "gemini",
        geminiApiKey: "", openaiApiKey: "", anthropicApiKey: "",
        geminiModel: "gemini-2.5-flash", openaiModel: "gpt-5.5",
        anthropicModel: "claude-sonnet-4-6"
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
          anthropicModel: result.anthropicModel || "claude-sonnet-4-6"
        });
      });
    });
  }

  function saveBackendUrl(value) {
    const storage = getStorageArea();
    const next = normalizeUrl(value);
    remoteBackendUrl = next;
    if (!storage) return Promise.resolve();
    return new Promise((resolve) => storage.set({ [BACKEND_URL_KEY]: next }, resolve));
  }

  // Saves provider, its API key, and selected model atomically.
  function saveAiSettings(provider, apiKey, model) {
    const storage = getStorageArea();
    if (!storage) return Promise.resolve();
    const keyField   = { gemini: "geminiApiKey",   openai: "openaiApiKey",   anthropic: "anthropicApiKey"  };
    const modelField = { gemini: "geminiModel",    openai: "openaiModel",    anthropic: "anthropicModel"   };
    return new Promise((resolve) =>
      storage.set({
        llmProvider:                    provider,
        [keyField[provider]   || "geminiApiKey"]:   apiKey,
        [modelField[provider] || "geminiModel"]:    model
      }, resolve)
    );
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

  function renderNotesFolderHint(el, folderName) {
    if (!el) return;
    el.textContent = folderName
      ? `Current folder: ${folderName}`
      : "Not set — click Configure to choose a folder.";
  }

  function refreshNotesFolderHint(el) {
    const storage = getStorageArea();
    if (!storage) {
      renderNotesFolderHint(el, "");
      return;
    }
    storage.get(["notesFolderName"], (res) => {
      renderNotesFolderHint(el, res.notesFolderName || "");
    });
  }

  function updateBackendMeta() {
    if (!settingsMeta) return;
    settingsMeta.textContent = isLocalMode()
      ? "Mode: Built-in (no server required)"
      : `Mode: Remote — ${remoteBackendUrl}`;
    if (backendUrlInput) backendUrlInput.value = remoteBackendUrl;
  }

  function getPageText() {
    const main = document.querySelector("main");
    const source = main || document.body;
    return (source && source.innerText ? source.innerText : "").trim().slice(0, 20000);
  }

  function getSelectedText() {
    const selection = window.getSelection();
    return selection ? String(selection).trim() : "";
  }

  function renderResult(value, mode) {
    if (!resultArea) return;

    if (typeof value === "string") {
      resultArea.textContent = value;
      return;
    }

    if (mode === "extract" && value !== null && typeof value === "object") {
      const lines = [];
      if (value.title) lines.push(`Title: ${value.title}`);
      if (value.summary) lines.push(`\nSummary:\n${value.summary}`);
      if (Array.isArray(value.keyPoints) && value.keyPoints.length > 0) {
        lines.push("\nKey Points:");
        for (const point of value.keyPoints) lines.push(`  • ${point}`);
      }
      const contacts = value.contacts;
      if (contacts) {
        if (Array.isArray(contacts.emails) && contacts.emails.length > 0)
          lines.push(`\nEmails: ${contacts.emails.join(", ")}`);
        if (Array.isArray(contacts.phones) && contacts.phones.length > 0)
          lines.push(`Phones: ${contacts.phones.join(", ")}`);
      }
      if (Array.isArray(value.dates) && value.dates.length > 0)
        lines.push(`\nDates: ${value.dates.join(", ")}`);
      resultArea.textContent = lines.join("\n");
      return;
    }

    resultArea.textContent = JSON.stringify(value, null, 2);
  }

  // Translate an HTTP-style path + options into a service worker message.
  function buildMessage(path, options = {}) {
    const method = (options.method || "GET").toUpperCase();
    const body = options.body ? JSON.parse(options.body) : {};

    if (path === "/health") return { type: "HEALTH" };

    if (path === "/api/assist/analyze") return { type: "ANALYZE", ...body };

    if (path === "/api/memory/save") return { type: "MEMORY_SAVE", ...body };

    if (path === "/api/memory/list") return { type: "MEMORY_LIST" };

    if (path.startsWith("/api/memory/search")) {
      // extract ?q= param
      const qIndex = path.indexOf("?q=");
      const query = qIndex !== -1 ? decodeURIComponent(path.slice(qIndex + 3)) : "";
      return { type: "MEMORY_SEARCH", query };
    }

    if (method === "DELETE" && path.startsWith("/api/memory/")) {
      return { type: "MEMORY_DELETE", id: path.replace("/api/memory/", "") };
    }

    if (path === "/api/actions/run") {
      // body.type is the action type — rename to avoid conflict with message.type
      return { type: "ACTION_RUN", actionType: body.type, payload: body.payload };
    }

    if (path === "/api/actions/state") return { type: "ACTION_STATE" };

    if (method === "PATCH" && path.startsWith("/api/actions/tasks/")) {
      return { type: "TASK_UPDATE", id: path.replace("/api/actions/tasks/", ""), patch: body };
    }

    throw new Error(`Unknown route: ${method} ${path}`);
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
    const message = buildMessage(path, options);
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

  function renderHealthStatus(data) {
    if (!settingsStatus) return;

    const llm         = data.llm || {};
    const provider    = llm.provider   || "gemini";
    const providerLabel = (PROVIDER_CONFIGS[provider] || {}).label || provider;
    const llmState    = llm.configured ? "connected" : "no key — using local fallback";
    const model       = llm.model      || "n/a";
    const memoryCount = data.counts && typeof data.counts.memory === "number" ? data.counts.memory : 0;
    const taskCount   = data.counts && typeof data.counts.tasks  === "number" ? data.counts.tasks  : 0;
    const modeLabel   = data.mode === "built-in" ? "Built-in (no server)" : (data.backendUrl || remoteBackendUrl);

    settingsStatus.textContent = "";

    function addRow(label, value) {
      const row = document.createElement("div");
      row.className = "aaw-health-row";
      const labelEl = document.createElement("span");
      labelEl.textContent = label;
      const valueEl = document.createElement("strong");
      valueEl.textContent = value;
      row.appendChild(labelEl);
      row.appendChild(valueEl);
      settingsStatus.appendChild(row);
    }

    addRow("Mode",     modeLabel);
    addRow("Provider", providerLabel);
    addRow("AI",       llmState);
    addRow("Model",    model);
    addRow("Memory",   `${memoryCount} items`);
    addRow("Tasks",    String(taskCount));
    if (data.notesDir) addRow("Notes dir", data.notesDir);
  }

  async function checkBackend() {
    if (settingsStatus) settingsStatus.textContent = "Checking…";
    try {
      const data = await request("/health", { method: "GET" });
      renderHealthStatus(data);
    } catch (error) {
      if (settingsStatus) settingsStatus.textContent = `Unavailable: ${error.message}`;
    }
  }

  // Smoothly resizes the panel from its current rendered height to toHeight (px).
  // Called before view-switch class changes so the browser sees the "from" height
  // before the "to" height is set. After the transition ends, the explicit height
  // is cleared so the panel returns to natural content-sized mode.
  function _animatePanelHeight(toHeight) {
    if (!root) return;
    const fromHeight = root.getBoundingClientRect().height;
    if (Math.abs(fromHeight - toHeight) < 2) return; // skip trivial differences
    root.style.height = fromHeight + "px";
    root.style.transition = "height 220ms ease-in-out";
    // Force a reflow so the browser commits the "from" state before changing to "to".
    root.getBoundingClientRect();
    root.style.height = toHeight + "px";
    // Use a named listener so we can filter by propertyName — avoids clearing the
    // transition prematurely if transform/opacity are also transitioning at the same time.
    root.addEventListener("transitionend", function onHeightEnd(e) {
      if (e.propertyName !== "height") return;
      root.removeEventListener("transitionend", onHeightEnd);
      root.style.height = "";
      root.style.transition = "";
    });
  }

  // Animates between main and settings views.
  // open=true: slide to settings; open=false: slide back to main.
  function setSettingsOpen(open) {
    _settingsOpen = open;

    if (open) {
      // Measure the target height before toggling classes. The settings view is
      // currently position:absolute (hidden), so scrollHeight = its natural height.
      if (root && _viewSettings) {
        const headerEl = root.querySelector(".aaw-header");
        const headerH  = headerEl ? headerEl.offsetHeight : 0;
        const targetH  = Math.min(headerH + _viewSettings.scrollHeight, window.innerHeight - 24);
        _animatePanelHeight(targetH);
      }

      if (_viewMain)     _viewMain.classList.add("aaw-view--hidden");
      if (_viewSettings) _viewSettings.classList.remove("aaw-view--hidden");
      root.classList.add("aaw-settings-open");
      if (_gearButton) {
        _gearButton.classList.add("aaw-btn-icon--active");
        _gearButton.setAttribute("aria-expanded", "true");
      }
      if (_liveRegion) _liveRegion.textContent = "Settings";

      // Defer health check until settings is actually visible.
      checkBackend();

      // Focus back button after the CSS transition; fall back to a timer.
      if (_backButton) {
        let focusDone = false;
        const doFocus = () => { if (!focusDone) { focusDone = true; _backButton.focus(); } };
        if (_viewSettings) _viewSettings.addEventListener("transitionend", doFocus, { once: true });
        setTimeout(doFocus, 270);
      }
    } else {
      // Measure the target height before toggling classes. The main view is
      // currently position:absolute (hidden), so scrollHeight = its natural height.
      if (root && _viewMain) {
        const headerEl = root.querySelector(".aaw-header");
        const headerH  = headerEl ? headerEl.offsetHeight : 0;
        const targetH  = Math.min(headerH + _viewMain.scrollHeight, window.innerHeight - 24);
        _animatePanelHeight(targetH);
      }

      if (_viewMain)     _viewMain.classList.remove("aaw-view--hidden");
      if (_viewSettings) _viewSettings.classList.add("aaw-view--hidden");
      root.classList.remove("aaw-settings-open");
      if (_gearButton) {
        _gearButton.classList.remove("aaw-btn-icon--active");
        _gearButton.setAttribute("aria-expanded", "false");
      }
      if (_liveRegion) _liveRegion.textContent = "Main view";

      // Focus gear button after transition so keyboard users return to a known landmark.
      if (_gearButton) {
        let focusDone = false;
        const doFocus = () => { if (!focusDone) { focusDone = true; _gearButton.focus(); } };
        if (_viewMain) _viewMain.addEventListener("transitionend", doFocus, { once: true });
        setTimeout(doFocus, 270);
      }
    }
  }

  async function persistBackendUrl() {
    if (!backendUrlInput) return;
    const raw = backendUrlInput.value.trim();

    if (raw) {
      try {
        new URL(raw);
      } catch {
        if (settingsStatus) settingsStatus.textContent = "Invalid URL — must include http:// or https://";
        return;
      }
    }

    await saveBackendUrl(raw);
    updateBackendMeta();
    if (settingsStatus) settingsStatus.textContent = "Saved. Running test…";
    await checkBackend();
  }

  async function persistAiSettings() {
    if (!providerSelect || !apiKeyInput || !modelSelect) return;
    const provider = providerSelect.getValue();
    const apiKey   = apiKeyInput.value.trim();
    const model    = modelSelect.getValue();
    _liveApiKeys[provider] = apiKey; // keep in sync for provider-switch restore
    await saveAiSettings(provider, apiKey, model);
    if (settingsStatus) settingsStatus.textContent = `${PROVIDER_CONFIGS[provider]?.label || provider} settings saved.`;
  }

  // Repopulates the model dropdown and updates the key placeholder when provider changes.
  function onProviderChange() {
    if (!providerSelect || !apiKeyInput || !modelSelect) return;
    const provider = providerSelect.getValue();
    const config   = PROVIDER_CONFIGS[provider] || PROVIDER_CONFIGS.gemini;
    apiKeyInput.placeholder = config.keyPlaceholder;
    modelSelect.setOptions(config.models); // setOptions closes list before mutating
  }

  async function analyze(mode) {
    const content = getSelectedText() || getPageText();
    const instruction = instructionInput ? instructionInput.value.trim() : "";

    const analyzeButtons = [btnSummarize, btnRewrite, btnExtract].filter(Boolean);
    for (const btn of analyzeButtons) btn.disabled = true;
    renderResult("Working…");

    try {
      const data = await request("/api/assist/analyze", {
        method: "POST",
        body: JSON.stringify({ mode, instruction, title: document.title, url: location.href, content })
      });
      renderResult(data.output, mode);
    } catch (error) {
      renderResult(`Error: ${error.message}`);
    } finally {
      for (const btn of analyzeButtons) btn.disabled = false;
    }
  }

  async function saveMemory() {
    const selection = getSelectedText();
    const content = selection || getPageText();
    const note = noteInput ? noteInput.value.trim() : "";

    if (btnSaveMemory) btnSaveMemory.disabled = true;
    try {
      const data = await request("/api/memory/save", {
        method: "POST",
        body: JSON.stringify({ title: document.title, sourceUrl: location.href, snippet: selection, content, note })
      });
      if (actionStatus) actionStatus.textContent = `Saved: ${data.item.id}`;
    } catch (error) {
      if (actionStatus) actionStatus.textContent = `Save failed: ${error.message}`;
    } finally {
      if (btnSaveMemory) btnSaveMemory.disabled = false;
    }
  }

  async function runAction() {
    const text = getSelectedText() || getPageText();
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const title = lines[0] || document.title;
    const type = actionTypeSelect ? actionTypeSelect.getValue() : "create_task";

    let payload;
    if (type === "create_task") payload = { title, notes: noteInput ? noteInput.value.trim() : "" };
    else if (type === "save_contact") payload = { name: title, notes: noteInput ? noteInput.value.trim() : "" };
    else if (type === "open_draft") payload = { title, body: text };
    else payload = { title };

    if (btnRunAction) btnRunAction.disabled = true;
    try {
      const data = await request("/api/actions/run", {
        method: "POST",
        body: JSON.stringify({ type, payload })
      });
      const result = data.result || {};
      const label = result.title || result.name || result.id || type;
      if (actionStatus) actionStatus.textContent = `Done (${type}): ${label}`;
    } catch (error) {
      if (actionStatus) actionStatus.textContent = `Action failed: ${error.message}`;
    } finally {
      if (btnRunAction) btnRunAction.disabled = false;
    }
  }

  async function searchMemory(query) {
    if (!searchResults) return;
    const trimmed = String(query || "").trim();
    if (!trimmed) {
      searchResults.innerHTML = "";
      return;
    }

    try {
      const data = await request(`/api/memory/search?q=${encodeURIComponent(trimmed)}`, { method: "GET" });
      searchResults.innerHTML = "";
      const items = Array.isArray(data.items) ? data.items : [];

      if (items.length === 0) {
        searchResults.textContent = "No matches yet.";
        return;
      }

      for (const item of items) {
        const card = document.createElement("div");
        card.className = "aaw-memory-result";

        const titleEl = document.createElement("div");
        titleEl.className = "aaw-memory-title";
        titleEl.textContent = item.title;

        const metaEl = document.createElement("div");
        metaEl.className = "aaw-memory-meta";
        metaEl.textContent = `score ${item.score} • ${new Date(item.createdAt).toLocaleString()}`;

        const bodyEl = document.createElement("div");
        bodyEl.className = "aaw-memory-body";
        bodyEl.textContent = item.summary;

        card.appendChild(titleEl);
        card.appendChild(metaEl);
        card.appendChild(bodyEl);
        searchResults.appendChild(card);
      }
    } catch (error) {
      searchResults.textContent = `Search failed: ${error.message}`;
    }
  }

  function createButton(label, onClick, tone) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.className = tone ? `aaw-btn ${tone}` : "aaw-btn";
    button.addEventListener("click", onClick);
    return button;
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

  function createDropdown({ id, ariaLabel, options, value: initialValue, onChange }) {
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

    return { element: wrapper, getValue, setValue, setOptions };
  }
  // ──────────────────────────────────────────────────────────────────────────

  async function buildPanel() {
    const settings = await loadSettings();
    remoteBackendUrl = settings.backendUrl;

    root = document.createElement("aside");
    root.className = "aaw-root aaw-hidden";
    root.setAttribute("role", "complementary");
    root.setAttribute("aria-label", "Workspace Assistant panel");

    // --- Header (unified — morphs between main and settings views) ---
    const header = document.createElement("div");
    header.className = "aaw-header";

    // Back button — invisible in main, slides in when settings opens.
    _backButton = document.createElement("button");
    _backButton.type = "button";
    _backButton.className = "aaw-btn-icon aaw-btn-back";
    _backButton.setAttribute("aria-label", "Back to main view");
    _backButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';
    _backButton.addEventListener("click", () => setSettingsOpen(false));
    header.appendChild(_backButton);

    // Brand group — visible in main, fades out in settings.
    _headerBrand = document.createElement("div");
    _headerBrand.className = "aaw-header-brand";
    const kicker = document.createElement("div");
    kicker.className = "aaw-kicker";
    kicker.textContent = "Workspace Assistant";
    const titleEl = document.createElement("div");
    titleEl.className = "aaw-title";
    titleEl.textContent = "On-page AI";
    _headerBrand.appendChild(kicker);
    _headerBrand.appendChild(titleEl);
    header.appendChild(_headerBrand);

    // Settings title — absolutely centred, hidden in main, visible in settings.
    _settingsTitleEl = document.createElement("div");
    _settingsTitleEl.className = "aaw-header-settings-title";
    _settingsTitleEl.textContent = "Settings";
    _settingsTitleEl.setAttribute("aria-hidden", "true"); // view region label covers AT
    header.appendChild(_settingsTitleEl);

    // Right-side controls: gear + close.
    const headerRight = document.createElement("div");
    headerRight.className = "aaw-header-right";

    _gearButton = document.createElement("button");
    _gearButton.type = "button";
    _gearButton.className = "aaw-btn-icon";
    _gearButton.setAttribute("aria-label", "Open settings");
    _gearButton.setAttribute("aria-expanded", "false");
    _gearButton.setAttribute("aria-controls", "aaw-settings-view");
    _gearButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
    _gearButton.addEventListener("click", () => setSettingsOpen(!_settingsOpen));
    headerRight.appendChild(_gearButton);

    const closeButton = createButton("Close", () => {
      // Reset to main view instantly (no animation) before hiding the panel.
      if (_settingsOpen) {
        _settingsOpen = false;
        if (_viewMain)     _viewMain.classList.remove("aaw-view--hidden");
        if (_viewSettings) _viewSettings.classList.add("aaw-view--hidden");
        root.classList.remove("aaw-settings-open");
        if (_gearButton) {
          _gearButton.classList.remove("aaw-btn-icon--active");
          _gearButton.setAttribute("aria-expanded", "false");
        }
      }
      _closePanel();
    }, "ghost");
    closeButton.setAttribute("aria-label", "Close panel");
    headerRight.appendChild(closeButton);
    header.appendChild(headerRight);

    // --- Instruction ---
    instructionInput = document.createElement("textarea");
    instructionInput.placeholder = "Optional rewrite or extraction guidance";
    instructionInput.rows = 2;
    const instructionWrap = makeField("Instruction", instructionInput);

    // --- Analyze buttons ---
    const actionsFieldWrap = document.createElement("div");
    actionsFieldWrap.className = "aaw-field";
    const actionsRow = document.createElement("div");
    actionsRow.className = "aaw-actions";
    btnSummarize = createButton("Summarize", () => analyze("summarize"));
    btnRewrite = createButton("Rewrite", () => analyze("rewrite"));
    btnExtract = createButton("Extract", () => analyze("extract"));
    actionsRow.appendChild(btnSummarize);
    actionsRow.appendChild(btnRewrite);
    actionsRow.appendChild(btnExtract);
    actionsFieldWrap.appendChild(actionsRow);

    // --- Result area ---
    const resultWrap = document.createElement("div");
    resultWrap.className = "aaw-result-wrap";
    const resultLabel = document.createElement("div");
    resultLabel.className = "aaw-section-label";
    resultLabel.textContent = "Result";
    resultArea = document.createElement("pre");
    resultArea.className = "aaw-result";
    resultArea.textContent = "Select text or use the full page, then run an action.";
    resultArea.setAttribute("aria-live", "polite");
    resultArea.setAttribute("aria-label", "AI result output");
    resultWrap.appendChild(resultLabel);
    resultWrap.appendChild(resultArea);

    // --- Memory / actions ---
    noteInput = document.createElement("textarea");
    noteInput.placeholder = "Add a note or context for this page";
    noteInput.rows = 3;
    const memoryWrap = makeField("Save to memory", noteInput);

    const memoryButtons = document.createElement("div");
    memoryButtons.className = "aaw-actions";
    btnSaveMemory = createButton("Save Memory", saveMemory, "accent");

    const actionTypeDropdown = createDropdown({
      id: "aaw-action-type",
      ariaLabel: "Action type",
      options: [
        { value: "create_task",  label: "Create Task" },
        { value: "save_contact", label: "Save Contact" },
        { value: "open_draft",   label: "Open Draft" }
      ],
      value: "create_task"
    });
    actionTypeSelect = actionTypeDropdown;

    btnRunAction = createButton("Run Action", runAction, "ghost");
    memoryButtons.appendChild(btnSaveMemory);
    memoryButtons.appendChild(actionTypeDropdown.element);
    memoryButtons.appendChild(btnRunAction);
    memoryWrap.appendChild(memoryButtons);

    actionStatus = document.createElement("div");
    actionStatus.className = "aaw-status";
    actionStatus.setAttribute("aria-live", "polite");
    memoryWrap.appendChild(actionStatus);

    // --- Search ---
    const searchWrap = document.createElement("div");
    searchWrap.className = "aaw-field";
    const searchLabel = document.createElement("label");
    searchLabel.textContent = "Search workspace memory";
    searchLabel.setAttribute("for", "aaw-search-input");
    searchWrap.appendChild(searchLabel);
    const searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.id = "aaw-search-input";
    searchInput.placeholder = "Keywords or concept";
    searchInput.setAttribute("aria-label", "Search workspace memory");
    searchInput.addEventListener("input", debounce((e) => searchMemory(e.target.value), 300));
    searchWrap.appendChild(searchInput);
    searchResults = document.createElement("div");
    searchResults.className = "aaw-search-results";
    searchResults.setAttribute("aria-live", "polite");
    searchWrap.appendChild(searchResults);

    // --- Settings (goes into its own view; no redundant heading needed) ---
    const settingsWrap = document.createElement("div");
    settingsWrap.className = "aaw-field";

    // Mode / status indicator
    settingsMeta = document.createElement("div");
    settingsMeta.className = "aaw-settings-meta";
    settingsWrap.appendChild(settingsMeta);

    // --- AI Provider ---
    const aiProviderGroup = document.createElement("div");
    aiProviderGroup.className = "aaw-settings-group";

    // Seed _liveApiKeys so switching providers restores the latest saved key.
    _liveApiKeys = {
      gemini:    settings.geminiApiKey,
      openai:    settings.openaiApiKey,
      anthropic: settings.anthropicApiKey
    };

    const currentConfig   = PROVIDER_CONFIGS[settings.llmProvider] || PROVIDER_CONFIGS.gemini;
    const currentApiKey   = _liveApiKeys[settings.llmProvider] || "";
    const currentModelVal = {
      gemini:    settings.geminiModel,
      openai:    settings.openaiModel,
      anthropic: settings.anthropicModel
    }[settings.llmProvider] || currentConfig.models[0].value;

    // Provider dropdown — <label for="aaw-provider-select"> handles AT association.
    const providerLabel = document.createElement("label");
    providerLabel.className = "aaw-settings-sublabel";
    providerLabel.setAttribute("for", "aaw-provider-select");
    providerLabel.textContent = "LLM provider";
    const providerDropdown = createDropdown({
      id:      "aaw-provider-select",
      options: Object.entries(PROVIDER_CONFIGS).map(([v, cfg]) => ({ value: v, label: cfg.label })),
      value:   settings.llmProvider,
      onChange(newProvider) {
        onProviderChange();
        apiKeyInput.value = _liveApiKeys[newProvider] || "";
      }
    });
    providerSelect = providerDropdown;
    aiProviderGroup.appendChild(providerLabel);
    aiProviderGroup.appendChild(providerDropdown.element);

    // API Key input (plain password field — no dropdown needed).
    const keyLabel = document.createElement("label");
    keyLabel.className = "aaw-settings-sublabel";
    keyLabel.setAttribute("for", "aaw-api-key-input");
    keyLabel.textContent = "API key";
    apiKeyInput = document.createElement("input");
    apiKeyInput.type = "password";
    apiKeyInput.id = "aaw-api-key-input";
    apiKeyInput.placeholder = currentConfig.keyPlaceholder;
    apiKeyInput.value = currentApiKey;
    apiKeyInput.setAttribute("aria-label", "LLM API key");
    aiProviderGroup.appendChild(keyLabel);
    aiProviderGroup.appendChild(apiKeyInput);

    // Model dropdown — <label for="aaw-model-select"> handles AT association.
    const modelLabel = document.createElement("label");
    modelLabel.className = "aaw-settings-sublabel";
    modelLabel.setAttribute("for", "aaw-model-select");
    modelLabel.textContent = "Model";
    const modelDropdown = createDropdown({
      id:      "aaw-model-select",
      options: currentConfig.models,
      value:   currentModelVal
    });
    modelSelect = modelDropdown;
    aiProviderGroup.appendChild(modelLabel);
    aiProviderGroup.appendChild(modelDropdown.element);
    settingsWrap.appendChild(aiProviderGroup);

    const aiActions = document.createElement("div");
    aiActions.className = "aaw-actions";
    aiActions.appendChild(createButton("Save AI Settings", persistAiSettings, "accent"));
    settingsWrap.appendChild(aiActions);

    // Notes folder mirror (only meaningful in built-in mode; opens the options page)
    const notesFolderWrap = document.createElement("div");
    notesFolderWrap.className = "aaw-settings-group";
    const notesFolderLabel = document.createElement("div");
    notesFolderLabel.className = "aaw-settings-sublabel";
    notesFolderLabel.textContent = "Notes folder (mirror saved notes to disk)";
    const notesFolderHint = document.createElement("div");
    notesFolderHint.className = "aaw-settings-hint";
    notesFolderHint.textContent = "Loading…";
    notesFolderWrap.appendChild(notesFolderLabel);
    notesFolderWrap.appendChild(notesFolderHint);
    const notesFolderActions = document.createElement("div");
    notesFolderActions.className = "aaw-actions";
    notesFolderActions.appendChild(createButton("Configure", openOptionsPage, "ghost"));
    notesFolderWrap.appendChild(notesFolderActions);
    settingsWrap.appendChild(notesFolderWrap);
    refreshNotesFolderHint(notesFolderHint);
    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local" || !changes.notesFolderName) return;
        renderNotesFolderHint(notesFolderHint, changes.notesFolderName.newValue);
      });
    }

    // Remote backend URL (optional / advanced)
    const backendWrap = document.createElement("div");
    backendWrap.className = "aaw-settings-group";
    const backendLabel = document.createElement("div");
    backendLabel.className = "aaw-settings-sublabel";
    backendLabel.textContent = "Remote backend URL (optional — leave blank to use built-in)";
    backendUrlInput = document.createElement("input");
    backendUrlInput.type = "url";
    backendUrlInput.className = "aaw-backend-url";
    backendUrlInput.placeholder = "https://your-backend.example.com";
    backendUrlInput.value = remoteBackendUrl;
    backendUrlInput.setAttribute("aria-label", "Remote backend URL");
    backendWrap.appendChild(backendLabel);
    backendWrap.appendChild(backendUrlInput);
    settingsWrap.appendChild(backendWrap);

    const backendActions = document.createElement("div");
    backendActions.className = "aaw-actions";
    backendActions.appendChild(createButton("Save Backend URL", persistBackendUrl, "ghost"));
    backendActions.appendChild(createButton("Test Connection", checkBackend, "ghost"));
    settingsWrap.appendChild(backendActions);

    settingsStatus = document.createElement("div");
    settingsStatus.className = "aaw-health-card";
    settingsStatus.textContent = "Run a connection test to load status.";
    settingsWrap.appendChild(settingsStatus);

    // --- Two-view container ---
    const viewContainer = document.createElement("div");
    viewContainer.className = "aaw-view-container";

    // Main view: all the working-panel content.
    _viewMain = document.createElement("div");
    _viewMain.className = "aaw-view aaw-view--main";
    _viewMain.setAttribute("role", "region");
    _viewMain.setAttribute("aria-label", "Assistant tools");
    _viewMain.appendChild(instructionWrap);
    _viewMain.appendChild(actionsFieldWrap);
    _viewMain.appendChild(resultWrap);
    _viewMain.appendChild(memoryWrap);
    _viewMain.appendChild(searchWrap);

    // Settings view: hidden until gear button is clicked.
    _viewSettings = document.createElement("div");
    _viewSettings.id = "aaw-settings-view"; // matches aria-controls on gear button
    _viewSettings.className = "aaw-view aaw-view--settings aaw-view--hidden";
    _viewSettings.setAttribute("role", "region");
    _viewSettings.setAttribute("aria-label", "Settings");
    _viewSettings.appendChild(settingsWrap);

    viewContainer.appendChild(_viewMain);
    viewContainer.appendChild(_viewSettings);

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
    document.documentElement.appendChild(root);

    // Escape key: close settings → close panel (dropdowns stop propagation, so
    // this only fires when no dropdown list is open).
    root.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (_ddCurrentOpen) return; // defensive — shouldn't reach here after stopPropagation fix
      if (_settingsOpen) {
        setSettingsOpen(false);
      } else {
        _closePanel();
      }
    });

    updateBackendMeta();
  }

  async function togglePanel() {
    if (!root) await buildPanel();

    if (root.classList.contains("aaw-hidden")) {
      // Opening: reveal the panel. checkBackend() is deferred to when
      // the user opens settings (avoids writing to a hidden element).
      _openPanel();
    } else {
      // Closing: silently reset to main view so next open is always fresh.
      if (_settingsOpen) {
        _settingsOpen = false;
        if (_viewMain)     _viewMain.classList.remove("aaw-view--hidden");
        if (_viewSettings) _viewSettings.classList.add("aaw-view--hidden");
        root.classList.remove("aaw-settings-open");
        if (_gearButton) {
          _gearButton.classList.remove("aaw-btn-icon--active");
          _gearButton.setAttribute("aria-expanded", "false");
        }
      }
      _closePanel();
    }
  }

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message && message.type === "TOGGLE_ASSISTANT") togglePanel();
  });
})();
