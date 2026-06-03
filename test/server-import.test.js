"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

test("backend server can be imported without listening", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aaw-server-import-"));
  process.env.NOTES_DIR = tmp;

  const { server, startServer } = require("../backend/src/server");

  assert.equal(server.listening, false);
  assert.equal(typeof startServer, "function");

  assert.equal(fs.existsSync(tmp), true);
});
