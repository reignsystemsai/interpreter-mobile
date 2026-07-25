# Interpreter.ai mobile

Expo SDK 54 mobile client for automatic English ↔ Brazilian Portuguese voice
interpretation. It requests microphone access, creates a session through the
existing Express endpoint, and uses WebRTC for live microphone input and
translated speech output.

## Required mobile environment variable

Create `mobile/.env`:

```dotenv
EXPO_PUBLIC_API_BASE_URL=https://YOUR-SERVICE.onrender.com
```

Use the deployed Render HTTPS origin with no trailing slash. Never put
`OPENAI_API_KEY` in this file or in the app.

## Install

From the repository root:

```powershell
cd mobile
pnpm install --frozen-lockfile
```

This app uses native WebRTC and audio-routing modules. **Expo Go is not
supported.** Install a development build as described below.

## Android

### Local Android build

Install Android Studio, an Android SDK, and either start an emulator or connect
an Android phone with USB debugging enabled. Then run:

```powershell
cd mobile
pnpm exec expo run:android
```

After the app is installed, later development sessions only need:

```powershell
cd mobile
pnpm exec expo start --dev-client
```

### Android build through EAS

```powershell
cd mobile
pnpm dlx eas-cli login
pnpm dlx eas-cli build --platform android --profile development
```

Open the resulting install URL on the Android device and install the APK. Then
start Metro:

```powershell
pnpm exec expo start --dev-client --tunnel
```

Open the installed Interpreter.ai development client and connect to the running
project.

## iPhone

Local iOS compilation requires macOS, Xcode, an Apple signing identity, and a
connected iPhone:

```bash
cd mobile
pnpm install --frozen-lockfile
pnpm exec expo run:ios --device
```

On Windows or when using cloud signing, use EAS and an Apple Developer account:

```powershell
cd mobile
pnpm dlx eas-cli login
pnpm dlx eas-cli device:create
pnpm dlx eas-cli build --platform ios --profile development
```

Register the iPhone when prompted, open the resulting install URL on that
iPhone, and install the development build. Then run:

```powershell
pnpm exec expo start --dev-client --tunnel
```

Open the installed Interpreter.ai development client and connect to the running
project.

## Production mobile builds

Set `EXPO_PUBLIC_API_BASE_URL` in the EAS `production` environment before
building:

```powershell
pnpm dlx eas-cli env:create --environment production --name EXPO_PUBLIC_API_BASE_URL --value https://YOUR-SERVICE.onrender.com --visibility plaintext
pnpm dlx eas-cli build --platform android --profile production
pnpm dlx eas-cli build --platform ios --profile production
```

Submit store-ready builds with:

```powershell
pnpm dlx eas-cli submit --platform android
pnpm dlx eas-cli submit --platform ios
```

## Use

Tap the illuminated **I**, approve microphone access, and speak either English
or Brazilian Portuguese. Server VAD detects completed speech turns, and the
Realtime model speaks the translation in the other language. Tap the **I** again
to stop.

## Validation

```powershell
pnpm typecheck
pnpm exec expo config --type public
```
