import { AudioSession } from '@livekit/react-native';
import { AudioPresets, Room, RoomEvent, Track, type VideoTrack } from 'livekit-client';
import { Alert, PermissionsAndroid, Platform } from 'react-native';
import InCallManager from 'react-native-incall-manager';

import { supabase } from '../../services/supabase';
import { ensureCallableIdentity, getLocalCallableIdentity, normalizePhone } from './CallableIdentity';
import { isLocalMicrophoneTrack, SpeakMicrophoneAudioProcessor } from './SpeakMicrophoneAudioProcessor';

export type CallStatus = 'idle' | 'ringing' | 'connecting' | 'connected' | 'reconnecting' | 'ended';
export type CallRole = 'caller' | 'recipient' | null;
export type CallState = { cameraEnabled: boolean; callId: string | null; connectedAt: number | null; error: string; localVideoTrack: VideoTrack | null; muted: boolean; remoteLabel: string; remotePhone: string; remoteVideoTrack: VideoTrack | null; role: CallRole; speakerEnabled: boolean; status: CallStatus };
type AppCall = { id: string; caller_device_id: string; recipient_device_id: string; status: 'ringing' | 'active' | 'declined' | 'ended' };
type CreatedCall = { call_id: string; recipient_device_id: string };

const INITIAL: CallState = { cameraEnabled: false, callId: null, connectedAt: null, error: '', localVideoTrack: null, muted: false, remoteLabel: '', remotePhone: '', remoteVideoTrack: null, role: null, speakerEnabled: false, status: 'idle' };
const AUDIO = { autoGainControl: false, channelCount: 1, echoCancellation: true, noiseSuppression: false } as const;

class SpeakCallService {
  private state = INITIAL;
  private room: Room | null = null;
  private incomingChannel: ReturnType<typeof supabase.channel> | null = null;
  private callChannel: ReturnType<typeof supabase.channel> | null = null;
  private callStatusPoll: ReturnType<typeof setInterval> | null = null;
  private identityRetry: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(state: CallState) => void>();
  private microphoneProcessor = new SpeakMicrophoneAudioProcessor();

  getState() { return this.state; }
  subscribe(listener: (state: CallState) => void) { this.listeners.add(listener); listener(this.state); return () => { this.listeners.delete(listener); }; }
  private set(patch: Partial<CallState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach((listener) => listener(this.state)); }

  async createCall(phone: string, remoteLabel: string) {
    const identity = await ensureCallableIdentity();
    const phoneE164 = normalizePhone(phone);
    const { data, error } = await supabase.rpc('create_direct_app_call', {
      p_caller_device_id: identity.deviceId,
      p_recipient_phone_e164: phoneE164,
    });
    const call = data as CreatedCall | null;
    if (error || !call?.call_id) {
      throw new Error(`CALL CREATE\n${error?.message || 'The call could not be started.'}`);
    }
    this.set({ callId: call.call_id, remoteLabel, remotePhone: phoneE164, role: 'caller', status: 'ringing' });
    this.watchCallStatus(call.call_id);
    InCallManager.start({ media: 'audio' });
    InCallManager.startRingback('_DEFAULT_');
  }

  startPolling() {
    let active = true;
    const start = async () => {
      const watching = await this.watchIncoming();
      if (!active) {
        this.stopIncomingChannel();
        return;
      }
      if (!watching) this.identityRetry = setTimeout(() => void start(), 1_000);
    };
    void start();
    return () => {
      active = false;
      if (this.identityRetry) clearTimeout(this.identityRetry);
      this.identityRetry = null;
      this.stopIncomingChannel();
    };
  }

  private async watchIncoming() {
    const identity = await getLocalCallableIdentity();
    if (!identity) return false;
    const recentCallCutoff = new Date(Date.now() - 90_000).toISOString();
    const { data: existingCalls } = await supabase.from('app_calls').select('id, caller_device_id, recipient_device_id, status').eq('recipient_device_id', identity.deviceId).eq('status', 'ringing').gte('created_at', recentCallCutoff).order('created_at', { ascending: false }).limit(1);
    const existing = existingCalls?.[0] as AppCall | undefined;
    if (existing) this.receiveIncoming(existing);
    this.incomingChannel = supabase.channel(`incoming-calls-${identity.deviceId}`).on('postgres_changes', { event: 'INSERT', filter: `recipient_device_id=eq.${identity.deviceId}`, schema: 'public', table: 'app_calls' }, (payload) => this.receiveIncoming(payload.new as AppCall)).subscribe();
    return true;
  }

  private receiveIncoming(call: AppCall) {
    if (this.state.status !== 'idle' || call.status !== 'ringing') return;
    InCallManager.start({ media: 'audio' });
    InCallManager.startRingtone('_DEFAULT_');
    this.set({ callId: call.id, remoteLabel: 'Interpreter contact', role: 'recipient', status: 'ringing' });
    this.watchCallStatus(call.id);
    void this.loadRemoteProfile(call.id, call.caller_device_id);
  }

  private async loadRemoteProfile(callId: string, deviceId: string) {
    const { data } = await supabase
      .from('speak_profiles')
      .select('display_name, phone_e164')
      .eq('device_id', deviceId)
      .maybeSingle();
    if (this.state.callId !== callId || !data) return;
    this.set({
      remoteLabel: data.display_name || this.state.remoteLabel,
      remotePhone: data.phone_e164 || '',
    });
  }

  async acceptCall() {
    const callId = this.state.callId;
    if (!callId) return;
    const identity = await getLocalCallableIdentity();
    if (!identity) throw new Error('CALL PROFILE\nCalling setup is required.');
    const { data, error } = await supabase.rpc('answer_direct_app_call', {
      p_call_id: callId,
      p_recipient_device_id: identity.deviceId,
    });
    if (error || data !== 'active') throw new Error(`CALL ANSWER\n${error?.message || 'The call could not be activated.'}`);
    try {
      await this.connectSpeakRoom(callId, 'recipient', this.state.remoteLabel);
    } catch (connectError) {
      await this.closeFailedCall(callId);
      throw connectError;
    }
  }

  async declineCall() {
    const callId = this.state.callId;
    const identity = await getLocalCallableIdentity();
    const cleanup = this.finish();
    if (callId && identity) {
      const { error } = await supabase.rpc('finish_direct_app_call', { p_call_id: callId, p_device_id: identity.deviceId, p_final_status: 'declined' });
      if (error) throw new Error(`CALL DECLINE\n${error.message}`);
    }
    await cleanup;
  }

  async endCall() {
    const callId = this.state.callId;
    const identity = await getLocalCallableIdentity();
    const cleanup = this.finish();
    if (callId && identity) {
      const { error } = await supabase.rpc('finish_direct_app_call', { p_call_id: callId, p_device_id: identity.deviceId, p_final_status: 'ended' });
      if (error) throw new Error(`CALL END\n${error.message}`);
    }
    await cleanup;
  }

  async connectSpeakRoom(callId: string, role: Exclude<CallRole, null>, remoteLabel: string) {
    const identity = await getLocalCallableIdentity();
    if (!identity) throw new Error('CALL PROFILE\nCalling setup is required.');
    this.set({ callId, remoteLabel, role, status: 'connecting' });
    const { data, error } = await supabase.rpc('issue_livekit_call_token', {
      p_call_id: callId,
      p_device_id: identity.deviceId,
    });
    if (error || !data?.server_url || !data?.participant_token) throw new Error(`CALL TOKEN\n${error?.message || 'LiveKit token could not be issued.'}`);
    const room = new Room({ audioCaptureDefaults: AUDIO, publishDefaults: { audioPreset: AudioPresets.speech } });
    this.room = room;
    InCallManager.stopRingback();
    InCallManager.stopRingtone();
    InCallManager.stop();
    await AudioSession.configureAudio({ ios: { defaultOutput: 'earpiece' } });
    await AudioSession.startAudioSession();
    room.on(RoomEvent.TrackSubscribed, (track) => { if (track.kind === Track.Kind.Audio) this.set({ connectedAt: this.state.connectedAt ?? Date.now(), status: 'connected' }); if (track.kind === Track.Kind.Video) this.set({ remoteVideoTrack: track as VideoTrack }); });
    room.on(RoomEvent.TrackUnsubscribed, (track) => { if (track.kind === Track.Kind.Video) this.set({ remoteVideoTrack: null }); });
    room.on(RoomEvent.Reconnecting, () => this.set({ status: 'reconnecting' }));
    room.on(RoomEvent.Reconnected, () => this.set({ status: 'connected' }));
    room.on(RoomEvent.Disconnected, () => void this.endCall());
    try {
      await room.connect(data.server_url, data.participant_token);
    } catch (roomError) {
      throw new Error(`CALL ROOM\n${roomError instanceof Error ? roomError.message : 'Unable to join the call room.'}`);
    }
    try {
      await room.localParticipant.setMicrophoneEnabled(true, AUDIO);
      const microphoneTrack = [...room.localParticipant.audioTrackPublications.values()]
        .find((publication) => publication.source === Track.Source.Microphone)?.track;
      if (isLocalMicrophoneTrack(microphoneTrack)) await this.microphoneProcessor.attach(microphoneTrack);
    } catch (audioError) {
      throw new Error(`CALL AUDIO\n${audioError instanceof Error ? audioError.message : 'Unable to start call audio.'}`);
    }
    InCallManager.stopRingback();
    InCallManager.stopRingtone();
    this.set({ connectedAt: Date.now(), status: 'connected' });
  }

  async toggleMute() {
    if (!this.room) throw new Error('Call audio is not connected.');
    const muted = !this.state.muted;
    await this.room.localParticipant.setMicrophoneEnabled(!muted, AUDIO);
    this.set({ muted });
  }
  async toggleSpeaker() {
    if (!this.room) throw new Error('Call audio is not connected.');
    const speakerEnabled = !this.state.speakerEnabled;
    await AudioSession.selectAudioOutput(Platform.OS === 'ios' ? speakerEnabled ? 'force_speaker' : 'default' : speakerEnabled ? 'speaker' : 'earpiece');
    this.set({ speakerEnabled });
  }
  async chooseBluetooth() {
    if (!this.room) throw new Error('Call audio is not connected.');
    if (Platform.OS === 'ios') {
      await AudioSession.showAudioRoutePicker();
      this.set({ speakerEnabled: false });
      return;
    }
    const outputs = await AudioSession.getAudioOutputs();
    if (!outputs.includes('bluetooth')) throw new Error('No Bluetooth audio device is connected.');
    await AudioSession.selectAudioOutput('bluetooth');
    this.set({ speakerEnabled: false });
  }
  async toggleCamera() { if (!this.room) return; const enabled = !this.state.cameraEnabled; if (enabled && Platform.OS === 'android' && await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA) !== PermissionsAndroid.RESULTS.GRANTED) throw new Error('Camera permission denied.'); await this.room.localParticipant.setCameraEnabled(enabled); const track = enabled ? [...this.room.localParticipant.videoTrackPublications.values()].find((publication) => publication.track)?.track as VideoTrack | null ?? null : null; this.set({ cameraEnabled: enabled, localVideoTrack: track }); }

  private watchCallStatus(callId: string) {
    this.stopCallChannel();
    const refreshStatus = () => {
      if (this.state.callId !== callId || this.state.status !== 'ringing') return;
      void supabase
        .from('app_calls')
        .select('id, caller_device_id, recipient_device_id, status')
        .eq('id', callId)
        .maybeSingle()
        .then(({ data }) => { if (data) this.handleCallStatus(callId, data as AppCall); });
    };
    this.callChannel = supabase
      .channel(`call-status-${callId}`)
      .on('postgres_changes', { event: 'UPDATE', filter: `id=eq.${callId}`, schema: 'public', table: 'app_calls' }, (payload) => {
        this.handleCallStatus(callId, payload.new as AppCall);
      })
      .subscribe((status) => {
        if (status !== 'SUBSCRIBED') return;
        refreshStatus();
      });
    this.callStatusPoll = setInterval(refreshStatus, 750);
  }

  private handleCallStatus(callId: string, call: AppCall) {
    if (this.state.callId !== callId) return;
    if (call.status === 'declined' || call.status === 'ended') {
      void this.finish();
      return;
    }
    if (call.status !== 'active' || this.state.role !== 'caller' || this.state.status !== 'ringing') return;
    const remoteLabel = this.state.remoteLabel;
    InCallManager.stopRingback();
    this.set({ status: 'connecting' });
    void this.connectSpeakRoom(callId, 'caller', remoteLabel).catch(async (error) => {
      await this.closeFailedCall(callId);
      Alert.alert('Unable to connect', error instanceof Error ? error.message : 'The LiveKit room could not be joined.');
    });
  }

  private async closeFailedCall(callId: string) {
    const identity = await getLocalCallableIdentity();
    const cleanup = this.finish();
    if (identity) await supabase.rpc('finish_direct_app_call', { p_call_id: callId, p_device_id: identity.deviceId, p_final_status: 'ended' });
    await cleanup;
  }

  private stopIncomingChannel() { if (!this.incomingChannel) return; void supabase.removeChannel(this.incomingChannel); this.incomingChannel = null; }
  private stopCallChannel() {
    if (this.callStatusPoll) clearInterval(this.callStatusPoll);
    this.callStatusPoll = null;
    if (!this.callChannel) return;
    void supabase.removeChannel(this.callChannel);
    this.callChannel = null;
  }
  private async finish() {
    const room = this.room;
    this.room = null;
    this.stopCallChannel();
    InCallManager.stopRingback();
    InCallManager.stopRingtone();
    InCallManager.stop();
    this.set(INITIAL);
    await this.microphoneProcessor.dispose();
    if (room) {
      room.removeAllListeners();
      await room.localParticipant.setCameraEnabled(false).catch(() => undefined);
      await room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
      await room.disconnect().catch(() => undefined);
    }
    await AudioSession.stopAudioSession().catch(() => undefined);
  }
}

export const CallService = new SpeakCallService();
