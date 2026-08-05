import { AndroidAudioTypePresets, AudioSession } from '@livekit/react-native';
import type { CountryCode } from 'libphonenumber-js';
import { AudioPresets, ConnectionState, Room, RoomEvent, Track, type VideoTrack } from 'livekit-client';
import { PermissionsAndroid, Platform } from 'react-native';
import InCallManager from 'react-native-incall-manager';

import { API_BASE_URL } from '../../config/runtime';
import { getDeviceId } from '../../services/deviceRegistration';

export type VoiceCallStatus = 'idle' | 'preparing' | 'ringing' | 'connecting' | 'connected' | 'reconnecting' | 'ending' | 'ended' | 'failed';
export type VoiceCallRole = 'caller' | 'recipient' | null;
export type InterpreterCallType = 'voice' | 'video';
export type VoiceCallState = {
  callType: InterpreterCallType;
  callId: string | null;
  cameraEnabled: boolean;
  error: string;
  localVideoTrack: VideoTrack | null;
  muted: boolean;
  remoteVideoTrack: VideoTrack | null;
  remoteLabel: string;
  role: VoiceCallRole;
  status: VoiceCallStatus;
};

type ActiveCall = {
  callType: InterpreterCallType;
  callId: string;
  roomName: string | null;
  livekitUrl: string | null;
  remoteLabel: string;
  role: Exclude<VoiceCallRole, null>;
  token: string | null;
};

export type IncomingVoiceCall = {
  callId: string;
  callType?: InterpreterCallType;
  callerPhoneNumber: string;
};

type ApiErrorPayload = { code?: string; error?: string };

export class VoiceCallError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'VoiceCallError';
  }
}

const INITIAL_STATE: VoiceCallState = { callId: null, callType: 'voice', cameraEnabled: false, error: '', localVideoTrack: null, muted: false, remoteLabel: '', remoteVideoTrack: null, role: null, status: 'idle' };
const AUDIO_CAPTURE = { autoGainControl: true, channelCount: 1, echoCancellation: true, noiseSuppression: true } as const;
const CALL_TIMEOUT_MS = 45_000;

class CleanVoiceCallService {
  private callContext: ActiveCall | null = null;
  private callTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(state: VoiceCallState) => void>();
  private resetPromise: Promise<void> | null = null;
  private room: Room | null = null;
  private state: VoiceCallState = INITIAL_STATE;

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

  async startVoiceCall(options: { contactName: string; defaultRegion?: CountryCode; phoneNumber: string }) {
    return this.startCall(options, 'voice');
  }

  async startVideoCall(options: { contactName: string; defaultRegion?: CountryCode; phoneNumber: string }) {
    return this.startCall(options, 'video');
  }

  private async startCall(options: { contactName: string; defaultRegion?: CountryCode; phoneNumber: string }, callType: InterpreterCallType) {
    if (this.state.status !== 'idle') throw new VoiceCallError('call_active', 'A call is already active.');
    const callerDeviceId = await getDeviceId();
    this.setState({ ...INITIAL_STATE, callType, remoteLabel: options.contactName, role: 'caller', status: 'preparing' });
    InCallManager.startRingback('_DEFAULT_');
    try {
      const response = await this.request<{
        callId: string;
        callerToken: string;
        livekitUrl: string;
        roomName: string;
      }>('/api/v1/calls/start', {
        callerDeviceId,
        callType,
        defaultRegion: options.defaultRegion,
        recipientPhoneNumber: options.phoneNumber,
      });
      this.callContext = {
        callId: response.callId,
        callType,
        livekitUrl: response.livekitUrl,
        remoteLabel: options.contactName,
        role: 'caller',
        roomName: response.roomName,
        token: response.callerToken,
      };
      this.updateState({ callId: response.callId, status: 'ringing' });
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
      callType: incoming.callType === 'video' ? 'video' : 'voice',
      livekitUrl: null,
      remoteLabel: incoming.callerPhoneNumber || 'Interpreter caller',
      role: 'recipient',
      roomName: null,
      token: null,
    };
    this.setState({ ...INITIAL_STATE, callId: incoming.callId, callType: this.callContext.callType, remoteLabel: this.callContext.remoteLabel, role: 'recipient', status: 'ringing' });
    InCallManager.turnScreenOn();
    InCallManager.setKeepScreenOn(true);
    InCallManager.startRingtone('_DEFAULT_', [0, 900, 700], 'playback', Math.ceil(CALL_TIMEOUT_MS / 1000));
    this.startTimeout();
    return true;
  }

  async acceptIncomingCall() {
    const call = this.callContext;
    if (!call || call.role !== 'recipient' || this.state.status !== 'ringing') return;
    InCallManager.stopRingtone();
    this.updateState({ status: 'connecting' });
    try {
      const recipientDeviceId = await getDeviceId();
      const response = await this.request<{ callId: string; livekitUrl: string; recipientToken: string; roomName: string }>(
        `/api/v1/calls/${encodeURIComponent(call.callId)}/accept`,
        { recipientDeviceId },
      );
      call.livekitUrl = response.livekitUrl;
      call.roomName = response.roomName;
      call.token = response.recipientToken;
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

  async toggleCamera() {
    const room = this.room;
    if (!room || this.state.callType !== 'video' || room.state !== ConnectionState.Connected) return;
    const nextEnabled = !this.state.cameraEnabled;
    const publication = await room.localParticipant.setCameraEnabled(nextEnabled);
    this.updateState({ cameraEnabled: nextEnabled, localVideoTrack: nextEnabled ? publication?.videoTrack ?? null : null });
  }

  async endCall() {
    await this.resetVoiceCall({ notifyBackend: true });
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
    InCallManager.stopRingback();
    InCallManager.stopRingtone();
    InCallManager.setKeepScreenOn(false);
    this.callContext = null;
    this.room = null;
    if (this.state.status !== 'idle') this.updateState({ status: 'ending' });
    await this.releaseRoom(room);
    if (notifyBackend && call?.callId) {
      const deviceId = await getDeviceId().catch(() => '');
      if (deviceId) {
        await this.request<void>(`/api/v1/calls/${encodeURIComponent(call.callId)}/end`, { deviceId }).catch(() => undefined);
      }
    }
    this.setState(INITIAL_STATE);
  }

  private async failAndCleanUp(message: string) {
    const callType = this.state.callType;
    const label = this.state.remoteLabel;
    const role = this.state.role;
    await this.resetVoiceCall({ notifyBackend: true });
    this.setState({ ...INITIAL_STATE, callType, error: message, remoteLabel: label, role, status: 'failed' });
  }

  private startTimeout() {
    if (this.callTimer) clearTimeout(this.callTimer);
    this.callTimer = setTimeout(() => { void this.failAndCleanUp('The call was not answered.'); }, CALL_TIMEOUT_MS);
  }

  private async requestMediaPermissions(callType: InterpreterCallType) {
    if (Platform.OS !== 'android') return;
    const permissions = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
    if (callType === 'video') permissions.push(PermissionsAndroid.PERMISSIONS.CAMERA);
    const results = await PermissionsAndroid.requestMultiple(permissions);
    if (results[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] !== PermissionsAndroid.RESULTS.GRANTED) throw new VoiceCallError('microphone_denied', 'Microphone access is required for calls.');
    if (callType === 'video' && results[PermissionsAndroid.PERMISSIONS.CAMERA] !== PermissionsAndroid.RESULTS.GRANTED) throw new VoiceCallError('camera_denied', 'Camera access is required for video calls.');
  }

  private async connect(call: ActiveCall) {
    if (!call.livekitUrl || !call.token) throw new VoiceCallError('missing_token', 'Unable to connect. Please try again.');
    await this.requestMediaPermissions(call.callType);
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
    room.on(RoomEvent.ParticipantConnected, () => {
      if (this.room !== room) return;
      InCallManager.stopRingback();
      InCallManager.stopRingtone();
      if (this.callTimer) clearTimeout(this.callTimer);
      this.callTimer = null;
      this.updateState({ status: 'connected' });
    });
    room.on(RoomEvent.ParticipantDisconnected, () => {
      if (this.room === room) void this.resetVoiceCall({ notifyBackend: true });
    });
    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (this.room !== room) return;
      if (track.kind === Track.Kind.Video) {
        this.updateState({ remoteVideoTrack: track as VideoTrack });
        return;
      }
      if (track.kind === Track.Kind.Audio) {
        console.info('[VoiceCall] remote audio subscribed');
        this.updateState({ status: 'connected' });
      }
    });
    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      if (this.room === room && track.kind === Track.Kind.Video) this.updateState({ remoteVideoTrack: null });
    });
    room.on(RoomEvent.Reconnecting, () => {
      if (this.room === room) this.updateState({ status: 'reconnecting' });
    });
    room.on(RoomEvent.Disconnected, () => {
      if (this.room === room) void this.resetVoiceCall({ notifyBackend: true });
    });
    this.updateState({ status: call.role === 'caller' ? 'ringing' : 'connecting' });
    await room.connect(call.livekitUrl, call.token, { autoSubscribe: true, maxRetries: 3 });
    if (this.room !== room || this.callContext !== call) throw new VoiceCallError('call_ended', 'Call ended.');
    console.info(`[VoiceCall] ${call.role} connected`);
    await room.localParticipant.setMicrophoneEnabled(true, AUDIO_CAPTURE);
    console.info('[VoiceCall] microphone published');
    if (call.callType === 'video') {
      const cameraPublication = await room.localParticipant.setCameraEnabled(true);
      this.updateState({ cameraEnabled: true, localVideoTrack: cameraPublication?.videoTrack ?? null });
      console.info('[VideoCall] camera published');
    }
    if (this.callTimer && room.remoteParticipants.size > 0) {
      clearTimeout(this.callTimer);
      this.callTimer = null;
    }
    this.updateState({ status: room.remoteParticipants.size > 0 ? 'connected' : call.role === 'caller' ? 'ringing' : 'connected' });
    if (Platform.OS === 'android') await AudioSession.selectAudioOutput('speaker');
    else await AudioSession.selectAudioOutput('force_speaker');
  }

  private async releaseRoom(room: Room | null) {
    if (room) {
      await room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
      await room.localParticipant.setCameraEnabled(false).catch(() => undefined);
      for (const publication of room.localParticipant.audioTrackPublications.values()) {
        if (publication.track) await room.localParticipant.unpublishTrack(publication.track).catch(() => undefined);
      }
      for (const publication of room.localParticipant.videoTrackPublications.values()) {
        if (publication.track) await room.localParticipant.unpublishTrack(publication.track).catch(() => undefined);
      }
      for (const participant of room.remoteParticipants.values()) {
        for (const publication of participant.audioTrackPublications.values()) {
          publication.track?.detach();
          if (publication.isSubscribed) publication.setSubscribed(false);
        }
        for (const publication of participant.videoTrackPublications.values()) {
          publication.track?.detach();
          if (publication.isSubscribed) publication.setSubscribed(false);
        }
      }
      room.removeAllListeners();
      await room.disconnect().catch(() => undefined);
    }
    await AudioSession.stopAudioSession().catch(() => undefined);
  }
}

export const VoiceCallService = new CleanVoiceCallService();
