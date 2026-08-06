const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const { createTranslationToken } = require("../src/server/livekit");
const { outputLanguageCode } = require("../src/server/translation/languages");
const { SpeechGate } = require("../src/server/translation/speech-gate");
const { humanRole, isVerifiedHumanTranscript, pcm16Frame } = require("../src/server/translation/translation-bridge");

function pcmFrame({ amplitude = 0, frequency = 220 } = {}) {
  const samples = 480;
  const buffer = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index += 1) {
    buffer.writeInt16LE(Math.round(amplitude * Math.sin((2 * Math.PI * frequency * index) / 24_000)), index * 2);
  }
  return buffer;
}

test("call languages map only to supported Realtime Translation outputs", () => {
  assert.equal(outputLanguageCode("English"), "en");
  assert.equal(outputLanguageCode("Spanish"), "es");
  assert.equal(outputLanguageCode("Brazilian Portuguese"), "pt");
  assert.equal(outputLanguageCode("Arabic"), null);
});

test("translation participant token is private to one room and call", async () => {
  const previous = { key: process.env.LIVEKIT_API_KEY, secret: process.env.LIVEKIT_API_SECRET, url: process.env.LIVEKIT_URL };
  process.env.LIVEKIT_URL = "wss://example.livekit.cloud";
  process.env.LIVEKIT_API_KEY = "test-key";
  process.env.LIVEKIT_API_SECRET = "test-secret-with-enough-entropy";
  const jwt = await createTranslationToken({ callId: "call-1", roomName: "voice-room-1" });
  const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
  assert.equal(payload.sub, "translator:call-1");
  assert.equal(payload.video.room, "voice-room-1");
  assert.equal(payload.video.canSubscribe, true);
  assert.deepEqual(payload.video.canPublishSources, ["microphone"]);
  for (const [name, value] of [["LIVEKIT_URL", previous.url], ["LIVEKIT_API_KEY", previous.key], ["LIVEKIT_API_SECRET", previous.secret]]) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});

test("translation audio and speaker roles remain directionally isolated", () => {
  assert.equal(humanRole("device-a:call-7:caller", "call-7"), "caller");
  assert.equal(humanRole("device-b:call-7:recipient", "call-7"), "recipient");
  assert.equal(humanRole("translator:call-7", "call-7"), null);
  const frame = pcm16Frame(Buffer.from([1, 0, 255, 255]).toString("base64"));
  assert.equal(frame.sampleRate, 24_000);
  assert.equal(frame.channels, 1);
  assert.deepEqual(Array.from(frame.data), [1, -1]);
});

test("speech gate rejects noise and short sounds, then preserves sustained speech", () => {
  const gate = new SpeechGate();
  const silence = pcmFrame();
  const speech = pcmFrame({ amplitude: 3000 });
  for (let index = 0; index < 30; index += 1) assert.equal(gate.push(silence).frames.length, 0);
  for (let index = 0; index < 19; index += 1) assert.equal(gate.push(speech).frames.length, 0);
  const opened = gate.push(speech);
  assert.equal(opened.started, true);
  assert.ok(opened.frames.length >= 20);
  for (let index = 0; index < 39; index += 1) assert.equal(gate.push(silence).ended, false);
  assert.equal(gate.push(silence).ended, true);
});

test("speech gate produces silence during translated playback suppression", () => {
  const gate = new SpeechGate();
  const speech = pcmFrame({ amplitude: 5000 });
  for (let index = 0; index < 30; index += 1) {
    assert.equal(gate.push(speech, { suppressed: true }).frames.length, 0);
  }
  assert.equal(gate.push(speech).started, false);
});

test("non-speech transcript labels and filler never authorize translated audio", () => {
  for (const value of ["", "[music]", "(laughter)", "coughing", "um", "wind"]) {
    assert.equal(isVerifiedHumanTranscript(value), false);
  }
  assert.equal(isVerifiedHumanTranscript("Where is the hotel?"), true);
  assert.equal(isVerifiedHumanTranscript("Sí, mañana a las nueve."), true);
});

test("mobile subscribes only to its translated track and never carries an OpenAI key", () => {
  const mobile = read("mobile", "src", "features", "calling", "VoiceCallService.ts");
  assert.match(mobile, /autoSubscribe: false/);
  assert.match(mobile, /translation-to-\$\{call\.role\}/);
  assert.match(mobile, /participant\.identity === `translator:\$\{call\.callId\}`/);
  assert.doesNotMatch(mobile, /OPENAI_API_KEY|api\.openai\.com/);
});

test("call languages are selected after the contact and passed explicitly to the call", () => {
  const home = read("mobile", "app", "index.tsx");
  const overlay = read("mobile", "src", "features", "calling", "CallingOverlay.tsx");
  const selector = read("mobile", "src", "features", "calling", "CallLanguageSelection.tsx");
  const contacts = read("mobile", "src", "features", "contacts", "ContactsPermissionPanel.tsx");
  assert.match(home, /<CallingOverlay onClose=/);
  assert.doesNotMatch(overlay, /languageOne|languageTwo/);
  assert.match(selector, /I speak/);
  assert.match(selector, /They speak/);
  assert.match(selector, /Start Voice Call/);
  assert.match(contacts, /startVoiceCall\(\{ callerLanguage,[\s\S]*recipientLanguage \}\)/);
});

test("in-person and remote calls enforce reliability through separate pipelines", () => {
  const inPersonBackend = read("server.js");
  const inPersonMobile = read("mobile", "src", "hooks", "useRealtimeInterpreter.ts");
  const remoteBridge = read("src", "server", "translation", "translation-bridge.js");
  assert.match(inPersonBackend, /threshold: mobilePair \? 0\.65 : 0\.5/);
  assert.match(inPersonBackend, /prefix_padding_ms: mobilePair \? 500 : 300/);
  assert.match(inPersonBackend, /silence_duration_ms: mobilePair \? 800 : 500/);
  assert.match(inPersonBackend, /interrupt_response: !mobilePair/);
  assert.match(inPersonBackend, /inputAudio\.noise_reduction = \{ type: "near_field" \}/);
  assert.match(inPersonBackend, /Silence is the required result/);
  assert.match(inPersonMobile, /echoCancellation: true/);
  assert.match(inPersonMobile, /noiseSuppression: true/);
  assert.match(inPersonMobile, /autoGainControl: true/);
  assert.match(inPersonMobile, /setMicrophoneEnabled\(false\)/);
  assert.doesNotMatch(inPersonMobile, /SpeechGate/);
  assert.match(remoteBridge, /new SpeechGate\(speechGateOptionsFromEnv\(\)\)/);
});

test("server creates exactly two translation directions and stops them with the call", () => {
  const bridge = read("src", "server", "translation", "translation-bridge.js");
  const calls = read("src", "server", "routes", "calls.js");
  assert.match(bridge, /sourceRole: "caller"[\s\S]*targetLanguage: recipientLanguage/);
  assert.match(bridge, /sourceRole: "recipient"[\s\S]*targetLanguage: callerLanguage/);
  assert.match(bridge, /session\.input_audio_buffer\.append/);
  assert.match(bridge, /session\.output_audio\.delta/);
  assert.match(bridge, /session\.input_transcript\.delta/);
  assert.match(bridge, /hasTranscriptEvidence/);
  assert.match(bridge, /shouldSuppressInput/);
  assert.match(bridge, /\/v1\/realtime\/translations\?model=gpt-realtime-translate/);
  assert.doesNotMatch(bridge, /response\.create/);
  assert.match(calls, /await stopCallTranslation\(row\.id\)/);
});
