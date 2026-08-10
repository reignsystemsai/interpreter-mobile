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
const TRANSLATION_URL = "wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate";
const bridges = new Map();
const FIXED_VOICES = { female: "marin", male: "cedar" };
const META_SPEECH = [
  "i'm sorry",
  "i am sorry",
  "i can't assist",
  "i cannot assist",
  "i can't help",
  "i cannot help",
  "as an ai",
  "unable to provide"
];

function normalizeSpeech(value) {
  return String(value || "").toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ").trim();
}

function isUnpromptedMetaSpeech(outputTranscript, inputTranscript) {
  const output = normalizeSpeech(outputTranscript);
  const input = normalizeSpeech(inputTranscript);
  return META_SPEECH.some((phrase) => output.includes(phrase) && !input.includes(phrase));
}

function humanRole(identity, callId) {
  if (typeof identity !== "string") return null;
  if (identity.endsWith(`:${callId}:caller`) || identity.includes(`:${callId}:caller:`)) return "caller";
  if (identity.endsWith(`:${callId}:recipient`) || identity.includes(`:${callId}:recipient:`)) return "recipient";
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
  constructor({ callId, outputSource, sourceRole, targetLanguage, voice }) {
    this.callId = callId;
    this.outputSource = outputSource;
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
    this.inputTranscript = "";
    this.outputTranscript = "";
    this.pendingOutputAudio = [];
    this.outputBlocked = false;
    this.outputFlushTimer = null;
  }

  async open() {
    if (!process.env.OPENAI_API_KEY) throw new Error("OpenAI translation is not configured");
    this.inputTranscript = "";
    this.outputTranscript = "";
    this.pendingOutputAudio = [];
    this.outputBlocked = false;
    const socket = new WebSocket(TRANSLATION_URL, {
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
            audio: {
              input: {
                noise_reduction: { type: "near_field" }
              },
              output: { language: this.targetLanguage, voice: this.voice }
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
        if (event.type === "session.input_transcript.delta" && typeof event.delta === "string") {
          this.inputTranscript = `${this.inputTranscript}${event.delta}`.slice(-1000);
          return;
        }
        if (event.type === "session.output_transcript.delta" && typeof event.delta === "string") {
          this.outputTranscript = `${this.outputTranscript}${event.delta}`.slice(-1000);
          if (isUnpromptedMetaSpeech(this.outputTranscript, this.inputTranscript)) {
            this.outputBlocked = true;
            this.pendingOutputAudio = [];
            if (this.outputFlushTimer) clearTimeout(this.outputFlushTimer);
            this.outputFlushTimer = null;
            console.warn("[Translation] blocked non-translation speech", { callId: this.callId, direction: this.sourceRole });
            if (socket.readyState === WebSocket.OPEN) socket.close();
          } else {
            this.scheduleOutputFlush();
          }
          return;
        }
        if (event.type === "session.output_audio.delta" && typeof event.delta === "string") {
          if (this.outputBlocked || !this.firstInputAt) return;
          this.pendingOutputAudio.push(event.delta);
          this.scheduleOutputFlush();
          return;
        }
        if (event.type === "error") {
          console.error("[Translation] OpenAI session error", { callId: this.callId, direction: this.sourceRole });
        }
      });
    });
    await this.readyPromise;
  }

  scheduleOutputFlush() {
    if (this.closed || this.outputBlocked || this.outputFlushTimer || !this.outputTranscript) return;
    this.outputFlushTimer = setTimeout(() => {
      this.outputFlushTimer = null;
      if (isUnpromptedMetaSpeech(this.outputTranscript, this.inputTranscript)) {
        this.outputBlocked = true;
        this.pendingOutputAudio = [];
        return;
      }
      const audio = this.pendingOutputAudio.splice(0);
      for (const delta of audio) {
        const frame = pcm16Frame(delta);
        if (!frame) continue;
        if (!this.firstOutputLogged) {
          this.firstOutputLogged = true;
          console.info("[Translation] first source-locked audio", {
            callId: this.callId,
            direction: this.sourceRole,
            latencyMs: this.firstInputAt ? Date.now() - this.firstInputAt : null
          });
        }
        this.outputChain = this.outputChain.then(() => this.outputSource.captureFrame(frame)).catch(() => undefined);
      }
      if (this.pendingOutputAudio.length) this.scheduleOutputFlush();
    }, 900);
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
            type: "session.input_audio_buffer.append",
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
    if (this.outputFlushTimer) clearTimeout(this.outputFlushTimer);
    this.outputFlushTimer = null;
    this.pendingOutputAudio = [];
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
  constructor({ callId, callerLanguage, recipientLanguage, roomName, voiceGender = "male" }) {
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
        sourceRole: "caller",
        targetLanguage: recipientLanguage,
        voice: FIXED_VOICES[voiceGender]
      }),
      recipient: new TranslationDirection({
        callId,
        outputSource: this.outputSources.caller,
        sourceRole: "recipient",
        targetLanguage: callerLanguage,
        voice: FIXED_VOICES[voiceGender]
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
  const active = bridges.get(options.callId);
  if (active) return active;
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
  humanRole,
  pcm16Frame,
  startCallTranslation,
  stopCallTranslation
};
