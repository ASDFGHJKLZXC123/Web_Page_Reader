"use strict";

// Lightweight HTTP harness around backend/src/server.js.
//
// Used by:
//   - backend route contract tests (test/server-routes.test.js), and
//   - e2e "remote backend mode" (test/e2e/helpers/extension-harness.js).
//
// The backend resolves its data dir (NOTES_DIR) once at module load, so this
// harness creates a temp NOTES_DIR and sets the env var BEFORE requiring the
// server. Node's test runner isolates each test file in its own process, so a
// per-file temp dir stays clean. No provider API key is required: when Gemini
// is unconfigured the server falls back to deterministic local analysis.

const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

function createTempNotesDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aaw-e2e-notes-"));
}

function createTempSocketPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aaw-e2e-socket-"));
  return { dir, socketPath: path.join(dir, "backend.sock") };
}

// Start the backend with an isolated NOTES_DIR.
// Default transport is a Unix socket so `npm test` does not need TCP bind
// permission inside restricted sandboxes. E2e remote-backend tests request
// `transport: "tcp"` because the browser extension needs a normal URL.
// Returns { baseUrl, port, socketPath, notesDir, server, request, close }.
async function startBackend({ host = "127.0.0.1", notesDir, transport = "socket" } = {}) {
  const dir = notesDir || createTempNotesDir();
  process.env.NOTES_DIR = dir;
  // Leave Gemini unconfigured so analyze/extract use the local fallback.
  delete process.env.GEMINI_API_KEY;

  const { server, startServer } = require("../../backend/src/server");
  let socketInfo = null;

  if (!server.listening) {
    if (transport === "tcp") {
      await new Promise((resolve) => {
        startServer({ port: 0, host });
        server.once("listening", resolve);
        if (server.listening) resolve();
      });
    } else {
      socketInfo = createTempSocketPath();
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(socketInfo.socketPath, () => {
          server.off("error", reject);
          resolve();
        });
      });
    }
  }

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const socketPath = typeof address === "string" ? address : (socketInfo && socketInfo.socketPath) || "";
  const baseUrl = port ? `http://${host}:${port}` : "";

  function request(method, requestPath, body) {
    return new Promise((resolve, reject) => {
      const payload = body === undefined ? null : JSON.stringify(body);
      const requestOptions = socketPath
        ? { socketPath, path: requestPath, method }
        : { hostname: host, port, path: requestPath, method };
      requestOptions.headers = {
        "Content-Type": "application/json",
        ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {})
      };
      const req = http.request(requestOptions, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode, json, text });
        });
      });
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  async function close() {
    if (server.listening) {
      await new Promise((resolve) => server.close(resolve));
    }
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
    if (socketInfo) {
      try {
        fs.rmSync(socketInfo.dir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  }

  return { baseUrl, port, socketPath, notesDir: dir, server, request, close };
}

module.exports = { startBackend, createTempNotesDir };
