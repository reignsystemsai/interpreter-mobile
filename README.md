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

Production account features require server-only `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, and `REVENUECAT_WEBHOOK_AUTH` values. Apply
`supabase/migrations/202608030001_account_membership_foundation.sql` before
enabling accounts, then configure RevenueCat's authorized webhook at
`POST /api/v1/subscriptions/revenuecat/webhook`.

Google Play products use `interpreter_pro_monthly` and
`interpreter_unlimited_monthly`. The Free allowance is 2 interpreted minutes per
day. Paid unused minutes roll over for one billing cycle, then expire.
