const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const { createTranslationToken } = require("../src/server/livekit");
const { outputLanguageCode } = require("../src/server/translation/languages");
const {
  buildSessionUpdate,
  FEMALE_TRANSLATOR_VOICE_ID,
  humanRole,
  MALE_TRANSLATOR_VOICE_ID,
  pcm16Frame,
  resolveTranslationPipeline,
  resolveTranslatorVoice,
  resolveTranslatorVoiceId,
  TranslationDirection
} = require("../src/server/translation/translation-bridge");
const callsRouter = require("../src/server/routes/calls");

const audioDelta = () => Buffer.alloc(960).toString("base64");

function testDirection({ pipeline = "general-realtime", voice = "cedar" } = {}) {
  const outputSource = {
    captured: [],
    clearCount: 0,
    queuedDuration: 0,
    async captureFrame(frame) { this.captured.push(frame); },
    clearQueue() { this.clearCount += 1; this.queuedDuration = 0; }
  };
  const socket = {
    closed: false,
    readyState: 1,
    sent: [],
    close() { this.closed = true; this.readyState = 3; },
    send(payload) { this.sent.push(JSON.parse(payload)); }
  };
  const direction = new TranslationDirection({
    callId: "call-test",
    onSpeechStarted: () => direction.cancelOutput(),
    outputSource,
    pipeline,
    sourceLanguage: "en",
    sourceRole: "caller",
    targetLanguage: "es",
    voice
  });
  direction.socket = socket;
  direction.sessionGeneration = 1;
  return { direction, outputSource, socket };
}

test("fixed translator voice maps once to supported Realtime voices", () => {
  assert.equal(MALE_TRANSLATOR_VOICE_ID, "cedar");
  assert.equal(FEMALE_TRANSLATOR_VOICE_ID, "marin");
  assert.equal(resolveTranslatorVoice("male"), "cedar");
  assert.equal(resolveTranslatorVoice("female"), "marin");
  assert.equal(resolveTranslatorVoiceId("cedar", "marin"), "cedar");
  assert.equal(resolveTranslatorVoiceId("unsupported", "marin"), "marin");
  assert.equal(resolveTranslationPipeline(), "general-realtime");
  assert.equal(resolveTranslationPipeline("realtime-translate"), "realtime-translate");
});

test("General Realtime session locks one voice and strict interpreter behavior", () => {
  const update = buildSessionUpdate({
    pipeline: "general-realtime",
    sourceLanguage: "en",
    targetLanguage: "es",
    voice: "cedar"
  });
  assert.equal(update.session.type, "realtime");
  assert.equal(update.session.model, "gpt-realtime-2.1");
  assert.deepEqual(update.session.output_modalities, ["audio"]);
  assert.equal(update.session.audio.input.format.rate, 24_000);
  assert.equal(update.session.audio.output.voice, "cedar");
  assert.equal(update.session.audio.output.format.type, "audio/pcm");
  assert.equal(update.session.audio.input.turn_detection.interrupt_response, false);
  assert.match(update.session.instructions, /Never answer a question/);
  assert.match(update.session.instructions, /output nothing/);
});

test("the selected voice remains identical across languages and both directions", () => {
  for (const targetLanguage of ["en", "es", "pt", "fr", "de", "it", "ru", "zh", "ja", "ko", "hi", "id", "vi"]) {
    const outgoing = buildSessionUpdate({ pipeline: "general-realtime", sourceLanguage: "en", targetLanguage, voice: "marin" });
    const incoming = buildSessionUpdate({ pipeline: "general-realtime", sourceLanguage: targetLanguage, targetLanguage: "en", voice: "marin" });
    assert.equal(outgoing.session.audio.output.voice, "marin");
    assert.equal(incoming.session.audio.output.voice, "marin");
  }
});

test("dedicated translation fallback remains available", () => {
  const update = buildSessionUpdate({
    pipeline: "realtime-translate",
    sourceLanguage: "en",
    targetLanguage: "es",
    voice: "marin"
  });
  assert.equal(update.session.audio.output.language, "es");
  assert.equal(update.session.audio.output.voice, undefined);
});

test("late audio from a cancelled response never reaches LiveKit or a new response", async () => {
  const { direction, outputSource, socket } = testDirection();
  direction.handleOpenAIEvent({ type: "response.created", response: { id: "response-old" } }, socket, 1);
  direction.handleOpenAIEvent({
    type: "response.output_audio.delta",
    response_id: "response-old",
    item_id: "item-old",
    content_index: 0,
    delta: audioDelta()
  }, socket, 1);
  direction.cancelOutput();
  await new Promise((resolve) => setImmediate(resolve));
  direction.handleOpenAIEvent({
    type: "response.output_audio.delta",
    response_id: "response-old",
    item_id: "item-old",
    content_index: 0,
    delta: audioDelta()
  }, socket, 1);
  assert.equal(outputSource.captured.length, 0);

  direction.handleOpenAIEvent({ type: "response.created", response: { id: "response-new" } }, socket, 1);
  direction.handleOpenAIEvent({
    type: "response.output_audio.delta",
    response_id: "response-new",
    item_id: "item-new",
    content_index: 0,
    delta: audioDelta()
  }, socket, 1);
  await direction.outputChain;
  assert.equal(outputSource.captured.length, 1);
});

test("interruption truncates the assistant item at the locally played position", async () => {
  const { direction, outputSource, socket } = testDirection();
  direction.handleOpenAIEvent({ type: "response.created", response: { id: "response-1" } }, socket, 1);
  direction.handleOpenAIEvent({
    type: "response.output_audio.delta",
    response_id: "response-1",
    item_id: "item-1",
    content_index: 0,
    delta: audioDelta()
  }, socket, 1);
  await direction.outputChain;
  outputSource.queuedDuration = 5;
  direction.cancelOutput();
  assert.deepEqual(socket.sent.at(-2), { type: "response.cancel" });
  assert.deepEqual(socket.sent.at(-1), {
    type: "conversation.item.truncate",
    item_id: "item-1",
    content_index: 0,
    audio_end_ms: 15
  });
});

test("reconnect invalidates the old session while preserving the selected voice", async () => {
  for (const voice of ["cedar", "marin"]) {
    const { direction, outputSource, socket } = testDirection({ voice });
    const oldGeneration = direction.sessionGeneration;
    direction.handleOpenAIEvent({ type: "response.created", response: { id: "response-old" } }, socket, oldGeneration);
    direction.invalidateSession({ closeSocket: true, stopReader: false });
    assert.equal(socket.closed, true);
    assert.equal(direction.voice, voice);

    direction.handleOpenAIEvent({
      type: "response.output_audio.delta",
      response_id: "response-old",
      item_id: "item-old",
      delta: audioDelta()
    }, socket, oldGeneration);
    assert.equal(outputSource.captured.length, 0);

    const newSocket = { readyState: 1, sent: [], send(payload) { this.sent.push(JSON.parse(payload)); } };
    direction.socket = newSocket;
    const newGeneration = ++direction.sessionGeneration;
    direction.handleOpenAIEvent({ type: "response.created", response: { id: "response-new" } }, newSocket, newGeneration);
    direction.handleOpenAIEvent({
      type: "response.output_audio.delta",
      response_id: "response-new",
      item_id: "item-new",
      delta: audioDelta()
    }, newSocket, newGeneration);
    await direction.outputChain;
    assert.equal(outputSource.captured.length, 1);
    assert.equal(buildSessionUpdate({ pipeline: "general-realtime", sourceLanguage: "en", targetLanguage: "es", voice: direction.voice }).session.audio.output.voice, voice);
  }
});

test("ringing call recovers its voice preference from the durable room record", () => {
  const maleRoom = callsRouter.roomNameWithVoicePreference("male", "restart-test");
  const femaleRoom = callsRouter.roomNameWithVoicePreference("female", "restart-test-2");
  delete require.cache[require.resolve("../src/server/routes/calls")];
  const restartedRouter = require("../src/server/routes/calls");
  assert.equal(restartedRouter.translatorVoicePreferenceFromRoomName(maleRoom), "male");
  assert.equal(restartedRouter.translatorVoicePreferenceFromRoomName(femaleRoom), "female");
  assert.equal(restartedRouter.roomNameWithoutVoicePreference(maleRoom), "voice-restart-test");
});

test("ringing calls persist and restore independent caller and recipient voices", () => {
  for (const callerHearsVoiceId of ["cedar", "marin"]) {
    for (const recipientHearsVoiceId of ["cedar", "marin"]) {
      const roomName = callsRouter.roomNameWithCallVoiceIds({ callerHearsVoiceId, recipientHearsVoiceId }, `pair-${callerHearsVoiceId}-${recipientHearsVoiceId}`);
      assert.deepEqual(callsRouter.callVoiceIdsFromRoomName(roomName), { callerHearsVoiceId, recipientHearsVoiceId });
      assert.equal(callsRouter.roomNameWithoutVoicePreference(roomName), `voice-pair-${callerHearsVoiceId}-${recipientHearsVoiceId}`);
    }
  }
});

test("new and legacy call requests resolve safe voice IDs", () => {
  assert.deepEqual(callsRouter.callVoiceIdsFromRequest({ callerHearsVoiceId: "marin", recipientHearsVoiceId: "cedar" }), {
    callerHearsVoiceId: "marin",
    recipientHearsVoiceId: "cedar"
  });
  assert.deepEqual(callsRouter.callVoiceIdsFromRequest({ translatorVoicePreference: "male" }), {
    callerHearsVoiceId: "cedar",
    recipientHearsVoiceId: "cedar"
  });
  assert.deepEqual(callsRouter.callVoiceIdsFromRequest({}), {
    callerHearsVoiceId: "cedar",
    recipientHearsVoiceId: "marin"
  });
});

test("dedicated realtime-translate fallback processes its original audio event", async () => {
  const { direction, outputSource, socket } = testDirection({ pipeline: "realtime-translate", voice: "marin" });
  direction.handleOpenAIEvent({ type: "session.output_audio.delta", delta: audioDelta() }, socket, 1);
  await direction.outputChain;
  assert.equal(outputSource.captured.length, 1);
  assert.equal(socket.sent.length, 0);
});

test("direction shutdown aborts its reader, closes its socket, and invalidates queued output", async () => {
  const { direction, outputSource, socket } = testDirection();
  let readerCancelled = false;
  direction.abortController = new AbortController();
  direction.reader = { cancel: async () => { readerCancelled = true; } };
  direction.activeResponseId = "response-active";
  direction.responseActive = true;
  const oldSessionGeneration = direction.sessionGeneration;
  const oldOutputGeneration = direction.outputGeneration;
  direction.close();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(readerCancelled, true);
  assert.equal(socket.closed, true);
  assert.equal(direction.activeResponseId, null);
  assert.equal(direction.responseActive, false);
  assert.ok(direction.sessionGeneration > oldSessionGeneration);
  assert.ok(direction.outputGeneration > oldOutputGeneration);
  assert.ok(outputSource.clearCount > 0);
});

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
  assert.match(selector, /SPEAK CALLING/);
  assert.match(selector, /Voice options/);
  assert.match(selector, /You hear/);
  assert.match(selector, /They hear/);
  assert.match(selector, /Voice 1/);
  assert.match(selector, /Male/);
  assert.match(selector, /Female/);
  assert.match(selector, /Start Voice Call/);
  assert.match(selector, /Speak Voice Call/);
  assert.doesNotMatch(selector, /You hear <Text[\s\S]*hears <Text/);
  assert.doesNotMatch(selector, />cedar<|>marin</);
  assert.match(contacts, /startVoiceCall\(\{ callerHearsVoiceId:[\s\S]*recipientHearsVoiceId:/);
  assert.match(contacts, /keyboardShouldPersistTaps="handled"/);
});

test("server creates exactly two translation directions and stops them with the call", () => {
  const bridge = read("src", "server", "translation", "translation-bridge.js");
  const calls = read("src", "server", "routes", "calls.js");
  assert.match(bridge, /sourceRole: "caller"[\s\S]*targetLanguage: recipientLanguage/);
  assert.match(bridge, /sourceRole: "recipient"[\s\S]*targetLanguage: callerLanguage/);
  assert.match(bridge, /sourceRole: "caller"[\s\S]*voice: this\.recipientHearsVoiceId/);
  assert.match(bridge, /sourceRole: "recipient"[\s\S]*voice: this\.callerHearsVoiceId/);
  assert.match(bridge, /session\.input_audio_buffer\.append/);
  assert.match(bridge, /response\.output_audio\.delta/);
  assert.match(bridge, /response\.cancel/);
  assert.match(bridge, /clearQueue\(\)/);
  assert.match(calls, /await stopCallTranslation\(row\.id\)/);
  assert.match(calls, /room_name: roomNameWithoutVoicePreference\(row\.room_name\)/);
});

test("both call directions continuously reach their independent translation sessions", () => {
  const bridge = read("src", "server", "translation", "translation-bridge.js");
  assert.doesNotMatch(bridge, /SELF_PLAYBACK_COOLDOWN_MS|shouldSuppressInput|isPlaybackActive/);
  assert.match(bridge, /this\.directions\[role\]\.attach\(track\)/);
  assert.match(bridge, /noise_reduction: \{ type: "near_field" \}/);
});

test("call audio session uses the proven explicit start and stop lifecycle", () => {
  const mobile = read("mobile", "src", "features", "calling", "VoiceCallService.ts");
  assert.match(mobile, /await AudioSession\.startAudioSession\(\)/);
  assert.match(mobile, /await AudioSession\.stopAudioSession\(\)/);
});
