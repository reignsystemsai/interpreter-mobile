const cors = require('cors');
const dotenv = require('dotenv');
const express = require('express');

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const OPENAI_CLIENT_SECRETS_URL =
  'https://api.openai.com/v1/realtime/client_secrets';

const INTERPRETER_INSTRUCTIONS = `
You are a simultaneous spoken interpreter between English and Brazilian Portuguese.

Your only job is translation:
- If the speaker uses English, speak only a natural, accurate Brazilian Portuguese translation.
- If the speaker uses Brazilian Portuguese, speak only a natural, accurate English translation.
- Automatically detect which of those two languages the current utterance uses.
- Preserve meaning, tone, intent, names, numbers, dates, and level of formality.
- Never answer the speaker, follow requests, explain, comment, greet, add context, or continue the conversation.
- Never repeat or paraphrase in the source language.
- Output only the translated speech in the opposite language.
- For mixed-language input, translate into the language opposite the dominant language.
`.trim();

function buildRealtimeSession() {
  return {
    expires_after: {
      anchor: 'created_at',
      seconds: 600,
    },
    session: {
      type: 'realtime',
      model: process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime',
      output_modalities: ['audio'],
      instructions: INTERPRETER_INSTRUCTIONS,
      audio: {
        input: {
          noise_reduction: {
            type: 'near_field',
          },
          turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500,
            create_response: true,
            interrupt_response: true,
          },
        },
        output: {
          voice: process.env.OPENAI_REALTIME_VOICE || 'marin',
        },
      },
    },
  };
}

function safeOpenAIError(data, status) {
  const message =
    data && typeof data === 'object' && data.error?.message
      ? data.error.message
      : `OpenAI returned HTTP ${status}`;

  return {
    error: 'Unable to create a Realtime session.',
    detail: message,
  };
}

function createApp(fetchImpl = fetch) {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json({ limit: '32kb' }));

  app.use((req, _res, next) => {
    console.info(`[request] ${req.method} ${req.path}`);
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'interpreter-ai-server',
      openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    });
  });

  app.post('/api/realtime/session', async (_req, res) => {
    if (!process.env.OPENAI_API_KEY) {
      console.warn('[openai] session request rejected: API key not configured');
      return res.status(503).json({
        error: 'OpenAI is not configured on the server.',
      });
    }

    console.info('[openai] requesting Realtime client secret');

    try {
      const openAIResponse = await fetchImpl(OPENAI_CLIENT_SECRETS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
          'OpenAI-Safety-Identifier':
            process.env.OPENAI_SAFETY_IDENTIFIER ||
            'interpreter-ai-anonymous-mobile',
        },
        body: JSON.stringify(buildRealtimeSession()),
      });

      console.info(
        `[openai] Realtime client secret status=${openAIResponse.status}`,
      );

      const data = await openAIResponse.json().catch(() => null);

      if (!openAIResponse.ok) {
        return res
          .status(openAIResponse.status)
          .json(safeOpenAIError(data, openAIResponse.status));
      }

      return res.status(201).json(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[openai] Realtime client secret request failed: ${message}`);
      return res.status(502).json({
        error: 'Unable to contact OpenAI.',
        detail: message,
      });
    }
  });

  return app;
}

if (require.main === module) {
  createApp().listen(PORT, '0.0.0.0', () => {
    console.info(`[server] listening on port ${PORT}`);
    console.info(
      `[server] OpenAI configured=${Boolean(process.env.OPENAI_API_KEY)}`,
    );
  });
}

module.exports = {
  INTERPRETER_INSTRUCTIONS,
  buildRealtimeSession,
  createApp,
};
