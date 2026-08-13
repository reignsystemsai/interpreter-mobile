import { AudioSession } from '@livekit/react-native';
import { AudioPresets, Room, RoomEvent, Track, type VideoTrack } from 'livekit-client';
import { AppState, PermissionsAndroid, Platform } from 'react-native';
import InCallManager from 'react-native-incall-manager';
import { supabase } from '../../services/supabase';

export type CallStatus = 'idle' | 'ringing' | 'connecting' | 'connected' | 'reconnecting' | 'ended';
export type CallRole = 'caller' | 'recipient' | null;
export type CallState = { cameraEnabled: boolean; callId: string | null; connectedAt: number | null; error: string; localVideoTrack: VideoTrack | null; muted: boolean; remoteLabel: string; remoteVideoTrack: VideoTrack | null; role: CallRole; speakerEnabled: boolean; status: CallStatus };
type AppCall = { id: string; caller_user_id: string; recipient_user_id: string; status: 'ringing' | 'connected' | 'ended' };
const INITIAL: CallState = { cameraEnabled: false, callId: null, connectedAt: null, error: '', localVideoTrack: null, muted: false, remoteLabel: '', remoteVideoTrack: null, role: null, speakerEnabled: false, status: 'idle' };
const AUDIO = { autoGainControl: true, channelCount: 1, echoCancellation: true, noiseSuppression: true } as const;

class SpeakCallService {
  private state = INITIAL; private room: Room | null = null; private listeners = new Set<(state: CallState) => void>(); private channel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null;
  getState() { return this.state; }
  subscribe(listener: (state: CallState) => void) { this.listeners.add(listener); listener(this.state); return () => { this.listeners.delete(listener); }; }
  private set(patch: Partial<CallState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach((listener) => listener(this.state)); }
  private async session() { const { data } = await supabase!.auth.getSession(); if (!data.session) throw new Error('Authentication required.'); return data.session; }
  async createCall(phoneE164: string, remoteLabel: string) {
    const session = await this.session(); const { data: recipient, error: resolveError } = await supabase!.rpc('resolve_speak_user', { phone_e164: phoneE164 });
    if (resolveError || !recipient) throw new Error('This person does not have Interpreter yet.');
    const { data, error } = await supabase!.from('app_calls').insert({ caller_user_id: session.user.id, recipient_user_id: recipient }).select('id').single();
    if (error || !data) throw new Error(error?.message || 'Unable to create the call.');
    this.set({ ...INITIAL, callId: data.id, remoteLabel, role: 'caller', status: 'ringing' }); InCallManager.startRingback('_DEFAULT_'); await this.watchIncoming();
  }
  startPolling() { void this.watchIncoming(); return () => { if (this.channel) void supabase?.removeChannel(this.channel); this.channel = null; }; }
  private async watchIncoming() {
    const session = await this.session(); if (this.channel) return;
    this.channel = supabase!.channel(`app-calls:${session.user.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'app_calls', filter: `recipient_user_id=eq.${session.user.id}` }, (event) => { const call = event.new as AppCall; if (event.eventType === 'INSERT' && call.status === 'ringing' && this.state.status === 'idle') { this.set({ ...INITIAL, callId: call.id, remoteLabel: 'Interpreter caller', role: 'recipient', status: 'ringing' }); InCallManager.startRingtone('_DEFAULT_'); } if (call.status === 'ended') void this.finish(false); }).subscribe();
  }
  async acceptCall() { if (!this.state.callId) return; await supabase!.from('app_calls').update({ status: 'connected', updated_at: new Date().toISOString() }).eq('id', this.state.callId); InCallManager.stopRingtone(); this.set({ status: 'connecting' }); await this.connectSpeakRoom(this.state.callId); }
  async declineCall() { await this.endCall(); }
  async endCall() { const id = this.state.callId; if (id) await supabase!.from('app_calls').update({ status: 'ended', ended_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', id); await this.finish(true); }
  async connectSpeakRoom(callId: string) {
    const { data, error } = await supabase!.functions.invoke('livekit-token', { body: { callId } }); if (error || !data?.server_url || !data?.participant_token) throw new Error(error?.message || 'Unable to join the call.');
    await AudioSession.configureAudio({ ios: { defaultOutput: 'speaker' } }); await AudioSession.startAudioSession(); const room = new Room({ audioCaptureDefaults: AUDIO, publishDefaults: { audioPreset: AudioPresets.speech } }); this.room = room;
    room.on(RoomEvent.TrackSubscribed, (track) => { if (track.kind === Track.Kind.Audio) this.set({ connectedAt: this.state.connectedAt ?? Date.now(), status: 'connected' }); if (track.kind === Track.Kind.Video) this.set({ remoteVideoTrack: track as VideoTrack }); }); room.on(RoomEvent.TrackUnsubscribed, (track) => { if (track.kind === Track.Kind.Video) this.set({ remoteVideoTrack: null }); }); room.on(RoomEvent.Reconnecting, () => this.set({ status: 'reconnecting' })); room.on(RoomEvent.Reconnected, () => this.set({ status: 'connected' })); room.on(RoomEvent.Disconnected, () => void this.finish(false));
    await room.connect(data.server_url, data.participant_token, { autoSubscribe: true }); await room.localParticipant.setMicrophoneEnabled(true, AUDIO); this.set({ connectedAt: this.state.connectedAt ?? Date.now(), status: 'connected' });
  }
  async toggleMute() { if (!this.room) return; const muted = !this.state.muted; await this.room.localParticipant.setMicrophoneEnabled(!muted, AUDIO); this.set({ muted }); }
  async toggleSpeaker() { const speakerEnabled = !this.state.speakerEnabled; await AudioSession.selectAudioOutput(Platform.OS === 'ios' ? speakerEnabled ? 'force_speaker' : 'default' : speakerEnabled ? 'speaker' : 'earpiece'); this.set({ speakerEnabled }); }
  async toggleCamera() { if (!this.room) return; const enabled = !this.state.cameraEnabled; if (enabled && Platform.OS === 'android' && await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA) !== PermissionsAndroid.RESULTS.GRANTED) throw new Error('Camera permission denied.'); await this.room.localParticipant.setCameraEnabled(enabled); const track = enabled ? [...this.room.localParticipant.videoTrackPublications.values()].find((p) => p.track)?.track as VideoTrack | null ?? null : null; this.set({ cameraEnabled: enabled, localVideoTrack: track }); }
  private async finish(notify: boolean) { void notify; const room = this.room; this.room = null; InCallManager.stopRingback(); InCallManager.stopRingtone(); if (room) { room.removeAllListeners(); await room.localParticipant.setCameraEnabled(false).catch(() => undefined); await room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined); await room.disconnect().catch(() => undefined); } await AudioSession.stopAudioSession().catch(() => undefined); this.set(INITIAL); }
}
export const CallService = new SpeakCallService();
