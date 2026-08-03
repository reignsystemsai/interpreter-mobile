# Interpreter.ai

Interpreter.ai is a standalone live voice interpreter. The Express service serves
the browser client and mints short-lived OpenAI Realtime credentials at
`POST /api/realtime/session`. Browser and Android clients then connect directly
to OpenAI over WebRTC for low-latency microphone input and translated audio.

The permanent `OPENAI_API_KEY` remains on the server. It is never included in
browser or Android source, nor returned in an API response.

## Render backend

- Service: existing `interpreter-api` Web Service
- Branch: `main`
- Build Command: `npm install`
- Start Command: `node server.js`
- Health Check Path: `/health`
- Auto-Deploy: enabled
- Required environment variable: existing server-side `OPENAI_API_KEY`

No additional Render environment variables are required.

## Browser

Run locally with `npm install` followed by `npm run start:server`, then open
`http://localhost:10000`. A local `.env` requires `OPENAI_API_KEY`; never place
that key in `public/`.

The browser supports continuous English ↔ Spanish and English ↔ Brazilian
Portuguese interpretation. Select a target language, press **Start Interpreter**,
allow microphone access, and speak in either language. Press **Stop** to release
the microphone and WebRTC session.

## Android

The Android app is a one-screen, automatic two-way interpreter between the
user's detected language and one selected target language. It supports English,
Spanish, Brazilian Portuguese, French, German, Italian, Dutch, Russian, Polish,
Romanian, Turkish, Arabic, Hebrew, Hindi, Japanese, Korean, Mandarin Chinese,
Cantonese, Vietnamese, and Thai. Transcripts are hidden by default.

See [mobile/README.md](mobile/README.md) for build and test steps.
