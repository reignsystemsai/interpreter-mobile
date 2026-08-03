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
2. Tap **Language to interpret** and select a target language.
3. Tap **Start Conversation** and allow microphone access.
4. Speak naturally in your language. Confirm only the selected-language
   translation is spoken and the transcript shows both texts.
5. Have the second speaker reply in the selected language. Confirm only the
   translation into your detected language is spoken.
6. Alternate speakers for several turns and confirm no playback feedback loop.
7. Test **Mute**, **Replay**, and **End conversation**.
8. Start another conversation and confirm microphone/audio reconnect correctly.

The microphone is paused while translated audio plays and resumes shortly after
playback ends to reduce speaker echo and self-triggering.
