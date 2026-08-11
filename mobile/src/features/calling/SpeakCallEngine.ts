import { AndroidAudioTypePresets, AudioSession } from '@livekit/react-native';
import { Camera } from 'expo-camera';
import type { CountryCode } from 'libphonenumber-js';
import { AudioPresets, ConnectionState, Room, RoomEvent, Track } from 'livekit-client';
import { Platform } from 'react-native';

import { API_BASE_URL } from '../../config/runtime';
import { getDeviceId } from '../../services/deviceRegistration';

export type SpeakCallStatus = 'idle' | 'calling' | 'ringing' | 'connecting' | 'connected' | 'reconnecting' | 'ending' | 'ended' | 'failed';
export type SpeakCallRole = 'caller' | 'recipient' | null;

export type SpeakCallState = {
  callId: string | null;
  error: string;
  muted: boolean;
  remoteConnected: boolean;
  remoteLabel: string;
  role: SpeakCallRole;
  speakerEnabled: boolean;
  status: SpeakCallStatus;
};

export type PlaceCallOptions = {
  callerLanguage: string;
  contactName: string;
  defaultRegion?: CountryCode;
  mode: string;
  phoneNumber: string;
  recipientLanguage: string;
  voiceGender?: 'female' | 'male';
};

export type IncomingSpeakCall = { callId: string; callerPhoneNumber: string };

type ActiveCall = {
  callId: string;
  livekitUrl: string | null;
  remoteLabel: string;
  role: Exclude<SpeakCallRole, null>;
  roomName: string | null;
  token: string | null;
};

type ApiErrorPayload = { code?: string; error?: string };

export class SpeakCallError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'SpeakCallError';
  }
}

const INITIAL_STATE: SpeakCallState = {
  callId: null,
  error: '',
  muted: false,
  remoteConnected: false,
  remoteLabel: '',
  role: null,
  speakerEnabled: false,
  status: 'idle',
};

const AUDIO_CAPTURE = {
  autoGainControl: true,
  channelCount: 1,
  echoCancellation: true,
  noiseSuppression: true,
} as const;
const CALL_TIMEOUT_MS = 60_000;

class SpeakCallEngine {
  private call: ActiveCall | null = null;
  private callStatusTimer: ReturnType<typeof setInterval> | null = null;
  private callTimer: ReturnType<typeof setTimeout> | null = null;
  private cleanupPromise: Promise<void> | null = null;
  private endingPromise: Promise<void> | null = null;
  private listeners = new Set<(state: SpeakCallState) => void>();
  private room: Room | null = null;
  private state: SpeakCallState = INITIAL_STATE;

  getState() { return this.state; }
  getRoom() { return this.room; }

  subscribe(listener: (state: SpeakCallState) => void) {
    this.listeners.add(listener);
    listener(this.state);
    return () => { this.listeners.delete(listener); };
  }

  private setState(next: SpeakCallState) {
    this.state = next;
    this.listeners.forEach((listener) => listener(next));
  }

  private updateState(update: Partial<SpeakCallState>) {
    this.setState({ ...this.state, ...update });
  }

  private async request<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as T & ApiErrorPayload;
    if (!response.ok) throw new SpeakCallError(payload.code || 'request_failed', payload.error || 'Unable to connect. Please try again.');
    return payload;
  }

  async placeCall(options: PlaceCallOptions) {
    if (this.state.status !== 'idle') throw new SpeakCallError('call_active', 'A call is already active.');
    await this.requestMediaPermissions(false);
    const callerDeviceId = await getDeviceId();
    this.setState({ ...INITIAL_STATE, remoteLabel: options.contactName, role: 'caller', status: 'calling' });
    try {
      const response = await this.request<{ callId: string; callerToken: string; livekitUrl: string; roomName: string }>('/api/v1/calls/start', {
        callerDeviceId,
        defaultRegion: options.defaultRegion,
        recipientPhoneNumber: options.phoneNumber,
      });
      const call: ActiveCall = {
        callId: response.callId,
        livekitUrl: response.livekitUrl,
        remoteLabel: options.contactName,
        role: 'caller',
        roomName: response.roomName,
        token: response.callerToken,
      };
      this.call = call;
      this.updateState({ callId: call.callId, status: 'ringing' });
      this.startStatusPolling(call.callId);
      this.startTimeout();
      await this.connect(call);
    } catch (error) {
      const failure = error instanceof SpeakCallError ? error : new SpeakCallError('call_failed', 'Unable to connect. Please try again.');
      await this.fail(failure.message);
      throw failure;
    }
  }

  receiveIncomingCall(incoming: IncomingSpeakCall) {
    if (!incoming.callId || this.state.status !== 'idle') return false;
    this.call = {
      callId: incoming.callId,
      livekitUrl: null,
      remoteLabel: incoming.callerPhoneNumber || 'Speak caller',
      role: 'recipient',
      roomName: null,
      token: null,
    };
    this.setState({ ...INITIAL_STATE, callId: incoming.callId, remoteLabel: this.call.remoteLabel, role: 'recipient', status: 'ringing' });
    this.startStatusPolling(incoming.callId);
    this.startTimeout();
    return true;
  }

  async answerCall() {
    const call = this.call;
    if (!call || call.role !== 'recipient' || this.state.status !== 'ringing') return;
    this.updateState({ status: 'connecting' });
    try {
      await this.requestMediaPermissions(false);
      const recipientDeviceId = await getDeviceId();
      const response = await this.request<{ callId: string; livekitUrl: string; recipientToken: string; roomName: string }>(`/api/v1/calls/${encodeURIComponent(call.callId)}/accept`, { recipientDeviceId });
      call.livekitUrl = response.livekitUrl;
      call.roomName = response.roomName;
      call.token = response.recipientToken;
      await this.connect(call);
    } catch (error) {
      await this.fail(error instanceof Error ? error.message : 'Unable to answer this call.');
    }
  }

  async declineCall() {
    const call = this.call;
    if (!call || call.role !== 'recipient') return;
    const deviceId = await getDeviceId().catch(() => '');
    await this.cleanup();
    if (deviceId) await this.request<void>(`/api/v1/calls/${encodeURIComponent(call.callId)}/decline`, { recipientDeviceId: deviceId }).catch(() => undefined);
  }

  async endCall() {
    if (this.endingPromise) return this.endingPromise;
    const call = this.call;
    this.updateState({ status: 'ending' });
    this.endingPromise = (async () => {
      await this.cleanup();
      if (!call?.callId) return;
      const deviceId = await getDeviceId().catch(() => '');
      if (deviceId) await this.request<void>(`/api/v1/calls/${encodeURIComponent(call.callId)}/end`, { deviceId }).catch(() => undefined);
    })().finally(() => { this.endingPromise = null; });
    return this.endingPromise;
  }

  async dismiss() { await this.cleanup(); }

  async toggleMute() {
    if (!this.room || this.room.state !== ConnectionState.Connected) return;
    const muted = !this.state.muted;
    await this.room.localParticipant.setMicrophoneEnabled(!muted, AUDIO_CAPTURE);
    this.updateState({ muted });
  }

  async toggleSpeaker() {
    const speakerEnabled = !this.state.speakerEnabled;
    const output = Platform.OS === 'ios' ? (speakerEnabled ? 'force_speaker' : 'default') : (speakerEnabled ? 'speaker' : 'earpiece');
    await AudioSession.selectAudioOutput(output).catch(() => undefined);
    this.updateState({ speakerEnabled });
  }

  async handleAppForeground() {
    if (this.state.status === 'idle') return;
    const roomActive = this.room && [ConnectionState.Connecting, ConnectionState.Connected, ConnectionState.Reconnecting].includes(this.room.state);
    const waiting = ['calling', 'ringing'].includes(this.state.status) && Boolean(this.call);
    if (!roomActive && !waiting) await this.endCall();
  }

  async requestMediaPermissions(_includeCamera: boolean) {
    const current = await Camera.getMicrophonePermissionsAsync();
    const microphone = current.granted ? current : await Camera.requestMicrophonePermissionsAsync();
    if (!microphone.granted) throw new SpeakCallError('microphone_denied', 'Allow microphone access in Settings to place this call.');
  }

  private async connect(call: ActiveCall) {
    if (!call.livekitUrl || !call.token) throw new SpeakCallError('missing_token', 'Unable to connect. Please try again.');
    await AudioSession.stopAudioSession().catch(() => undefined);
    if (Platform.OS === 'android') {
      await AudioSession.configureAudio({
        android: {
          audioTypeOptions: AndroidAudioTypePresets.communication,
          preferredOutputList: ['headset', 'earpiece', 'speaker'],
        },
      });
    }
    await AudioSession.startAudioSession();

    const room = new Room({
      adaptiveStream: false,
      audioCaptureDefaults: AUDIO_CAPTURE,
      dynacast: false,
      publishDefaults: { audioPreset: AudioPresets.speech, dtx: true, forceStereo: false, red: true },
    });
    this.room = room;
    this.attachRoomEvents(room);
    await room.connect(call.livekitUrl, call.token, { autoSubscribe: true, maxRetries: 3 });
    if (this.room !== room || this.call !== call) throw new SpeakCallError('call_ended', 'Call ended.');
    const microphone = await room.localParticipant.setMicrophoneEnabled(true, AUDIO_CAPTURE);
    if (!microphone || microphone.source !== Track.Source.Microphone || microphone.isMuted) {
      throw new SpeakCallError('microphone_publish_failed', 'The microphone could not start. Please try again.');
    }
    if (Platform.OS === 'android') await AudioSession.selectAudioOutput('earpiece').catch(() => undefined);
    if (room.remoteParticipants.size > 0) this.markConnected();
  }

  private attachRoomEvents(room: Room) {
    room.on(RoomEvent.ParticipantConnected, () => { if (this.room === room) this.markConnected(); });
    room.on(RoomEvent.ParticipantDisconnected, () => { if (this.room === room) void this.endCall(); });
    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (this.room === room && track.kind === Track.Kind.Audio) this.markConnected();
    });
    room.on(RoomEvent.Reconnecting, () => { if (this.room === room) this.updateState({ status: 'reconnecting' }); });
    room.on(RoomEvent.Reconnected, () => { if (this.room === room) this.updateState({ status: 'connected' }); });
    room.on(RoomEvent.Disconnected, () => { if (this.room === room) void this.cleanup(); });
  }

  private markConnected() {
    if (this.callTimer) clearTimeout(this.callTimer);
    this.callTimer = null;
    this.updateState({ remoteConnected: true, status: 'connected' });
  }

  private startTimeout() {
    if (this.callTimer) clearTimeout(this.callTimer);
    this.callTimer = setTimeout(() => { void this.fail('The call was not answered.'); }, CALL_TIMEOUT_MS);
  }

  private startStatusPolling(callId: string) {
    if (this.callStatusTimer) clearInterval(this.callStatusTimer);
    this.callStatusTimer = setInterval(() => { void this.pollStatus(callId); }, 2_000);
  }

  private async pollStatus(callId: string) {
    if (this.call?.callId !== callId) return;
    const deviceId = await getDeviceId().catch(() => '');
    if (!deviceId) return;
    const response = await fetch(`${API_BASE_URL}/api/v1/calls/${encodeURIComponent(callId)}?deviceId=${encodeURIComponent(deviceId)}`).catch(() => null);
    if (!response?.ok) return;
    const payload = (await response.json().catch(() => ({}))) as { active?: boolean };
    if (payload.active === false) await this.cleanup();
  }

  private async fail(message: string) {
    const remoteLabel = this.state.remoteLabel;
    const role = this.state.role;
    await this.endCall().catch(() => this.cleanup());
    this.setState({ ...INITIAL_STATE, error: message, remoteLabel, role, status: 'failed' });
  }

  private async cleanup() {
    if (this.cleanupPromise) return this.cleanupPromise;
    this.cleanupPromise = (async () => {
      if (this.callTimer) clearTimeout(this.callTimer);
      if (this.callStatusTimer) clearInterval(this.callStatusTimer);
      this.callTimer = null;
      this.callStatusTimer = null;
      const room = this.room;
      this.room = null;
      this.call = null;
      this.setState(INITIAL_STATE);
      if (room) {
        room.removeAllListeners();
        await room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
        await room.disconnect().catch(() => undefined);
      }
      await AudioSession.stopAudioSession().catch(() => undefined);
    })().finally(() => { this.cleanupPromise = null; });
    return this.cleanupPromise;
  }
}

export const speakCallEngine = new SpeakCallEngine();
