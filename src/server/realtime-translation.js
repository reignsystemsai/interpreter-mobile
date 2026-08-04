const { EventEmitter } = require("node:events");
const WebSocket = require("ws");

const OPENAI_REALTIME_URL = "wss://api.openai.com/v1/realtime";
const REALTIME_MODEL = "gpt-realtime";

function translationInstructions(sourceLanguage, targetLanguage) {
  return `You are Interpreter.ai in a private live call. Translate only from ${sourceLanguage} into natural ${targetLanguage}.
Speak only the translated meaning. Never answer the speaker, add commentary, explain, greet, or repeat the original.
Translate questions as questions. Preserve names, numbers, dates, currency, addresses, tone, intent, uncertainty, humor, and technical terms.
Keep the translation accurate, concise, natural, and suitable for immediate conversational playback. If speech is unclear, ask the same speaker to repeat using only ${targetLanguage}.`;
}

class DirectionalRealtimeSession extends EventEmitter {
  constructor({ callId, sourceLanguage, sourceUserId, targetLanguage, targetUserId }) {
    super();
    this.callId = callId;
    this.sourceLanguage = sourceLanguage;
    this.sourceUserId = sourceUserId;
    this.targetLanguage = targetLanguage;
    this.targetUserId = targetUserId;
    this.socket = null;
    this.closed = false;
    this.ready = false;
    this.recoveryAttempt = 0;
    this.recoveryTimer = null;
    this.connectingPromise = null;
    this.currentMetric = null;
    this.pendingOriginal = "";
    this.pendingTranslation = "";
  }

  async connect() {
    if (this.closed) throw new Error("Translation session is closed");
    if (!process.env.OPENAI_API_KEY) throw new Error("OpenAI is not configured");
    if (this.socket?.readyState === WebSocket.OPEN) return;
    if (this.connectingPromise) return this.connectingPromise;
    this.connectingPromise = new Promise((resolve, reject) => {
      const socket = new WebSocket(`${OPENAI_REALTIME_URL}?model=${encodeURIComponent(REALTIME_MODEL)}`, {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "OpenAI-Beta": "realtime=v1" },
        handshakeTimeout: 10_000
      });
      this.socket = socket;
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        callback(value);
      };
      const timeout = setTimeout(() => {
        finish(reject, new Error("OpenAI connection timed out"));
        socket.terminate();
      }, 12_000);
      socket.once("open", () => {
        socket.send(JSON.stringify({
          type: "session.update",
          session: {
            type: "realtime",
            model: REALTIME_MODEL,
            instructions: translationInstructions(this.sourceLanguage, this.targetLanguage),
            output_modalities: ["audio"],
            audio: {
              input: {
                format: { type: "audio/pcm", rate: 24000 },
                noise_reduction: { type: "near_field" },
                transcription: { model: "gpt-4o-mini-transcribe", language: languageCode(this.sourceLanguage) },
                turn_detection: {
                  type: "server_vad",
                  threshold: 0.45,
                  prefix_padding_ms: 300,
                  silence_duration_ms: 350,
                  create_response: true,
                  interrupt_response: true
                }
              },
              output: { format: { type: "audio/pcm", rate: 24000 }, voice: "alloy" }
            }
          }
        }));
      });
      socket.on("message", (payload) => {
        let event;
        try { event = JSON.parse(payload.toString()); } catch { return; }
        if (event.type === "session.updated") {
          this.ready = true;
          this.recoveryAttempt = 0;
          this.emit("ready");
          finish(resolve);
        }
        this.handleEvent(event);
      });
      socket.once("error", (error) => {
        if (!this.ready) finish(reject, error);
        this.emit("session-error", error);
      });
      socket.once("close", () => {
        if (!this.ready) finish(reject, new Error("OpenAI connection closed"));
        this.ready = false;
        this.emit("not-ready");
        if (!this.closed) this.scheduleRecovery();
      });
    }).finally(() => { this.connectingPromise = null; });
    return this.connectingPromise;
  }

  handleEvent(event) {
    const now = Date.now();
    if (event.type === "input_audio_buffer.speech_started") {
      const utteranceId = event.item_id || `utterance-${now}`;
      this.currentMetric = { utteranceId, inputStartedAt: now, firstAudioAt: null, transcriptionCompletedAt: null, outputCompletedAt: null, interruptionCount: 0, recoveryCount: this.recoveryAttempt, errorCount: 0 };
      this.pendingOriginal = "";
      this.pendingTranslation = "";
      this.emit("speech-started", { sourceUserId: this.sourceUserId, utteranceId });
    } else if (event.type === "conversation.item.input_audio_transcription.delta") {
      this.pendingOriginal += event.delta || "";
      this.emitTranscript("original", event.delta || "", false, event.item_id);
    } else if (event.type === "conversation.item.input_audio_transcription.completed") {
      this.pendingOriginal = event.transcript || this.pendingOriginal;
      if (this.currentMetric) this.currentMetric.transcriptionCompletedAt = now;
      this.emitTranscript("original", this.pendingOriginal, true, event.item_id);
    } else if (["response.output_audio.delta", "response.audio.delta"].includes(event.type)) {
      if (this.currentMetric && !this.currentMetric.firstAudioAt) this.currentMetric.firstAudioAt = now;
      if (event.delta) this.emit("audio", Buffer.from(event.delta, "base64"));
    } else if (event.type === "response.output_audio_transcript.delta") {
      this.pendingTranslation += event.delta || "";
      this.emitTranscript("translation", event.delta || "", false, event.item_id);
    } else if (event.type === "response.output_audio_transcript.done") {
      this.pendingTranslation = event.transcript || this.pendingTranslation;
      this.emitTranscript("translation", this.pendingTranslation, true, event.item_id);
    } else if (event.type === "response.done") {
      if (this.currentMetric) {
        this.currentMetric.outputCompletedAt = now;
        this.emit("metric", this.currentMetric);
        this.currentMetric = null;
      }
      if (["failed", "incomplete"].includes(event.response?.status)) this.emit("session-error", new Error(event.response?.status_details?.error?.message || "OpenAI response failed"));
    } else if (event.type === "error") {
      if (this.currentMetric) this.currentMetric.errorCount += 1;
      this.emit("session-error", new Error(event.error?.message || "OpenAI Realtime error"));
    }
  }

  emitTranscript(kind, text, final, itemId) {
    this.emit("transcript", {
      type: "interpretation.transcript",
      callId: this.callId,
      sourceUserId: this.sourceUserId,
      targetUserId: this.targetUserId,
      sourceLanguage: this.sourceLanguage,
      targetLanguage: this.targetLanguage,
      utteranceId: itemId || this.currentMetric?.utteranceId || `utterance-${Date.now()}`,
      kind,
      text,
      final
    });
  }

  appendAudio(frame) {
    if (!this.ready || this.socket?.readyState !== WebSocket.OPEN) return false;
    const bytes = Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
    this.socket.send(JSON.stringify({ type: "input_audio_buffer.append", audio: bytes.toString("base64") }));
    return true;
  }

  interrupt() {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: "response.cancel" }));
    if (this.currentMetric) this.currentMetric.interruptionCount += 1;
  }

  scheduleRecovery() {
    clearTimeout(this.recoveryTimer);
    if (this.recoveryAttempt >= 8) {
      this.emit("session-failed");
      return;
    }
    const delay = Math.min(8_000, 500 * (2 ** this.recoveryAttempt));
    this.recoveryAttempt += 1;
    this.emit("recovering", { attempt: this.recoveryAttempt, delay });
    this.recoveryTimer = setTimeout(() => void this.connect().catch((error) => this.emit("session-error", error)), delay);
  }

  close() {
    this.closed = true;
    this.ready = false;
    clearTimeout(this.recoveryTimer);
    if (this.socket && [WebSocket.CONNECTING, WebSocket.OPEN].includes(this.socket.readyState)) this.socket.close();
    this.socket = null;
    this.connectingPromise = null;
  }
}

function languageCode(language) {
  return ({ English: "en", Spanish: "es", "Brazilian Portuguese": "pt", French: "fr", German: "de", Italian: "it", Dutch: "nl", Russian: "ru", Polish: "pl", Romanian: "ro", Turkish: "tr", Arabic: "ar", Hebrew: "he", Hindi: "hi", Japanese: "ja", Korean: "ko", "Mandarin Chinese": "zh", Cantonese: "zh", Vietnamese: "vi", Thai: "th" })[language];
}

module.exports = { DirectionalRealtimeSession, OPENAI_REALTIME_URL, REALTIME_MODEL, languageCode, translationInstructions };
