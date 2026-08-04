import { AndroidAudioTypePresets, AudioSession } from '@livekit/react-native';
import { PermissionsAndroid, Platform } from 'react-native';
import { AudioPresets, Room, RoomEvent, Track } from 'livekit-client';

import { API_BASE_URL } from '../../config/runtime';

export type CallServiceStatus = 'idle' | 'connecting' | 'connected' | 'participant_joined' | 'audio_active' | 'ended';
export type CallServiceState = { callCode: string | null; status: CallServiceStatus };
type Role = 'caller' | 'recipient';
type CreateResponse = {
  roomName: string;
  livekitUrl: string;
  callerToken: string;
  recipientToken: string;
  temporaryCallCode: string;
};

const AUDIO_CAPTURE = { autoGainControl: true, channelCount: 1, echoCancellation: true, noiseSuppression: true } as const;

class CentralCallService {
  private listeners = new Set<(state: CallServiceState) => void>();
  private room: Room | null = null;
  private state: CallServiceState = { callCode: null, status: 'idle' };

  getState() {
    return this.state;
  }

  subscribe(listener: (state: CallServiceState) => void) {
    this.listeners.add(listener);
    listener(this.state);
    return () => { this.listeners.delete(listener); };
  }

  private setState(state: CallServiceState) {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }

  private showEnded(callCode: string | null) {
    this.setState({ callCode, status: 'ended' });
    setTimeout(() => {
      if (!this.room && this.state.status === 'ended') this.setState({ callCode: null, status: 'idle' });
    }, 1200);
  }

  private async request(body: Record<string, string> = {}) {
    const response = await fetch(`${API_BASE_URL}/api/v1/voice-call/create`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as Partial<CreateResponse> & { error?: string };
    if (!response.ok) throw new Error(payload.error || 'Unable to create the voice call.');
    if (!payload.roomName || !payload.livekitUrl || !payload.callerToken || !payload.recipientToken || !payload.temporaryCallCode) {
      throw new Error('Unable to create the voice call.');
    }
    return payload as CreateResponse;
  }

  async startVoiceCall() {
    if (this.room) throw new Error('A voice call is already active.');
    this.setState({ callCode: null, status: 'connecting' });
    try {
      const call = await this.request();
      this.setState({ callCode: call.temporaryCallCode, status: 'connecting' });
      await this.connect('caller', call, call.callerToken);
    } catch (error) {
      this.showEnded(this.state.callCode);
      throw error;
    }
  }

  async joinVoiceCall(callCode: string) {
    if (this.room) throw new Error('A voice call is already active.');
    const normalized = callCode.trim().toUpperCase();
    if (!normalized) throw new Error('Enter the call code.');
    this.setState({ callCode: normalized, status: 'connecting' });
    try {
      const call = await this.request({ temporaryCallCode: normalized });
      await this.connect('recipient', call, call.recipientToken);
    } catch (error) {
      this.showEnded(normalized);
      throw error;
    }
  }

  private async requestMicrophone() {
    if (Platform.OS !== 'android') return;
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    if (result !== PermissionsAndroid.RESULTS.GRANTED) throw new Error('Microphone permission is required.');
  }

  private async connect(role: Role, call: CreateResponse, token: string) {
    let nextRoom: Room | null = null;
    try {
      await this.requestMicrophone();
      await AudioSession.configureAudio({
        android: { preferredOutputList: ['bluetooth', 'headset', 'speaker', 'earpiece'], audioTypeOptions: { ...AndroidAudioTypePresets.communication, forceHandleAudioRouting: true } },
        ios: { defaultOutput: 'speaker' },
      });
      await AudioSession.setDefaultRemoteAudioTrackVolume(1);
      await AudioSession.startAudioSession();
      nextRoom = new Room({
        adaptiveStream: true,
        audioCaptureDefaults: AUDIO_CAPTURE,
        publishDefaults: { audioPreset: AudioPresets.speech, dtx: true, forceStereo: false, red: true },
      });
      nextRoom.on(RoomEvent.ParticipantConnected, () => this.setState({ callCode: call.temporaryCallCode, status: 'participant_joined' }));
      nextRoom.on(RoomEvent.ParticipantDisconnected, () => {
        if (this.room !== nextRoom) return;
        this.room = null;
        void nextRoom?.disconnect().catch(() => undefined);
        void AudioSession.stopAudioSession().catch(() => undefined);
        console.info('[LiveKitCall] call ended');
        this.showEnded(call.temporaryCallCode);
      });
      nextRoom.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind !== Track.Kind.Audio) return;
        console.info('[LiveKitCall] remote audio subscribed');
        this.setState({ callCode: call.temporaryCallCode, status: 'audio_active' });
      });
      nextRoom.on(RoomEvent.Disconnected, () => {
        if (this.room !== nextRoom) return;
        this.room = null;
        void AudioSession.stopAudioSession().catch(() => undefined);
        this.showEnded(call.temporaryCallCode);
      });
      this.room = nextRoom;
      await nextRoom.connect(call.livekitUrl, token, { autoSubscribe: true, maxRetries: 3 });
      console.info(`[LiveKitCall] ${role} connected`);
      this.setState({ callCode: call.temporaryCallCode, status: nextRoom.remoteParticipants.size ? 'participant_joined' : 'connected' });
      await nextRoom.localParticipant.setMicrophoneEnabled(true, AUDIO_CAPTURE);
      console.info('[LiveKitCall] microphone published');
      if (Platform.OS === 'android') await AudioSession.selectAudioOutput('speaker');
      else await AudioSession.selectAudioOutput('force_speaker');
    } catch (error) {
      this.room = null;
      await nextRoom?.disconnect().catch(() => undefined);
      await AudioSession.stopAudioSession().catch(() => undefined);
      this.showEnded(call.temporaryCallCode);
      throw error;
    }
  }

  async endCall() {
    const room = this.room;
    this.room = null;
    await room?.disconnect().catch(() => undefined);
    await AudioSession.stopAudioSession().catch(() => undefined);
    console.info('[LiveKitCall] call ended');
    this.showEnded(this.state.callCode);
  }
}

export const CallService = new CentralCallService();
