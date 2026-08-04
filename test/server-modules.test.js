const assert = require("node:assert/strict");
const test = require("node:test");

const { PLAN_CATALOG, publicPlans } = require("../src/server/plans");
const { createBridgeToken, createParticipantToken, isLiveKitConfigured, liveKitHttpUrl } = require("../src/server/livekit");
const { DirectionalRealtimeSession, languageCode, translationInstructions } = require("../src/server/realtime-translation");
const { InterpretedCallBridge } = require("../src/server/interpreted-call-manager");
const { summarizeMetrics } = require("../src/server/routes/interpreted-calls");
const { createRoomName, validTransition } = require("../src/server/calls");
const { validExpoPushToken } = require("../src/server/push");
const { hashIdentity, normalizeContactPayload, normalizeEmail, normalizePhone } = require("../src/server/contacts");

test("plan catalog preserves approved limits without exposing store identifiers", () => {
  assert.equal(PLAN_CATALOG.free.interpretedMinutes, 3);
  assert.equal(PLAN_CATALOG.free.allowancePeriod, "rolling_30_days");
  assert.equal(PLAN_CATALOG.pro.interpretedMinutes, 500);
  assert.equal(PLAN_CATALOG.unlimited.interpretedMinutes, 2000);
  assert.equal(PLAN_CATALOG.pro.rolloverPeriods, 1);
  assert.equal(PLAN_CATALOG.pro.trialDays, 7);
  assert.equal(publicPlans().some((plan) => "productId" in plan), false);
  assert.equal(publicPlans().some((plan) => "entitlementId" in plan), false);
});

test("LiveKit configuration requires the canonical environment names", () => {
  const previous = {
    url: process.env.LIVEKIT_URL,
    key: process.env.LIVEKIT_API_KEY,
    secret: process.env.LIVEKIT_API_SECRET
  };
  delete process.env.LIVEKIT_URL;
  delete process.env.LIVEKIT_API_KEY;
  delete process.env.LIVEKIT_API_SECRET;
  assert.equal(isLiveKitConfigured(), false);
  process.env.LIVEKIT_URL = "wss://example.invalid";
  process.env.LIVEKIT_API_KEY = "test-key";
  process.env.LIVEKIT_API_SECRET = "test-secret";
  assert.equal(isLiveKitConfigured(), true);
  for (const [name, value] of [
    ["LIVEKIT_URL", previous.url],
    ["LIVEKIT_API_KEY", previous.key],
    ["LIVEKIT_API_SECRET", previous.secret]
  ]) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test("calling helpers create scoped rooms, transitions, tokens, and push identifiers", async () => {
  const previous = { url: process.env.LIVEKIT_URL, key: process.env.LIVEKIT_API_KEY, secret: process.env.LIVEKIT_API_SECRET };
  process.env.LIVEKIT_URL = "wss://example.livekit.cloud";
  process.env.LIVEKIT_API_KEY = "test-key";
  process.env.LIVEKIT_API_SECRET = "test-secret-with-enough-entropy";
  assert.equal(liveKitHttpUrl(), "https://example.livekit.cloud");
  assert.match(createRoomName(), /^interpreter-\d+-[a-f0-9]{24}$/);
  assert.equal(validTransition("ringing", "accepted"), true);
  assert.equal(validTransition("active", "accepted"), false);
  const jwt = await createParticipantToken({ callType: "voice", identity: "user-1", name: "Test User", roomName: "room-1" });
  const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
  assert.equal(payload.sub, "user-1");
  assert.equal(payload.video.room, "room-1");
  assert.deepEqual(payload.video.canPublishSources, ["microphone"]);
  assert.ok(payload.exp - payload.nbf <= 600);
  assert.equal(validExpoPushToken("ExpoPushToken[test]"), true);
  assert.equal(validExpoPushToken("secret"), false);
  for (const [name, value] of [["LIVEKIT_URL", previous.url], ["LIVEKIT_API_KEY", previous.key], ["LIVEKIT_API_SECRET", previous.secret]]) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});

test("contact normalization is deterministic and excludes unsafe duplicate data", () => {
  assert.equal(normalizeEmail(" Test@Example.COM "), "test@example.com");
  assert.equal(normalizePhone("+1 (555) 010-2000"), "15550102000");
  assert.equal(hashIdentity("email:test@example.com").length, 64);
  const contact = normalizeContactPayload({
    deviceContactId: "device-1",
    displayName: "  Ada\u0000 Lovelace  ",
    phoneNumbers: [{ label: "mobile", value: "+1 555 0100" }, { label: "other", value: "15550100" }],
    emailAddresses: [{ label: "work", value: "ADA@EXAMPLE.COM" }, { label: "home", value: "ada@example.com" }]
  });
  assert.equal(contact.displayName, "Ada  Lovelace");
  assert.equal(contact.emailAddresses.length, 1);
  assert.equal(contact.phoneNumbers.length, 1);
  assert.equal(contact.identityHash, hashIdentity("email:ada@example.com"));
});

test("Phase 4 creates a hidden server bridge with strict directional interpretation", async () => {
  const previous = { url: process.env.LIVEKIT_URL, key: process.env.LIVEKIT_API_KEY, secret: process.env.LIVEKIT_API_SECRET };
  process.env.LIVEKIT_URL = "wss://example.livekit.cloud";
  process.env.LIVEKIT_API_KEY = "test-key";
  process.env.LIVEKIT_API_SECRET = "test-secret-with-enough-entropy";
  const { identity, token } = await createBridgeToken({ callId: "call-1", roomName: "room-1" });
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  assert.equal(identity, "interpreter-bridge-call-1");
  assert.equal(payload.video.room, "room-1");
  assert.equal(payload.video.hidden, true);
  assert.equal(languageCode("Brazilian Portuguese"), "pt");
  const instructions = translationInstructions("English", "Spanish");
  assert.match(instructions, /Translate only from English into natural Spanish/);
  assert.match(instructions, /Never answer the speaker/);
  for (const [name, value] of [["LIVEKIT_URL", previous.url], ["LIVEKIT_API_KEY", previous.key], ["LIVEKIT_API_SECRET", previous.secret]]) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});

test("Phase 4 latency metrics report averages and p95 without transcript content", () => {
  const metrics = summarizeMetrics([
    { first_audio_latency_ms: 300, total_latency_ms: 900, interruption_count: 1, recovery_count: 0, error_count: 0 },
    { first_audio_latency_ms: 500, total_latency_ms: 1100, interruption_count: 0, recovery_count: 1, error_count: 0 },
    { first_audio_latency_ms: 700, total_latency_ms: 1300, interruption_count: 0, recovery_count: 0, error_count: 1 }
  ]);
  assert.deepEqual(metrics, { utterances: 3, averageFirstAudioLatencyMs: 500, p95FirstAudioLatencyMs: 700, averageTotalLatencyMs: 1100, interruptions: 1, recoveries: 1, errors: 1 });
  assert.equal("transcript" in metrics, false);
});

test("Phase 4 Realtime events keep original and translated transcripts independent", () => {
  const session = new DirectionalRealtimeSession({ callId: "call-1", sourceLanguage: "English", sourceUserId: "user-1", targetLanguage: "Spanish", targetUserId: "user-2" });
  const transcripts = [];
  const audio = [];
  const metrics = [];
  session.on("transcript", (event) => transcripts.push(event));
  session.on("audio", (bytes) => audio.push(bytes));
  session.on("metric", (metric) => metrics.push(metric));
  session.handleEvent({ type: "input_audio_buffer.speech_started", item_id: "utterance-1" });
  session.handleEvent({ type: "conversation.item.input_audio_transcription.completed", item_id: "utterance-1", transcript: "How are you?" });
  session.handleEvent({ type: "response.output_audio_transcript.done", item_id: "utterance-1", transcript: "Â¿CÃ³mo estÃ¡s?" });
  session.handleEvent({ type: "response.output_audio.delta", delta: Buffer.from([0, 0]).toString("base64") });
  session.handleEvent({ type: "response.done", response: { status: "completed" } });
  assert.deepEqual(transcripts.map(({ kind, text }) => ({ kind, text })), [
    { kind: "original", text: "How are you?" },
    { kind: "translation", text: "Â¿CÃ³mo estÃ¡s?" }
  ]);
  assert.equal(audio[0].byteLength, 2);
  assert.equal(metrics[0].utteranceId, "utterance-1");
});

test("Phase 4 interpreted-minute cap counts only active translation time", () => {
  const bridge = new InterpretedCallBridge({ admin: {}, call: { id: "call-1", interpreted_seconds: 12 } });
  bridge.authorize("user-1", 30);
  assert.equal(bridge.totalActiveSeconds(), 12);
  assert.equal(bridge.maximumActiveSeconds, 42);
  assert.equal(bridge.isTranslationActive(), false);
});
