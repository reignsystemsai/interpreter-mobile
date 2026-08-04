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

No additional Render environment variables are required for the existing
Realtime interpreter. Account and membership modules remain disabled until the
separate server-only values documented below are configured.

## Browser

Run locally with `npm install` followed by `npm run start:server`, then open
`http://localhost:10000`. A local `.env` requires `OPENAI_API_KEY`; never place
that key in `public/`.

The browser supports continuous English ↔ Spanish and English ↔ Brazilian
Portuguese interpretation. Select a target language, press **Start Interpreter**,
allow microphone access, and speak in either language. Press **Stop** to release
the microphone and WebRTC session.

## Android

The Android app is a one-screen, explicit two-way interpreter. The user selects
the language for each speaker, and the mirrored rows make both translation
directions unambiguous. It supports English,
Spanish, Brazilian Portuguese, French, German, Italian, Dutch, Russian, Polish,
Romanian, Turkish, Arabic, Hebrew, Hindi, Japanese, Korean, Mandarin Chinese,
Cantonese, Vietnamese, and Thai. Transcripts are not shown on the home screen.

See [mobile/README.md](mobile/README.md) for build and test steps.

## Account and membership foundation

The existing low-latency OpenAI Realtime route remains unchanged. Account,
membership, notification, and usage data is isolated under versioned `/api/v1`
modules so it can scale independently from live interpretation.

Production account features require `SUPABASE_URL`, the server-only
`SUPABASE_SECRET_KEY`, and `REVENUECAT_WEBHOOK_AUTH`. Calling services use
`LIVEKIT_URL`, `LIVEKIT_API_KEY`, and the server-only `LIVEKIT_API_SECRET`. Apply
`supabase/migrations/202608030001_account_membership_foundation.sql` before
enabling accounts, then configure RevenueCat's authorized webhook at
`POST /api/v1/subscriptions/revenuecat/webhook`.

Google Play products use `interpreter_pro_monthly` and
`interpreter_unlimited_monthly`. The Free allowance is 2 interpreted minutes per
day. Paid unused minutes roll over for one billing cycle, then expire.

## Interpreted calls

Phase 4 extends the existing LiveKit voice, video, and business-video calls with
a server-side interpretation bridge. The two people remain connected through
LiveKit while a hidden backend participant runs one independent OpenAI Realtime
session for each translation direction. The original in-person
`useRealtimeInterpreter` flow is unchanged.

Authenticated call controls are available under:

- `POST /api/v1/interpreted-calls/:callId/start`
- `GET /api/v1/interpreted-calls/:callId/status`
- `GET /api/v1/interpreted-calls/:callId/metrics`
- `POST /api/v1/interpreted-calls/:callId/stop`

Apply `supabase/migrations/202608030004_interpreted_calling.sql` after the Phase
3 calling migration. Live transcript messages are ephemeral LiveKit data and are
shown only during the active call; transcript text is not stored. Supabase stores
only call usage and performance measurements. Interpreted usage is metered only
while both translation directions are ready, against the allowance synchronized
from RevenueCat.

The bridge requires the existing server-only `OPENAI_API_KEY`, `LIVEKIT_API_KEY`,
`LIVEKIT_API_SECRET`, and `SUPABASE_SECRET_KEY`. No permanent credential belongs
in the browser or Android bundle.

Phase 5 reliability, media, privacy, validation, and physical-device follow-up
are documented in [docs/beta-readiness-report.md](docs/beta-readiness-report.md).
