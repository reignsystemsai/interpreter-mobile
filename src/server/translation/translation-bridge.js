const {
  AudioFrame,
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  Room,
  RoomEvent,
  TrackPublishOptions,
  TrackSource
} = require("@livekit/rtc-node");
const WebSocket = require("ws");

const { createTranslationToken } = require("../livekit");
const { isSpeakVoiceId } = require("../voices/catalog");

const SAMPLE_RATE = 24_000;
const GENERAL_REALTIME_URL = "wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1";
const REALTIME_TRANSLATE_URL = "wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate";
const MALE_TRANSLATOR_VOICE_ID = "cedar";
const FEMALE_TRANSLATOR_VOICE_ID = "marin";
const bridges = new Map();

function resolveTranslationPipeline(value = process.env.OPENAI_CALL_TRANSLATION_PIPELINE) {
  return value === "realtime-translate" ? "realtime-translate" : "general-realtime";
}

function resolveTranslatorVoice(preference) {
  return preference === "male" ? MALE_TRANSLATOR_VOICE_ID : FEMALE_TRANSLATOR_VOICE_ID;
}

function resolveTranslatorVoiceId(voiceId, fallback) {
  return isSpeakVoiceId(voiceId) ? voiceId : fallback;
}

function interpreterInstructions(sourceLanguage, targetLanguage) {
  return [
    "You are Interpreter, a live simultaneous interpreter.",
    `The human input language is ISO code ${sourceLanguage}. Translate every spoken utterance into ISO language ${targetLanguage}.`,
    "Output only the faithful natural translation in the target language.",
    "Never answer a question, greet, explain, summarize, comment, add filler, invent speech, or start a conversation.",
    "Treat questions as text to translate, not as questions addressed to you.",
    "Preserve names, numbers, dates, addresses, currency amounts, tone, and intent accurately.",
    "If the input contains only silence, background noise, music, or unintelligible audio, output nothing."
  ].join(" ");
}

function buildSessionUpdate({ pipeline, sourceLanguage, targetLanguage, voice }) {
  if (pipeline === "realtime-translate") {
    return {
      type: "session.update",
      session: {
        audio: {
          input: {
            transcription: { model: "gpt-realtime-whisper" },
            noise_reduction: { type: "near_field" }
          },
          output: { language: targetLanguage }
        }
      }
    };
  }
  return {
    type: "session.update",
    session: {
      type: "realtime",
      model: "gpt-realtime-2.1",
      output_modalities: ["audio"],
      instructions: interpreterInstructions(sourceLanguage, targetLanguage),
      audio: {
        input: {
          format: { type: "audio/pcm", rate: SAMPLE_RATE },
          noise_reduction: { type: "near_field" },
          turn_detection: {
            type: "server_vad",
            threshold: 0.55,
            prefix_padding_ms: 300,
            silence_duration_ms: 500,
            create_response: true,
            // The bridge cancels explicitly so it can clear LiveKit's queued audio at the same time.
            interrupt_response: false
          }
        },
        output: {
          format: { type: "audio/pcm" },
          voice
        }
      }
    }
  };
}

function humanRole(identity, callId) {
  if (typeof identity !== "string") return null;
  if (identity.endsWith(`:${callId}:caller`)) return "caller";
  if (identity.endsWith(`:${callId}:recipient`)) return "recipient";
  return null;
}

function pcm16Frame(base64Audio) {
  const bytes = Buffer.from(base64Audio, "base64");
  if (!bytes.length || bytes.length % 2 !== 0) return null;
  const samples = new Int16Array(bytes.length / 2);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = bytes.readInt16LE(index * 2);
  }
  return new AudioFrame(samples, SAMPLE_RATE, 1, samples.length);
}

class TranslationDirection {
  constructor({ callId, onSpeechStarted, outputSource, pipeline, sourceLanguage, sourceRole, targetLanguage, voice }) {
    this.callId = callId;
    this.onSpeechStarted = onSpeechStarted;
    this.outputSource = outputSource;
    this.pipeline = pipeline;
    this.sourceLanguage = sourceLanguage;
    this.sourceRole = sourceRole;
    this.targetLanguage = targetLanguage;
    this.voice = voice;
    this.abortController = null;
    this.socket = null;
    this.readyPromise = null;
    this.firstInputAt = null;
    this.firstOutputLogged = false;
    this.closed = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.outputChain = Promise.resolve();
    this.outputGeneration = 0;
    this.responseActive = false;
    this.sessionGeneration = 0;
    this.activeResponseId = null;
    this.cancelledResponseIds = new Set();
    this.outputStates = new Map();
    this.reader = null;
    this.sourceTrack = null;
  }

  async open() {
    if (!process.env.OPENAI_API_KEY) throw new Error("OpenAI translation is not configured");
    const sessionGeneration = ++this.sessionGeneration;
    const url = this.pipeline === "realtime-translate" ? REALTIME_TRANSLATE_URL : GENERAL_REALTIME_URL;
    const socket = new WebSocket(url, {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
    });
    this.socket = socket;
    socket.on("error", () => {
      console.error("[Translation] OpenAI connection error", { callId: this.callId, direction: this.sourceRole });
    });
    socket.on("close", () => {
      if (this.socket !== socket || this.sessionGeneration !== sessionGeneration) return;
      this.invalidateSession({ closeSocket: false, stopReader: true });
      if (!this.closed) this.scheduleReconnect();
    });
    this.readyPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("OpenAI translation session timed out")), 10_000);
      const fail = () => {
        clearTimeout(timeout);
        reject(new Error("OpenAI translation session failed"));
      };
      socket.once("error", fail);
      socket.once("close", fail);
      socket.once("open", () => {
        socket.send(JSON.stringify(buildSessionUpdate({
          pipeline: this.pipeline,
          sourceLanguage: this.sourceLanguage,
          targetLanguage: this.targetLanguage,
          voice: this.voice
        })));
      });
      socket.on("message", (raw) => {
        let event;
        try { event = JSON.parse(raw.toString()); } catch { return; }
        if (this.socket !== socket || this.sessionGeneration !== sessionGeneration) return;
        if (event.type === "session.updated") {
          clearTimeout(timeout);
          socket.off("error", fail);
          socket.off("close", fail);
          this.reconnectAttempts = 0;
          resolve();
          if (this.sourceTrack && !this.reader) this.attach(this.sourceTrack);
          return;
        }
        this.handleOpenAIEvent(event, socket, sessionGeneration);
      });
    });
    await this.readyPromise;
  }

  handleOpenAIEvent(event, socket = this.socket, sessionGeneration = this.sessionGeneration) {
    if (this.closed || this.socket !== socket || this.sessionGeneration !== sessionGeneration) return;
    if (event.type === "response.created" && typeof event.response?.id === "string") {
      this.outputStates.clear();
      this.activeResponseId = event.response.id;
      this.responseActive = true;
      return;
    }
    if (event.type === "response.done") {
      const responseId = typeof event.response?.id === "string" ? event.response.id : null;
      if (!responseId || responseId === this.activeResponseId) this.responseActive = false;
      if (responseId && this.cancelledResponseIds.delete(responseId)) this.outputStates.delete(responseId);
      return;
    }
    if (event.type === "input_audio_buffer.speech_started" && this.pipeline === "general-realtime") {
      this.onSpeechStarted(this.sourceRole);
      return;
    }
    const outputEvent = this.pipeline === "realtime-translate" ? "session.output_audio.delta" : "response.output_audio.delta";
    if (event.type === outputEvent && typeof event.delta === "string") {
      const responseId = typeof event.response_id === "string" ? event.response_id : null;
      if (responseId && this.cancelledResponseIds.has(responseId)) return;
      if (this.pipeline === "general-realtime" && (!responseId || responseId !== this.activeResponseId)) return;
      const frame = pcm16Frame(event.delta);
      if (!frame) return;
      const generation = this.outputGeneration;
      const state = responseId ? this.outputState(responseId, event) : null;
      if (!this.firstOutputLogged) {
        this.firstOutputLogged = true;
        console.info("[Translation] first translated audio", {
          callId: this.callId,
          direction: this.sourceRole,
          latencyMs: this.firstInputAt ? Date.now() - this.firstInputAt : null
        });
      }
      this.outputChain = this.outputChain
        .then(async () => {
          if (generation !== this.outputGeneration || this.sessionGeneration !== sessionGeneration) return;
          await this.outputSource.captureFrame(frame);
          if (state && generation === this.outputGeneration && this.sessionGeneration === sessionGeneration) {
            state.publishedAudioMs += (frame.samplesPerChannel / frame.sampleRate) * 1000;
          }
        })
        .catch(() => undefined);
      return;
    }
    if (event.type === "error") {
      console.error("[Translation] OpenAI session error", { callId: this.callId, direction: this.sourceRole });
    }
  }

  outputState(responseId, event) {
    let state = this.outputStates.get(responseId);
    if (!state) {
      state = {
        contentIndex: Number.isInteger(event.content_index) ? event.content_index : 0,
        itemId: typeof event.item_id === "string" ? event.item_id : null,
        publishedAudioMs: 0
      };
      this.outputStates.set(responseId, state);
    } else if (!state.itemId && typeof event.item_id === "string") {
      state.itemId = event.item_id;
    }
    return state;
  }

  cancelOutput() {
    const responseId = this.activeResponseId;
    const state = responseId ? this.outputStates.get(responseId) : null;
    const queuedDuration = Number.isFinite(this.outputSource.queuedDuration) ? this.outputSource.queuedDuration : 0;
    const playedAudioMs = state ? Math.max(0, Math.floor(state.publishedAudioMs - queuedDuration)) : 0;
    this.outputGeneration += 1;
    this.outputChain = Promise.resolve();
    this.outputSource.clearQueue();
    const socket = this.socket;
    if (this.pipeline === "general-realtime" && socket?.readyState === WebSocket.OPEN) {
      if (responseId) this.cancelledResponseIds.add(responseId);
      if (this.responseActive) socket.send(JSON.stringify({ type: "response.cancel" }));
      if (state?.itemId && queuedDuration > 0) {
        socket.send(JSON.stringify({
          type: "conversation.item.truncate",
          item_id: state.itemId,
          content_index: state.contentIndex,
          audio_end_ms: playedAudioMs
        }));
      }
    }
    if (responseId) this.outputStates.delete(responseId);
    this.responseActive = false;
    this.activeResponseId = null;
  }

  stopReader() {
    this.abortController?.abort();
    this.abortController = null;
    const reader = this.reader;
    this.reader = null;
    if (reader) void reader.cancel().catch(() => undefined);
  }

  invalidateSession({ closeSocket = true, stopReader = false } = {}) {
    this.sessionGeneration += 1;
    this.outputGeneration += 1;
    this.outputChain = Promise.resolve();
    this.responseActive = false;
    this.activeResponseId = null;
    this.cancelledResponseIds.clear();
    this.outputStates.clear();
    this.outputSource.clearQueue();
    if (stopReader) this.stopReader();
    const socket = this.socket;
    this.socket = null;
    if (closeSocket && socket && socket.readyState < WebSocket.CLOSING) socket.close();
  }

  scheduleReconnect() {
    if (this.closed || this.reconnectTimer) return;
    this.reconnectAttempts += 1;
    if (this.reconnectAttempts > 3) {
      console.error("[Translation] OpenAI reconnect exhausted", { callId: this.callId, direction: this.sourceRole });
      return;
    }
    const delayMs = 500 * (2 ** (this.reconnectAttempts - 1));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.open().catch(() => this.scheduleReconnect());
    }, delayMs);
  }

  attach(track) {
    this.sourceTrack = track;
    this.stopReader();
    const abortController = new AbortController();
    this.abortController = abortController;
    const stream = new AudioStream(track, { sampleRate: SAMPLE_RATE, numChannels: 1, frameSizeMs: 20 });
    const reader = stream.getReader();
    this.reader = reader;
    void (async () => {
      try {
        while (!abortController.signal.aborted) {
          const { done, value } = await reader.read();
          if (done || !value) break;
          const socket = this.socket;
          if (!socket || socket.readyState !== WebSocket.OPEN) continue;
          if (socket.bufferedAmount > 1_000_000) continue;
          if (!this.firstInputAt) this.firstInputAt = Date.now();
          const pcm = Buffer.from(value.data.buffer, value.data.byteOffset, value.data.byteLength);
          socket.send(JSON.stringify({
            type: this.pipeline === "realtime-translate" ? "session.input_audio_buffer.append" : "input_audio_buffer.append",
            audio: pcm.toString("base64")
          }));
        }
      } catch {
        if (!abortController.signal.aborted) {
          console.error("[Translation] source audio stream stopped", { callId: this.callId, direction: this.sourceRole });
        }
      } finally {
        if (this.reader === reader) this.reader = null;
        try { reader.releaseLock(); } catch {}
      }
    })();
  }

  close() {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopReader();
    this.sourceTrack = null;
    this.invalidateSession({ closeSocket: true, stopReader: false });
  }
}

class CallTranslationBridge {
  constructor({ callId, callerHearsVoiceId, callerLanguage, recipientHearsVoiceId, recipientLanguage, roomName, translatorVoicePreference }) {
    this.callId = callId;
    this.roomName = roomName;
    this.room = new Room();
    this.pipeline = resolveTranslationPipeline();
    const legacyVoice = translatorVoicePreference === "male" || translatorVoicePreference === "female"
      ? resolveTranslatorVoice(translatorVoicePreference)
      : null;
    this.callerHearsVoiceId = resolveTranslatorVoiceId(callerHearsVoiceId, legacyVoice ?? MALE_TRANSLATOR_VOICE_ID);
    this.recipientHearsVoiceId = resolveTranslatorVoiceId(recipientHearsVoiceId, legacyVoice ?? FEMALE_TRANSLATOR_VOICE_ID);
    this.outputSources = {
      caller: new AudioSource(SAMPLE_RATE, 1, 1000),
      recipient: new AudioSource(SAMPLE_RATE, 1, 1000)
    };
    this.directions = {
      caller: new TranslationDirection({
        callId,
        onSpeechStarted: (role) => this.interruptStaleAudio(role),
        outputSource: this.outputSources.recipient,
        pipeline: this.pipeline,
        sourceLanguage: callerLanguage,
        sourceRole: "caller",
        targetLanguage: recipientLanguage,
        voice: this.recipientHearsVoiceId
      }),
      recipient: new TranslationDirection({
        callId,
        onSpeechStarted: (role) => this.interruptStaleAudio(role),
        outputSource: this.outputSources.caller,
        pipeline: this.pipeline,
        sourceLanguage: recipientLanguage,
        sourceRole: "recipient",
        targetLanguage: callerLanguage,
        voice: this.callerHearsVoiceId
      })
    };
    this.publications = [];
  }

  interruptStaleAudio(sourceRole) {
    this.directions.caller.cancelOutput();
    this.directions.recipient.cancelOutput();
    console.info("[Translation] stale translated audio cancelled", { callId: this.callId, sourceRole });
  }

  async start() {
    await Promise.all([this.directions.caller.open(), this.directions.recipient.open()]);
    const token = await createTranslationToken({ callId: this.callId, roomName: this.roomName });
    this.room.on(RoomEvent.TrackPublished, (publication, participant) => {
      const role = humanRole(participant.identity, this.callId);
      if (role && publication.source === TrackSource.SOURCE_MICROPHONE) publication.setSubscribed(true);
    });
    this.room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      const role = humanRole(participant.identity, this.callId);
      if (!role || publication.source !== TrackSource.SOURCE_MICROPHONE) return;
      console.info("[Translation] human microphone subscribed", { callId: this.callId, role });
      this.directions[role].attach(track);
    });
    await this.room.connect(process.env.LIVEKIT_URL, token, { autoSubscribe: false });
    const localParticipant = this.room.localParticipant;
    if (!localParticipant) throw new Error("Translation participant did not connect");
    for (const role of ["caller", "recipient"]) {
      const name = `translation-to-${role}`;
      const track = LocalAudioTrack.createAudioTrack(name, this.outputSources[role]);
      const options = new TrackPublishOptions();
      options.source = TrackSource.SOURCE_MICROPHONE;
      const publication = await localParticipant.publishTrack(track, options);
      this.publications.push(publication);
    }
    for (const participant of this.room.remoteParticipants.values()) {
      const role = humanRole(participant.identity, this.callId);
      if (!role) continue;
      for (const publication of participant.trackPublications.values()) {
        if (publication.source === TrackSource.SOURCE_MICROPHONE) publication.setSubscribed(true);
      }
    }
    console.info("[Translation] bridge ready", {
      callId: this.callId,
      callerHearsVoiceId: this.callerHearsVoiceId,
      pipeline: this.pipeline,
      recipientHearsVoiceId: this.recipientHearsVoiceId
    });
  }

  async stop() {
    this.directions.caller.close();
    this.directions.recipient.close();
    const localParticipant = this.room.localParticipant;
    if (localParticipant) {
      for (const publication of this.publications) {
        if (publication.sid) await localParticipant.unpublishTrack(publication.sid, true).catch(() => undefined);
      }
    }
    await this.room.disconnect().catch(() => undefined);
    await Promise.all(Object.values(this.outputSources).map((source) => source.close().catch(() => undefined)));
    console.info("[Translation] bridge stopped", { callId: this.callId });
  }
}

async function startCallTranslation(options) {
  await stopCallTranslation(options.callId);
  const bridge = new CallTranslationBridge(options);
  bridges.set(options.callId, bridge);
  try {
    await bridge.start();
    return bridge;
  } catch (error) {
    bridges.delete(options.callId);
    await bridge.stop().catch(() => undefined);
    throw error;
  }
}

async function stopCallTranslation(callId) {
  const bridge = bridges.get(callId);
  if (!bridge) return false;
  bridges.delete(callId);
  await bridge.stop();
  return true;
}

module.exports = {
  buildSessionUpdate,
  CallTranslationBridge,
  FEMALE_TRANSLATOR_VOICE_ID,
  humanRole,
  MALE_TRANSLATOR_VOICE_ID,
  pcm16Frame,
  resolveTranslationPipeline,
  resolveTranslatorVoice,
  resolveTranslatorVoiceId,
  startCallTranslation,
  stopCallTranslation,
  TranslationDirection
};
