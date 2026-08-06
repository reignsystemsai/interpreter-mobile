const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const { createTranslationToken } = require("../src/server/livekit");
const { outputLanguageCode } = require("../src/server/translation/languages");
const { humanRole, pcm16Frame } = require("../src/server/translation/translation-bridge");

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

test("server creates exactly two translation directions and stops them with the call", () => {
  const bridge = read("src", "server", "translation", "translation-bridge.js");
  const calls = read("src", "server", "routes", "calls.js");
  assert.match(bridge, /sourceRole: "caller"[\s\S]*targetLanguage: recipientLanguage/);
  assert.match(bridge, /sourceRole: "recipient"[\s\S]*targetLanguage: callerLanguage/);
  assert.match(bridge, /session\.input_audio_buffer\.append/);
  assert.match(bridge, /session\.output_audio\.delta/);
  assert.match(calls, /await stopCallTranslation\(row\.id\)/);
});

test("translated playback cannot immediately feed back into the opposite translation direction", () => {
  const bridge = read("src", "server", "translation", "translation-bridge.js");
  assert.match(bridge, /SELF_PLAYBACK_COOLDOWN_MS = 250/);
  assert.match(bridge, /onOutputAudio: \(durationMs\) => this\.markPlayback\("recipient", durationMs\)/);
  assert.match(bridge, /onOutputAudio: \(durationMs\) => this\.markPlayback\("caller", durationMs\)/);
  assert.match(bridge, /if \(this\.shouldSuppressInput\(\)\) continue/);
});

test("iOS leaves AVAudioSession ownership to LiveKit and call cleanup is ordered", () => {
  const mobile = read("mobile", "src", "features", "calling", "VoiceCallService.ts");
  assert.match(mobile, /if \(Platform\.OS === 'android'\) await AudioSession\.startAudioSession\(\)/);
  assert.match(mobile, /if \(Platform\.OS === 'android'\) await AudioSession\.stopAudioSession\(\)/);
  assert.ok(mobile.indexOf("setMicrophoneEnabled(false)") < mobile.indexOf("await room.disconnect()"));
  assert.ok(mobile.indexOf("unpublishTrack(publication.track)") < mobile.indexOf("await room.disconnect()"));
  assert.ok(mobile.indexOf("publication.track?.detach()") < mobile.indexOf("await room.disconnect()"));
});
