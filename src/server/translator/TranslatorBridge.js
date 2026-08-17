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

const SAMPLE_RATE = 24_000;
const REALTIME_URL = "wss://api.openai.com/v1/realtime?model=gpt-realtime";
const SYSTEM_VOICES = Object.freeze({ male: "cedar", female: "marin" });
const LANGUAGE_NAMES = Object.freeze({
  en: "English", es: "Spanish", pt: "Brazilian Portuguese", fr: "French",
  de: "German", it: "Italian", ru: "Russian", zh: "Mandarin Chinese",
  ja: "Japanese", ko: "Korean", hi: "Hindi", id: "Indonesian", vi: "Vietnamese"
});

function instructions(sourceCode, targetCode) {
  const source = LANGUAGE_NAMES[sourceCode];
  const target = LANGUAGE_NAMES[targetCode];
  return `You are a live interpreter translating from ${source} into ${target}.
Translate each completed human utterance naturally and accurately into ${target}.
Speak only the translated meaning. Never answer, greet, explain, add commentary, or initiate speech.
Never repeat the original aloud. Preserve names, numbers, dates, addresses, amounts, tone, and intent.`;
}

function frameFromBase64(audio) {
  const bytes = Buffer.from(audio, "base64");
  if (!bytes.length || bytes.length % 2) return null;
  const samples = new Int16Array(bytes.length / 2);
  for (let index = 0; index < samples.length; index += 1) samples[index] = bytes.readInt16LE(index * 2);
  return new AudioFrame(samples, SAMPLE_RATE, 1, samples.length);
}

class RealtimeDirection {
  constructor({ callId, output, sourceLanguage, sourceRole, targetLanguage, voice }) {
    this.callId = callId;
    this.output = output;
    this.sourceLanguage = sourceLanguage;
    this.sourceRole = sourceRole;
    this.targetLanguage = targetLanguage;
    this.voice = SYSTEM_VOICES[voice];
    this.socket = null;
    this.abortController = null;
    this.outputChain = Promise.resolve();
  }

  async open() {
    if (!process.env.OPENAI_API_KEY) throw new Error("OpenAI is not configured");
    const socket = new WebSocket(REALTIME_URL, { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } });
    this.socket = socket;
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("OpenAI Realtime connection timed out")), 10_000);
      const fail = () => { clearTimeout(timeout); reject(new Error("OpenAI Realtime connection failed")); };
      socket.once("error", fail);
      socket.once("close", fail);
      socket.once("open", () => socket.send(JSON.stringify({
        type: "session.update",
        session: {
          type: "realtime",
          model: "gpt-realtime",
          instructions: instructions(this.sourceLanguage, this.targetLanguage),
          output_modalities: ["audio"],
          audio: {
            input: { turn_detection: { type: "server_vad", threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 500, create_response: true, interrupt_response: true } },
            output: { voice: this.voice }
          }
        }
      })));
      socket.on("message", (raw) => {
        let event;
        try { event = JSON.parse(raw.toString()); } catch { return; }
        if (event.type === "session.updated") {
          clearTimeout(timeout); socket.off("error", fail); socket.off("close", fail); resolve(); return;
        }
        if (event.type === "response.output_audio.delta" && typeof event.delta === "string") {
          const frame = frameFromBase64(event.delta);
          if (frame) this.outputChain = this.outputChain.then(() => this.output.captureFrame(frame)).catch(() => undefined);
        }
        if (event.type === "error") console.error("[Translator] Realtime error", { callId: this.callId, direction: this.sourceRole });
      });
    });
  }

  attach(track) {
    this.abortController?.abort();
    const controller = new AbortController();
    this.abortController = controller;
    const reader = new AudioStream(track, { sampleRate: SAMPLE_RATE, numChannels: 1, frameSizeMs: 20 }).getReader();
    void (async () => {
      try {
        while (!controller.signal.aborted) {
          const { done, value } = await reader.read();
          if (done || !value) break;
          const socket = this.socket;
          if (!socket || socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > 1_000_000) continue;
          const pcm = Buffer.from(value.data.buffer, value.data.byteOffset, value.data.byteLength);
          socket.send(JSON.stringify({ type: "input_audio_buffer.append", audio: pcm.toString("base64") }));
        }
      } finally { reader.releaseLock(); }
    })().catch(() => undefined);
  }

  close() {
    this.abortController?.abort();
    this.abortController = null;
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
  }
}

class TranslatorBridge {
  constructor(call, serverUrl, token) {
    this.call = call;
    this.serverUrl = serverUrl;
    this.token = token;
    this.room = new Room();
    this.outputs = { caller: new AudioSource(SAMPLE_RATE, 1, 1000), recipient: new AudioSource(SAMPLE_RATE, 1, 1000) };
    this.directions = {
      caller: new RealtimeDirection({ callId: call.id, output: this.outputs.recipient, sourceLanguage: call.callerLanguage, sourceRole: "caller", targetLanguage: call.recipientLanguage, voice: call.callerVoice }),
      recipient: new RealtimeDirection({ callId: call.id, output: this.outputs.caller, sourceLanguage: call.recipientLanguage, sourceRole: "recipient", targetLanguage: call.callerLanguage, voice: call.recipientVoice })
    };
  }

  role(identity) {
    if (identity === this.call.callerIdentity) return "caller";
    if (identity === this.call.recipientIdentity) return "recipient";
    return null;
  }

  async start() {
    await Promise.all([this.directions.caller.open(), this.directions.recipient.open()]);
    this.room.on(RoomEvent.TrackPublished, (publication, participant) => {
      if (this.role(participant.identity) && publication.source === TrackSource.SOURCE_MICROPHONE) publication.setSubscribed(true);
    });
    this.room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      const role = this.role(participant.identity);
      if (role && publication.source === TrackSource.SOURCE_MICROPHONE) this.directions[role].attach(track);
    });
    await this.room.connect(this.serverUrl, this.token, { autoSubscribe: false });
    if (!this.room.localParticipant) throw new Error("Translator did not join the room");
    for (const role of ["caller", "recipient"]) {
      const track = LocalAudioTrack.createAudioTrack(`translation-to-${role}`, this.outputs[role]);
      const options = new TrackPublishOptions();
      options.source = TrackSource.SOURCE_MICROPHONE;
      await this.room.localParticipant.publishTrack(track, options);
    }
    console.info("[Translator] ready", { callId: this.call.id });
  }

  async stop() {
    this.directions.caller.close();
    this.directions.recipient.close();
    await this.room.disconnect().catch(() => undefined);
    await Promise.all(Object.values(this.outputs).map((output) => output.close().catch(() => undefined)));
  }
}

module.exports = { LANGUAGE_NAMES, SYSTEM_VOICES, TranslatorBridge, instructions };
