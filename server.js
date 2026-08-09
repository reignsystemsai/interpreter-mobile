const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
const accountRoutes = require("./src/server/routes/account");
const contactRoutes = require("./src/server/routes/contacts");
const notificationRoutes = require("./src/server/routes/notifications");
const subscriptionRoutes = require("./src/server/routes/subscriptions");
const deviceRoutes = require("./src/server/routes/devices");
const callRoutes = require("./src/server/routes/calls");
const { isSupabaseConfigured } = require("./src/server/supabase");
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

app.use("/api/v1/account", accountRoutes);
app.use("/api/v1/contacts", contactRoutes);
app.use("/api/v1/notifications", notificationRoutes);
app.use("/api/v1/subscriptions", subscriptionRoutes);
app.use("/api/v1/devices", deviceRoutes);
app.use("/api/v1/calls", callRoutes);

app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true,
    service: "interpreter-api",
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    accountServicesConfigured: isSupabaseConfigured(),
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

const MOBILE_INTERPRETER_LANGUAGES = {
  English: "English",
  "Brazilian Portuguese": "Brazilian Portuguese (Português do Brasil)",
  Spanish: "Spanish",
  French: "French",
  German: "German",
  Italian: "Italian",
  Dutch: "Dutch",
  Russian: "Russian",
  Polish: "Polish",
  Romanian: "Romanian",
  Turkish: "Turkish",
  Hebrew: "Hebrew",
  "Mandarin Chinese": "Mandarin Chinese",
  Cantonese: "Cantonese",
  Vietnamese: "Vietnamese",
  Thai: "Thai",
  Japanese: "Japanese",
  Korean: "Korean",
  Arabic: "Arabic",
  Hindi: "Hindi"
};

app.post("/api/realtime/session", async (req, res) => {
  const timestamp = new Date().toISOString();
  const browserOneWay = req.body?.mode === "browser-one-way";
  const browserTwoWay = req.body?.mode === "browser-two-way";
  const mobileInterpreter = req.body?.mode === "mobile-interpreter";
  const mobilePair = req.body?.mode === "mobile-pair";
  const transcribedSession =
    browserOneWay || browserTwoWay || mobileInterpreter || mobilePair;
  const languageOne = normalizeLanguage(req.body?.languageOne, "English");
  const languageTwo = normalizeLanguage(
    req.body?.languageTwo,
    "Brazilian Portuguese"
  );
  const browserTarget = BROWSER_LANGUAGE_PAIRS[languageTwo]
    ? languageTwo
    : "Spanish";
  const mobileTarget = MOBILE_INTERPRETER_LANGUAGES[languageTwo]
    ? languageTwo
    : "Spanish";
  const mobileSource = MOBILE_INTERPRETER_LANGUAGES[languageOne]
    ? languageOne
    : "English";

  console.log("[Realtime session] Route received", {
    timestamp,
    route: "/api/realtime/session",
    mode: browserOneWay
      ? "browser-one-way"
      : browserTwoWay
        ? "browser-two-way"
        : mobileInterpreter
          ? "mobile-interpreter"
          : mobilePair
            ? "mobile-pair"
          : "two-way"
  });

  try {
    if (!process.env.OPENAI_API_KEY) {
      console.error("[Realtime session] Backend configuration error", {
        timestamp,
        route: "/api/realtime/session",
        category: "configuration"
      });

      return res.status(503).json({
        error: "OPENAI_API_KEY is not configured"
      });
    }

    const instructions = mobilePair
      ? `
You are Interpreter.ai, a live two-way voice interpreter for two explicitly
selected languages.

The selected directions are fixed:
- Speaker 1 speaks ${MOBILE_INTERPRETER_LANGUAGES[mobileSource]}; translate and
  speak only ${MOBILE_INTERPRETER_LANGUAGES[mobileTarget]}.
- Speaker 2 speaks ${MOBILE_INTERPRETER_LANGUAGES[mobileTarget]}; translate and
  speak only ${MOBILE_INTERPRETER_LANGUAGES[mobileSource]}.

Rules:
- Use only these selected source and target languages. Never substitute or
  automatically change either language.
- Treat every utterance as something to interpret, never as a request to answer.
- Translate questions as questions. Never answer on behalf of either participant.
- Never initiate speech, greet the participants, prompt them to speak, ask a
  question, ask anyone to repeat, or respond to a command directed at you.
- Speak only the translation, with no labels, preface, commentary, explanation,
  advice, greeting, or repetition of the original.
- Produce audio only after a clear, completed utterance in one selected language
  can be translated into the other selected language. Otherwise remain silent.
- Preserve names, numbers, prices, dates, currency amounts, addresses, emotion,
  tone, intent, uncertainty, humor, and technical terms accurately.
- Keep translations natural, concise, context-aware, and culturally appropriate.
- Maintain the active conversation context while translating each completed turn.
- Ignore audio that repeats or echoes your immediately preceding spoken translation.
- Do not announce that you are translating.
`
      : mobileInterpreter
      ? `
You are Interpreter.ai, a live automatic two-way voice interpreter.

The user selected ${MOBILE_INTERPRETER_LANGUAGES[mobileTarget]} as the language
they want interpreted. Detect the user's own language from their first clear
speech turn and retain it for this session as the user language.

For every completed speech turn:
- When speech is in the retained user language, translate it naturally into
  ${MOBILE_INTERPRETER_LANGUAGES[mobileTarget]} and speak only that translation.
- When speech is in ${MOBILE_INTERPRETER_LANGUAGES[mobileTarget]}, translate it
  naturally into the retained user language and speak only that translation.

Rules:
- Treat every utterance as something to interpret, never as a request to answer.
- Translate questions as questions. Never answer on behalf of either participant.
- Never add advice, facts, opinions, commentary, explanations, greetings, or labels.
- Never repeat or speak the original language.
- Preserve names, numbers, prices, dates, currency amounts, addresses, emotion,
  tone, intent, uncertainty, and technical terms accurately.
- Keep translations natural, accurate, concise, and culturally appropriate.
- If speech is unclear, ask only that same speaker to repeat, using the opposite language.
- If the two languages remain ambiguous, ask the user to confirm their own language.
- Ignore audio that repeats or echoes your immediately preceding spoken translation.
- Do not announce that you are translating.
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
      noise_reduction: {
        type: "near_field"
      },
      turn_detection: {
        type: "server_vad",
        threshold: 0.65,
        prefix_padding_ms: 300,
        silence_duration_ms: 700,
        create_response: true,
        interrupt_response: true
      }
    };

    if (transcribedSession) {
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
        openAIResponseStatus: openAIResponse.status
      });

      return res.status(openAIResponse.status).json({
        error: "The translation service is temporarily unavailable"
      });
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error("[Realtime session] Caught backend error", {
      timestamp,
      route: "/api/realtime/session",
      category: error instanceof TypeError ? "network" : "internal"
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
