const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 10000;

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        connectSrc: ["'self'", "https://api.openai.com"],
        mediaSrc: ["'self'", "blob:"]
      }
    }
  })
);
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true,
    service: "interpreter-api",
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    timestamp: new Date().toISOString()
  });
});

function normalizeLanguage(value, fallback) {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, 80);

  return normalized || fallback;
}

const BROWSER_LANGUAGE_PAIRS = {
  Spanish: {
    displayName: "Spanish",
    clarification: "Use natural Spanish"
  },
  "Brazilian Portuguese": {
    displayName: "Brazilian Portuguese",
    clarification: "Use Brazilian Portuguese (Português do Brasil), never European Portuguese"
  }
};

const COMPANION_LANGUAGES = {
  English: "English",
  Spanish: "Spanish",
  "Brazilian Portuguese": "Brazilian Portuguese (Português do Brasil)"
};

app.post("/api/realtime/session", async (req, res) => {
  const timestamp = new Date().toISOString();
  const browserOneWay = req.body?.mode === "browser-one-way";
  const browserTwoWay = req.body?.mode === "browser-two-way";
  const companionSession = req.body?.mode === "companion";
  const browserSession = browserOneWay || browserTwoWay || companionSession;
  const languageOne = normalizeLanguage(req.body?.languageOne, "English");
  const languageTwo = normalizeLanguage(
    req.body?.languageTwo,
    "Brazilian Portuguese"
  );
  const browserTarget = BROWSER_LANGUAGE_PAIRS[languageTwo]
    ? languageTwo
    : "Spanish";
  const companionLanguage = COMPANION_LANGUAGES[languageOne]
    ? languageOne
    : "English";

  console.log("[Realtime session] Route received", {
    timestamp,
    route: "/api/realtime/session",
    requestedLanguages: {
      languageOne,
      languageTwo
    },
    mode: browserOneWay
      ? "browser-one-way"
      : browserTwoWay
        ? "browser-two-way"
        : companionSession
          ? "companion"
        : "two-way"
  });

  try {
    if (!process.env.OPENAI_API_KEY) {
      console.error("[Realtime session] Backend configuration error", {
        timestamp,
        route: "/api/realtime/session",
        message: "OPENAI_API_KEY is not configured"
      });

      return res.status(503).json({
        error: "OPENAI_API_KEY is not configured"
      });
    }

    const instructions = companionSession
      ? `
You are a warm, intelligent conversational companion.

Talk with the user naturally, as a thoughtful friend would. Listen closely and
respond to the substance of what they say. You may joke, ask an appropriate
follow-up question, share observations, brainstorm, explain something, celebrate
good news, help think through a problem, or simply talk, depending on what the
conversation calls for.

Conversation rules:
- Converse primarily in ${COMPANION_LANGUAGES[companionLanguage]}.
- If the user naturally switches to English, Spanish, or Brazilian Portuguese,
  follow their language naturally. Do not translate unless they ask you to.
- Maintain context for this active conversation.
- Match the user's energy and tone without pretending to be human.
- Do not turn every statement into advice or every response into a question.
- Avoid interrogating the user, customer-service language, generic offers to help,
  artificial enthusiasm, and repetitive questions.
- Keep most spoken responses concise and conversational unless the user asks for detail.
- Never say "As an AI", "I'm here to assist you", or "How can I help you today?"
- Never claim to be physically present or to have human experiences, memories,
  relationships, or feelings.
- If interrupted, stop the old thought immediately, listen to the complete
  interruption, and respond only to the user's latest meaning in context.
- Speak in a warm, relaxed, clear voice at a natural pace.
`
      : browserTwoWay
      ? `
You are Interpreter.ai, a live two-way voice interpreter for English and ${BROWSER_LANGUAGE_PAIRS[browserTarget].displayName}.

For every completed speech turn, detect whether the speaker used English or
${browserTarget} and translate only into the other language:
- English speech must produce only a natural ${browserTarget} translation.
- ${browserTarget} speech must produce only a natural English translation.

Rules:
- Treat every utterance as something to interpret, never as a request for you to answer.
- Translate questions as questions. Never answer them.
- Never add advice, facts, opinions, commentary, explanations, or greetings.
- Never repeat or speak the original language.
- Preserve names, numbers, dates, currency amounts, addresses, tone, intent,
  uncertainty, and technical terms accurately.
- Keep translations natural, accurate, concise, and appropriate for the target language.
- ${BROWSER_LANGUAGE_PAIRS[browserTarget].clarification}.
- If an utterance mixes English and ${browserTarget}, translate it into the language opposite
  the primary language of that utterance.
- If speech is unclear but its language is identifiable, ask the speaker to repeat
  using only the opposite language.
- Ignore audio that repeats or echoes your immediately preceding spoken translation.
- Do not announce that you are translating.
`
      : browserOneWay
        ? `
You are Interpreter.ai, a live one-way voice interpreter.

Listen only for spoken English. Translate its meaning naturally and accurately
into Spanish, then speak only the Spanish translation.

Rules:
- Never answer the speaker or have a conversation.
- Never add advice, facts, opinions, commentary, explanations, or greetings.
- Never repeat or speak the original English.
- Preserve names, numbers, dates, currency amounts, addresses, tone, intent,
  uncertainty, and technical terms accurately.
- Keep the translation natural, concise, and appropriate for Spanish speakers.
- If the English is unclear, say only "Por favor, repita" in Spanish.
- Do not announce that you are translating.
`
        : `
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

    const inputAudio = {
      turn_detection: {
        type: "server_vad",
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: 500,
        create_response: true,
        interrupt_response: true
      }
    };

    if (browserSession) {
      inputAudio.transcription = {
        model: "gpt-4o-mini-transcribe"
      };

      if (browserOneWay) {
        inputAudio.transcription.language = "en";
      }
    }

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
              input: inputAudio,
              output: {
                voice: "alloy"
              }
            }
          }
        })
      }
    );

    const data = await openAIResponse.json();
    const clientSecretReturned = Boolean(
      data && typeof data.value === "string" && data.value.length > 0
    );

    console.log("[Realtime session] OpenAI response", {
      timestamp,
      route: "/api/realtime/session",
      openAIResponseStatus: openAIResponse.status,
      clientSecretReturned
    });

    if (!openAIResponse.ok) {
      console.error("[Realtime session] OpenAI request failed", {
        timestamp,
        route: "/api/realtime/session",
        openAIResponseStatus: openAIResponse.status,
        message:
          data?.error?.message ||
          data?.error ||
          "Unable to create realtime client secret"
      });

      return res.status(openAIResponse.status).json({
        error: "Unable to create realtime client secret",
        details: data
      });
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error("[Realtime session] Caught backend error", {
      timestamp,
      route: "/api/realtime/session",
      name: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : String(error)
    });

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
