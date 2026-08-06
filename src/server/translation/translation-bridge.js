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

const SAMPLE_RATE = 24_000;
const REALTIME_URL = "wss://api.openai.com/v1/realtime?model=gpt-realtime";
const FEMALE_VOICE = "marin";
const MALE_VOICE = "cedar";
const LANGUAGE_NAMES = Object.freeze({
  en: "English",
  es: "Spanish",
  pt: "Brazilian Portuguese",
  fr: "French",
  de: "German",
  it: "Italian",
  ru: "Russian",
  zh: "Mandarin Chinese",
  ja: "Japanese",
  ko: "Korean",
  hi: "Hindi",
  id: "Indonesian",
  vi: "Vietnamese"
});
const bridges = new Map();

function interpreterInstructions(sourceLanguage, targetLanguage) {
  const source = LANGUAGE_NAMES[sourceLanguage] ?? sourceLanguage;
  const target = LANGUAGE_NAMES[targetLanguage] ?? targetLanguage;
  return `You are a live interpreter translating from ${source} into ${target}.
Translate every utterance naturally and accurately into ${target}.
Speak only the translated meaning in ${target}.
Never answer the speaker, ask questions, greet, explain, add commentary, or act as an assistant.
Never repeat the original ${source} aloud.
Preserve names, numbers, dates, addresses, currency amounts, tone, and intent accurately.`;
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
  constructor({ callId, outputSource, sourceLanguage, sourceRole, targetLanguage, voice }) {
    this.callId = callId;
    this.outputSource = outputSource;
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
  }

  async open() {
    if (!process.env.OPENAI_API_KEY) throw new Error("OpenAI translation is not configured");
    const socket = new WebSocket(REALTIME_URL, {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
    });
    this.socket = socket;
    socket.on("error", () => {
      console.error("[Translation] OpenAI connection error", { callId: this.callId, direction: this.sourceRole });
    });
    socket.on("close", () => {
      if (this.socket === socket) this.socket = null;
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
        socket.send(JSON.stringify({
          type: "session.update",
          session: {
            type: "realtime",
            model: "gpt-realtime",
            instructions: interpreterInstructions(this.sourceLanguage, this.targetLanguage),
            output_modalities: ["audio"],
            audio: {
              input: {
                turn_detection: {
                  type: "server_vad",
                  threshold: 0.5,
                  prefix_padding_ms: 300,
                  silence_duration_ms: 500,
                  create_response: true,
                  interrupt_response: true
                }
              },
              output: { voice: this.voice }
            }
          }
        }));
      });
      socket.on("message", (raw) => {
        let event;
        try { event = JSON.parse(raw.toString()); } catch { return; }
        if (event.type === "session.updated") {
          clearTimeout(timeout);
          socket.off("error", fail);
          socket.off("close", fail);
          this.reconnectAttempts = 0;
          resolve();
          return;
        }
        if (event.type === "response.output_audio.delta" && typeof event.delta === "string") {
          const frame = pcm16Frame(event.delta);
          if (!frame) return;
          if (!this.firstOutputLogged) {
            this.firstOutputLogged = true;
            console.info("[Translation] first translated audio", {
              callId: this.callId,
              direction: this.sourceRole,
              latencyMs: this.firstInputAt ? Date.now() - this.firstInputAt : null
            });
          }
          this.outputChain = this.outputChain
            .then(() => this.outputSource.captureFrame(frame))
            .catch(() => undefined);
          return;
        }
        if (event.type === "error") {
          console.error("[Translation] OpenAI session error", { callId: this.callId, direction: this.sourceRole });
        }
      });
    });
    await this.readyPromise;
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
    this.abortController?.abort();
    const abortController = new AbortController();
    this.abortController = abortController;
    const stream = new AudioStream(track, { sampleRate: SAMPLE_RATE, numChannels: 1, frameSizeMs: 20 });
    const reader = stream.getReader();
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
            type: "input_audio_buffer.append",
            audio: pcm.toString("base64")
          }));
        }
      } catch {
        if (!abortController.signal.aborted) {
          console.error("[Translation] source audio stream stopped", { callId: this.callId, direction: this.sourceRole });
        }
      } finally {
        reader.releaseLock();
      }
    })();
  }

  close() {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.abortController?.abort();
    this.abortController = null;
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
  }
}

class CallTranslationBridge {
  constructor({ callId, callerLanguage, recipientLanguage, roomName }) {
    this.callId = callId;
    this.roomName = roomName;
    this.room = new Room();
    this.outputSources = {
      caller: new AudioSource(SAMPLE_RATE, 1, 1000),
      recipient: new AudioSource(SAMPLE_RATE, 1, 1000)
    };
    this.directions = {
      caller: new TranslationDirection({
        callId,
        outputSource: this.outputSources.recipient,
        sourceLanguage: callerLanguage,
        sourceRole: "caller",
        targetLanguage: recipientLanguage,
        voice: FEMALE_VOICE
      }),
      recipient: new TranslationDirection({
        callId,
        outputSource: this.outputSources.caller,
        sourceLanguage: recipientLanguage,
        sourceRole: "recipient",
        targetLanguage: callerLanguage,
        voice: MALE_VOICE
      })
    };
    this.publications = [];
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
    console.info("[Translation] bridge ready", { callId: this.callId });
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
  CallTranslationBridge,
  FEMALE_VOICE,
  MALE_VOICE,
  humanRole,
  interpreterInstructions,
  pcm16Frame,
  startCallTranslation,
  stopCallTranslation
};
