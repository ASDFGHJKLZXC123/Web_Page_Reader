const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

function getGeminiApiKey() {
  return process.env.GEMINI_API_KEY || "";
}

function getGeminiModel() {
  return process.env.GEMINI_MODEL || "gemini-2.5-flash";
}

function getGeminiEmbeddingModel() {
  return process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001";
}

function isGeminiConfigured() {
  return Boolean(getGeminiApiKey());
}

async function geminiRequest(path, body) {
  if (!isGeminiConfigured()) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const response = await fetch(`${GEMINI_API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": getGeminiApiKey()
    },
    body: JSON.stringify(body)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data.error && data.error.message ? data.error.message : "Gemini request failed";
    throw new Error(message);
  }

  return data;
}

function extractTextFromCandidate(data) {
  const candidates = Array.isArray(data.candidates) ? data.candidates : [];
  const content = candidates[0] && candidates[0].content ? candidates[0].content : {};
  const parts = Array.isArray(content.parts) ? content.parts : [];

  return parts
    .map((part) => part.text || "")
    .join("")
    .trim();
}

async function generateText(prompt) {
  const data = await geminiRequest(`/models/${getGeminiModel()}:generateContent`, {
    contents: [
      {
        parts: [
          {
            text: prompt
          }
        ]
      }
    ]
  });

  return extractTextFromCandidate(data);
}

async function generateStructuredJson(prompt, schema) {
  const data = await geminiRequest(`/models/${getGeminiModel()}:generateContent`, {
    contents: [
      {
        parts: [
          {
            text: prompt
          }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema
    }
  });

  return extractTextFromCandidate(data);
}

async function embedText(text, taskType) {
  const embeddingModel = getGeminiEmbeddingModel();
  const data = await geminiRequest(`/models/${embeddingModel}:embedContent`, {
    model: `models/${embeddingModel}`,
    content: {
      parts: [
        {
          text
        }
      ]
    },
    taskType,
    outputDimensionality: 768
  });

  return data.embedding && Array.isArray(data.embedding.values) ? data.embedding.values : [];
}

module.exports = {
  embedText,
  generateText,
  generateStructuredJson,
  getGeminiEmbeddingModel,
  getGeminiModel,
  isGeminiConfigured
};
