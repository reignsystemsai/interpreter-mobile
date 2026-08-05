import { AndroidAudioTypePresets, AudioSession } from '@livekit/react-native';
import { PermissionsAndroid, Platform } from 'react-native';
import { AudioPresets, ConnectionState, Room, RoomEvent, Track } from 'livekit-client';

import { API_BASE_URL } from '../../config/runtime';
import { lookupDeviceByPhone } from '../../services/deviceRegistration';
import type { CountryCode } from 'libphonenumber-js';

export type CallServiceStatus = 'idle' | 'connecting' | 'reconnecting' | 'connected' | 'participant_joined' | 'audio_active' | 'ended';
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
  private activeCall: CreateResponse | null = null;
  private operationInProgress = false;
  private operationVersion = 0;
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

  private roomIsActive() {
    return Boolean(this.room && [ConnectionState.Connecting, ConnectionState.Connected, ConnectionState.Reconnecting].includes(this.room.state));
  }

  hasActiveRoom() {
    return this.operationInProgress || this.roomIsActive();
  }

  async resetStaleCallState() {
    if (this.hasActiveRoom()) return false;
    const staleRoom = this.room;
    const staleCall = this.activeCall;
    this.room = null;
    this.activeCall = null;
    await this.releaseRoom(staleRoom);
    await this.endBackendCall(staleCall);
    this.setState({ callCode: null, status: 'idle' });
    return true;
  }

  async startVoiceCall(phoneNumber?: string, defaultRegion?: CountryCode) {
    await this.resetStaleCallState();
    if (this.hasActiveRoom()) throw new Error('A voice call is already active.');
    this.operationInProgress = true;
    const operationVersion = ++this.operationVersion;
    this.setState({ callCode: null, status: 'connecting' });
    try {
      let recipientInstallationId = '';
      if (phoneNumber) {
        const recipient = await lookupDeviceByPhone(phoneNumber, defaultRegion);
        if (!recipient.available) throw new Error('This person does not have Interpreter yet.');
        recipientInstallationId = recipient.installationId;
      }
      const call = await this.request(recipientInstallationId ? { recipientInstallationId } : {});
      if (operationVersion !== this.operationVersion) {
        await this.endBackendCall(call);
        throw new Error('Call ended.');
      }
      this.activeCall = call;
      this.setState({ callCode: call.temporaryCallCode, status: 'connecting' });
      await this.connect('caller', call, call.callerToken);
      this.operationInProgress = false;
    } catch (error) {
      this.operationInProgress = false;
      await this.endCall();
      throw error;
    }
  }

  async joinVoiceCall(callCode: string) {
    await this.resetStaleCallState();
    if (this.hasActiveRoom()) throw new Error('A voice call is already active.');
    const normalized = callCode.trim().toUpperCase();
    if (!normalized) throw new Error('Enter the call code.');
    this.operationInProgress = true;
    const operationVersion = ++this.operationVersion;
    this.setState({ callCode: normalized, status: 'connecting' });
    try {
      const call = await this.request({ temporaryCallCode: normalized });
      if (operationVersion !== this.operationVersion) {
        await this.endBackendCall(call);
        throw new Error('Call ended.');
      }
      this.activeCall = call;
      await this.connect('recipient', call, call.recipientToken);
      this.operationInProgress = false;
    } catch (error) {
      this.operationInProgress = false;
      await this.endCall();
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
        void this.endCall();
      });
      nextRoom.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind !== Track.Kind.Audio) return;
        console.info('[LiveKitCall] remote audio subscribed');
        this.setState({ callCode: call.temporaryCallCode, status: 'audio_active' });
      });
      nextRoom.on(RoomEvent.Disconnected, () => {
        if (this.room !== nextRoom) return;
        void this.endCall();
      });
      nextRoom.on(RoomEvent.Reconnecting, () => {
        if (this.room === nextRoom) this.setState({ callCode: call.temporaryCallCode, status: 'reconnecting' });
      });
      this.room = nextRoom;
      await nextRoom.connect(call.livekitUrl, token, { autoSubscribe: true, maxRetries: 3 });
      if (this.room !== nextRoom || this.activeCall !== call) throw new Error('Call ended.');
      console.info(`[LiveKitCall] ${role} connected`);
      this.setState({ callCode: call.temporaryCallCode, status: nextRoom.remoteParticipants.size ? 'participant_joined' : 'connected' });
      await nextRoom.localParticipant.setMicrophoneEnabled(true, AUDIO_CAPTURE);
      console.info('[LiveKitCall] microphone published');
      if (Platform.OS === 'android') await AudioSession.selectAudioOutput('speaker');
      else await AudioSession.selectAudioOutput('force_speaker');
    } catch (error) {
      this.room = null;
      await this.releaseRoom(nextRoom);
      throw error;
    }
  }

  private async releaseRoom(room: Room | null) {
    if (room) {
      await room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
      for (const publication of room.localParticipant.audioTrackPublications.values()) {
        if (publication.track) await room.localParticipant.unpublishTrack(publication.track).catch(() => undefined);
      }
      for (const participant of room.remoteParticipants.values()) {
        for (const publication of participant.audioTrackPublications.values()) {
          publication.track?.detach();
          if (publication.isSubscribed) publication.setSubscribed(false);
        }
      }
      await room.disconnect().catch(() => undefined);
    }
    await AudioSession.stopAudioSession().catch(() => undefined);
  }

  private async endBackendCall(call: CreateResponse | null) {
    if (!call) return;
    await fetch(`${API_BASE_URL}/api/v1/voice-call/end`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomName: call.roomName, temporaryCallCode: call.temporaryCallCode }),
    }).catch(() => undefined);
  }

  async endCall() {
    const room = this.room;
    const call = this.activeCall;
    this.room = null;
    this.activeCall = null;
    this.operationInProgress = false;
    this.operationVersion += 1;
    this.setState({ callCode: null, status: 'idle' });
    await this.releaseRoom(room);
    await this.endBackendCall(call);
    console.info('[LiveKitCall] call ended');
  }
}

export const CallService = new CentralCallService();
