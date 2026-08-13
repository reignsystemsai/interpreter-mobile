import { AndroidAudioTypePresets, AudioSession } from '@livekit/react-native';
import { AudioPresets, Room, RoomEvent, Track } from 'livekit-client';
import { AppState, PermissionsAndroid, Platform } from 'react-native';
import InCallManager from 'react-native-incall-manager';

import { API_BASE_URL } from '../../config/runtime';
import { getDeviceId } from '../../services/deviceRegistration';

export type CallStatus = 'idle' | 'ringing' | 'connecting' | 'connected' | 'ended';
export type CallRole = 'caller' | 'recipient' | null;
export type CallState = {
  callId: string | null;
  error: string;
  remoteLabel: string;
  role: CallRole;
  status: CallStatus;
};

type ActiveCall = {
  callId: string;
  livekitUrl: string;
  remoteLabel: string;
  role: Exclude<CallRole, null>;
  roomName: string;
  token: string;
};

type ApiErrorPayload = { code?: string; error?: string };

export class CallError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'CallError';
  }
}

const INITIAL_STATE: CallState = { callId: null, error: '', remoteLabel: '', role: null, status: 'idle' };
const AUDIO_CAPTURE = { autoGainControl: true, channelCount: 1, echoCancellation: true, noiseSuppression: true } as const;
const POLL_INTERVAL_MS = 2_000;

class BasicCallService {
  private state: CallState = INITIAL_STATE;
  private listeners = new Set<(state: CallState) => void>();
  private call: ActiveCall | null = null;
  private room: Room | null = null;
  private connectingCallId: string | null = null;
  private handledIncomingCallIds = new Set<string>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  getState() {
    return this.state;
  }

  subscribe(listener: (state: CallState) => void) {
    this.listeners.add(listener);
    listener(this.state);
    return () => { this.listeners.delete(listener); };
  }

  private setState(next: CallState) {
    this.state = next;
    for (const listener of [...this.listeners]) listener(next);
  }

  private update(patch: Partial<CallState>) {
    this.setState({ ...this.state, ...patch });
  }

  private async request<T>(path: string, method: 'GET' | 'POST', body?: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = (await response.json().catch(() => ({}))) as T & ApiErrorPayload;
    if (!response.ok) throw new CallError(payload.code || 'request_failed', payload.error || 'Unable to connect. Please try again.');
    return payload;
  }

  // ---- Starting a call (caller side) ----

  async createCall(recipientPhoneNumber: string, remoteLabel: string) {
    if (this.state.status !== 'idle') throw new CallError('call_active', 'A call is already active on this device.');
    const callerDeviceId = await getDeviceId();
    this.setState({ ...INITIAL_STATE, remoteLabel, role: 'caller', status: 'ringing' });
    InCallManager.startRingback('_DEFAULT_');
    try {
      const response = await this.request<{ id: string; livekitUrl: string; roomName: string; token: string }>('/api/v1/calls', 'POST', {
        callerDeviceId,
        recipientPhoneNumber,
      });
      this.call = { callId: response.id, livekitUrl: response.livekitUrl, remoteLabel, role: 'caller', roomName: response.roomName, token: response.token };
      this.update({ callId: response.id });
    } catch (error) {
      InCallManager.stopRingback();
      const callError = error instanceof CallError ? error : new CallError('call_failed', 'Unable to connect. Please try again.');
      await this.hangup({ notifyBackend: Boolean(this.call) });
      throw callError;
    }
  }

  // ---- Receiving a call (recipient side) ----

  presentIncoming(callId: string, callerPhoneNumber: string) {
    if (this.state.status !== 'idle') return false;
    this.setState({ callId, error: '', remoteLabel: callerPhoneNumber, role: 'recipient', status: 'ringing' });
    InCallManager.startRingtone('_DEFAULT_');
    return true;
  }

  async acceptCall() {
    if (this.state.status !== 'ringing' || this.state.role !== 'recipient' || !this.state.callId) return;
    const callId = this.state.callId;
    const recipientDeviceId = await getDeviceId();
    InCallManager.stopRingtone();
    this.update({ status: 'connecting' });
    try {
      const response = await this.request<{ livekitUrl: string; roomName: string; token: string }>(`/api/v1/calls/${encodeURIComponent(callId)}/accept`, 'POST', {
        deviceId: recipientDeviceId,
      });
      this.call = { callId, livekitUrl: response.livekitUrl, remoteLabel: this.state.remoteLabel, role: 'recipient', roomName: response.roomName, token: response.token };
      await this.connect(this.call);
    } catch (error) {
      const callError = error instanceof CallError ? error : new CallError('call_failed', 'Unable to answer the call.');
      await this.hangup({ notifyBackend: true });
      throw callError;
    }
  }

  async declineCall() {
    if (this.state.status !== 'ringing' || this.state.role !== 'recipient' || !this.state.callId) return;
    InCallManager.stopRingtone();
    await this.hangup({ notifyBackend: true, endpoint: 'decline' });
  }

  // ---- Ending a call (either role, any state) ----

  async endCall() {
    if (this.state.status === 'idle') return;
    InCallManager.stopRingback();
    InCallManager.stopRingtone();
    await this.hangup({ notifyBackend: true, endpoint: 'end' });
  }

  private async hangup({ endpoint = 'end', notifyBackend }: { endpoint?: 'decline' | 'end'; notifyBackend: boolean }) {
    const callId = this.state.callId;
    const deviceId = notifyBackend && callId ? await getDeviceId().catch(() => null) : null;
    this.connectingCallId = null;
    await this.releaseRoom();
    this.call = null;
    this.setState(INITIAL_STATE);
    if (deviceId && callId) {
      await this.request(`/api/v1/calls/${encodeURIComponent(callId)}/${endpoint}`, 'POST', { deviceId }).catch(() => undefined);
    }
  }

  // ---- LiveKit media ----

  private async requestMicrophone() {
    if (Platform.OS !== 'android') return;
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    if (result !== PermissionsAndroid.RESULTS.GRANTED) throw new CallError('microphone_denied', 'Microphone access is required for calls.');
  }

  private async connect(call: ActiveCall) {
    this.connectingCallId = call.callId;
    await this.requestMicrophone();
    if (Platform.OS === 'android') await AudioSession.stopAudioSession().catch(() => undefined);
    await AudioSession.configureAudio({
      android: { audioTypeOptions: { ...AndroidAudioTypePresets.communication, forceHandleAudioRouting: true }, preferredOutputList: ['bluetooth', 'headset', 'speaker', 'earpiece'] },
      ios: { defaultOutput: 'speaker' },
    });
    await AudioSession.setDefaultRemoteAudioTrackVolume(1);
    if (Platform.OS === 'android') await AudioSession.startAudioSession();

    const room = new Room({ adaptiveStream: true, audioCaptureDefaults: AUDIO_CAPTURE, publishDefaults: { audioPreset: AudioPresets.speech, dtx: true } });
    this.room = room;

    const markConnected = () => {
      if (this.room !== room) return;
      InCallManager.stopRingback();
      InCallManager.stopRingtone();
      this.update({ status: 'connected' });
    };

    room.on(RoomEvent.ParticipantConnected, markConnected);
    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === Track.Kind.Audio) markConnected();
    });
    room.on(RoomEvent.ParticipantDisconnected, () => {
      if (this.room === room) void this.hangup({ notifyBackend: true });
    });
    room.on(RoomEvent.Disconnected, () => {
      if (this.room === room) void this.hangup({ notifyBackend: true });
    });

    await room.connect(call.livekitUrl, call.token, { autoSubscribe: true, maxRetries: 3 });
    if (this.room !== room || this.call !== call) throw new CallError('call_ended', 'Call ended.');
    await room.localParticipant.setMicrophoneEnabled(true, AUDIO_CAPTURE);
    if (Platform.OS === 'android') await AudioSession.selectAudioOutput('speaker');
    if (room.remoteParticipants.size > 0) markConnected();
    else this.update({ status: 'connecting' });
    this.connectingCallId = null;
  }

  private async releaseRoom() {
    const room = this.room;
    this.room = null;
    if (room) {
      room.removeAllListeners();
      await room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
      await room.disconnect().catch(() => undefined);
    }
    if (Platform.OS === 'android') await AudioSession.stopAudioSession().catch(() => undefined);
    InCallManager.stopRingback();
    InCallManager.stopRingtone();
  }

  // ---- Discovery (foreground polling — the sole discovery mechanism; no push yet) ----

  private async pollIncoming() {
    if (AppState.currentState !== 'active' || this.state.status !== 'idle') return;
    const deviceId = await getDeviceId();
    const response = await fetch(`${API_BASE_URL}/api/v1/calls/incoming?deviceId=${encodeURIComponent(deviceId)}`);
    if (!response.ok) return;
    const payload = (await response.json()) as { callId?: string; callerPhoneNumber?: string; incoming?: boolean };
    if (!payload.incoming || !payload.callId || this.handledIncomingCallIds.has(payload.callId)) return;
    if (this.presentIncoming(payload.callId, payload.callerPhoneNumber || 'Unknown caller')) this.handledIncomingCallIds.add(payload.callId);
  }

  // Before both sides are connected in the same LiveKit room, there is no
  // LiveKit-level signal for "the other side hung up" — most importantly a
  // caller still waiting for pickup while the recipient declines, or a
  // recipient still looking at the ringing screen while the caller cancels.
  // This poll is that missing signal.
  private async pollStatus() {
    const { callId, status } = this.state;
    if (!callId || (status !== 'ringing' && status !== 'connecting')) return;
    const deviceId = await getDeviceId().catch(() => '');
    if (!deviceId) return;
    const response = await fetch(`${API_BASE_URL}/api/v1/calls/${encodeURIComponent(callId)}?deviceId=${encodeURIComponent(deviceId)}`).catch(() => null);
    if (!response?.ok) return;
    const payload = (await response.json().catch(() => ({}))) as { call?: { status?: string }; found?: boolean };
    const remoteEnded = payload.found === false || payload.call?.status === 'ended';
    if (remoteEnded && this.state.callId === callId) await this.hangup({ notifyBackend: false });
    const remoteConnected = payload.call?.status === 'connected';
    if (
      remoteConnected &&
      this.state.callId === callId &&
      this.state.role === 'caller' &&
      this.state.status === 'ringing' &&
      this.call?.callId === callId &&
      !this.room &&
      this.connectingCallId !== callId
    ) {
      this.update({ status: 'connecting' });
      try {
        await this.connect(this.call);
      } catch (error) {
        const callError = error instanceof CallError ? error : new CallError('call_failed', 'Unable to connect. Please try again.');
        await this.hangup({ notifyBackend: true });
        throw callError;
      }
    }
  }

  startPolling() {
    this.stopPolling();
    void this.pollIncoming().catch(() => undefined);
    this.pollTimer = setInterval(() => {
      void this.pollIncoming().catch(() => undefined);
      void this.pollStatus().catch(() => undefined);
    }, POLL_INTERVAL_MS);
    return () => this.stopPolling();
  }

  stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }
}

export const CallService = new BasicCallService();
