# Interpreter.ai browser MVP

The Express service serves a mobile-friendly browser client and mints short-lived
OpenAI Realtime client secrets at `POST /api/realtime/session`. The browser uses
that endpoint, then establishes a direct WebRTC connection to OpenAI for English
microphone input and spoken Spanish translation.

The permanent OpenAI API key remains on the server. It is never included in the
browser files or session response.

## Required environment variables

- Backend: `OPENAI_API_KEY`
- Existing native mobile app: `EXPO_PUBLIC_API_BASE_URL` (the public HTTPS origin
  of the backend, without a trailing slash)

`PORT` is supported by `server.js`, but Render supplies it automatically. Do not
set it manually on Render.

## Render backend settings

Create a **Web Service** connected to
`reignsystemsai/interpreter-mobile` with:

- Branch: `main`
- Root Directory: leave blank
- Runtime: `Node`
- Build Command: `npm install`
- Start Command: `node server.js`
- Health Check Path: `/health`
- Auto-Deploy: `Yes`
- Environment variable: `OPENAI_API_KEY` = a server-side OpenAI project API key

After deployment, verify:

```text
https://YOUR-SERVICE.onrender.com/health
```

The response must show `"ok": true` and `"openaiConfigured": true`.

## Run and test the browser locally

Localhost is treated as a secure browser context, so microphone access works
without a local TLS certificate.

```powershell
npm install
npm run start:server
```

Then:

1. Open `http://localhost:10000` in Chrome or Edge.
2. Press **Start Interpreter**.
3. Allow microphone access.
4. Say: `Good morning. My appointment is on August fifteenth at three thirty PM.`
5. Confirm the English transcript appears.
6. Confirm a natural Spanish translation appears and is spoken.
7. Press **Stop** and confirm the microphone indicator turns off.
8. Press **Start Interpreter** again to verify the session can restart.

The local server still needs a valid `OPENAI_API_KEY` in a local `.env` file to
create the short-lived Realtime credential. Never put this key in `public/`.

## Test the deployed browser

1. Open the Render service's HTTPS root URL on Android Chrome.
2. Press **Start Interpreter**.
3. Choose **Allow** when Chrome requests microphone access.
4. Speak one short English sentence, then pause.
5. Listen for only the Spanish translation.
6. Confirm both transcript areas update.
7. Press **Stop** before closing the page.

The first request can take longer when a free Render instance is waking up. Once
the page loads, microphone audio travels directly between the browser and OpenAI
over WebRTC; Render is used only to mint the short-lived credential.

## Existing mobile app

See [mobile/README.md](mobile/README.md). This app requires a custom development
build because WebRTC and speaker routing use native modules; it cannot run in
Expo Go.
