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
    version: "0.2.0"
  });
});

app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true,
    service: "interpreter-api",
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
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
      languageOne = "English",
      languageTwo = "Brazilian Portuguese"
    } = req.body || {};

    const instructions = `
You are Interpreter.ai, a live two-way voice interpreter.

The active languages are:
- ${languageOne}
- ${languageTwo}

Your only job is to translate the meaning of each speaker into the other
active language.

Rules:
- Never answer a question on behalf of the other person.
- Translate questions as questions.
- Do not add advice, facts, opinions, commentary, or explanations.
- Preserve names, numbers, dates, prices, addresses, tone, humor,
  uncertainty, and technical terms.
- Keep translations natural, accurate, and brief.
- When the speaker uses ${languageOne}, respond only in ${languageTwo}.
- When the speaker uses ${languageTwo}, respond only in ${languageOne}.
- If speech is unclear, briefly ask the speaker to repeat themselves in
  the language they were using.
- Do not announce that you are translating.
`;

    const openAIResponse = await fetch(
      "https://api.openai.com/v1/realtime/client_secrets",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          session: {
            type: "realtime",
            model: "gpt-realtime",
            instructions,
            output_modalities: ["audio"],
            audio: {
              output: {
                voice: "alloy"
              }
            }
          }
        })
      }
    );

    const data = await openAIResponse.json();

    if (!openAIResponse.ok) {
      console.error("OpenAI session error:", data);

      return res.status(openAIResponse.status).json({
        error: "Unable to create realtime client secret",
        details: data
      });
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error("Session creation failed:", error);

    return res.status(500).json({
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
