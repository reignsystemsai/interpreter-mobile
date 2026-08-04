# Interpreter.ai Android app

Expo SDK 54 client for the production Interpreter.ai service. The app requests a
short-lived Realtime credential from the existing Render backend and connects to
OpenAI directly over WebRTC. The permanent `OPENAI_API_KEY` is never bundled into
the app.

Production backend:

```text
https://interpreter-api-fycw.onrender.com
```

For local development only, `EXPO_PUBLIC_API_BASE_URL` may point to another
Interpreter backend. Never put `OPENAI_API_KEY` in a mobile environment file.

## Install and validate

```powershell
cd mobile
pnpm install --frozen-lockfile
pnpm typecheck
pnpm exec expo config --type public
```

Native WebRTC and audio routing are required, so Expo Go is not supported.

## Build an installable Android APK

```powershell
cd mobile
pnpm dlx eas-cli build --platform android --profile preview
```

The `preview` profile produces an internal-distribution APK. Open the EAS build
URL on the Android phone, download the APK, allow installation from the browser
when Android asks, and install **Interpreter.ai**.

## Test the app

1. Open **Interpreter.ai**.
2. Set the language for Speaker 1 and Speaker 2. The two rows mirror the
   opposite translation directions automatically.
3. Tap **Start Conversation** and allow microphone access.
4. Speak naturally in your language. Confirm only the selected-language
   translation is spoken and the orb reflects the current state.
5. Have the second speaker reply in the selected language. Confirm only the
   translation into your detected language is spoken.
6. Alternate speakers for several turns and confirm no playback feedback loop.
7. Confirm no transcript or developer information appears on the home screen.
8. Tap **End Conversation**, then start another conversation and confirm
   microphone/audio reconnect correctly.

The microphone is paused while translated audio plays and resumes shortly after
playback ends to reduce speaker echo and self-triggering.

## Accounts, Interpreter Pro, and notifications

The app includes a modular Supabase authentication, RevenueCat subscription,
and Expo notification foundation. These features fail closed while configuration
is absent; the live interpreter continues to use the production backend.

Set only public mobile values in the EAS environment:

```text
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
LIVEKIT_URL
EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY
EXPO_PUBLIC_LEGAL_REVIEW_APPROVED=false
```

The active Expo config copies only the Supabase URL, publishable key, and LiveKit
URL into public app configuration. Never place `SUPABASE_SECRET_KEY`,
`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, RevenueCat webhook authorization, or the
OpenAI API key in Expo configuration. Configure Google Play and RevenueCat products
with IDs `interpreter_pro_monthly` and `interpreter_unlimited_monthly`.

Account creation and customer-facing legal links stay disabled while
`EXPO_PUBLIC_LEGAL_REVIEW_APPROVED` is false. Change it only after final Terms and
Privacy pages have completed legal review and are hosted at stable public URLs.

- Free: 2 interpreted minutes per day, voice/video calls, basic AI voices.
- Interpreter Pro: $9.99/month, 500 minutes/month, seven-day trial.
- Interpreter Unlimited: $19.99/month, 2,000 minutes/month under fair use,
  seven-day trial.
- Paid unused minutes roll over for one billing cycle and then expire.
