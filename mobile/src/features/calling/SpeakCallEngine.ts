import { AndroidAudioTypePresets, AudioSession } from '@livekit/react-native';
import { Camera } from 'expo-camera';
import type { CountryCode } from 'libphonenumber-js';
import { AudioPresets, ConnectionState, Room, RoomEvent, Track } from 'livekit-client';
import InCallManager from 'react-native-incall-manager';

import { API_BASE_URL } from '../../config/runtime';
import { getDeviceId } from '../../services/deviceRegistration';

export type SpeakCallStatus = 'idle' | 'calling' | 'ringing' | 'connecting' | 'connected' | 'reconnecting' | 'ending' | 'ended' | 'failed';
export type SpeakCallRole = 'caller' | 'recipient' | null;
export type SpeakCallMode = 'voice' | 'video' | 'interpreter';

export type SpeakCallState = {
  callId: string | null;
  callMode: SpeakCallMode;
  cameraFacing: 'front' | 'back';
  error: string;
  interpreterEnabled: boolean;
  muted: boolean;
  remoteConnected: boolean;
  remoteLabel: string;
  remoteVideoAvailable: boolean;
  role: SpeakCallRole;
  speakerEnabled: boolean;
  status: SpeakCallStatus;
  videoEnabled: boolean;
};

export type PlaceCallOptions = {
  callerLanguage: string;
  contactName: string;
  defaultRegion?: CountryCode;
  mode: SpeakCallMode;
  phoneNumber: string;
  recipientLanguage: string;
  voiceGender?: 'female' | 'male';
};

export type IncomingSpeakCall = {
  callId: string;
  callerPhoneNumber: string;
  callMode?: SpeakCallMode;
};

type ActiveCall = {
  callId: string;
  callMode: SpeakCallMode;
  livekitUrl: string | null;
  remoteLabel: string;
  role: Exclude<SpeakCallRole, null>;
  roomName: string | null;
  token: string | null;
  translationEnabled: boolean;
  voiceGender: 'female' | 'male';
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
  callMode: 'voice',
  cameraFacing: 'front',
  error: '',
  interpreterEnabled: false,
  muted: false,
  remoteConnected: false,
  remoteLabel: '',
  remoteVideoAvailable: false,
  role: null,
  speakerEnabled: false,
  status: 'idle',
  videoEnabled: false,
};

const AUDIO_CAPTURE = { autoGainControl: true, channelCount: 1, echoCancellation: true, noiseSuppression: true } as const;
const CALL_TIMEOUT_MS = 45_000;

class SpeakCallEngine {
  private call: ActiveCall | null = null;
  private callStatusTimer: ReturnType<typeof setInterval> | null = null;
  private callTimer: ReturnType<typeof setTimeout> | null = null;
  private endingPromise: Promise<void> | null = null;
  private listeners = new Set<(state: SpeakCallState) => void>();
  private room: Room | null = null;
  private state: SpeakCallState = INITIAL_STATE;

  getState() {
    return this.state;
  }

  getRoom() {
    return this.room;
  }

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
    await this.requestMediaPermissions(options.mode === 'video');
    const callerDeviceId = await getDeviceId();
    this.setState({
      ...INITIAL_STATE,
      callMode: options.mode,
      interpreterEnabled: options.mode === 'interpreter',
      remoteLabel: options.contactName,
      role: 'caller',
      status: 'calling',
      videoEnabled: options.mode === 'video',
    });
    InCallManager.startRingback('_DEFAULT_');
    try {
      const response = await this.request<{
        callId: string;
        callerToken: string;
        callMode?: SpeakCallMode;
        livekitUrl: string;
        roomName: string;
        translationEnabled: boolean;
      }>('/api/v1/calls/start', {
        callerDeviceId,
        callerLanguage: options.callerLanguage,
        callType: options.mode,
        defaultRegion: options.defaultRegion,
        recipientPhoneNumber: options.phoneNumber,
        recipientLanguage: options.recipientLanguage,
        translationMode: options.mode === 'interpreter' ? 'realtime-translate' : 'plain',
        voiceGender: options.voiceGender ?? 'male',
      });
      this.call = {
        callId: response.callId,
        callMode: response.callMode ?? options.mode,
        livekitUrl: response.livekitUrl,
        remoteLabel: options.contactName,
        role: 'caller',
        roomName: response.roomName,
        token: response.callerToken,
        translationEnabled: response.translationEnabled,
        voiceGender: options.voiceGender ?? 'male',
      };
      this.updateState({ callId: response.callId, status: 'ringing' });
      this.startStatusPolling(response.callId);
      this.startTimeout();
      await this.connect(this.call);
    } catch (error) {
      const failure = error instanceof SpeakCallError ? error : new SpeakCallError('call_failed', 'Unable to connect. Please try again.');
      await this.fail(failure.message);
      throw failure;
    }
  }

  receiveIncomingCall(incoming: IncomingSpeakCall) {
    if (!incoming.callId || this.state.status !== 'idle') return false;
    const callMode = incoming.callMode ?? 'voice';
    this.call = {
      callId: incoming.callId,
      callMode,
      livekitUrl: null,
      remoteLabel: incoming.callerPhoneNumber || 'Speak caller',
      role: 'recipient',
      roomName: null,
      token: null,
      translationEnabled: callMode === 'interpreter',
      voiceGender: 'male',
    };
    this.setState({
      ...INITIAL_STATE,
      callId: incoming.callId,
      callMode,
      interpreterEnabled: callMode === 'interpreter',
      remoteLabel: this.call.remoteLabel,
      role: 'recipient',
      status: 'ringing',
      videoEnabled: callMode === 'video',
    });
    this.startStatusPolling(incoming.callId);
    InCallManager.turnScreenOn();
    InCallManager.setKeepScreenOn(true);
    InCallManager.startRingtone('_DEFAULT_', [0, 900, 700], 'playback', Math.ceil(CALL_TIMEOUT_MS / 1000));
    this.startTimeout();
    return true;
  }

  async answerCall() {
    const call = this.call;
    if (!call || call.role !== 'recipient' || this.state.status !== 'ringing') return;
    InCallManager.stopRingtone();
    this.updateState({ status: 'connecting' });
    try {
      await this.requestMediaPermissions(call.callMode === 'video');
      const recipientDeviceId = await getDeviceId();
      const response = await this.request<{
        callId: string;
        callMode?: SpeakCallMode;
        livekitUrl: string;
        recipientToken: string;
        roomName: string;
        translationEnabled: boolean;
      }>(`/api/v1/calls/${encodeURIComponent(call.callId)}/accept`, {
        recipientDeviceId,
        translationCapable: true,
      });
      call.callMode = response.callMode ?? call.callMode;
      call.livekitUrl = response.livekitUrl;
      call.roomName = response.roomName;
      call.token = response.recipientToken;
      call.translationEnabled = response.translationEnabled;
      await this.connect(call);
    } catch (error) {
      await this.fail(error instanceof Error ? error.message : 'Unable to answer this call.');
    }
  }

  async declineCall() {
    const call = this.call;
    if (!call || call.role !== 'recipient') return;
    const recipientDeviceId = await getDeviceId();
    await this.request<void>(`/api/v1/calls/${encodeURIComponent(call.callId)}/decline`, { recipientDeviceId }).catch(() => undefined);
    await this.cleanup();
  }

  async endCall() {
    if (this.endingPromise) return this.endingPromise;
    const call = this.call;
    this.updateState({ status: 'ending' });
    this.endingPromise = (async () => {
      try {
        if (call?.callId) {
          const deviceId = await getDeviceId().catch(() => '');
          if (deviceId) await this.request<void>(`/api/v1/calls/${encodeURIComponent(call.callId)}/end`, { deviceId });
        }
      } finally {
        await this.cleanup();
      }
    })().finally(() => { this.endingPromise = null; });
    return this.endingPromise;
  }

  async dismiss() {
    await this.cleanup();
  }

  async toggleMute() {
    if (!this.room || this.room.state !== ConnectionState.Connected) return;
    const muted = !this.state.muted;
    await this.room.localParticipant.setMicrophoneEnabled(!muted, AUDIO_CAPTURE);
    this.updateState({ muted });
  }

  async toggleSpeaker() {
    const speakerEnabled = !this.state.speakerEnabled;
    await AudioSession.selectAudioOutput(speakerEnabled ? 'speaker' : 'earpiece').catch(() => undefined);
    this.updateState({ speakerEnabled });
  }

  async toggleVideo() {
    if (!this.room || this.room.state !== ConnectionState.Connected) return;
    const videoEnabled = !this.state.videoEnabled;
    if (videoEnabled) await this.requestMediaPermissions(true);
    await this.room.localParticipant.setCameraEnabled(videoEnabled, videoEnabled ? { facingMode: 'user' } : undefined);
    this.updateState({ cameraFacing: 'front', videoEnabled });
  }

  async switchCamera() {
    if (!this.room || !this.state.videoEnabled) return;
    const cameraFacing = this.state.cameraFacing === 'front' ? 'back' : 'front';
    const publication = this.room.localParticipant.getTrackPublication(Track.Source.Camera);
    const cameraTrack = publication?.track as { restartTrack?: (options: { facingMode: 'environment' | 'user' }) => Promise<void> } | undefined;
    await cameraTrack?.restartTrack?.({ facingMode: cameraFacing === 'front' ? 'user' : 'environment' });
    this.updateState({ cameraFacing });
  }

  async toggleInterpreter() {
    const call = this.call;
    if (!call || this.state.status !== 'connected') return;
    const enabled = !this.state.interpreterEnabled;
    const deviceId = await getDeviceId();
    await this.request<{ interpreterEnabled: boolean }>(`/api/v1/calls/${encodeURIComponent(call.callId)}/interpreter`, {
      deviceId,
      enabled,
      voiceGender: call.voiceGender,
    });
    call.translationEnabled = enabled;
    this.updateState({ interpreterEnabled: enabled });
    this.applySubscriptionPolicy(call);
  }

  async handleAppForeground() {
    if (this.state.status === 'idle') return;
    const roomActive = this.room && [ConnectionState.Connecting, ConnectionState.Connected, ConnectionState.Reconnecting].includes(this.room.state);
    const waiting = ['calling', 'ringing'].includes(this.state.status) && Boolean(this.call);
    if (!roomActive && !waiting) await this.endCall().catch(() => this.cleanup());
  }

  async requestMediaPermissions(video: boolean) {
    const currentMicrophone = await Camera.getMicrophonePermissionsAsync();
    const microphone = currentMicrophone.granted ? currentMicrophone : await Camera.requestMicrophonePermissionsAsync();
    if (!microphone.granted) throw new SpeakCallError('microphone_denied', 'Allow microphone access in Settings to place this call.');
    if (!video) return;
    const currentCamera = await Camera.getCameraPermissionsAsync();
    const camera = currentCamera.granted ? currentCamera : await Camera.requestCameraPermissionsAsync();
    if (!camera.granted) throw new SpeakCallError('camera_denied', 'Allow camera access in Settings to place a video call.');
  }

  private async connect(call: ActiveCall) {
    if (!call.livekitUrl || !call.token) throw new SpeakCallError('missing_token', 'Unable to connect. Please try again.');
    await AudioSession.stopAudioSession().catch(() => undefined);
    await AudioSession.configureAudio({
      android: {
        audioTypeOptions: { ...AndroidAudioTypePresets.communication, forceHandleAudioRouting: false },
        preferredOutputList: ['bluetooth', 'headset', 'earpiece', 'speaker'],
      },
      ios: { defaultOutput: 'earpiece' },
    });
    await AudioSession.setDefaultRemoteAudioTrackVolume(1);
    await AudioSession.startAudioSession();

    const room = new Room({
      adaptiveStream: true,
      audioCaptureDefaults: AUDIO_CAPTURE,
      dynacast: true,
      publishDefaults: { audioPreset: AudioPresets.speech, dtx: true, forceStereo: false, red: true },
    });
    this.room = room;
    this.attachRoomEvents(room, call);
    this.updateState({ status: call.role === 'caller' ? 'ringing' : 'connecting' });
    await room.connect(call.livekitUrl, call.token, { autoSubscribe: true, maxRetries: 3 });
    if (this.room !== room || this.call !== call) throw new SpeakCallError('call_ended', 'Call ended.');
    await room.localParticipant.setMicrophoneEnabled(true, AUDIO_CAPTURE);
    if (call.callMode === 'video') await room.localParticipant.setCameraEnabled(true, { facingMode: 'user' });
    this.applySubscriptionPolicy(call);
    const humanConnected = [...room.remoteParticipants.values()].some((participant) => participant.identity !== `translator:${call.callId}`);
    if (humanConnected) this.markConnected();
    await AudioSession.selectAudioOutput('earpiece').catch(() => undefined);
  }

  private attachRoomEvents(room: Room, call: ActiveCall) {
    room.on(RoomEvent.ParticipantConnected, (participant) => {
      if (this.room !== room || participant.identity === `translator:${call.callId}`) return;
      this.markConnected();
    });
    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      if (participant.identity === `translator:${call.callId}`) {
        call.translationEnabled = false;
        this.updateState({ interpreterEnabled: false });
        this.applySubscriptionPolicy(call);
        return;
      }
      if (this.room === room) void this.endCall().catch(() => this.cleanup());
    });
    room.on(RoomEvent.TrackPublished, (publication, participant) => {
      if (participant.identity === `translator:${call.callId}` && publication.kind === Track.Kind.Audio && publication.trackName === `translation-to-${call.role}`) {
        call.translationEnabled = true;
        this.updateState({ interpreterEnabled: true });
      }
      publication.setSubscribed(this.shouldSubscribe(call, participant.identity, publication.trackName, publication.kind, publication.source));
      if (call.translationEnabled) this.applySubscriptionPolicy(call);
    });
    room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      if (this.room !== room) return;
      if (track.kind === Track.Kind.Video) {
        this.updateState({ remoteVideoAvailable: true });
        return;
      }
      if (track.kind === Track.Kind.Audio && this.shouldSubscribe(call, participant.identity, publication.trackName, track.kind, publication.source)) this.markConnected();
    });
    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      if (track.kind === Track.Kind.Video) this.updateState({ remoteVideoAvailable: false });
    });
    room.on(RoomEvent.Reconnecting, () => {
      if (this.room === room) this.updateState({ status: 'reconnecting' });
    });
    room.on(RoomEvent.Reconnected, () => {
      if (this.room === room && this.state.remoteConnected) this.updateState({ status: 'connected' });
    });
    room.on(RoomEvent.Disconnected, () => {
      if (this.room === room) void this.cleanup();
    });
  }

  private shouldSubscribe(call: ActiveCall, participantIdentity: string, trackName: string, kind: Track.Kind, source: Track.Source) {
    const translator = participantIdentity === `translator:${call.callId}`;
    if (kind !== Track.Kind.Audio) return !translator;
    if (translator) return call.translationEnabled && trackName === `translation-to-${call.role}`;
    return !call.translationEnabled && source === Track.Source.Microphone;
  }

  private applySubscriptionPolicy(call: ActiveCall) {
    if (!this.room) return;
    for (const participant of this.room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        publication.setSubscribed(this.shouldSubscribe(call, participant.identity, publication.trackName, publication.kind, publication.source));
      }
    }
  }

  private markConnected() {
    InCallManager.stopRingback();
    InCallManager.stopRingtone();
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
    this.callStatusTimer = setInterval(() => { void this.pollStatus(callId); }, 1_000);
  }

  private async pollStatus(callId: string) {
    if (this.call?.callId !== callId) return;
    const deviceId = await getDeviceId().catch(() => '');
    if (!deviceId) return;
    const response = await fetch(`${API_BASE_URL}/api/v1/calls/${encodeURIComponent(callId)}?deviceId=${encodeURIComponent(deviceId)}`).catch(() => null);
    if (!response?.ok) return;
    const payload = (await response.json().catch(() => ({}))) as { active?: boolean; status?: string };
    if (payload.active === false) await this.cleanup();
  }

  private async fail(message: string) {
    const remoteLabel = this.state.remoteLabel;
    const role = this.state.role;
    await this.endCall().catch(() => this.cleanup());
    this.setState({ ...INITIAL_STATE, error: message, remoteLabel, role, status: 'failed' });
  }

  private async cleanup() {
    if (this.callTimer) clearTimeout(this.callTimer);
    if (this.callStatusTimer) clearInterval(this.callStatusTimer);
    this.callTimer = null;
    this.callStatusTimer = null;
    InCallManager.stopRingback();
    InCallManager.stopRingtone();
    InCallManager.setKeepScreenOn(false);
    const room = this.room;
    this.room = null;
    this.call = null;
    if (room) {
      room.removeAllListeners();
      await room.localParticipant.setCameraEnabled(false).catch(() => undefined);
      await room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
      await room.disconnect().catch(() => undefined);
    }
    await AudioSession.stopAudioSession().catch(() => undefined);
    InCallManager.stop();
    this.setState(INITIAL_STATE);
  }
}

export const speakCallEngine = new SpeakCallEngine();
