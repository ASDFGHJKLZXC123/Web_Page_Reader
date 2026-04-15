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
        { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash (recommended)" },
        { value: "gemini-2.5-pro",   label: "Gemini 2.5 Pro" },
        { value: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
        { value: "gemini-1.5-pro",   label: "Gemini 1.5 Pro" }
      ]
    },
    openai: {
      label:          "OpenAI",
      keyPlaceholder: "sk-…",
      models: [
        { value: "gpt-4o",       label: "GPT-4o (recommended)" },
        { value: "gpt-4o-mini",  label: "GPT-4o Mini" },
        { value: "gpt-4-turbo",  label: "GPT-4 Turbo" },
        { value: "gpt-3.5-turbo",label: "GPT-3.5 Turbo" }
      ]
    },
    anthropic: {
      label:          "Anthropic Claude",
      keyPlaceholder: "sk-ant-…",
      models: [
        { value: "claude-sonnet-4-6",       label: "Claude Sonnet 4.6 (recommended)" },
        { value: "claude-opus-4-6",         label: "Claude Opus 4.6" },
        { value: "claude-haiku-4-5-20251001",label: "Claude Haiku 4.5" }
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
        geminiModel: "gemini-2.5-flash", openaiModel: "gpt-4o",
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
          openaiModel:    result.openaiModel    || "gpt-4o",
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

    // --- Header ---
    const header = document.createElement("div");
    header.className = "aaw-header";
    const headerText = document.createElement("div");
    const kicker = document.createElement("div");
    kicker.className = "aaw-kicker";
    kicker.textContent = "Workspace Assistant";
    const titleEl = document.createElement("div");
    titleEl.className = "aaw-title";
    titleEl.textContent = "On-page AI";
    headerText.appendChild(kicker);
    headerText.appendChild(titleEl);
    header.appendChild(headerText);
    const closeButton = createButton("Close", () => root.classList.add("aaw-hidden"), "ghost");
    closeButton.setAttribute("aria-label", "Close panel");
    header.appendChild(closeButton);

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

    // --- Settings ---
    const settingsWrap = document.createElement("div");
    settingsWrap.className = "aaw-field";
    const settingsLabel = document.createElement("label");
    settingsLabel.textContent = "Settings";
    settingsWrap.appendChild(settingsLabel);

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

    // Assemble
    root.appendChild(header);
    root.appendChild(instructionWrap);
    root.appendChild(actionsFieldWrap);
    root.appendChild(resultWrap);
    root.appendChild(memoryWrap);
    root.appendChild(searchWrap);
    root.appendChild(settingsWrap);
    document.documentElement.appendChild(root);

    updateBackendMeta();
  }

  async function togglePanel() {
    if (!root) await buildPanel();
    root.classList.toggle("aaw-hidden");
    if (!root.classList.contains("aaw-hidden")) {
      void checkBackend();
    }
  }

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message && message.type === "TOGGLE_ASSISTANT") togglePanel();
  });
})();
