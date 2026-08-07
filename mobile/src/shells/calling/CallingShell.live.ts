import { getDeviceId } from '../../services/deviceRegistration';
import { LiveAudioShell } from '../audio/AudioShell.live';
import { LiveCallDataGateway, type PlainCallConnection } from '../data/CallDataShell.live';
import type { CallSession, CallStatus } from '../data/CallSession';
import type { CallingShell } from './CallingShell';

// Fresh per-call state. Every createCall/answerCall builds a brand new CallSession,
// a brand new LiveAudioShell (and therefore a brand new Room instance), and a brand
// new gateway — nothing is reused across calls.
export class CallingShellLive implements CallingShell {
  private session: CallSession | null = null;
  private audio: LiveAudioShell | null = null;
  private listeners = new Set<(session: CallSession | null) => void>();

  getSession(): CallSession | null {
    return this.session;
  }

  subscribe(listener: (session: CallSession | null) => void): () => void {
    this.listeners.add(listener);
    listener(this.session);
    return () => { this.listeners.delete(listener); };
  }

  private setSession(session: CallSession | null) {
    this.session = session;
    this.listeners.forEach((listener) => listener(session));
  }

  private setStatus(status: CallStatus) {
    if (!this.session) return;
    this.setSession({ ...this.session, status });
  }

  async createCall(input: { callerDeviceId: string; callerLanguage: string; recipientPhoneNumber: string; recipientLanguage: string }): Promise<CallSession> {
    const gateway = new LiveCallDataGateway();
    const connection = await gateway.startCall({
      callerLanguage: input.callerLanguage,
      recipientLanguage: input.recipientLanguage,
      recipientPhoneNumber: input.recipientPhoneNumber,
    });
    const session: CallSession = {
      callId: connection.callId,
      callerDeviceId: input.callerDeviceId,
      callerLanguage: input.callerLanguage,
      callerParticipantIdentity: `${input.callerDeviceId}:${connection.callId}:caller`,
      // The recipient's device identity isn't known to the caller until they answer;
      // this is a best-effort client-side view, not the authoritative server record.
      recipientDeviceId: 'unknown',
      recipientLanguage: input.recipientLanguage,
      recipientParticipantIdentity: `unknown:${connection.callId}:recipient`,
      status: 'ringing',
    };
    this.setSession(session);
    await this.connectAudio(connection);
    return session;
  }

  presentIncomingCall(session: CallSession): void {
    this.setSession(session);
  }

  async answerCall(callId: string): Promise<CallSession> {
    const gateway = new LiveCallDataGateway();
    const connection = await gateway.acceptCall(callId);
    const recipientDeviceId = await getDeviceId();
    const existing = this.session;
    const session: CallSession = {
      callId: connection.callId,
      callerDeviceId: existing?.callerDeviceId ?? 'unknown',
      callerLanguage: existing?.callerLanguage ?? '',
      callerParticipantIdentity: existing?.callerParticipantIdentity ?? `unknown:${connection.callId}:caller`,
      recipientDeviceId,
      recipientLanguage: existing?.recipientLanguage ?? '',
      recipientParticipantIdentity: `${recipientDeviceId}:${connection.callId}:recipient`,
      status: 'connecting',
    };
    this.setSession(session);
    await this.connectAudio(connection);
    return session;
  }

  async declineCall(callId: string): Promise<void> {
    const gateway = new LiveCallDataGateway();
    await gateway.endCall(callId);
    this.setSession(null);
  }

  async endCall(callId: string): Promise<void> {
    const gateway = new LiveCallDataGateway();
    const audio = this.audio;
    this.audio = null;
    if (audio) {
      await audio.disableMicrophone();
      await audio.detachSubscriptions();
      await audio.disconnectRoom();
      await audio.releaseCallAudioState();
    }
    await gateway.endCall(callId);
    this.setSession(null);
  }

  async reconnect(callId: string): Promise<CallSession> {
    if (!this.session || this.session.callId !== callId) throw new Error('No matching session to reconnect');
    this.setStatus('reconnecting');
    return this.session;
  }

  async confirmConnected(callId: string): Promise<CallSession> {
    if (!this.session || this.session.callId !== callId) throw new Error('No matching session to confirm connected');
    this.setStatus('connected');
    return this.session;
  }

  private async connectAudio(connection: PlainCallConnection): Promise<void> {
    const audio = new LiveAudioShell();
    this.audio = audio;
    const permission = await audio.checkMicrophonePermission();
    if (permission !== 'granted') await audio.requestMicrophonePermission();
    await audio.activateCallAudioSession();
    await audio.connectRoom({ livekitUrl: connection.livekitUrl, token: connection.token });
    await audio.enableLocalMicrophone();
    await audio.publishMicrophoneTrack();
    await audio.subscribeToRemoteMicrophone(() => this.setStatus('connected'));
    const active = await audio.verifyAudioActive();
    this.setStatus(active ? 'connected' : 'connecting');
  }
}
