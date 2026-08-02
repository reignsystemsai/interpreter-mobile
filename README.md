# Interpreter.ai browser MVP

The Express service serves a mobile-friendly browser client and mints short-lived
OpenAI Realtime client secrets at `POST /api/realtime/session`. The browser uses
that endpoint, then establishes a direct WebRTC connection to OpenAI for
continuous two-way speech interpretation for either English ↔ Spanish or
English ↔ Brazilian Portuguese.

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
2. Choose **Spanish** or **Português (Brasil)**. The selected pair is locked while a session is active.
3. Press **Start Interpreter** and allow microphone access.
4. For Spanish, say: `Good evening. I have a reservation for two people at seven thirty.`
5. Confirm the original English and translated Spanish appear, and only Spanish is spoken.
6. Wait for the status to return to listening, then say: `Sí, su reservación está
   confirmada para las siete y media.`
7. Confirm the original Spanish and translated English appear, and only English is spoken.
8. For Portuguese, stop, choose **Português (Brasil)**, restart, and say:
   `Good morning. I need to go to the airport at six thirty tomorrow morning.`
9. After its Portuguese translation, say: `Claro. Posso chamar um carro para você às seis e quinze.`
10. Confirm Portuguese is interpreted into English, then alternate at least four turns.
11. Press **Stop** and confirm the microphone indicator turns off.
12. Press **Start Interpreter** again to verify the session can restart.

The local server still needs a valid `OPENAI_API_KEY` in a local `.env` file to
create the short-lived Realtime credential. Never put this key in `public/`.

## Test the deployed browser

1. Open the Render service's HTTPS root URL on Android Chrome.
2. Press **Start Interpreter**.
3. Choose **Allow** when Chrome requests microphone access.
4. Choose the desired pair before starting. Speak one short English sentence,
   pause, and confirm only the selected target language is spoken.
5. Wait for the listening status, respond in Spanish or Brazilian Portuguese,
   and confirm only English is spoken.
6. Alternate at least four turns without changing direction or pressing Stop.
7. At normal speaker volume, confirm the app does not interpret its own output.
8. Begin the next reply shortly after the listening status returns and confirm
   it is captured.
9. Press **Stop**, then **Start Interpreter**, and verify a new session works.

The first request can take longer when a free Render instance is waking up. Once
the page loads, microphone audio travels directly between the browser and OpenAI
over WebRTC; Render is used only to mint the short-lived credential.

To reduce translation feedback loops, the browser requests acoustic echo
cancellation, noise suppression, mono speech capture, and Realtime far-field
input noise reduction. It disables its outgoing track only while translation
audio is generated and played, restores it 180 ms after OpenAI reports that the
speaker buffer is drained, and rejects a close duplicate of the immediately
preceding translation during a short echo window.

The browser session retains conservative server VAD settings: threshold `0.5`,
`300 ms` prefix padding, and `500 ms` end-of-speech silence. This tolerates short
natural pauses without adding a large delay after a completed sentence. Browser
sessions use the `marin` voice at `1.03×` speed; the model and direct WebRTC
architecture are unchanged. Existing mobile sessions retain their previous
voice and behavior.

## Existing mobile app

See [mobile/README.md](mobile/README.md). This app requires a custom development
build because WebRTC and speaker routing use native modules; it cannot run in
Expo Go.
