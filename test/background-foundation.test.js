"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

function installChromeMock(seed = {}) {
  const state = {
    memory: [],
    noteWorkspaces: [],
    actions: { tasks: [], tableRows: [], contacts: [], drafts: [] },
    embeddings: {},
    runtimeMessages: [],
    actionClickListener: null,
    commandListener: null,
    tabMessages: [],
    scriptInjections: [],
    cssInjections: [],
    activeTabs: [{ id: 7 }],
    ...seed
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
          if (state.storageSetError) {
            global.chrome.runtime.lastError = { message: state.storageSetError };
            if (callback) callback();
            global.chrome.runtime.lastError = undefined;
            return;
          }
          Object.assign(state, updates);
          if (callback) callback();
        }
      }
    },
    runtime: {
      lastError: undefined,
      onMessage: { addListener() {} },
      sendMessage(message) {
        state.runtimeMessages.push(message);
        return Promise.resolve();
      },
      openOptionsPage(callback) {
        if (callback) callback();
      }
    },
    action: {
      onClicked: {
        addListener(listener) {
          state.actionClickListener = listener;
        }
      }
    },
    commands: {
      onCommand: {
        addListener(listener) {
          state.commandListener = listener;
        }
      }
    },
    tabs: {
      query(_query, callback) {
        callback(state.activeTabs);
      },
      sendMessage(tabId, message) {
        state.tabMessages.push({ tabId, message });
        if (state.failTabMessages && state.failTabMessages > 0) {
          state.failTabMessages--;
          return Promise.reject(new Error("No receiver"));
        }
        if (state.alwaysFailTabMessages) return Promise.reject(new Error("Restricted page"));
        return Promise.resolve({ ok: true });
      }
    },
    scripting: {
      executeScript(details) {
        state.scriptInjections.push(details);
        if (state.failInjection) return Promise.reject(new Error("Cannot access page"));
        return Promise.resolve();
      },
      insertCSS(details) {
        state.cssInjections.push(details);
        if (state.failInjection) return Promise.reject(new Error("Cannot access page"));
        return Promise.resolve();
      }
    }
  };

  return state;
}

function loadBackground() {
  const path = require.resolve("../chrome-extension/background.js");
  delete require.cache[path];
  return require(path);
}

test("service-worker normalizer exposes canonical workspaceIds for legacy taskIds", () => {
  installChromeMock();
  const { compactStringArray, normalizeMemoryItem } = loadBackground();

  const item = normalizeMemoryItem({ id: "mem_1", taskIds: [" nw_1 ", "nw_1", "", null] });

  assert.deepEqual(compactStringArray([" tag ", "tag", null]), ["tag"]);
  assert.deepEqual(item.workspaceIds, ["nw_1"]);
  assert.deepEqual(item.taskIds, ["nw_1"]);
  assert.deepEqual(item.linkedTaskIds, []);
});

test("service-worker memory builder creates canonical page memory fields", () => {
  installChromeMock();
  const { buildMemoryItem } = loadBackground();

  const item = buildMemoryItem(
    {
      title: "Article",
      sourceUrl: "https://Example.com/path?utm_source=x&keep=1#intro",
      content: "Long page text",
      note: "Follow up",
      workspaceIds: [" nw_1 ", "nw_1"],
      tags: [" lead ", "lead"]
    },
    { id: "mem_1", now: "2026-01-01T00:00:00.000Z" }
  );

  assert.equal(item.schemaVersion, 2);
  assert.equal(item.canonicalUrl, "https://example.com/path?keep=1#intro");
  assert.equal(item.urlKey, "https://example.com/path?keep=1");
  assert.equal(item.sourceHost, "example.com");
  assert.equal(item.sourceHash, "intro");
  assert.equal(item.pageExcerpt, "Long page text");
  assert.equal(item.content, undefined);
  assert.deepEqual(item.workspaceIds, ["nw_1"]);
  assert.deepEqual(item.tags, ["lead"]);
});

test("service-worker keyword scorer matches workspace and source fields", () => {
  installChromeMock();
  const { scoreMemoryKeyword } = loadBackground();

  const score = scoreMemoryKeyword(
    "client example",
    { sourceHost: "example.com", tags: ["lead"] },
    ["Client Leads"]
  );

  assert.ok(score.keywordScore > 0);
  assert.deepEqual(score.matchedTerms.sort(), ["client", "example"]);
  assert.ok(score.matchedFields.includes("workspace"));
  assert.ok(score.matchedFields.includes("sourceHost"));
});

test("service-worker membership input accepts workspaceIds and legacy taskIds", async () => {
  installChromeMock({ noteWorkspaces: [{ id: "nw_1" }, { id: "nw_2" }] });
  const { normalizeMemoryMembershipInput } = loadBackground();

  assert.deepEqual(await normalizeMemoryMembershipInput({ workspaceIds: ["nw_1", "nw_1"] }), ["nw_1"]);
  assert.deepEqual(await normalizeMemoryMembershipInput({ taskIds: ["nw_2"] }), ["nw_2"]);
  await assert.rejects(
    () => normalizeMemoryMembershipInput({ workspaceIds: ["missing"] }),
    /Unknown note workspace ID: missing/
  );
});

test("service-worker write queue serializes async mutations", async () => {
  installChromeMock();
  const { enqueueStorageWrite } = loadBackground();
  const order = [];

  await Promise.all([
    enqueueStorageWrite(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("first");
    }),
    enqueueStorageWrite(async () => {
      order.push("second");
    })
  ]);

  assert.deepEqual(order, ["first", "second"]);
});

test("service-worker seeds default workspaces idempotently", async () => {
  installChromeMock();
  const { normalizeMemoryMembershipInput, seedDefaultNoteWorkspaceItems } = loadBackground();

  const seeded = seedDefaultNoteWorkspaceItems([{ id: "custom_research", name: "Research" }], "2026-01-01T00:00:00.000Z");
  assert.equal(seeded.added, 3);
  assert.deepEqual(
    seeded.items.map((workspace) => workspace.name),
    ["Job Search", "Startup Ideas", "Client Leads", "Research"]
  );

  assert.deepEqual(
    await normalizeMemoryMembershipInput({ workspaceIds: ["nw_default_job_search"] }),
    ["nw_default_job_search"]
  );
});

test("service-worker NOTE_WORKSPACE_DELETE destroys data, tombstones, and blocks reseed", async () => {
  const state = installChromeMock({
    memory: [{ id: "mem_1", title: "Note", workspaceId: "nw_default_research" }],
    actions: {
      tasks: [{ id: "t1", title: "Task", workspaceId: "nw_default_research", sourceMemoryIds: ["mem_1"] }],
      tableRows: [],
      contacts: [{ id: "c1", name: "Ada", email: "ada@example.com", workspaceId: "nw_default_research", memoryIds: ["mem_1"] }],
      drafts: []
    },
    embeddings: { mem_1: { embedding: [0.1, 0.2] } }
  });
  const { routeMessage } = loadBackground();

  const result = await routeMessage({ type: "NOTE_WORKSPACE_DELETE", id: "nw_default_research" });
  assert.deepEqual(result, {
    deleted: true,
    workspaceId: "nw_default_research",
    counts: { notes: 1, contacts: 1, tasks: 1 }
  });
  assert.equal(state.memory.length, 0);
  assert.equal(Object.prototype.hasOwnProperty.call(state.embeddings, "mem_1"), false);
  assert.equal(state.actions.contacts.length, 0);
  assert.equal(state.actions.tasks.length, 0);
  assert.ok(state.deletedWorkspaces.some((workspace) => workspace.id === "nw_default_research"));

  const list = await routeMessage({ type: "NOTE_WORKSPACE_LIST", status: "all" });
  assert.equal(list.items.some((workspace) => workspace.id === "nw_default_research"), false);

  assert.equal((await routeMessage({ type: "NOTE_WORKSPACE_DELETE", id: "inbox" })).error, "Unassigned cannot be deleted");
  assert.deepEqual(await routeMessage({ type: "NOTE_WORKSPACE_DELETE", id: "nw_missing" }), { error: "Not found" });
});

test("service-worker create restores a tombstoned workspace by name once", async () => {
  const state = installChromeMock();
  const { handleNoteWorkspaceCreate, handleNoteWorkspaceDelete } = loadBackground();

  await handleNoteWorkspaceDelete("nw_default_research");

  const created = await handleNoteWorkspaceCreate({ name: "research" });
  assert.equal(created.restored, true);
  assert.equal(created.workspace.id, "nw_default_research");
  assert.equal(created.workspace.status, "open");
  assert.equal(state.deletedWorkspaces.some((workspace) => workspace.id === "nw_default_research"), false);

  const duplicate = await handleNoteWorkspaceCreate({ name: "Research" });
  assert.equal(duplicate.error, "Workspace already exists");
});

test("service-worker extracts deterministic contact drafts from page hints", () => {
  installChromeMock();
  const { extractContactDrafts } = loadBackground();

  const result = extractContactDrafts({
    title: "Acme Contact",
    sourceUrl: "https://example.com/contact",
    content: "Reach Ada at ada@example.com or (555) 111-2222.",
    pageMeta: {
      headings: ["Acme Inc"],
      mailto: ["sales@example.com"],
      tel: ["555.333.4444"],
      jsonLd: [{
        "@type": "Person",
        name: "Ada Lovelace",
        email: "ada@example.com",
        sameAs: "https://www.linkedin.com/in/adalovelace"
      }]
    }
  });

  assert.equal(result.contacts.length, 2);
  assert.equal(result.contacts[0].name, "Ada Lovelace");
  assert.equal(result.contacts[0].email, "ada@example.com");
  assert.equal(result.contacts[0].phone, "5551112222");
  assert.equal(result.contacts[0].company, "Acme Inc");
  assert.match(result.contacts[0].linkedInUrl, /linkedin\.com\/in\/adalovelace/);
});

test("service-worker CONTACT_EXTRACT routes through message dispatch", async () => {
  installChromeMock();
  const { routeMessage } = loadBackground();

  const result = await routeMessage({
    type: "CONTACT_EXTRACT",
    title: "Acme Contact",
    sourceUrl: "https://example.com/contact",
    content: "Reach Ada at ada@example.com.",
    pageMeta: {
      headings: ["Acme Inc"],
      jsonLd: [{ "@type": "Person", name: "Ada Lovelace" }]
    }
  });

  assert.ok(result.contacts.length >= 1);
  const contact = result.contacts.find((item) => item.email === "ada@example.com");
  assert.ok(contact);
  assert.equal(contact.name, "Ada Lovelace");
  assert.equal(contact.company, "Acme Inc");
});

test("service-worker TASK_DRAFT routes through message dispatch", async () => {
  installChromeMock();
  const { routeMessage } = loadBackground();

  const result = await routeMessage({
    type: "TASK_DRAFT",
    title: "Launch notes",
    sourceUrl: "https://example.com/launch",
    content: "Follow up with Ada before 2026-08-15. Prepare rollout notes.",
    sourceMemoryIds: ["mem_1"]
  });

  assert.equal(result.draft.title, "Follow up: Launch notes");
  assert.equal(result.draft.dueDate, "2026-08-15");
  assert.deepEqual(result.draft.sourceMemoryIds, ["mem_1"]);
  assert.equal(result.extractionMeta.promptVersion, "task-draft-v1");
});

test("service-worker model-shaped extraction failures fall back locally", async () => {
  installChromeMock({
    llmProvider: "gemini",
    geminiApiKey: "test-key",
    geminiModel: "gemini-test"
  });
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ text: "{\"notContacts\":[]}" }] } }] })
  });
  try {
    const { routeMessage } = loadBackground();
    const lead = await routeMessage({
      type: "CONTACT_EXTRACT",
      title: "Acme",
      sourceUrl: "https://example.com/contact",
      content: "Reach Ada at ada@example.com."
    });
    assert.equal(lead.extractionMeta.fallbackReason, "provider_error");
    assert.match(lead.extractionMeta.validationWarnings[0], /contacts array/);

    const draft = await routeMessage({
      type: "TASK_DRAFT",
      title: "Acme",
      sourceUrl: "https://example.com/task",
      content: "Follow up on 2026-08-15."
    });
    assert.equal(draft.extractionMeta.fallbackReason, "provider_error");
    assert.match(draft.extractionMeta.validationWarnings[0], /draft object/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("service-worker privacy messages preserve keys and clear selected buckets", async () => {
  const state = installChromeMock({
    memory: [{ id: "mem_1", title: "Private note", createdAt: "2026-01-01T00:00:00.000Z" }],
    embeddings: { mem_1: { embedding: [1, 2, 3] } },
    geminiApiKey: "secret-key"
  });
  const { routeMessage } = loadBackground();

  const patched = await routeMessage({ type: "PRIVACY_SETTINGS_PATCH", patch: { aiMode: "local_only" } });
  assert.equal(patched.settings.aiMode, "local_only");

  const cleared = await routeMessage({
    type: "PRIVACY_CLEAR_DATA",
    buckets: ["memory"],
    confirmationToken: "CLEAR"
  });
  assert.equal(cleared.cleared.memory, 1);
  assert.deepEqual(state.memory, []);
  assert.deepEqual(state.embeddings, {});
  assert.equal(state.geminiApiKey, "secret-key");
  assert.equal(state.privacySettings.aiMode, "local_only");
});

test("service-worker local-only analyze records sanitized privacy provenance", async () => {
  const state = installChromeMock();
  const { routeMessage } = loadBackground();

  const result = await routeMessage({
    type: "ANALYZE",
    mode: "summarize",
    title: "Private page",
    url: "https://secret.example/report?token=1",
    content: "Private launch report. ".repeat(20),
    aiMode: "local_only",
    privacyMeta: {
      operation: "summarize",
      effectiveAiMode: "local_only",
      sentToProvider: true,
      sentToBackend: true,
      contentSource: "page",
      originalCharCount: 440,
      submittedCharCount: 400,
      redactionCounts: { emails: 1 },
      host: "secret.example"
    }
  });

  assert.equal(result.privacyMeta.sentToProvider, false);
  assert.equal(result.privacyMeta.sentToBackend, false);
  assert.equal(state.privacyEvents.length, 1);
  assert.equal(state.privacyEvents[0].host, "secret.example");
  assert.equal(state.privacyEvents[0].redactionCounts.emails, 1);
});

test("service-worker contact merge dedupes legacy save_contact data", () => {
  installChromeMock();
  const { contactDedupeKey, createOrMergeContact } = loadBackground();
  const actions = { tasks: [], tableRows: [], contacts: [], drafts: [] };

  const first = createOrMergeContact(actions, {
    name: "Ada Lovelace",
    email: "Ada@Example.com",
    company: "Acme",
    memoryIds: ["mem_1"]
  }, "2026-01-01T00:00:00.000Z");
  const second = createOrMergeContact(actions, {
    name: "Ada Lovelace",
    email: "ada@example.com",
    roleTitle: "Founder",
    memoryIds: ["mem_2"]
  }, "2026-01-02T00:00:00.000Z");

  assert.equal(actions.contacts.length, 1);
  assert.equal(first.id, second.id);
  assert.equal(contactDedupeKey(second), "email:ada@example.com");
  assert.equal(second.roleTitle, "Founder");
  assert.deepEqual(second.memoryIds, ["mem_1", "mem_2"]);
});

test("service-worker contact messages create, list, get, update, and delete contacts", async () => {
  installChromeMock();
  const { routeMessage } = loadBackground();

  const created = await routeMessage({
    type: "CONTACT_CREATE",
    contact: {
      name: "Ada Lovelace",
      email: "ada@example.com",
      phones: ["555.333.4444"],
      company: "Acme",
      memoryIds: ["mem_1"]
    }
  });

  assert.equal(created.contact.name, "Ada Lovelace");

  const listed = await routeMessage({
    type: "CONTACT_LIST",
    q: "5553334444",
    limit: 10,
    offset: 0
  });
  assert.equal(listed.total, 1);
  assert.equal(listed.contacts[0].id, created.contact.id);

  const fetched = await routeMessage({ type: "CONTACT_GET", id: created.contact.id });
  assert.equal(fetched.contact.email, "ada@example.com");

  const updated = await routeMessage({
    type: "CONTACT_UPDATE",
    id: created.contact.id,
    patch: { leadStatus: "qualified", memoryIds: [] }
  });
  assert.equal(updated.contact.leadStatus, "qualified");
  assert.deepEqual(updated.contact.memoryIds, []);

  const deleted = await routeMessage({ type: "CONTACT_DELETE", id: created.contact.id });
  assert.equal(deleted.deleted, true);
  assert.equal((await routeMessage({ type: "CONTACT_LIST", limit: 10, offset: 0 })).total, 0);
});

test("service-worker dedupe routes preview, merge, audit, undo, ignore, and unignore", async () => {
  const state = installChromeMock({
    memory: [{
      id: "mem_keep",
      title: "Acme report",
      sourceUrl: "https://example.com/report?keep=1",
      note: "Follow up with Acme",
      workspaceIds: [],
      linkedTaskIds: ["task_dup"]
    }, {
      id: "mem_dup",
      title: "Acme report",
      sourceUrl: "https://example.com/report?utm_source=x&keep=1",
      note: "Follow up with Acme",
      workspaceIds: ["nw_default_research"],
      summary: "Duplicate summary"
    }],
    embeddings: {
      mem_keep: { embedding: [0.1], meta: { provider: "test", model: "m", dimensions: 1 } },
      mem_dup: { embedding: [0.2], meta: { provider: "test", model: "m", dimensions: 1 } }
    },
    actions: {
      tableRows: [],
      drafts: [],
      contacts: [{
        id: "contact_1",
        name: "Ada",
        memoryIds: ["mem_dup"]
      }],
      tasks: [{
        id: "task_dup",
        title: "Follow up with Acme",
        sourceMemoryIds: ["mem_dup"]
      }]
    }
  });
  const { routeMessage } = loadBackground();

  const listed = await routeMessage({ type: "DEDUPE_CANDIDATES", typeFilter: "memory" });
  assert.equal(listed.candidates.length, 1);
  const group = listed.candidates[0];
  assert.equal(group.mergeable, true);

  await routeMessage({ type: "DEDUPE_IGNORE", groupId: group.groupId, dedupeType: "memory" });
  assert.equal((await routeMessage({ type: "DEDUPE_CANDIDATES", typeFilter: "memory" })).candidates.length, 0);
  assert.equal((await routeMessage({ type: "DEDUPE_CANDIDATES", typeFilter: "memory", includeIgnored: true })).candidates[0].ignored, true);
  await routeMessage({ type: "DEDUPE_UNIGNORE", groupId: group.groupId });

  const preview = await routeMessage({ type: "DEDUPE_PREVIEW", groupId: group.groupId, dedupeType: "memory", primaryId: "mem_keep" });
  assert.ok(preview.plan.planHash);
  const missingHash = await routeMessage({ type: "DEDUPE_APPLY", groupId: group.groupId, dedupeType: "memory", primaryId: "mem_keep" });
  assert.equal(missingHash.error, "planHash is required");
  assert.equal(missingHash.statusCode, 400);
  const stale = await routeMessage({ type: "DEDUPE_APPLY", groupId: group.groupId, dedupeType: "memory", primaryId: "mem_keep", planHash: "stale" });
  assert.equal(stale.statusCode, 409);

  const applied = await routeMessage({
    type: "DEDUPE_APPLY",
    groupId: group.groupId,
    dedupeType: "memory",
    primaryId: "mem_keep",
    planHash: preview.plan.planHash
  });
  assert.equal(applied.applied, true);
  assert.equal(applied.audit.before, undefined);
  assert.deepEqual(state.memory.map((item) => item.id), ["mem_keep"]);
  assert.equal(state.embeddings.mem_dup, undefined);
  assert.deepEqual(state.actions.contacts[0].memoryIds, ["mem_keep"]);
  assert.deepEqual(state.actions.tasks[0].sourceMemoryIds, ["mem_keep"]);

  const retried = await routeMessage({
    type: "DEDUPE_APPLY",
    groupId: group.groupId,
    dedupeType: "memory",
    primaryId: "mem_keep",
    planHash: preview.plan.planHash
  });
  assert.equal(retried.applied, true);
  assert.equal(retried.idempotent, true);
  assert.equal(retried.audit.before, undefined);

  const audit = await routeMessage({ type: "DEDUPE_AUDIT", limit: 5, offset: 0 });
  assert.equal(audit.total, 1);
  assert.equal(audit.items[0].before, undefined);
  assert.equal(audit.items[0].undoable, true);

  const undone = await routeMessage({ type: "DEDUPE_UNDO", auditId: audit.items[0].id });
  assert.equal(undone.undone, true);
  assert.deepEqual(state.memory.map((item) => item.id), ["mem_keep", "mem_dup"]);
  assert.deepEqual(state.embeddings.mem_dup.embedding, [0.2]);
});

test("service-worker dedupe preview plan hash matches backend implementation", async () => {
  const dataset = {
    memory: [{
      id: "mem_keep",
      title: "Acme report",
      sourceUrl: "https://example.com/report?keep=1",
      note: "Follow up with Acme",
      workspaceIds: []
    }, {
      id: "mem_dup",
      title: "Acme report",
      sourceUrl: "https://example.com/report?utm_source=x&keep=1",
      note: "Follow up with Acme",
      workspaceIds: ["nw_default_research"]
    }],
    actions: {
      tableRows: [],
      drafts: [],
      contacts: [{
        id: "contact_keep",
        name: "Ada Lovelace",
        email: "ada@example.com"
      }, {
        id: "contact_dup",
        name: "Ada Lovelace",
        email: "ADA@example.com",
        company: "Acme"
      }],
      tasks: [{
        id: "task_keep",
        title: "Call Ada",
        sourceUrl: "https://example.com/report?keep=1"
      }, {
        id: "task_dup",
        title: "Call Ada",
        sourceUrl: "https://example.com/report?utm_source=x&keep=1",
        priority: "high"
      }]
    }
  };
  installChromeMock(dataset);
  const { buildDedupeCandidates, buildMergePreview } = require("../backend/src/lib/dedupe");
  const { routeMessage } = loadBackground();

  for (const [type, primaryId] of Object.entries({
    memory: "mem_keep",
    contact: "contact_keep",
    task: "task_keep",
    source: ""
  })) {
    const backendGroup = buildDedupeCandidates(dataset, { type })[0];
    const backendPreview = buildMergePreview(dataset, { groupId: backendGroup.groupId, type, primaryId });
    const localPreview = await routeMessage({ type: "DEDUPE_PREVIEW", groupId: backendGroup.groupId, dedupeType: type, primaryId });
    assert.equal(localPreview.plan.planHash, backendPreview.planHash);
  }
});

test("service-worker automatic contact merges write non-undoable audit metadata", async () => {
  installChromeMock();
  const { routeMessage } = loadBackground();

  const first = await routeMessage({
    type: "CONTACT_CREATE",
    contact: { name: "Ada Lovelace", email: "ada@example.com" }
  });
  const merged = await routeMessage({
    type: "CONTACT_CREATE",
    contact: { name: "Ada Lovelace", email: "ADA@example.com", company: "Acme" }
  });
  const audit = await routeMessage({ type: "DEDUPE_AUDIT", limit: 5, offset: 0 });

  assert.equal(first.contact.id, merged.contact.id);
  assert.equal(audit.total, 1);
  assert.equal(audit.items[0].type, "contact");
  assert.equal(audit.items[0].automatic, true);
  assert.equal(audit.items[0].undoable, false);
  assert.equal(audit.items[0].before, undefined);
});

test("service-worker backup export, validate, merge, replace, and import notification", async () => {
  const state = installChromeMock({
    memory: [{
      id: "mem_backup",
      title: "Backup note",
      sourceUrl: "https://example.com/backup",
      note: "Backup note",
      workspaceIds: ["nw_project"],
      taskIds: ["nw_project"],
      linkedTaskIds: ["task_backup"],
      contactId: "contact_backup"
    }],
    noteWorkspaces: [{ id: "nw_project", name: "Project", status: "open" }],
    actions: {
      tableRows: [],
      drafts: [],
      contacts: [{ id: "contact_backup", name: "Ada Backup", email: "ada.backup@example.com", memoryIds: ["mem_backup"] }],
      tasks: [{ id: "task_backup", title: "Backup task", clientRequestId: "backup-task-request", sourceUrl: "https://example.com/backup", sourceMemoryIds: ["mem_backup"] }]
    },
    embeddings: { mem_backup: { embedding: [0.1, 0.2], meta: { provider: "test", model: "m", dimensions: 2 } } },
    privacySettings: { aiMode: "local_only" },
    dedupeIgnored: [{ groupId: "memory:test", type: "memory" }],
    geminiApiKey: "secret-key",
    llmProvider: "gemini",
    geminiModel: "gemini-test"
  });
  const { routeMessage } = loadBackground();

  const backup = await routeMessage({ type: "BACKUP_EXPORT", includeEmbeddings: true, includeSettings: true });
  assert.equal(backup.format, "aaw.backup.v1");
  assert.equal(backup.sections.settings.items.geminiApiKey, undefined);
  assert.equal(backup.sections.settings.items.geminiModel, "gemini-test");
  assert.equal(backup.sections.privacy.settings.aiMode, "local_only");
  assert.equal(backup.sections.embeddings.items.length, 1);
  assert.equal((await routeMessage({ type: "BACKUP_VALIDATE", backup })).valid, true);
  const wrongVersion = JSON.parse(JSON.stringify(backup));
  wrongVersion.sections.memory.version = 99;
  assert.equal((await routeMessage({ type: "BACKUP_VALIDATE", backup: wrongVersion })).valid, false);
  const maliciousSettings = JSON.parse(JSON.stringify(backup));
  maliciousSettings.sections.settings.items.memory = [{ id: "evil" }];
  assert.equal((await routeMessage({ type: "BACKUP_VALIDATE", backup: maliciousSettings })).valid, false);
  const malformedDedupe = JSON.parse(JSON.stringify(backup));
  malformedDedupe.sections.dedupe.ignored = {};
  assert.equal((await routeMessage({ type: "BACKUP_VALIDATE", backup: malformedDedupe })).valid, false);

  state.memory = [{ id: "mem_backup", title: "Existing note" }];
  state.actions = {
    tasks: [{ id: "task_existing", title: "Backup task", clientRequestId: "backup-task-request", sourceMemoryIds: [] }],
    tableRows: [],
    contacts: [{ id: "contact_existing", name: "Ada Backup", email: "ada.backup@example.com", memoryIds: [] }],
    drafts: []
  };
  state.embeddings = {};
  const merged = await routeMessage({ type: "BACKUP_IMPORT", backup, mode: "merge", includeEmbeddings: true, includeSettings: true });
  assert.equal(merged.imported, true);
  const importedMemory = state.memory.find((item) => item.title === "Backup note");
  assert.ok(importedMemory);
  assert.notEqual(importedMemory.id, "mem_backup");
  assert.equal(importedMemory.contactId, "contact_existing");
  assert.deepEqual(importedMemory.linkedTaskIds, ["task_existing"]);
  assert.deepEqual(state.actions.contacts.find((contact) => contact.id === "contact_existing").memoryIds, [importedMemory.id]);
  assert.deepEqual(state.actions.tasks.find((task) => task.id === "task_existing").sourceMemoryIds, [importedMemory.id]);
  assert.equal(state.embeddings[importedMemory.id].embedding.length, 2);
  assert.ok(state.runtimeMessages.some((message) => message && message.type === "BACKUP_IMPORTED"));

  const blocked = await routeMessage({ type: "BACKUP_IMPORT", backup, mode: "replace", confirmationToken: "REPLACE" });
  assert.match(blocked.error, /restore point/i);
  const point = await routeMessage({ type: "BACKUP_RESTORE_POINT" });
  state.privacySettings = { aiMode: "auto" };
  state.dedupeIgnored = [{ groupId: "old", type: "memory" }];
  const replaced = await routeMessage({
    type: "BACKUP_IMPORT",
    backup,
    mode: "replace",
    restorePointId: point.restorePointId,
    confirmationToken: "REPLACE",
    includeEmbeddings: true
  });
  assert.equal(replaced.imported, true);
  assert.deepEqual(state.memory.map((item) => item.id), ["mem_backup"]);
  assert.deepEqual(state.embeddings.mem_backup.embedding, [0.1, 0.2]);
  assert.equal(state.privacySettings.aiMode, "local_only");
  assert.deepEqual(state.dedupeIgnored, [{ groupId: "memory:test", type: "memory" }]);
  assert.equal(state.geminiApiKey, "secret-key");
});

test("service-worker backup import rejects malicious settings without mutation", async () => {
  const state = installChromeMock({
    memory: [{ id: "mem_safe", title: "Safe note" }],
    actions: { tasks: [], tableRows: [], contacts: [], drafts: [] },
    embeddings: {}
  });
  const { routeMessage } = loadBackground();
  const backup = {
    format: "aaw.backup.v1",
    exportedAt: "2026-01-01T00:00:00.000Z",
    app: { name: "AI Assistant Across Websites", version: "0.1.0" },
    source: { mode: "built-in" },
    options: { includeEmbeddings: true, includeSettings: true, includeSensitive: false, includeAudit: false },
    sections: {
      memory: { version: 1, items: [{ id: "mem_new", title: "New note" }] },
      noteWorkspaces: { version: 1, items: [] },
      actions: { version: 1, tasks: [], contacts: [], drafts: [], tableRows: [] },
      embeddings: { version: 1, items: [] },
      settings: { version: 1, items: { memory: [{ id: "evil" }] } },
      privacy: { version: 1, settings: {} },
      dedupe: { version: 1, ignored: [], audit: [] }
    }
  };

  const result = await routeMessage({ type: "BACKUP_IMPORT", backup, mode: "merge", includeSettings: true });
  assert.equal(result.error, "Invalid backup");
  assert.deepEqual(state.memory, [{ id: "mem_safe", title: "Safe note" }]);
});

test("service-worker backup import surfaces storage write failures", async () => {
  const state = installChromeMock({
    memory: [{ id: "mem_backup", title: "Backup note" }],
    storageSetError: "Quota exceeded"
  });
  const { routeMessage } = loadBackground();
  const backup = {
    format: "aaw.backup.v1",
    exportedAt: "2026-01-01T00:00:00.000Z",
    app: { name: "AI Assistant Across Websites", version: "0.1.0" },
    source: { mode: "built-in" },
    options: { includeEmbeddings: true, includeSettings: false, includeSensitive: false, includeAudit: false },
    sections: {
      memory: { version: 1, items: [{ id: "mem_new", title: "New note" }] },
      noteWorkspaces: { version: 1, items: [] },
      actions: { version: 1, tasks: [], contacts: [], drafts: [], tableRows: [] },
      embeddings: { version: 1, items: [] },
      settings: { version: 1, items: {} },
      privacy: { version: 1, settings: {} },
      dedupe: { version: 1, ignored: [], audit: [] }
    }
  };

  await assert.rejects(
    () => routeMessage({ type: "BACKUP_IMPORT", backup, mode: "merge" }),
    /Quota exceeded/
  );
  assert.deepEqual(state.memory, [{ id: "mem_backup", title: "Backup note" }]);
});

test("service-worker advanced contact and task management routes filter, batch, and clean links", async () => {
  const state = installChromeMock({
    noteWorkspaces: [{ id: "nw_research", name: "Research", status: "open" }],
    memory: [{
      id: "mem_profile",
      title: "Acme profile",
      sourceUrl: "https://acme.example/profile?keep=1",
      workspaceIds: ["nw_research"],
      taskIds: ["nw_research"],
      contactId: "contact_ada",
      linkedTaskIds: ["task_ada"]
    }],
    actions: {
      tableRows: [],
      drafts: [],
      contacts: [{
        id: "contact_ada",
        name: "Ada Rivera",
        email: "ada@acme.example",
        company: "Acme",
        sourceUrl: "https://acme.example/profile?keep=1",
        sourceDomain: "acme.example",
        leadStatus: "new",
        memoryIds: ["mem_profile"]
      }, {
        id: "contact_beta",
        name: "Ben Beta",
        company: "Beta",
        sourceUrl: "https://beta.example/contact",
        sourceDomain: "beta.example",
        leadStatus: "new",
        memoryIds: []
      }],
      tasks: [{
        id: "task_ada",
        title: "Follow up with Ada",
        notes: "Send Acme notes",
        status: "open",
        priority: "high",
        dueDate: "2026-05-28",
        sourceUrl: "https://acme.example/profile?keep=1",
        sourceHost: "acme.example",
        sourceMemoryIds: ["mem_profile"]
      }, {
        id: "task_beta",
        title: "Review Beta",
        notes: "Check intake",
        status: "open",
        priority: "low",
        dueDate: "2026-06-10",
        sourceUrl: "https://beta.example/contact",
        sourceHost: "beta.example",
        sourceMemoryIds: []
      }]
    }
  });
  const { routeMessage } = loadBackground();

  const contacts = await routeMessage({
    type: "CONTACT_LIST",
    workspaceId: "nw_research",
    sourceHost: "acme.example",
    sourceUrlKey: "https://acme.example/profile?keep=1",
    limit: 10,
    offset: 0
  });
  assert.equal(contacts.total, 1);
  assert.equal(contacts.contacts[0].id, "contact_ada");
  assert.equal(contacts.listMeta.count, 1);
  assert.equal(contacts.facets.workspaces[0].id, "nw_research");

  const contactBatch = await routeMessage({
    type: "CONTACT_BATCH",
    ids: ["contact_ada", "missing_contact"],
    action: "update",
    patch: { leadStatus: "qualified" }
  });
  assert.equal(contactBatch.succeeded, 1);
  assert.equal(contactBatch.failed, 1);
  const singleStatusContacts = await routeMessage({
    type: "CONTACT_LIST",
    status: "qualified",
    statuses: "",
    limit: 10,
    offset: 0
  });
  assert.deepEqual(singleStatusContacts.contacts.map((contact) => contact.id), ["contact_ada"]);

  const tasks = await routeMessage({
    type: "TASK_LIST",
    status: "open",
    priority: "high",
    workspaceId: "nw_research",
    sourceHost: "acme.example",
    dueFrom: "2026-05-01",
    dueTo: "2026-05-31",
    q: "Acme",
    limit: 10,
    offset: 0
  });
  assert.equal(tasks.total, 1);
  assert.equal(tasks.tasks[0].id, "task_ada");
  assert.equal(tasks.facets.priorities.high, 1);

  const taskBatch = await routeMessage({
    type: "TASK_BATCH",
    ids: ["task_ada"],
    action: "update",
    patch: { status: "done", priority: "medium" }
  });
  assert.equal(taskBatch.succeeded, 1);
  const singleValueTasks = await routeMessage({
    type: "TASK_LIST",
    status: "done",
    statuses: "",
    priority: "medium",
    priorities: "",
    limit: 10,
    offset: 0
  });
  assert.deepEqual(singleValueTasks.tasks.map((task) => task.id), ["task_ada"]);

  const deletedTask = await routeMessage({ type: "TASK_DELETE", id: "task_ada" });
  assert.equal(deletedTask.deleted, true);
  assert.deepEqual(state.memory[0].linkedTaskIds, []);

  const deletedContact = await routeMessage({ type: "CONTACT_DELETE", id: "contact_ada" });
  assert.equal(deletedContact.deleted, true);
  assert.equal(state.memory[0].contactId, "");
});

test("service-worker linked lead memory is searchable", async () => {
  installChromeMock({ noteWorkspaces: [{ id: "nw_default_client_leads", name: "Client Leads" }] });
  const { routeMessage } = loadBackground();

  const saved = await routeMessage({
    type: "MEMORY_SAVE",
    kind: "lead",
    contactId: "contact_ada",
    title: "Ada Lovelace",
    sourceUrl: "https://example.com/profile",
    note: "Ada Lovelace Founder at Acme",
    snippet: "Ada Lovelace Founder at Acme",
    workspaceIds: ["nw_default_client_leads"],
    tags: ["lead"]
  });
  const result = await routeMessage({
    type: "MEMORY_SEARCH",
    query: "Ada Acme Client",
    limit: 5,
    offset: 0
  });

  assert.equal(result.total, 1);
  assert.equal(result.items[0].id, saved.item.id);
  assert.equal(result.items[0].kind, "lead");
  assert.equal(result.items[0].contactId, "contact_ada");
  assert.deepEqual(result.items[0].workspaceLabels, ["Client Leads"]);
});

test("service-worker task messages create linked tasks and preserve missing memory context", async () => {
  installChromeMock();
  const { routeMessage } = loadBackground();

  const saved = await routeMessage({
    type: "MEMORY_SAVE",
    title: "Task source",
    sourceUrl: "https://example.com/source",
    note: "Important follow up",
    workspaceIds: []
  });

  const created = await routeMessage({
    type: "ACTION_RUN",
    actionType: "create_task",
    payload: {
      title: "Follow up",
      notes: "Email Ada",
      dueDate: "2026-02-01",
      priority: "high",
      sourceMemoryIds: [saved.item.id],
      clientRequestId: "task-click-1"
    }
  });

  assert.equal(created.result.title, "Follow up");
  assert.equal(created.result.priority, "high");
  assert.deepEqual(created.result.sourceMemoryIds, [saved.item.id]);
  assert.equal(created.linkedMemoryItems[0].linkedTaskIds[0], created.result.id);

  const duplicate = await routeMessage({
    type: "ACTION_RUN",
    actionType: "create_task",
    payload: {
      title: "Follow up",
      sourceMemoryIds: [saved.item.id],
      clientRequestId: "task-click-1"
    }
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.result.id, created.result.id);

  const listed = await routeMessage({ type: "TASK_LIST", status: "open", limit: 10, offset: 0 });
  assert.equal(listed.total, 1);
  assert.equal(listed.tasks[0].id, created.result.id);

  const done = await routeMessage({
    type: "TASK_UPDATE",
    id: created.result.id,
    patch: { status: "done", priority: "medium" }
  });
  assert.equal(done.task.status, "done");
  assert.ok(done.task.completedAt);
  assert.equal((await routeMessage({ type: "TASK_LIST", status: "done", limit: 10, offset: 0 })).total, 1);

  const reopened = await routeMessage({
    type: "TASK_UPDATE",
    id: created.result.id,
    patch: { status: "open" }
  });
  assert.equal(reopened.task.completedAt, "");

  assert.equal((await routeMessage({ type: "TASK_CONTEXT", id: created.result.id })).items[0].unavailable, false);
  await routeMessage({ type: "MEMORY_DELETE", id: saved.item.id });
  const context = await routeMessage({ type: "TASK_CONTEXT", id: created.result.id });
  assert.equal(context.items[0].id, saved.item.id);
  assert.equal(context.items[0].unavailable, true);
});

test("service-worker broadcasts mirror refresh messages for workspace, contact, and task changes", async () => {
  const state = installChromeMock({
    noteWorkspaces: [{ id: "nw_research", name: "Research", status: "open" }],
    memory: [{
      id: "mem_source",
      title: "Source",
      sourceUrl: "https://example.com/source",
      workspaceIds: ["nw_research"],
      taskIds: ["nw_research"],
      linkedTaskIds: []
    }]
  });
  const { routeMessage } = loadBackground();

  await routeMessage({ type: "NOTE_WORKSPACE_CREATE", name: "Mirror Broadcast" });
  await routeMessage({
    type: "CONTACT_CREATE",
    contact: { id: "contact_ada", name: "Ada Lovelace", company: "Analytical Engines" }
  });
  const task = await routeMessage({
    type: "ACTION_RUN",
    actionType: "create_task",
    payload: {
      title: "Follow up with Ada",
      priority: "high",
      sourceMemoryIds: ["mem_source"],
      clientRequestId: "mirror-broadcast-task"
    }
  });
  await routeMessage({ type: "TASK_UPDATE", id: task.result.id, patch: { status: "done" } });

  const mirrorMessages = state.runtimeMessages.filter((message) => message && message.type === "MIRROR_DATA_CHANGED");
  assert.ok(mirrorMessages.some((message) => message.reason === "workspace" && message.action === "create"));
  assert.ok(mirrorMessages.some((message) => message.reason === "contact" && message.action === "create"));
  assert.ok(mirrorMessages.some((message) => message.reason === "task" && message.action === "create"));
  assert.ok(mirrorMessages.some((message) => message.reason === "task" && message.action === "update"));
});

test("service-worker Chrome command opens command palette on active tab with injection fallback", async () => {
  const state = installChromeMock({
    failTabMessages: 1,
    activeTabs: [{ id: 42, url: "https://example.com/page" }]
  });
  const { handleChromeCommand } = loadBackground();

  const result = await handleChromeCommand("open-command-palette");

  assert.equal(result.ok, true);
  assert.equal(state.commandListener instanceof Function, true);
  assert.deepEqual(state.tabMessages.map((item) => item.message.type), ["AAW_OPEN_COMMAND_PALETTE", "AAW_OPEN_COMMAND_PALETTE"]);
  assert.deepEqual(state.scriptInjections[0].files, ["privacy-utils.js", "selection-replacement.js", "shortcut-utils.js", "settings-utils.js", "content.js"]);
  assert.deepEqual(state.cssInjections[0].files, ["styles.css"]);
});

test("service-worker Chrome command short-circuits on restricted chrome:// tabs without messaging or injection", async () => {
  const state = installChromeMock({
    activeTabs: [{ id: 9, url: "chrome://extensions" }]
  });
  const { handleChromeCommand } = loadBackground();

  const result = await handleChromeCommand("open-command-palette");

  assert.equal(result.ok, false);
  assert.equal(result.error, "Restricted page");
  assert.equal(result.reason, "unsupported_url");
  assert.deepEqual(state.tabMessages, []);
  assert.deepEqual(state.scriptInjections, []);
  assert.deepEqual(state.cssInjections, []);
});

test("service-worker isSupportedPageUrl gates schemes that content scripts cannot run on", () => {
  installChromeMock();
  const { isSupportedPageUrl, isInjectableTab } = loadBackground();

  assert.equal(isSupportedPageUrl("https://example.com/path"), true);
  assert.equal(isSupportedPageUrl("http://example.com/"), true);
  assert.equal(isSupportedPageUrl("file:///Users/me/page.html"), true);
  for (const restricted of [
    "chrome://extensions",
    "chrome-untrusted://terminal",
    "about:blank",
    "edge://settings",
    "devtools://devtools/bundled/devtools_app.html",
    "view-source:https://example.com",
    "data:text/html,<p>hi</p>",
    "javascript:void(0)",
    ""
  ]) {
    assert.equal(isSupportedPageUrl(restricted), false, `expected ${restricted} to be unsupported`);
  }

  assert.equal(isInjectableTab(null), false);
  assert.equal(isInjectableTab({ id: 1 }), false);
  assert.equal(isInjectableTab({ id: 1, url: "chrome://extensions" }), false);
  assert.equal(isInjectableTab({ id: 1, url: "https://example.com" }), true);
  assert.equal(isInjectableTab({ id: 1, pendingUrl: "https://example.com" }), true);
});

test("service-worker context graph messages expose read-only related records", async () => {
  installChromeMock({
    noteWorkspaces: [{ id: "nw_research", name: "Research", status: "open" }],
    memory: [{
      id: "mem_graph",
      title: "Graph note",
      note: "Ada context",
      sourceUrl: "https://example.com/report?utm_source=x&keep=1",
      workspaceIds: ["nw_research"],
      taskIds: ["nw_research"],
      linkedTaskIds: ["task_graph"],
      contactId: "contact_graph",
      structuredExtraction: { title: "Graph extraction" }
    }],
    actions: {
      tableRows: [],
      drafts: [],
      contacts: [{
        id: "contact_graph",
        name: "Ada Graph",
        email: "ada@example.com",
        sourceUrl: "https://example.com/report?keep=1",
        memoryIds: ["mem_graph"]
      }],
      tasks: [{
        id: "task_graph",
        title: "Follow graph",
        status: "open",
        sourceUrl: "https://example.com/report?keep=1",
        sourceMemoryIds: ["mem_graph"]
      }]
    }
  });
  const { routeMessage } = loadBackground();

  const memoryGraph = await routeMessage({ type: "CONTEXT_MEMORY", id: "mem_graph" });
  assert.equal(memoryGraph.subject.found, true);
  assert.ok(memoryGraph.nodes.some((node) => node.id === "workspace:nw_research"));
  assert.ok(memoryGraph.nodes.some((node) => node.id === "task:task_graph"));
  assert.ok(memoryGraph.nodes.some((node) => node.id === "contact:contact_graph"));
  assert.ok(memoryGraph.nodes.some((node) => node.id === "extraction:mem_graph"));
  assert.ok(memoryGraph.edges.some((edge) => edge.type === "memory_source"));

  const sourceGraph = await routeMessage({
    type: "CONTEXT_SOURCE",
    urlKey: "https://example.com/report?utm_campaign=x&keep=1"
  });
  assert.equal(sourceGraph.subject.found, true);
  assert.ok(sourceGraph.nodes.some((node) => node.id === "memory:mem_graph"));

  const searchGraph = await routeMessage({ type: "CONTEXT_SEARCH", q: "Ada", limit: 10 });
  assert.equal(searchGraph.subject.found, true);
  assert.ok(searchGraph.nodes.some((node) => node.id === "contact:contact_graph"));
});

test("service-worker workspace dashboard messages derive metrics and related records", async () => {
  installChromeMock({
    noteWorkspaces: [
      { id: "nw_research", name: "Research", status: "open" },
      { id: "nw_archived", name: "Archived", status: "archived" }
    ],
    memory: [{
      id: "mem_dash",
      title: "Dashboard note",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
      sourceUrl: "https://example.com/report?utm_source=x&keep=1",
      workspaceIds: ["nw_research"],
      taskIds: ["nw_research"],
      linkedTaskIds: ["task_dash"],
      contactId: "contact_dash"
    }, {
      id: "mem_unassigned_dash",
      title: "Unassigned dashboard note",
      createdAt: "2026-04-01T00:00:00.000Z"
    }],
    actions: {
      tableRows: [],
      drafts: [],
      contacts: [{
        id: "contact_dash",
        name: "Ada Dashboard",
        sourceUrl: "https://example.com/report?keep=1",
        memoryIds: ["mem_dash"]
      }],
      tasks: [{
        id: "task_dash",
        title: "Dashboard task",
        status: "done",
        completedAt: "2026-05-03T00:00:00.000Z",
        sourceUrl: "https://example.com/report?keep=1",
        sourceMemoryIds: ["mem_dash"]
      }]
    }
  });
  const { routeMessage } = loadBackground();

  const dashboard = await routeMessage({ type: "NOTE_WORKSPACE_DASHBOARD", id: "nw_research", taskStatus: "done" });
  assert.equal(dashboard.workspace.name, "Research");
  assert.equal(dashboard.metrics.notes, 1);
  assert.equal(dashboard.metrics.contacts, 1);
  assert.equal(dashboard.metrics.tasks, 1);
  assert.equal(dashboard.tasks.items[0].id, "task_dash");
  assert.equal(dashboard.sources[0].urlKey, "https://example.com/report?keep=1");
  assert.equal(dashboard.permissions.canWrite, true);

  const unassigned = await routeMessage({ type: "NOTE_WORKSPACE_UNASSIGNED_DASHBOARD" });
  assert.equal(unassigned.workspace.id, "unassigned");
  assert.equal(unassigned.permissions.canArchive, false);
  assert.equal(unassigned.memory.items[0].id, "mem_unassigned_dash");

  const archived = await routeMessage({ type: "NOTE_WORKSPACE_DASHBOARD", id: "nw_archived" });
  assert.equal(archived.permissions.canWrite, false);
  assert.equal(archived.permissions.canArchive, true);
});
