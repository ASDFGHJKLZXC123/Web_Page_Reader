"use strict";

// Minimal static file server for deterministic local fixture pages.
// Content scripts only match http/https (and the manifest grants http/https
// host permissions), so fixtures must be served over HTTP rather than file://.
//
// Dependency-free (node http/fs only) so it can be required without Playwright.

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function startFixtureServer(rootDir, { host = "127.0.0.1" } = {}) {
  const root = path.resolve(rootDir);

  const server = http.createServer((req, res) => {
    // Strip query/hash, normalize, and confine to the fixtures root.
    const rawPath = decodeURIComponent((req.url || "/").split("?")[0].split("#")[0]);
    const relPath = rawPath === "/" ? "/index.html" : rawPath;
    const filePath = path.normalize(path.join(root, relPath));

    if (!filePath.startsWith(root)) {
      res.writeHead(403).end("Forbidden");
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
        return;
      }
      const type = CONTENT_TYPES[path.extname(filePath)] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": type }).end(data);
    });
  });

  return new Promise((resolve) => {
    server.listen(0, host, () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://${host}:${port}`,
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
}

module.exports = { startFixtureServer };
