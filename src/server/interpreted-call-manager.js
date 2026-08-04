const {
  AudioFrame,
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  RemoteAudioTrack,
  Room,
  RoomEvent,
  TrackPublishOptions,
  TrackSource
} = require("@livekit/rtc-node");
const { createBridgeToken } = require("./livekit");
const { DirectionalRealtimeSession } = require("./realtime-translation");

const SAMPLE_RATE = 24_000;
const CHANNELS = 1;
const bridges = new Map();

class InterpretedCallBridge {
  constructor({ admin, call }) {
    this.admin = admin;
    this.call = call;
    this.room = null;
    this.sessions = new Map();
    this.audioSources = new Map();
    this.audioTracks = new Map();
    this.audioPumps = new Map();
    this.closed = false;
    this.activeSince = null;
    this.activeMilliseconds = Math.max(0, Number(call.interpreted_seconds || 0) * 1000);
    this.usageTimer = null;
    this.meterTimer = null;
    this.maximumActiveSeconds = Number.POSITIVE_INFINITY;
    this.allowanceStopRequested = false;
    this.authorizedUsers = new Set();
    this.starting = null;
  }

  async start() {
    if (this.room || this.closed) return;
    const { token } = await createBridgeToken({ callId: this.call.id, roomName: this.call.room_name });
    const room = new Room();
    this.room = room;
    room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
      if (track instanceof RemoteAudioTrack && [this.call.caller_id, this.call.callee_id].includes(participant.identity)) {
        void this.attachParticipantAudio(participant.identity, track).catch((error) => this.reportError(error));
      }
    });
    room.on(RoomEvent.TrackUnsubscribed, (_track, _publication, participant) => {
      this.audioPumps.get(participant.identity)?.abort();
      this.audioPumps.delete(participant.identity);
      this.refreshActiveMeter();
    });
    room.on(RoomEvent.Reconnecting, () => void this.publishStatus("livekit_reconnecting"));
    room.on(RoomEvent.Reconnected, () => void this.publishStatus("livekit_reconnected"));
    room.on(RoomEvent.Disconnected, () => {
      if (!this.closed) {
        void this.publishStatus("livekit_disconnected").catch(() => undefined);
        bridges.delete(this.call.id);
        void this.stop("livekit_disconnected").catch(() => undefined);
      }
      this.refreshActiveMeter();
    });
    await room.connect(process.env.LIVEKIT_URL, token, { autoSubscribe: true, dynacast: false });
    await Promise.all([
      this.createOutputTrack(this.call.caller_id),
      this.createOutputTrack(this.call.callee_id)
    ]);
    this.usageTimer = setInterval(() => void this.flushUsage().catch((error) => this.reportError(error)), 15_000);
    this.meterTimer = setInterval(() => {
      if (!this.allowanceStopRequested && this.isTranslationActive() && this.totalActiveSeconds() >= this.maximumActiveSeconds) {
        this.allowanceStopRequested = true;
        void this.publishStatus("allowance_exhausted")
          .then(() => this.stop("allowance_exhausted"))
          .catch((error) => this.reportError(error));
      }
    }, 1_000);
    await this.admin.from("calls").update({ interpretation_started_at: this.call.interpretation_started_at || new Date().toISOString(), interpretation_ended_at: null }).eq("id", this.call.id);
    await this.publishStatus("bridge_ready");
  }

  directionFor(sourceUserId) {
    if (sourceUserId === this.call.caller_id) return {
      sourceLanguage: this.call.caller_spoken_language,
      sourceUserId: this.call.caller_id,
      targetLanguage: this.call.callee_heard_language,
      targetUserId: this.call.callee_id
    };
    return {
      sourceLanguage: this.call.callee_spoken_language,
      sourceUserId: this.call.callee_id,
      targetLanguage: this.call.caller_heard_language,
      targetUserId: this.call.caller_id
    };
  }

  async createOutputTrack(targetUserId) {
    const source = new AudioSource(SAMPLE_RATE, CHANNELS, 1000);
    const track = LocalAudioTrack.createAudioTrack(`interpreter-to-${targetUserId}`, source);
    const options = new TrackPublishOptions();
    options.source = TrackSource.SOURCE_MICROPHONE;
    await this.room.localParticipant.publishTrack(track, options);
    this.audioSources.set(targetUserId, source);
    this.audioTracks.set(targetUserId, track);
  }

  async attachParticipantAudio(sourceUserId, track) {
    this.audioPumps.get(sourceUserId)?.abort();
    const abortController = new AbortController();
    this.audioPumps.set(sourceUserId, abortController);
    let session = this.sessions.get(sourceUserId);
    if (!session) {
      const direction = this.directionFor(sourceUserId);
      session = new DirectionalRealtimeSession({ callId: this.call.id, ...direction });
      this.bindSession(session, direction);
      this.sessions.set(sourceUserId, session);
    }
    await session.connect();
    this.refreshActiveMeter();
    const stream = new AudioStream(track, SAMPLE_RATE, CHANNELS);
    try {
      for await (const frame of stream) {
        if (abortController.signal.aborted || this.closed) break;
        session.appendAudio(frame);
      }
    } finally {
      await stream.cancel().catch(() => undefined);
      this.audioPumps.delete(sourceUserId);
      this.refreshActiveMeter();
    }
  }

  bindSession(session, direction) {
    session.on("ready", () => {
      void this.publishStatus("openai_connected", { sourceUserId: direction.sourceUserId });
      this.refreshActiveMeter();
    });
    session.on("not-ready", () => this.refreshActiveMeter());
    session.on("recovering", (details) => void this.publishStatus("openai_reconnecting", { sourceUserId: direction.sourceUserId, ...details }));
    session.on("session-error", (error) => this.reportError(error, direction.sourceUserId));
    session.on("session-failed", () => void this.publishStatus("openai_unavailable", { sourceUserId: direction.sourceUserId }));
    session.on("speech-started", () => {
      const opposite = this.sessions.get(direction.targetUserId);
      opposite?.interrupt();
      this.audioSources.get(direction.sourceUserId)?.clearQueue();
    });
    session.on("audio", (bytes) => void this.publishAudio(direction.targetUserId, bytes).catch((error) => this.reportError(error, direction.sourceUserId)));
    session.on("transcript", (event) => void this.publishData(event, [this.call.caller_id, this.call.callee_id]));
    session.on("metric", (metric) => void this.recordMetric(direction, metric).catch((error) => this.reportError(error, direction.sourceUserId)));
  }

  async publishAudio(targetUserId, bytes) {
    const source = this.audioSources.get(targetUserId);
    if (!source || bytes.byteLength < 2) return;
    const evenLength = bytes.byteLength - (bytes.byteLength % 2);
    const samples = new Int16Array(bytes.buffer, bytes.byteOffset, evenLength / 2);
    await source.captureFrame(new AudioFrame(samples, SAMPLE_RATE, CHANNELS, samples.length));
  }

  async publishData(payload, destinationIdentities) {
    if (!this.room) return;
    await this.room.localParticipant.publishData(Buffer.from(JSON.stringify(payload)), {
      reliable: true,
      destination_identities: destinationIdentities,
      topic: "interpreter.call"
    });
  }

  async publishStatus(status, details = {}) {
    await this.publishData({ type: "interpretation.status", callId: this.call.id, status, timestamp: new Date().toISOString(), ...details }, [this.call.caller_id, this.call.callee_id]);
  }

  async recordMetric(direction, metric) {
    const firstAudioLatency = metric.firstAudioAt && metric.inputStartedAt ? metric.firstAudioAt - metric.inputStartedAt : null;
    const totalLatency = metric.outputCompletedAt && metric.inputStartedAt ? metric.outputCompletedAt - metric.inputStartedAt : null;
    const { error } = await this.admin.from("call_interpretation_metrics").upsert({
      call_id: this.call.id,
      source_user_id: direction.sourceUserId,
      target_user_id: direction.targetUserId,
      utterance_id: metric.utteranceId,
      input_started_at: toIso(metric.inputStartedAt),
      transcription_completed_at: toIso(metric.transcriptionCompletedAt),
      first_audio_at: toIso(metric.firstAudioAt),
      output_completed_at: toIso(metric.outputCompletedAt),
      first_audio_latency_ms: firstAudioLatency,
      total_latency_ms: totalLatency,
      interruption_count: metric.interruptionCount,
      recovery_count: metric.recoveryCount,
      error_count: metric.errorCount
    }, { onConflict: "call_id,source_user_id,utterance_id" });
    if (error) throw new Error("Unable to store interpretation metric");
    await this.publishData({ type: "interpretation.metric", callId: this.call.id, firstAudioLatencyMs: firstAudioLatency, totalLatencyMs: totalLatency }, [this.call.caller_id, this.call.callee_id]);
  }

  reportError(error, sourceUserId = null) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    const category = message.includes("meter") ? "usage" : message.includes("metric") ? "metrics" : message.includes("openai") ? "translation" : "media";
    console.warn("[Interpreted call] Bridge degraded", { category });
    void this.publishStatus("degraded", { sourceUserId, message: "Translation is reconnecting" }).catch(() => undefined);
  }

  isTranslationActive() {
    return Boolean(!this.closed && this.room && this.audioPumps.size === 2 && this.sessions.size === 2 && [...this.sessions.values()].every((session) => session.ready));
  }

  refreshActiveMeter() {
    const active = this.isTranslationActive();
    if (active && !this.activeSince) this.activeSince = Date.now();
    if (!active && this.activeSince) {
      this.activeMilliseconds += Date.now() - this.activeSince;
      this.activeSince = null;
    }
  }

  totalActiveSeconds() {
    const milliseconds = this.activeMilliseconds + (this.activeSince ? Date.now() - this.activeSince : 0);
    return Math.max(0, Math.floor(milliseconds / 1000));
  }

  async flushUsage() {
    const seconds = this.totalActiveSeconds();
    const results = await Promise.all([
      this.admin.from("calls").update({ interpreted_seconds: seconds }).eq("id", this.call.id),
      this.admin.rpc("record_interpreted_usage", { p_call_id: this.call.id, p_user_id: this.call.caller_id, p_total_seconds: seconds }),
      this.admin.rpc("record_interpreted_usage", { p_call_id: this.call.id, p_user_id: this.call.callee_id, p_total_seconds: seconds })
    ]);
    if (results.some((result) => result.error)) throw new Error("Unable to meter interpreted usage");
  }

  registerAllowance(remainingSeconds) {
    const candidate = this.totalActiveSeconds() + Math.max(0, Number(remainingSeconds) || 0);
    this.maximumActiveSeconds = Math.min(this.maximumActiveSeconds, candidate);
  }

  authorize(userId, remainingSeconds) {
    if ([this.call.caller_id, this.call.callee_id].includes(userId)) this.authorizedUsers.add(userId);
    this.registerAllowance(remainingSeconds);
  }

  bothParticipantsAuthorized() {
    return this.authorizedUsers.has(this.call.caller_id) && this.authorizedUsers.has(this.call.callee_id);
  }

  async stop(reason = "call_ended") {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.usageTimer);
    clearInterval(this.meterTimer);
    this.refreshActiveMeter();
    for (const controller of this.audioPumps.values()) controller.abort();
    for (const session of this.sessions.values()) session.close();
    await this.flushUsage().catch((error) => this.reportError(error));
    await this.admin.from("calls").update({ interpretation_ended_at: new Date().toISOString() }).eq("id", this.call.id);
    await this.publishStatus("stopped", { reason }).catch(() => undefined);
    for (const track of this.audioTracks.values()) await track.close().catch(() => undefined);
    for (const source of this.audioSources.values()) await source.close().catch(() => undefined);
    await this.room?.disconnect().catch(() => undefined);
    this.room = null;
  }
}

async function ensureInterpretedCall({ admin, call, remainingSeconds, userId }) {
  const existing = bridges.get(call.id);
  if (existing && !existing.closed) {
    existing.authorize(userId, remainingSeconds);
    if (existing.bothParticipantsAuthorized() && !existing.room) {
      existing.starting ||= existing.start().finally(() => { existing.starting = null; });
      try {
        await existing.starting;
      } catch (error) {
        bridges.delete(call.id);
        await existing.stop("startup_failed").catch(() => undefined);
        throw error;
      }
    }
    return existing;
  }
  const bridge = new InterpretedCallBridge({ admin, call });
  bridge.authorize(userId, remainingSeconds);
  bridges.set(call.id, bridge);
  return bridge;
}

async function stopInterpretedCall(callId, reason) {
  const bridge = bridges.get(callId);
  if (!bridge) return;
  bridges.delete(callId);
  await bridge.stop(reason);
}

function getInterpretedCallState(callId) {
  const bridge = bridges.get(callId);
  if (!bridge) return { active: false, status: "stopped", interpretedSeconds: 0 };
  return { active: bridge.isTranslationActive(), status: bridge.isTranslationActive() ? "active" : "connecting", interpretedSeconds: bridge.totalActiveSeconds() };
}

function toIso(timestamp) { return timestamp ? new Date(timestamp).toISOString() : null; }

module.exports = { InterpretedCallBridge, ensureInterpretedCall, getInterpretedCallState, SAMPLE_RATE, stopInterpretedCall };
