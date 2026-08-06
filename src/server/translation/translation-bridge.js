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
const { SpeechGate, speechGateOptionsFromEnv } = require("./speech-gate");

const SAMPLE_RATE = 24_000;
const TRANSLATION_URL = "wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate";
const OUTPUT_AUTHORIZATION_MS = 5_000;
const SELF_PLAYBACK_COOLDOWN_MS = 350;
const MAX_PENDING_OUTPUT_FRAMES = 150;
const bridges = new Map();

const NON_SPEECH_TRANSCRIPTS = new Set([
  "ah", "applause", "breathing", "cough", "coughing", "door", "hmm", "laughter",
  "music", "noise", "oh", "silence", "tapping", "traffic", "uh", "um", "wind"
]);

function isVerifiedHumanTranscript(value) {
  if (typeof value !== "string") return false;
  const normalized = value
    .toLocaleLowerCase()
    .replace(/[\[\](){}<>]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  if (!normalized || !/[\p{L}\p{N}]/u.test(normalized)) return false;
  return !NON_SPEECH_TRANSCRIPTS.has(normalized);
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
  constructor({ callId, onOutputAudio, outputSource, shouldSuppressInput, sourceRole, targetLanguage }) {
    this.callId = callId;
    this.outputSource = outputSource;
    this.sourceRole = sourceRole;
    this.targetLanguage = targetLanguage;
    this.onOutputAudio = onOutputAudio;
    this.shouldSuppressInput = shouldSuppressInput;
    this.abortController = null;
    this.socket = null;
    this.readyPromise = null;
    this.firstInputAt = null;
    this.firstOutputLogged = false;
    this.closed = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.outputChain = Promise.resolve();
    this.outputAuthorizedUntil = 0;
    this.hasTranscriptEvidence = false;
    this.sourceTranscript = "";
    this.pendingOutputFrames = [];
    this.speechGate = new SpeechGate(speechGateOptionsFromEnv());
  }

  queueOutput(frame, durationMs) {
    this.outputChain = this.outputChain
      .then(() => {
        this.onOutputAudio(durationMs);
        return this.outputSource.captureFrame(frame);
      })
      .catch(() => undefined);
  }

  confirmTranscript(delta) {
    if (typeof delta !== "string" || !delta.trim() || this.hasTranscriptEvidence) return;
    this.sourceTranscript += delta;
    if (!isVerifiedHumanTranscript(this.sourceTranscript)) return;
    this.hasTranscriptEvidence = true;
    const pending = this.pendingOutputFrames;
    this.pendingOutputFrames = [];
    for (const item of pending) this.queueOutput(item.frame, item.durationMs);
  }

  async open() {
    if (!process.env.OPENAI_API_KEY) throw new Error("OpenAI translation is not configured");
    this.hasTranscriptEvidence = false;
    this.sourceTranscript = "";
    this.pendingOutputFrames = [];
    this.outputAuthorizedUntil = 0;
    this.speechGate.reset();
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
                transcription: { model: "gpt-realtime-whisper" },
                noise_reduction: { type: "near_field" }
              },
              output: { language: this.targetLanguage }
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
        if (event.type === "session.input_transcript.delta") {
          this.confirmTranscript(event.delta);
          return;
        }
        if (event.type === "session.output_audio.delta" && typeof event.delta === "string") {
          if (Date.now() > this.outputAuthorizedUntil) return;
          const frame = pcm16Frame(event.delta);
          if (!frame) return;
          const durationMs = (Buffer.from(event.delta, "base64").length / 2 / SAMPLE_RATE) * 1000;
          if (!this.hasTranscriptEvidence) {
            this.pendingOutputFrames.push({ durationMs, frame });
            if (this.pendingOutputFrames.length > MAX_PENDING_OUTPUT_FRAMES) this.pendingOutputFrames.shift();
            return;
          }
          if (!this.firstOutputLogged) {
            this.firstOutputLogged = true;
            console.info("[Translation] first translated audio", {
              callId: this.callId,
              direction: this.sourceRole,
              latencyMs: this.firstInputAt ? Date.now() - this.firstInputAt : null
            });
          }
          this.queueOutput(frame, durationMs);
          return;
        }
        if (event.type === "session.output_audio.done" && !this.hasTranscriptEvidence) {
          this.pendingOutputFrames = [];
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
          const pcm = Buffer.from(value.data.buffer, value.data.byteOffset, value.data.byteLength);
          const gated = this.speechGate.push(pcm, { suppressed: this.shouldSuppressInput() });
          if (gated.started) {
            this.firstInputAt = Date.now();
            this.hasTranscriptEvidence = false;
            this.sourceTranscript = "";
            this.pendingOutputFrames = [];
          }
          if (gated.frames.length) this.outputAuthorizedUntil = Date.now() + OUTPUT_AUTHORIZATION_MS;
          for (const frame of gated.frames) {
            socket.send(JSON.stringify({
              type: "session.input_audio_buffer.append",
              audio: frame.toString("base64")
            }));
          }
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
    this.speechGate.reset();
    this.pendingOutputFrames = [];
    this.sourceTranscript = "";
    this.outputAuthorizedUntil = 0;
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
    this.playbackEndsAt = { caller: 0, recipient: 0 };
    this.directions = {
      caller: new TranslationDirection({
        callId,
        onOutputAudio: (durationMs) => this.markPlayback("recipient", durationMs),
        outputSource: this.outputSources.recipient,
        shouldSuppressInput: () => this.isPlaybackActive("caller"),
        sourceRole: "caller",
        targetLanguage: recipientLanguage
      }),
      recipient: new TranslationDirection({
        callId,
        onOutputAudio: (durationMs) => this.markPlayback("caller", durationMs),
        outputSource: this.outputSources.caller,
        shouldSuppressInput: () => this.isPlaybackActive("recipient"),
        sourceRole: "recipient",
        targetLanguage: callerLanguage
      })
    };
    this.publications = [];
  }

  markPlayback(role, durationMs) {
    this.playbackEndsAt[role] = Math.max(Date.now(), this.playbackEndsAt[role]) + Math.max(0, durationMs);
  }

  isPlaybackActive(role) {
    return Date.now() < this.playbackEndsAt[role] + SELF_PLAYBACK_COOLDOWN_MS;
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
  humanRole,
  isVerifiedHumanTranscript,
  pcm16Frame,
  startCallTranslation,
  stopCallTranslation
};
