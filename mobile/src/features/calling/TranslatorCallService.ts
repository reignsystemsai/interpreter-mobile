import { AudioSession } from '@livekit/react-native';
import { AudioPresets, Room, RoomEvent, Track, type RemoteTrackPublication } from 'livekit-client';
import { Alert } from 'react-native';
import InCallManager from 'react-native-incall-manager';

import { authenticatedRequest } from '../../services/api';
import { supabase } from '../../services/supabase';
import { recordRecentCall, requestPhoneOpen } from '../phone/PhoneActivityStore';
import { CALL_LANGUAGE_CODES, type CallLanguage, type CallVoice } from './CallLanguageSelection';
import type { CallRole, CallState } from './CallService';
import { ensureCallableIdentity, getLocalCallableIdentity, normalizePhone } from './CallableIdentity';
import { isLocalMicrophoneTrack, SpeakMicrophoneAudioProcessor } from './SpeakMicrophoneAudioProcessor';

type BackendCall = { callerIdentity: string; callerLabel: string; createdAt: number; id: string; recipientIdentity: string; recipientLabel: string; status: 'ringing' | 'connecting' | 'active' | 'declined' | 'ended' | 'failed' };
type CallResponse = { call: BackendCall | null };
type TokenResponse = { call?: BackendCall; participantToken: string; serverUrl: string };

const INITIAL: CallState = { cameraEnabled: false, cameraFacingMode: 'user', callId: null, connectedAt: null, error: '', localVideoTrack: null, muted: false, remoteLabel: '', remotePhone: '', remoteVideoTrack: null, role: null, speakerEnabled: false, status: 'idle' };
const AUDIO = { autoGainControl: false, channelCount: 1, echoCancellation: true, noiseSuppression: true } as const;

class TranslatorCallController {
  private state = INITIAL;
  private room: Room | null = null;
  private incomingTimer: ReturnType<typeof setInterval> | null = null;
  private statusTimer: ReturnType<typeof setInterval> | null = null;
  private cleanupPromise: Promise<void> | null = null;
  private listeners = new Set<(state: CallState) => void>();
  private microphoneProcessor = new SpeakMicrophoneAudioProcessor();

  getState() { return this.state; }
  subscribe(listener: (state: CallState) => void) { this.listeners.add(listener); listener(this.state); return () => { this.listeners.delete(listener); }; }
  private set(patch: Partial<CallState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach((listener) => listener(this.state)); }

  startPolling() {
    let active = true;
    const poll = async () => {
      if (!active || this.state.status !== 'idle') return;
      const identity = await getLocalCallableIdentity();
      if (!identity) return;
      const result = await authenticatedRequest<CallResponse>(`/api/translator-calls/incoming?deviceId=${encodeURIComponent(identity.deviceId)}`).catch(() => null);
      if (result?.call && active && this.state.status === 'idle') this.receiveIncoming(result.call);
    };
    void poll();
    this.incomingTimer = setInterval(() => void poll(), 750);
    return () => { active = false; if (this.incomingTimer) clearInterval(this.incomingTimer); this.incomingTimer = null; };
  }

  async createCall(phone: string, remoteLabel: string, callerLanguage: CallLanguage, recipientLanguage: CallLanguage, callerVoice: CallVoice, recipientVoice: CallVoice) {
    await this.waitForCleanup();
    const identity = await ensureCallableIdentity();
    const phoneE164 = normalizePhone(phone);
    const { data: recipientId, error } = await supabase.rpc('resolve_speak_device', { phone: phoneE164 });
    if (error || !recipientId) throw new Error('This person does not have Interpreter yet.');
    const result = await authenticatedRequest<CallResponse>('/api/translator-calls', {
      method: 'POST',
      body: JSON.stringify({
        callerIdentity: identity.deviceId, callerLabel: identity.displayName,
        callerLanguage: CALL_LANGUAGE_CODES[callerLanguage], callerVoice,
        recipientIdentity: recipientId, recipientLabel: remoteLabel,
        recipientLanguage: CALL_LANGUAGE_CODES[recipientLanguage], recipientVoice,
      }),
    });
    if (!result.call) throw new Error('Translator Call could not be created.');
    this.set({ callId: result.call.id, remoteLabel, remotePhone: phoneE164, role: 'caller', status: 'ringing' });
    this.watchStatus(result.call.id);
    InCallManager.start({ media: 'audio' });
    InCallManager.startRingback('_DEFAULT_');
  }

  private receiveIncoming(call: BackendCall) {
    InCallManager.start({ media: 'audio' });
    InCallManager.startRingtone('_DEFAULT_');
    this.set({ callId: call.id, remoteLabel: call.callerLabel, remotePhone: '', role: 'recipient', status: 'ringing' });
    this.watchStatus(call.id);
  }

  async acceptCall() {
    const callId = this.state.callId;
    const identity = await getLocalCallableIdentity();
    if (!callId || !identity) throw new Error('Calling setup is required.');
    this.set({ status: 'connecting' });
    try {
      const token = await authenticatedRequest<TokenResponse>(`/api/translator-calls/${callId}/answer`, { method: 'POST', body: JSON.stringify({ deviceId: identity.deviceId }) });
      await this.connectRoom(callId, 'recipient', token);
    } catch (error) {
      await this.finish();
      throw error;
    }
  }

  async declineCall() { await this.endWithStatus('declined'); }
  async endCall() { await this.endWithStatus('ended'); }

  async toggleMute() {
    const room = this.room;
    if (!room || this.state.status !== 'connected') return;
    const muted = !this.state.muted;
    if (muted) await room.localParticipant.setMicrophoneEnabled(false); else await this.startMicrophone(room);
    this.set({ muted });
  }

  async toggleSpeaker() {
    if (this.state.status !== 'connected') return;
    const speakerEnabled = !this.state.speakerEnabled;
    await AudioSession.selectAudioOutput(speakerEnabled ? 'force_speaker' : 'default');
    this.set({ speakerEnabled });
  }

  private watchStatus(callId: string) {
    this.stopStatusPolling();
    this.statusTimer = setInterval(() => void this.refreshStatus(callId), 750);
  }

  private async refreshStatus(callId: string) {
    if (this.state.callId !== callId) return;
    const identity = await getLocalCallableIdentity();
    if (!identity) return;
    const result = await authenticatedRequest<CallResponse>(`/api/translator-calls/${callId}?deviceId=${encodeURIComponent(identity.deviceId)}`).catch(() => null);
    const call = result?.call;
    if (!call || this.state.callId !== callId) return;
    if (['declined', 'ended', 'failed'].includes(call.status)) { await this.finish(); return; }
    if (call.status !== 'active' || this.state.role !== 'caller' || this.room) return;
    this.set({ status: 'connecting' });
    try {
      const token = await authenticatedRequest<TokenResponse>(`/api/translator-calls/${callId}/token`, { method: 'POST', body: JSON.stringify({ deviceId: identity.deviceId }) });
      await this.connectRoom(callId, 'caller', token);
    } catch (error) {
      await this.endWithStatus('ended');
      Alert.alert('Unable to connect', error instanceof Error ? error.message : 'Translator Call could not connect.');
    }
  }

  private async connectRoom(callId: string, role: Exclude<CallRole, null>, token: TokenResponse) {
    const room = new Room({ audioCaptureDefaults: AUDIO, publishDefaults: { audioPreset: AudioPresets.music, dtx: true, red: true } });
    this.room = room;
    InCallManager.stopRingback(); InCallManager.stopRingtone(); InCallManager.stop();
    await AudioSession.configureAudio({ ios: { defaultOutput: 'earpiece' } });
    await AudioSession.startAudioSession();
    await AudioSession.selectAudioOutput('default');
    room.on(RoomEvent.TrackPublished, (publication) => this.subscribeTranslation(publication, role));
    room.on(RoomEvent.Reconnecting, () => this.set({ status: 'reconnecting' }));
    room.on(RoomEvent.Reconnected, () => this.set({ status: 'connected' }));
    room.on(RoomEvent.Disconnected, () => { if (this.room === room) void this.endCall(); });
    await room.connect(token.serverUrl, token.participantToken, { autoSubscribe: false });
    for (const participant of room.remoteParticipants.values()) for (const publication of participant.trackPublications.values()) this.subscribeTranslation(publication, role);
    await this.startMicrophone(room);
    await this.waitForTranslation(room, role);
    this.set({ connectedAt: Date.now(), status: 'connected' });
  }

  private subscribeTranslation(publication: RemoteTrackPublication, role: Exclude<CallRole, null>) {
    if (publication.kind === Track.Kind.Audio && publication.trackName === `translation-to-${role}`) publication.setSubscribed(true);
  }

  private async waitForTranslation(room: Room, role: Exclude<CallRole, null>) {
    const name = `translation-to-${role}`;
    const present = () => [...room.remoteParticipants.values()].some((participant) => [...participant.audioTrackPublications.values()].some((publication) => publication.trackName === name && publication.track));
    if (present()) return;
    await new Promise<void>((resolve, reject) => {
      const onSubscribed = (_track: unknown, publication: RemoteTrackPublication) => {
        if (publication.trackName !== name) return;
        clearTimeout(timeout); room.off(RoomEvent.TrackSubscribed, onSubscribed); resolve();
      };
      const timeout = setTimeout(() => { room.off(RoomEvent.TrackSubscribed, onSubscribed); reject(new Error('Translated audio was not received.')); }, 15_000);
      room.on(RoomEvent.TrackSubscribed, onSubscribed);
    });
  }

  private async startMicrophone(room: Room) {
    const publication = await room.localParticipant.setMicrophoneEnabled(true, AUDIO);
    if (!isLocalMicrophoneTrack(publication?.audioTrack)) throw new Error('Microphone track was not published.');
    await this.microphoneProcessor.attach(publication.audioTrack);
  }

  private async endWithStatus(status: 'declined' | 'ended') {
    const callId = this.state.callId;
    const identity = await getLocalCallableIdentity();
    if (callId && identity) await authenticatedRequest<void>(`/api/translator-calls/${callId}/end`, { method: 'POST', body: JSON.stringify({ deviceId: identity.deviceId, status }) }).catch(() => undefined);
    await this.finish();
  }

  private stopStatusPolling() { if (this.statusTimer) clearInterval(this.statusTimer); this.statusTimer = null; }
  private async waitForCleanup() { if (this.cleanupPromise) await this.cleanupPromise; }
  private async finish() {
    if (this.cleanupPromise) return this.cleanupPromise;
    const room = this.room;
    const completed = this.state.callId ? { callId: this.state.callId, kind: this.state.role === 'caller' ? 'outgoing' as const : this.state.status === 'ringing' ? 'missed' as const : 'incoming' as const, label: `${this.state.remoteLabel || 'Call'} · Translator`, phone: this.state.remotePhone } : null;
    this.room = null; this.stopStatusPolling(); InCallManager.stopRingback(); InCallManager.stopRingtone(); InCallManager.stop(); this.set({ status: 'ended' });
    let cleanup: Promise<void>;
    cleanup = (async () => {
      await this.microphoneProcessor.dispose();
      if (room) { room.removeAllListeners(); await room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined); await room.disconnect().catch(() => undefined); }
      await AudioSession.stopAudioSession().catch(() => undefined);
      this.set(INITIAL);
      if (completed) { recordRecentCall(completed); requestPhoneOpen('recents'); }
    })().finally(() => { if (this.cleanupPromise === cleanup) this.cleanupPromise = null; });
    this.cleanupPromise = cleanup;
    return cleanup;
  }
}

export const TranslatorCallService = new TranslatorCallController();
