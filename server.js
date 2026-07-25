const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 10000;

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/", (req, res) => {
  res.json({
    service: "Interpreter.ai API",
    status: "online",
    version: "0.1.0"
  });
});

app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true,
    service: "interpreter-api",
    timestamp: new Date().toISOString()
  });
});

app.post("/api/realtime/session", async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({
        error: "OPENAI_API_KEY is not configured"
      });
    }

    const {
      sourceLanguage = "English",
      targetLanguage = "Brazilian Portuguese"
    } = req.body || {};

    const instructions = `
You are Interpreter.ai, a real-time voice translation system.

The two active languages are:
- Source language: ${sourceLanguage}
- Target language: ${targetLanguage}

Translate the speaker's intended meaning naturally and accurately.

Rules:
- Translate only. Do not answer the speaker's questions.
- Do not add advice, facts, opinions, or explanations.
- Preserve names, numbers, dates, prices, addresses, tone, and uncertainty.
- Keep the translation concise enough for a natural conversation.
- If audio is unclear, ask the speaker to repeat it.
- Speak only in the opposite language from the language just spoken.
`;

    const openAIResponse = await fetch(
      "https://api.openai.com/v1/realtime/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-4o-realtime-preview",
          voice: "alloy",
          instructions
        })
      }
    );

    const data = await openAIResponse.json();

    if (!openAIResponse.ok) {
      console.error("OpenAI session error:", data);

      return res.status(openAIResponse.status).json({
        error: "Unable to create realtime session",
        details: data
      });
    }

    res.status(200).json(data);
  } catch (error) {
    console.error("Session creation failed:", error);

    res.status(500).json({
      error: "Internal server error"
    });
  }
});

app.use((req, res) => {
  res.status(404).json({
    error: "Route not found"
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Interpreter.ai API listening on port ${PORT}`);
});

