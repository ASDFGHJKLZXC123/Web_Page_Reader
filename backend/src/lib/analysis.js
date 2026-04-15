function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateText(text, maxLength = 12000) {
  const normalized = normalizeText(text);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return normalized.slice(0, maxLength);
}

function splitSentences(text) {
  return normalizeText(text)
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function topSentences(text, count) {
  const sentences = splitSentences(text);
  const scored = sentences.map((sentence, index) => {
    const words = sentence.toLowerCase().match(/[a-z0-9]+/g) || [];
    const unique = new Set(words).size;
    const score = unique + clamp(sentence.length / 30, 0, 8) - index * 0.15;
    return { sentence, score, index };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.sentence);
}

function summarizeText(text) {
  const summary = topSentences(text, 3).join(" ");
  return summary || "No meaningful text was available to summarize.";
}

function rewriteText(text, instruction) {
  const sentences = splitSentences(text).slice(0, 6);
  if (sentences.length === 0) {
    return "No text was available to rewrite.";
  }

  const opener = instruction
    ? `Rewrite goal: ${instruction.trim()}.`
    : "Rewrite goal: clearer and shorter.";

  const bullets = sentences.map((sentence) => {
    const trimmed = sentence.replace(/\s+/g, " ").trim();
    const softened = trimmed.replace(/\b(is|are|was|were)\b/gi, "can be");
    return `- ${softened}`;
  });

  return [opener, ...bullets].join("\n");
}

function extractStructuredInfo(text, title, url) {
  const emails = Array.from(new Set(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []));
  const phones = Array.from(
    new Set(text.match(/(?:\+?\d{1,2}\s*)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}/g) || [])
  );
  const dates = Array.from(
    new Set(
      text.match(
        /\b(?:\d{4}-\d{2}-\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]* \d{1,2}, \d{4})\b/gi
      ) || []
    )
  );
  const headings = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && line.length < 80)
    .slice(0, 8);

  return {
    title: title || "Untitled page",
    url: url || "",
    headings,
    contacts: {
      emails,
      phones
    },
    dates,
    summary: summarizeText(text)
  };
}

function tokenize(text) {
  return normalizeText(text)
    .toLowerCase()
    .match(/[a-z0-9]{2,}/g) || [];
}

function buildEmbedding(text, dimensions = 48) {
  const vector = new Array(dimensions).fill(0);
  const tokens = tokenize(text);

  if (tokens.length === 0) {
    return vector;
  }

  for (const token of tokens) {
    let hash = 2166136261;
    for (let index = 0; index < token.length; index += 1) {
      hash ^= token.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }

    const slot = Math.abs(hash) % dimensions;
    vector[slot] += 1;
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => Number((value / magnitude).toFixed(6)));
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
    return 0;
  }

  let sum = 0;
  for (let index = 0; index < a.length; index += 1) {
    sum += a[index] * b[index];
  }
  return sum;
}

function buildResponse({ mode, content, instruction, title, url }) {
  const text = normalizeText(content);

  if (mode === "rewrite") {
    return {
      mode,
      output: rewriteText(text, instruction)
    };
  }

  if (mode === "extract") {
    return {
      mode,
      output: extractStructuredInfo(content, title, url)
    };
  }

  return {
    mode: "summarize",
    output: summarizeText(text)
  };
}

module.exports = {
  buildEmbedding,
  buildResponse,
  cosineSimilarity,
  normalizeText,
  summarizeText,
  tokenize,
  truncateText
};
