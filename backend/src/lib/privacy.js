"use strict";

// Backend re-export of the shared privacy utilities. The canonical
// implementation lives in chrome-extension/privacy-utils.js so the backend,
// service worker, and content script share one source of truth for AI-send
// decisions, redaction, host matching, and retention math.
module.exports = require("../../../chrome-extension/privacy-utils.js");
