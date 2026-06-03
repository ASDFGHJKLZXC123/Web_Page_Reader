// Playwright config for the MV3 extension e2e harness (Milestone 1).
//
// The unpacked extension is loaded via a persistent Chromium context inside
// test/e2e/helpers/extension-harness.js (Playwright cannot load MV3 extensions
// through the standard `browser` fixture), so this config only governs test
// discovery, timeouts, and failure artifacts.
//
// Specs live in test/e2e/specs and match *.spec.js so the Node test runner
// (`npm test`) never picks them up. Helper unit tests stay as *.test.js under
// test/e2e/helpers and are run by `node --test` instead.

const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./test/e2e/specs",
  testMatch: "**/*.spec.js",
  // Persistent profile + single shared extension context — never run in parallel.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? "line" : "list",
  outputDir: "./test/e2e/artifacts",
  use: {
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  }
});
