# Interpreter.ai MVP

The existing Express server mints short-lived OpenAI Realtime client secrets at
`POST /api/realtime/session`. The Expo app uses that endpoint, then establishes a
direct WebRTC connection to OpenAI for full-duplex microphone and translated
speech audio.

## Required environment variables

- Backend: `OPENAI_API_KEY`
- Mobile: `EXPO_PUBLIC_API_BASE_URL` (the public HTTPS origin of the backend,
  without a trailing slash)

`PORT` is supported by `server.js`, but Render supplies it automatically. Do not
set it manually on Render.

## Render backend settings

Create a **Web Service** connected to
`reignsystemsai/interpreter-mobile` with:

- Branch: `main`
- Root Directory: leave blank
- Runtime: `Node`
- Build Command: `pnpm install --frozen-lockfile`
- Start Command: `pnpm start:server`
- Health Check Path: `/health`
- Auto-Deploy: `Yes`
- Environment variable: `OPENAI_API_KEY` = a server-side OpenAI project API key

After deployment, verify:

```text
https://YOUR-SERVICE.onrender.com/health
```

The response must show `"ok": true` and `"openaiConfigured": true`.

## Deploy the backend

1. Push this repository to GitHub on `main`.
2. In Render, choose **New > Web Service** and select the repository.
3. Enter the settings above.
4. Add `OPENAI_API_KEY` under **Environment**.
5. Choose an instance type and click **Create Web Service**.
6. Wait for `/health` to pass and copy the service's HTTPS URL.

## Run the mobile app

See [mobile/README.md](mobile/README.md). This app requires a custom development
build because WebRTC and speaker routing use native modules; it cannot run in
Expo Go.
