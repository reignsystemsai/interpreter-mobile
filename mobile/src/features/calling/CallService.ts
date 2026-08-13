import { AudioSession } from '@livekit/react-native';
import { AudioPresets, Room, RoomEvent, Track, type VideoTrack } from 'livekit-client';
import { AppState, PermissionsAndroid, Platform } from 'react-native';
import InCallManager from 'react-native-incall-manager';
import { getCallingDeviceId } from '../../services/deviceIdentity';

export type CallStatus = 'idle' | 'ringing' | 'connecting' | 'connected' | 'reconnecting' | 'ended';
export type CallRole = 'caller' | 'recipient' | null;
export type CallState = { cameraEnabled: boolean; callId: string | null; connectedAt: number | null; error: string; localVideoTrack: VideoTrack | null; muted: boolean; remoteLabel: string; remoteVideoTrack: VideoTrack | null; role: CallRole; speakerEnabled: boolean; status: CallStatus };
type AppCall = { id: string; caller_device_id: string; recipient_device_id: string; status: 'ringing' | 'connected' | 'ended' };
const INITIAL: CallState = { cameraEnabled: false, callId: null, connectedAt: null, error: '', localVideoTrack: null, muted: false, remoteLabel: '', remoteVideoTrack: null, role: null, speakerEnabled: false, status: 'idle' };
const AUDIO = { autoGainControl: true, channelCount: 1, echoCancellation: true, noiseSuppression: true } as const;

class SpeakCallService {
  private state = INITIAL; private room: Room | null = null; private listeners = new Set<(state: CallState) => void>();
  getState() { return this.state; }
  subscribe(listener: (state: CallState) => void) { this.listeners.add(listener); listener(this.state); return () => { this.listeners.delete(listener); }; }
  private set(patch: Partial<CallState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach((listener) => listener(this.state)); }
  async createCall(phoneE164: string, remoteLabel: string) {
    throw new Error('Calling is unavailable in this build.');
  }
  startPolling() { return () => {}; }
  private async watchIncoming() { return; }
  async acceptCall() { return; }
  async declineCall() { await this.endCall(); }
  async endCall() { await this.finish(true); }
  async connectSpeakRoom(callId: string) {
    const deviceId = await getCallingDeviceId();
    const room = new Room({ audioCaptureDefaults: AUDIO, publishDefaults: { audioPreset: AudioPresets.speech } });
    this.room = room;
    await AudioSession.configureAudio({ ios: { defaultOutput: 'speaker' } });
    await AudioSession.startAudioSession();
    room.on(RoomEvent.TrackSubscribed, (track) => { if (track.kind === Track.Kind.Audio) this.set({ connectedAt: this.state.connectedAt ?? Date.now(), status: 'connected' }); if (track.kind === Track.Kind.Video) this.set({ remoteVideoTrack: track as VideoTrack }); }); room.on(RoomEvent.TrackUnsubscribed, (track) => { if (track.kind === Track.Kind.Video) this.set({ remoteVideoTrack: null }); }); room.on(RoomEvent.Reconnecting, () => this.set({ status: 'reconnecting' })); room.on(RoomEvent.Reconnected, () => this.set({ status: 'connected' })); room.on(RoomEvent.Disconnected, () => void this.finish(false));
    this.set({ ...INITIAL, callId, remoteLabel: 'Interpreter call', role: 'caller', status: 'connected' });
  }
  async toggleMute() { if (!this.room) return; const muted = !this.state.muted; await this.room.localParticipant.setMicrophoneEnabled(!muted, AUDIO); this.set({ muted }); }
  async toggleSpeaker() { const speakerEnabled = !this.state.speakerEnabled; await AudioSession.selectAudioOutput(Platform.OS === 'ios' ? speakerEnabled ? 'force_speaker' : 'default' : speakerEnabled ? 'speaker' : 'earpiece'); this.set({ speakerEnabled }); }
  async toggleCamera() { if (!this.room) return; const enabled = !this.state.cameraEnabled; if (enabled && Platform.OS === 'android' && await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA) !== PermissionsAndroid.RESULTS.GRANTED) throw new Error('Camera permission denied.'); await this.room.localParticipant.setCameraEnabled(enabled); const track = enabled ? [...this.room.localParticipant.videoTrackPublications.values()].find((p) => p.track)?.track as VideoTrack | null ?? null : null; this.set({ cameraEnabled: enabled, localVideoTrack: track }); }
  private async finish(notify: boolean) { void notify; const room = this.room; this.room = null; InCallManager.stopRingback(); InCallManager.stopRingtone(); if (room) { room.removeAllListeners(); await room.localParticipant.setCameraEnabled(false).catch(() => undefined); await room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined); await room.disconnect().catch(() => undefined); } await AudioSession.stopAudioSession().catch(() => undefined); this.set(INITIAL); }
}
export const CallService = new SpeakCallService();
