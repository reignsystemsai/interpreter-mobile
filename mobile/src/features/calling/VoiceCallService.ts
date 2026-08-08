import { AndroidAudioTypePresets, AudioSession } from '@livekit/react-native';
import type { CountryCode } from 'libphonenumber-js';
import { AudioPresets, ConnectionState, Room, RoomEvent, Track } from 'livekit-client';
import { PermissionsAndroid, Platform } from 'react-native';
import InCallManager from 'react-native-incall-manager';

import { API_BASE_URL } from '../../config/runtime';
import { getDeviceId } from '../../services/deviceRegistration';

export type VoiceCallStatus = 'idle' | 'preparing' | 'ringing' | 'connecting' | 'connected' | 'reconnecting' | 'ending' | 'ended' | 'failed';
export type VoiceCallRole = 'caller' | 'recipient' | null;
export type VoiceCallState = {
  callId: string | null;
  error: string;
  muted: boolean;
  remoteLabel: string;
  role: VoiceCallRole;
  status: VoiceCallStatus;
};

type ActiveCall = {
  callId: string;
  roomName: string | null;
  livekitUrl: string | null;
  remoteLabel: string;
  role: Exclude<VoiceCallRole, null>;
  token: string | null;
  translationEnabled: boolean;
};

export type IncomingVoiceCall = {
  callId: string;
  callerPhoneNumber: string;
};

// Credentials issued by the new media-session endpoint (src/server/routes/mediaSessions.js)
// for a call whose state is owned by CallingShellHost, not by this service's own
// backend calls.
export type MediaSessionCredentials = {
  callId: string;
  roomName: string;
  livekitUrl: string;
  token: string;
  translationEnabled: boolean;
  role: Exclude<VoiceCallRole, null>;
  remoteLabel: string;
};

type ApiErrorPayload = { code?: string; error?: string };

export class VoiceCallError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'VoiceCallError';
  }
}

const INITIAL_STATE: VoiceCallState = { callId: null, error: '', muted: false, remoteLabel: '', role: null, status: 'idle' };
const AUDIO_CAPTURE = { autoGainControl: true, channelCount: 1, echoCancellation: true, noiseSuppression: true } as const;
const CALL_TIMEOUT_MS = 45_000;

class CleanVoiceCallService {
  private callContext: ActiveCall | null = null;
  private callStatusTimer: ReturnType<typeof setInterval> | null = null;
  private callTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(state: VoiceCallState) => void>();
  private resetPromise: Promise<void> | null = null;
  private room: Room | null = null;
  private state: VoiceCallState = INITIAL_STATE;
  // Call IDs whose call-data state is owned by CallingShellHost rather than by this
  // service's own backend calls (see acceptIncomingCall).
  private canonicalCallIds = new Set<string>();
  private onMediaConnected: (() => void) | null = null;

  getState() {
    return this.state;
  }

  subscribe(listener: (state: VoiceCallState) => void) {
    this.listeners.add(listener);
    listener(this.state);
    return () => { this.listeners.delete(listener); };
  }

  private setState(next: VoiceCallState) {
    this.state = next;
    this.listeners.forEach((listener) => listener(next));
  }

  private updateState(update: Partial<VoiceCallState>) {
    this.setState({ ...this.state, ...update });
  }

  private async request<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as T & ApiErrorPayload;
    if (!response.ok) throw new VoiceCallError(payload.code || 'request_failed', payload.error || 'Unable to connect. Please try again.');
    return payload;
  }

  async startVoiceCall(options: { callerLanguage: string; contactName: string; defaultRegion?: CountryCode; phoneNumber: string; recipientLanguage: string }) {
    if (this.resetPromise) await this.resetPromise;
    if (this.state.status !== 'idle') throw new VoiceCallError('call_active', 'A voice call is already active.');
    const callerDeviceId = await getDeviceId();
    this.setState({ ...INITIAL_STATE, remoteLabel: options.contactName, role: 'caller', status: 'preparing' });
    InCallManager.startRingback('_DEFAULT_');
    try {
      const response = await this.request<{
        callId: string;
        callerToken: string;
        livekitUrl: string;
        roomName: string;
        translationEnabled: boolean;
      }>('/api/v1/calls/start', {
        callerDeviceId,
        callerLanguage: options.callerLanguage,
        defaultRegion: options.defaultRegion,
        recipientPhoneNumber: options.phoneNumber,
        recipientLanguage: options.recipientLanguage,
        translationMode: 'realtime-translate',
      });
      this.callContext = {
        callId: response.callId,
        livekitUrl: response.livekitUrl,
        remoteLabel: options.contactName,
        role: 'caller',
        roomName: response.roomName,
        token: response.callerToken,
        translationEnabled: response.translationEnabled,
      };
      this.updateState({ callId: response.callId, status: 'ringing' });
      this.startCallStatusPolling(response.callId);
      this.startTimeout();
      await this.connect(this.callContext);
    } catch (error) {
      const voiceError = error instanceof VoiceCallError ? error : new VoiceCallError('call_failed', 'Unable to connect. Please try again.');
      if (voiceError.code === 'recipient_not_registered') await this.resetVoiceCall({ notifyBackend: false });
      else await this.failAndCleanUp(voiceError.message);
      throw voiceError;
    }
  }

  presentIncomingCall(incoming: IncomingVoiceCall) {
    if (!incoming.callId || this.state.status !== 'idle') return false;
    this.callContext = {
      callId: incoming.callId,
      livekitUrl: null,
      remoteLabel: incoming.callerPhoneNumber || 'Interpreter caller',
      role: 'recipient',
      roomName: null,
      token: null,
      translationEnabled: false,
    };
    this.setState({ callId: incoming.callId, error: '', muted: false, remoteLabel: this.callContext.remoteLabel, role: 'recipient', status: 'ringing' });
    this.startCallStatusPolling(incoming.callId);
    InCallManager.turnScreenOn();
    InCallManager.setKeepScreenOn(true);
    InCallManager.startRingtone('_DEFAULT_', [0, 900, 700], 'playback', Math.ceil(CALL_TIMEOUT_MS / 1000));
    this.startTimeout();
    return true;
  }

  // Marks a callId as belonging to CallingShellHost's call-data state rather than to
  // the old /api/v1/calls/* backend. Called by VoiceCallHost the moment it presents a
  // canonical incoming call. Without this, acceptIncomingCall's own OLD-backend
  // request below would always 404 (the id never exists in active_calls) and its
  // catch block would tear down whatever connectMedia concurrently establishes.
  markCanonicalCall(callId: string) {
    this.canonicalCallIds.add(callId);
  }

  async acceptIncomingCall() {
    const call = this.callContext;
    if (!call || call.role !== 'recipient' || this.state.status !== 'ringing') return;
    InCallManager.stopRingtone();
    this.updateState({ status: 'connecting' });
    // The real claim + media connection for canonical calls is driven externally
    // (VoiceCallHost -> CallingShellHost.answerCall + connectMedia). Stop here.
    if (this.canonicalCallIds.has(call.callId)) return;
    try {
      const recipientDeviceId = await getDeviceId();
      const response = await this.request<{ callId: string; livekitUrl: string; recipientToken: string; roomName: string; translationEnabled: boolean }>(
        `/api/v1/calls/${encodeURIComponent(call.callId)}/accept`,
        { recipientDeviceId, translationCapable: true },
      );
      call.livekitUrl = response.livekitUrl;
      call.roomName = response.roomName;
      call.token = response.recipientToken;
      call.translationEnabled = response.translationEnabled;
      await this.connect(call);
    } catch (error) {
      await this.failAndCleanUp(error instanceof Error ? error.message : 'Unable to accept this call.');
    }
  }

  async declineIncomingCall() {
    const call = this.callContext;
    if (!call || call.role !== 'recipient') return;
    const recipientDeviceId = await getDeviceId();
    await this.request<void>(`/api/v1/calls/${encodeURIComponent(call.callId)}/decline`, { recipientDeviceId }).catch(() => undefined);
    await this.resetVoiceCall({ notifyBackend: false });
  }

  async toggleMute() {
    const room = this.room;
    if (!room || room.state !== ConnectionState.Connected) return;
    const nextMuted = !this.state.muted;
    await room.localParticipant.setMicrophoneEnabled(!nextMuted, AUDIO_CAPTURE);
    this.updateState({ muted: nextMuted });
  }

  async endCall() {
    await this.resetVoiceCall({ notifyBackend: true });
  }

  // Media-only entry point for calls whose data/state lives in CallingShellHost.
  // Reuses the exact same connect() mechanics (room setup, track subscription,
  // mic publish, audio session) as startVoiceCall/acceptIncomingCall — nothing
  // about LiveKit connection, translation-track filtering, or audio-session
  // configuration is duplicated or changed. onConnected fires once, the moment the
  // real remote human participant's audio is confirmed (the same instant this
  // service would otherwise set its own status to 'connected').
  async connectMedia(credentials: MediaSessionCredentials, onConnected: () => void) {
    if (this.resetPromise) await this.resetPromise;
    this.markCanonicalCall(credentials.callId);
    this.callContext = {
      callId: credentials.callId,
      livekitUrl: credentials.livekitUrl,
      remoteLabel: credentials.remoteLabel,
      role: credentials.role,
      roomName: credentials.roomName,
      token: credentials.token,
      translationEnabled: credentials.translationEnabled,
    };
    this.onMediaConnected = onConnected;
    if (this.state.status === 'idle') this.setState({ ...INITIAL_STATE, remoteLabel: credentials.remoteLabel, role: credentials.role, status: credentials.role === 'caller' ? 'preparing' : 'connecting' });
    await this.connect(this.callContext);
  }

  // Local-only teardown: releases the LiveKit room and clears call context without
  // making any request to the old backend. Call-data closure (speak_call_sessions)
  // is CallingShellHost's responsibility, not this service's.
  async disconnectMedia() {
    this.onMediaConnected = null;
    const room = this.room;
    const call = this.callContext;
    if (call) this.canonicalCallIds.delete(call.callId);
    this.room = null;
    this.callContext = null;
    this.setState(INITIAL_STATE);
    await this.releaseRoom(room);
  }

  async handleAppForeground() {
    if (this.state.status === 'idle') return;
    const roomActuallyActive = this.room && [ConnectionState.Connecting, ConnectionState.Connected, ConnectionState.Reconnecting].includes(this.room.state);
    const incomingWaiting = this.state.role === 'recipient' && this.state.status === 'ringing' && Boolean(this.callContext);
    const callerPreparing = this.state.role === 'caller' && ['preparing', 'ringing'].includes(this.state.status) && Boolean(this.callContext);
    if (!roomActuallyActive && !incomingWaiting && !callerPreparing) await this.resetVoiceCall({ notifyBackend: true });
  }

  async resetVoiceCall({ notifyBackend = true }: { notifyBackend?: boolean } = {}) {
    if (this.resetPromise) return this.resetPromise;
    this.resetPromise = this.performReset(notifyBackend).finally(() => { this.resetPromise = null; });
    return this.resetPromise;
  }

  private async performReset(notifyBackend: boolean) {
    const call = this.callContext;
    const room = this.room;
    if (this.callTimer) clearTimeout(this.callTimer);
    this.callTimer = null;
    if (this.callStatusTimer) clearInterval(this.callStatusTimer);
    this.callStatusTimer = null;
    InCallManager.stopRingback();
    InCallManager.stopRingtone();
    InCallManager.setKeepScreenOn(false);
    if (call) this.canonicalCallIds.delete(call.callId);
    this.onMediaConnected = null;
    this.callContext = null;
    this.room = null;
    this.setState(INITIAL_STATE);

    const backendCleanup = async () => {
      if (!notifyBackend || !call?.callId) return;
      const deviceId = await getDeviceId().catch(() => '');
      if (deviceId) {
        await this.request<void>(`/api/v1/calls/${encodeURIComponent(call.callId)}/end`, { deviceId }).catch(() => undefined);
      }
    };

    await Promise.all([this.releaseRoom(room), backendCleanup()]);
  }

  private async failAndCleanUp(message: string) {
    const label = this.state.remoteLabel;
    const role = this.state.role;
    await this.resetVoiceCall({ notifyBackend: true });
    this.setState({ callId: null, error: message, muted: false, remoteLabel: label, role, status: 'failed' });
  }

  private startTimeout() {
    if (this.callTimer) clearTimeout(this.callTimer);
    this.callTimer = setTimeout(() => { void this.failAndCleanUp('The call was not answered.'); }, CALL_TIMEOUT_MS);
  }

  private startCallStatusPolling(callId: string) {
    if (this.callStatusTimer) clearInterval(this.callStatusTimer);
    this.callStatusTimer = setInterval(() => {
      void this.pollCallStatus(callId);
    }, 1_000);
  }

  private async pollCallStatus(callId: string) {
    if (this.callContext?.callId !== callId) return;
    // This liveness check only knows the OLD /api/v1/calls/* backend (active_calls).
    // A canonical call's id never exists there, so that endpoint would always report
    // "not found" and this would immediately reset a call that is actually still
    // ringing/active under the new system. Canonical liveness is tracked separately.
    if (this.canonicalCallIds.has(callId)) return;
    const deviceId = await getDeviceId().catch(() => '');
    if (!deviceId) return;
    const response = await fetch(`${API_BASE_URL}/api/v1/calls/${encodeURIComponent(callId)}?deviceId=${encodeURIComponent(deviceId)}`).catch(() => null);
    if (!response?.ok) return;
    const payload = (await response.json().catch(() => ({}))) as { active?: boolean };
    if (payload.active === false) await this.resetVoiceCall({ notifyBackend: false });
  }

  // Single trigger point for "a real remote human's audio is confirmed flowing" —
  // used by both the legacy startVoiceCall/acceptIncomingCall path and the new
  // connectMedia path, so the notification fires from exactly the same place this
  // service already treated as "connected" (no new/duplicated connection logic).
  private markConnected() {
    this.updateState({ status: 'connected' });
    const callback = this.onMediaConnected;
    this.onMediaConnected = null;
    callback?.();
  }

  private async requestMicrophone() {
    if (Platform.OS !== 'android') return;
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    if (result !== PermissionsAndroid.RESULTS.GRANTED) throw new VoiceCallError('microphone_denied', 'Microphone access is required for voice calls.');
  }

  private async connect(call: ActiveCall) {
    if (!call.livekitUrl || !call.token) throw new VoiceCallError('missing_token', 'Unable to connect. Please try again.');
    await this.requestMicrophone();
    // Other features (in-person interpreter mode, voice previews) can leave the shared native
    // audio session claimed. Force a clean reset before configuring it for this call.
    await AudioSession.stopAudioSession().catch(() => undefined);
    await AudioSession.configureAudio({
      android: {
        audioTypeOptions: { ...AndroidAudioTypePresets.communication, forceHandleAudioRouting: true },
        preferredOutputList: ['bluetooth', 'headset', 'speaker', 'earpiece'],
      },
      ios: { defaultOutput: 'speaker' },
    });
    await AudioSession.setDefaultRemoteAudioTrackVolume(1);
    await AudioSession.startAudioSession();
    const room = new Room({
      adaptiveStream: true,
      audioCaptureDefaults: AUDIO_CAPTURE,
      publishDefaults: { audioPreset: AudioPresets.speech, dtx: true, forceStereo: false, red: true },
    });
    this.room = room;
    room.on(RoomEvent.ParticipantConnected, (participant) => {
      if (this.room !== room) return;
      if (participant.identity === `translator:${call.callId}`) return;
      InCallManager.stopRingback();
      InCallManager.stopRingtone();
      if (this.callTimer) clearTimeout(this.callTimer);
      this.callTimer = null;
      this.markConnected();
    });
    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      if (participant.identity === `translator:${call.callId}`) return;
      if (this.room === room) void this.resetVoiceCall({ notifyBackend: true });
    });
    room.on(RoomEvent.TrackPublished, (publication, participant) => {
      publication.setSubscribed(this.shouldSubscribe(call, participant.identity, publication.trackName));
    });
    room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      if (track.kind !== Track.Kind.Audio || this.room !== room) return;
      if (!this.shouldSubscribe(call, participant.identity, publication.trackName)) {
        publication.setSubscribed(false);
        return;
      }
      console.info('[VoiceCall] remote audio subscribed');
      this.markConnected();
    });
    room.on(RoomEvent.Reconnecting, () => {
      if (this.room === room) this.updateState({ status: 'reconnecting' });
    });
    room.on(RoomEvent.Disconnected, () => {
      if (this.room === room) void this.resetVoiceCall({ notifyBackend: true });
    });
    this.updateState({ status: call.role === 'caller' ? 'ringing' : 'connecting' });
    await room.connect(call.livekitUrl, call.token, { autoSubscribe: false, maxRetries: 3 });
    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.audioTrackPublications.values()) {
        publication.setSubscribed(this.shouldSubscribe(call, participant.identity, publication.trackName));
      }
    }
    if (this.room !== room || this.callContext !== call) throw new VoiceCallError('call_ended', 'Call ended.');
    console.info(`[VoiceCall] ${call.role} connected`);
    await room.localParticipant.setMicrophoneEnabled(true, AUDIO_CAPTURE);
    console.info('[VoiceCall] microphone published');
    if (this.callTimer && room.remoteParticipants.size > 0) {
      clearTimeout(this.callTimer);
      this.callTimer = null;
    }
    const humanParticipantConnected = [...room.remoteParticipants.values()].some((participant) => participant.identity !== `translator:${call.callId}`);
    if (humanParticipantConnected) this.markConnected();
    else this.updateState({ status: call.role === 'caller' ? 'ringing' : 'connecting' });
    if (Platform.OS === 'android') await AudioSession.selectAudioOutput('speaker');
    else await AudioSession.selectAudioOutput('force_speaker');
  }

  private shouldSubscribe(call: ActiveCall, participantIdentity: string, trackName: string) {
    if (call.translationEnabled) {
      const isTranslatorParticipant = participantIdentity === `translator:${call.callId}`;
      const isMyTranslatedTrack = trackName === `translation-to-${call.role}`;
      // Raw human mic tracks must stay published for the translation bridge to consume,
      // but only the translator's matching dubbed track may ever be subscribed to here.
      if (!isTranslatorParticipant) return false;
      return isMyTranslatedTrack;
    }
    return participantIdentity !== `translator:${call.callId}`;
  }

  private async releaseRoom(room: Room | null) {
    if (room) {
      room.removeAllListeners();
      // The mic track must be fully, cleanly disabled while the room connection is still
      // alive, not concurrently with disconnect — racing them can leave the native audio
      // capture engine in a state where the next call's setMicrophoneEnabled(true) silently
      // produces no audio, since permission is already granted and nothing errors.
      await room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
      await room.disconnect().catch(() => undefined);
      for (const publication of room.localParticipant.audioTrackPublications.values()) {
        if (publication.track) await room.localParticipant.unpublishTrack(publication.track).catch(() => undefined);
      }
      for (const participant of room.remoteParticipants.values()) {
        for (const publication of participant.audioTrackPublications.values()) {
          publication.track?.detach();
          if (publication.isSubscribed) publication.setSubscribed(false);
        }
      }
    }
    await AudioSession.stopAudioSession().catch(() => undefined);
  }
}

export const VoiceCallService = new CleanVoiceCallService();
