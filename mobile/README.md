# Interpreter.ai Android app

Expo SDK 54 client for the production Interpreter.ai service. The app connects
to the existing Render backend for a short-lived OpenAI Realtime credential,
then uses WebRTC directly for low-latency microphone input and speaker output.
The permanent `OPENAI_API_KEY` remains on Render and is never bundled into the
Android app.

## Included modes

- **Interpreter:** automatic two-way English ↔ Spanish or English ↔ Brazilian
  Portuguese interpretation. The microphone pauses during translated playback
  to prevent speaker feedback.
- **Companion:** natural voice conversation in English, Spanish, or Brazilian
  Portuguese with interruption enabled.

The production build defaults to:

```text
https://interpreter-api-fycw.onrender.com
```

For development against another Interpreter backend, override it with:

```dotenv
EXPO_PUBLIC_API_BASE_URL=https://YOUR-INTERPRETER-SERVICE.onrender.com
```

Never put `OPENAI_API_KEY` in a mobile environment file.

## Install dependencies

```powershell
cd mobile
pnpm install --frozen-lockfile
```

This app uses native WebRTC and audio-routing modules, so Expo Go is not
supported.

## Build an installable Android APK

The `preview` profile creates an APK that can be installed directly on an
Android phone:

```powershell
cd mobile
pnpm dlx eas-cli login
pnpm dlx eas-cli build --platform android --profile preview
```

Open the EAS build URL on the Android phone, download the APK, allow installation
from that browser when Android asks, and install **Interpreter.ai**.

The `production` profile creates the AAB used for Google Play:

```powershell
pnpm dlx eas-cli build --platform android --profile production
```

## Use

1. Open **Interpreter.ai**.
2. Tap the language card and choose **Spanish** or **Português (Brasil)**.
3. Tap **Start conversation** and allow microphone access.
4. Speak English; the app speaks only the translation.
5. Let the other speaker respond in the selected language; the app speaks the
   English translation.
6. Tap **Stop conversation** to close the microphone and WebRTC session.

Open the top-right menu to switch between **Interpreter** and **Companion**.

## Validation

```powershell
pnpm typecheck
pnpm exec expo config --type public
```
