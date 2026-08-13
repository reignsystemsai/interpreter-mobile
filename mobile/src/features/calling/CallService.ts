import { AudioSession } from '@livekit/react-native';
import { AudioPresets, Room, RoomEvent, Track, type VideoTrack } from 'livekit-client';
import { PermissionsAndroid, Platform } from 'react-native';
import InCallManager from 'react-native-incall-manager';

import { supabase } from '../../services/supabase';
import { normalizePhone } from './CallableIdentity';

export type CallStatus = 'idle' | 'ringing' | 'connecting' | 'connected' | 'reconnecting' | 'ended';
export type CallRole = 'caller' | 'recipient' | null;
export type CallState = { cameraEnabled: boolean; callId: string | null; connectedAt: number | null; error: string; localVideoTrack: VideoTrack | null; muted: boolean; remoteLabel: string; remoteVideoTrack: VideoTrack | null; role: CallRole; speakerEnabled: boolean; status: CallStatus };
type AppCall = { id: string; caller_user_id: string; recipient_user_id: string; status: 'ringing' | 'active' | 'declined' | 'ended' };

const INITIAL: CallState = { cameraEnabled: false, callId: null, connectedAt: null, error: '', localVideoTrack: null, muted: false, remoteLabel: '', remoteVideoTrack: null, role: null, speakerEnabled: false, status: 'idle' };
const AUDIO = { autoGainControl: true, channelCount: 1, echoCancellation: true, noiseSuppression: true } as const;

class SpeakCallService {
  private state = INITIAL;
  private room: Room | null = null;
  private incomingChannel: ReturnType<typeof supabase.channel> | null = null;
  private listeners = new Set<(state: CallState) => void>();

  getState() { return this.state; }
  subscribe(listener: (state: CallState) => void) { this.listeners.add(listener); listener(this.state); return () => { this.listeners.delete(listener); }; }
  private set(patch: Partial<CallState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach((listener) => listener(this.state)); }

  async createCall(phone: string, remoteLabel: string) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Calling setup is required before making a call.');
    const phoneE164 = normalizePhone(phone);
    const { data: recipientUserId, error: resolveError } = await supabase.rpc('resolve_speak_user', { phone: phoneE164 });
    if (resolveError) throw new Error('Phone resolution is unavailable.');
    if (!recipientUserId || recipientUserId === session.user.id) throw new Error('This person does not have Interpreter yet.');
    const { data: call, error: callError } = await supabase.from('app_calls').insert({ caller_user_id: session.user.id, recipient_user_id: recipientUserId, status: 'ringing' }).select('id').single();
    if (callError || !call) throw new Error('The call could not be started.');
    this.set({ callId: call.id, remoteLabel, role: 'caller', status: 'ringing' });
    InCallManager.start({ media: 'audio' });
    InCallManager.startRingback('_DEFAULT_');
    await this.connectSpeakRoom(call.id, 'caller', remoteLabel);
  }

  startPolling() {
    let active = true;
    void this.watchIncoming().then(() => { if (!active) this.stopIncomingChannel(); });
    return () => { active = false; this.stopIncomingChannel(); };
  }

  private async watchIncoming() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const { data: existingCalls } = await supabase.from('app_calls').select('id, caller_user_id, recipient_user_id, status').eq('recipient_user_id', session.user.id).eq('status', 'ringing').order('created_at', { ascending: false }).limit(1);
    const existing = existingCalls?.[0] as AppCall | undefined;
    if (existing) this.receiveIncoming(existing);
    this.incomingChannel = supabase.channel(`incoming-calls-${session.user.id}`).on('postgres_changes', { event: 'INSERT', filter: `recipient_user_id=eq.${session.user.id}`, schema: 'public', table: 'app_calls' }, (payload) => this.receiveIncoming(payload.new as AppCall)).subscribe();
  }

  private receiveIncoming(call: AppCall) {
    if (this.state.status !== 'idle' || call.status !== 'ringing') return;
    InCallManager.start({ media: 'audio' });
    InCallManager.startRingtone('_DEFAULT_');
    this.set({ callId: call.id, remoteLabel: 'Interpreter contact', role: 'recipient', status: 'ringing' });
  }

  async acceptCall() {
    const callId = this.state.callId;
    if (!callId) return;
    const { error } = await supabase.from('app_calls').update({ answered_at: new Date().toISOString(), status: 'active' }).eq('id', callId).eq('status', 'ringing');
    if (error) throw new Error('The call could not be answered.');
    await this.connectSpeakRoom(callId, 'recipient', this.state.remoteLabel);
  }

  async declineCall() {
    if (this.state.callId) await supabase.from('app_calls').update({ status: 'declined', ended_at: new Date().toISOString() }).eq('id', this.state.callId).eq('status', 'ringing');
    await this.finish(false);
  }

  async endCall() {
    if (this.state.callId) await supabase.from('app_calls').update({ ended_at: new Date().toISOString(), status: 'ended' }).eq('id', this.state.callId).neq('status', 'ended');
    await this.finish(false);
  }

  async connectSpeakRoom(callId: string, role: Exclude<CallRole, null>, remoteLabel: string) {
    this.set({ callId, remoteLabel, role, status: 'connecting' });
    const { data, error } = await supabase.functions.invoke('livekit-token', { body: { callId } });
    if (error || !data?.server_url || !data?.participant_token) throw new Error('LiveKit token could not be issued.');
    const room = new Room({ audioCaptureDefaults: AUDIO, publishDefaults: { audioPreset: AudioPresets.speech } });
    this.room = room;
    await AudioSession.configureAudio({ ios: { defaultOutput: 'speaker' } });
    await AudioSession.startAudioSession();
    room.on(RoomEvent.TrackSubscribed, (track) => { if (track.kind === Track.Kind.Audio) this.set({ connectedAt: this.state.connectedAt ?? Date.now(), status: 'connected' }); if (track.kind === Track.Kind.Video) this.set({ remoteVideoTrack: track as VideoTrack }); });
    room.on(RoomEvent.TrackUnsubscribed, (track) => { if (track.kind === Track.Kind.Video) this.set({ remoteVideoTrack: null }); });
    room.on(RoomEvent.Reconnecting, () => this.set({ status: 'reconnecting' }));
    room.on(RoomEvent.Reconnected, () => this.set({ status: 'connected' }));
    room.on(RoomEvent.Disconnected, () => void this.finish(false));
    await room.connect(data.server_url, data.participant_token);
    await room.localParticipant.setMicrophoneEnabled(true, AUDIO);
    InCallManager.stopRingback();
    InCallManager.stopRingtone();
    this.set({ connectedAt: Date.now(), status: 'connected' });
  }

  async toggleMute() { if (!this.room) return; const muted = !this.state.muted; await this.room.localParticipant.setMicrophoneEnabled(!muted, AUDIO); this.set({ muted }); }
  async toggleSpeaker() { const speakerEnabled = !this.state.speakerEnabled; await AudioSession.selectAudioOutput(Platform.OS === 'ios' ? speakerEnabled ? 'force_speaker' : 'default' : speakerEnabled ? 'speaker' : 'earpiece'); this.set({ speakerEnabled }); }
  async toggleCamera() { if (!this.room) return; const enabled = !this.state.cameraEnabled; if (enabled && Platform.OS === 'android' && await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA) !== PermissionsAndroid.RESULTS.GRANTED) throw new Error('Camera permission denied.'); await this.room.localParticipant.setCameraEnabled(enabled); const track = enabled ? [...this.room.localParticipant.videoTrackPublications.values()].find((publication) => publication.track)?.track as VideoTrack | null ?? null : null; this.set({ cameraEnabled: enabled, localVideoTrack: track }); }

  private stopIncomingChannel() { if (!this.incomingChannel) return; void supabase.removeChannel(this.incomingChannel); this.incomingChannel = null; }
  private async finish(notify: boolean) { void notify; const room = this.room; this.room = null; InCallManager.stopRingback(); InCallManager.stopRingtone(); if (room) { room.removeAllListeners(); await room.localParticipant.setCameraEnabled(false).catch(() => undefined); await room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined); await room.disconnect().catch(() => undefined); } await AudioSession.stopAudioSession().catch(() => undefined); this.set(INITIAL); }
}

export const CallService = new SpeakCallService();