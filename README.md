# Interpreter.ai browser MVP

The Express service serves a mobile-friendly browser client and mints short-lived
OpenAI Realtime client secrets at `POST /api/realtime/session`. The browser then
connects directly to OpenAI over WebRTC; Render does not proxy live audio.

The browser has two separate modes:

- **Interpreter** provides continuous English ↔ Spanish or English ↔ Brazilian
  Portuguese interpretation. It translates only and does not join the conversation.
- **Companion** provides a direct, contextual voice conversation in English,
  Spanish, or Brazilian Portuguese.

The permanent OpenAI API key remains on the server and is never included in
browser files or session responses. Conversation context and transcripts exist
only in the active browser/Realtime session; there is no database or history.

## Required environment variables

- Backend: `OPENAI_API_KEY`
- Existing native mobile app: `EXPO_PUBLIC_API_BASE_URL` (the public HTTPS origin
  of the backend, without a trailing slash)

`PORT` is supported by `server.js`, but Render supplies it automatically.

## Render backend settings

- Service: existing `interpreter-api` Web Service
- Branch: `main`
- Build Command: `npm install`
- Start Command: `node server.js`
- Health Check Path: `/health`
- Auto-Deploy: `Yes`
- Environment variable: existing server-side `OPENAI_API_KEY`

No additional Render environment variables are required.

## Run locally

```powershell
npm install
npm run start:server
```

Open `http://localhost:10000` in Chrome or Edge. Local session creation requires
a valid `OPENAI_API_KEY` in a local `.env` file. Never put it in `public/`.

## Test Interpreter

1. Select **INTERPRETER**.
2. Choose **Spanish**.
3. Press **Start Interpreter**, allow microphone access, and speak English.
4. Confirm only Spanish is spoken and both original/translation panels update.
5. Respond in Spanish and confirm only English is spoken.
6. Stop, choose **Português (Brasil)**, and restart.
7. Test English → Brazilian Portuguese and Brazilian Portuguese → English.
8. Press **Stop**, then Start again, to verify restart behavior.

Interpreter retains the prior working behavior: `alloy` voice, the existing
server VAD configuration, browser echo cancellation/noise suppression, and a
600 ms microphone restore delay after translated speaker audio finishes.

## Test Companion

1. Select **COMPANION**.
2. Choose **English**, **Español**, or **Português (Brasil)**.
3. Press **START CONVERSATION** and say: `Hey, I had a really long day today.`
4. Continue for at least five turns and confirm Companion responds naturally
   instead of translating.
5. While it is speaking, say: `Wait, that's not what I meant.`
6. Confirm its old audio stops, the interruption is captured, and the cancelled
   response does not resume.
7. Repeat within the first second of a response and several times in one session.
8. Test multi-turn Spanish and Brazilian Portuguese conversations.
9. Test: Companion → Stop → Interpreter → Stop → Companion.

Companion keeps the microphone live while speaking. Server VAD detects barge-in;
the browser cancels the active response, clears queued WebRTC output audio, and
truncates the assistant item to the audio duration already heard. A new response
is created only after the user's interrupted turn finishes.

## Existing mobile app

See [mobile/README.md](mobile/README.md). The mobile implementation is unchanged.
