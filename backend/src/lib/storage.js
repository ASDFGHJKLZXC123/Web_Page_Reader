const fs = require("fs");
const path = require("path");

const dataDir = path.join(__dirname, "..", "..", "data");
const dbFile = path.join(dataDir, "db.json");
const embeddingsFile = path.join(dataDir, "embeddings.ndjson");

const DEFAULT_DB = {
  memory: [],
  actions: {
    tasks: [],
    tableRows: [],
    contacts: [],
    drafts: []
  }
};

// In-memory write-through cache. Populated on first load, stays warm.
let dbCache = null;

// Write queue: serializes all disk writes so concurrent requests never clobber each other.
let writeChain = Promise.resolve();

function enqueueWrite(fn) {
  writeChain = writeChain.then(fn).catch(() => {});
  return writeChain;
}

async function ensureDb() {
  await fs.promises.mkdir(dataDir, { recursive: true });

  try {
    await fs.promises.access(dbFile);
  } catch {
    await fs.promises.writeFile(dbFile, JSON.stringify(DEFAULT_DB, null, 2));
  }

  try {
    await fs.promises.access(embeddingsFile);
  } catch {
    await fs.promises.writeFile(embeddingsFile, "");
  }
}

async function loadDb() {
  if (dbCache !== null) return dbCache;

  await ensureDb();

  let raw;
  try {
    raw = await fs.promises.readFile(dbFile, "utf8");
  } catch {
    dbCache = structuredClone(DEFAULT_DB);
    await fs.promises.writeFile(dbFile, JSON.stringify(dbCache, null, 2));
    return dbCache;
  }

  try {
    dbCache = JSON.parse(raw);
  } catch {
    // Rename corrupt file instead of silently overwriting — prevent data loss
    const backup = `${dbFile}.broken-${Date.now()}`;
    await fs.promises.rename(dbFile, backup).catch(() => {});
    console.error(`[storage] Corrupt db.json renamed to ${path.basename(backup)}. Starting fresh.`);
    dbCache = structuredClone(DEFAULT_DB);
    await fs.promises.writeFile(dbFile, JSON.stringify(dbCache, null, 2));
  }

  return dbCache;
}

async function saveDb(db) {
  await ensureDb();
  // Atomic write: write to temp file then rename
  const tmp = `${dbFile}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(db, null, 2));
  await fs.promises.rename(tmp, dbFile);
  dbCache = db;
}

async function appendMemory(item) {
  return enqueueWrite(async () => {
    const db = await loadDb();

    // Separate embedding from the main item before persisting
    const { embedding, ...itemWithoutEmbedding } = item;

    if (embedding && Array.isArray(embedding) && embedding.length > 0) {
      const line = JSON.stringify({ id: item.id, embedding }) + "\n";
      await fs.promises.appendFile(embeddingsFile, line, "utf8");
    }

    db.memory.unshift(itemWithoutEmbedding);
    await saveDb(db);
    return itemWithoutEmbedding;
  });
}

async function listMemory() {
  const db = await loadDb();
  return db.memory;
}

async function deleteMemory(id) {
  return enqueueWrite(async () => {
    const db = await loadDb();
    const index = db.memory.findIndex((item) => item.id === id);
    if (index === -1) return null;
    db.memory.splice(index, 1);
    await saveDb(db);
    return id;
  });
}

async function appendAction(kind, item) {
  return enqueueWrite(async () => {
    const db = await loadDb();
    if (!db.actions[kind]) db.actions[kind] = [];
    db.actions[kind].unshift(item);
    await saveDb(db);
    return item;
  });
}

async function getActions() {
  const db = await loadDb();
  return db.actions;
}

async function updateTask(id, patch) {
  return enqueueWrite(async () => {
    const db = await loadDb();
    const tasks = db.actions.tasks || [];
    const index = tasks.findIndex((task) => task.id === id);
    if (index === -1) return null;
    const allowed = ["status", "title", "notes"];
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(patch, key) && patch[key] !== undefined) {
        tasks[index][key] = patch[key];
      }
    }
    db.actions.tasks = tasks;
    await saveDb(db);
    return tasks[index];
  });
}

// Synchronous: reads embeddings.ndjson and returns a Map of id → float[].
// Kept sync because it's a separate file read used only during search.
function loadAllEmbeddings() {
  const map = new Map();
  try {
    if (!fs.existsSync(embeddingsFile)) return map;
    const content = fs.readFileSync(embeddingsFile, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const entry = JSON.parse(trimmed);
        if (entry.id) map.set(entry.id, entry.embedding || []);
      } catch {
        // skip malformed lines
      }
    }
  } catch {
    // return empty map on any read error
  }
  return map;
}

// One-time startup migration: move inline embeddings from db.json to embeddings.ndjson.
async function migrateEmbeddings() {
  await ensureDb();
  const db = await loadDb();
  let migrated = 0;
  const lines = [];

  for (const item of db.memory) {
    if (item.embedding && Array.isArray(item.embedding) && item.embedding.length > 0) {
      lines.push(JSON.stringify({ id: item.id, embedding: item.embedding }) + "\n");
      delete item.embedding;
      migrated++;
    }
  }

  if (migrated > 0) {
    await fs.promises.appendFile(embeddingsFile, lines.join(""), "utf8");
    await saveDb(db);
    console.log(`[storage] Migrated ${migrated} embedding(s) from db.json to embeddings.ndjson`);
  }
}

migrateEmbeddings().catch((err) => console.error("[storage] Migration error:", err));

module.exports = {
  appendAction,
  appendMemory,
  deleteMemory,
  getActions,
  listMemory,
  loadAllEmbeddings,
  updateTask
};
