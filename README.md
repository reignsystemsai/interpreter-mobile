# Interpreter.ai Android MVP

Interpreter.ai is a clean two-way spoken interpreter for English and Brazilian
Portuguese. The Expo Android client sends microphone audio directly to the
OpenAI Realtime API over WebRTC using a short-lived client secret minted by the
Express backend. The standard OpenAI API key remains server-side.

The interface is intentionally diagnostic-first. Keep the on-screen stages and
transcripts until live device testing proves the complete voice path.

## Architecture

- `mobile/`: Expo SDK 57, React Native, TypeScript, `react-native-webrtc`, and
  `react-native-incall-manager`.
- `server/`: Express broker for health checks and short-lived Realtime client
  secrets.
- Realtime audio: microphone media track to OpenAI, remote audio track retained
  by the app and routed to the Android loudspeaker.
- Turn taking: server VAD with automatic response creation and response
  interruption enabled.

This project requires an EAS development build. It does not run in Expo Go
because WebRTC and in-call audio routing use native modules.

## 1. Run the backend locally (Windows PowerShell)

From the repository root:

```powershell
Copy-Item .\server\.env.example .\server\.env
notepad .\server\.env
npm install
npm run check --workspace server
npm test --workspace server
npm start --workspace server
```

Set `OPENAI_API_KEY` in `server\.env` before starting. Verify the service in a
second PowerShell window:

```powershell
Invoke-RestMethod http://localhost:3000/health
```

For a physical Android phone, use the computer's LAN IPv4 address instead of
`localhost`:

```powershell
Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike '127.*' } |
  Select-Object InterfaceAlias, IPAddress
```

## 2. Configure Render

The root `render.yaml` is a Render Blueprint. Commit and push the repository,
then create a Blueprint in the Render dashboard and select this repository.
Render will use `server` as the service root.

In the Render service environment, add `OPENAI_API_KEY` as a secret. The
Blueprint supplies the start command, health check, model, and voice. After the
deploy succeeds, verify it from PowerShell:

```powershell
$RenderUrl = 'https://YOUR-SERVICE.onrender.com'
Invoke-RestMethod "$RenderUrl/health"
```

The response should show `ok: true` and `openaiConfigured: true`.

## 3. Create the EAS Android development APK

Install dependencies and the EAS CLI, configure the mobile environment, then
build the `development` profile:

```powershell
npm install
npm install --global eas-cli
Copy-Item .\mobile\.env.example .\mobile\.env
notepad .\mobile\.env
Set-Location .\mobile
eas login
eas build:configure
eas build --platform android --profile development
```

Set `EXPO_PUBLIC_API_BASE_URL` to the HTTPS Render URL for a remote backend, or
to `http://YOUR-LAN-IP:3000` for a local backend. The development profile
produces an installable APK and includes the required native modules and Android
microphone configuration.

## 4. Start Metro with the development client

After installing the development APK on the Android device:

```powershell
Set-Location .\mobile
npm run start:dev
```

Keep the phone and development computer on the same network. Native dependency
or app-config changes require a new EAS development build; TypeScript and UI
changes can normally be loaded through Metro.

## Validation

From the repository root:

```powershell
npm install
npm run check
npm test
Set-Location .\mobile
npx expo config --type public
npx expo-doctor
```

The repository validates code and configuration, but live audio must still be
verified on an Android device with a configured OpenAI account and backend. A
successful device test should visibly reach `Data channel open`,
`Remote audio track received`, `Speech detected`, `Translation response
started`, and `Audio output received`, while also showing translated transcript
text.

Expo Doctor's React Native Directory metadata check intentionally excludes
`react-native-webrtc` and `react-native-incall-manager`: both are explicit
architecture requirements for this MVP and are currently marked “untested on
New Architecture” by that directory. TypeScript, Expo config, and native
prebuild validation do not replace an EAS APK build and physical-device audio
test.
