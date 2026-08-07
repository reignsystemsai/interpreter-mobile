import type { CallSession } from '../data/CallSession';

// Public contract only — no implementation yet. The active VoiceCallService remains
// the running implementation until a Calling Shell implementation replaces it.
export interface CallingShell {
  createCall(input: {
    callerDeviceId: string;
    // The recipient's device isn't known until they answer; calls are placed by
    // phone number, same as the existing product's dialing flow.
    recipientPhoneNumber: string;
    callerLanguage: string;
    recipientLanguage: string;
  }): Promise<CallSession>;

  presentIncomingCall(session: CallSession): void;

  answerCall(callId: string): Promise<CallSession>;

  // Moves a session from "connecting" or "reconnecting" to "connected" once the
  // media layer confirms the remote participant's audio is actually flowing. The
  // shell has no LiveKit awareness itself; a media adapter calls this.
  confirmConnected(callId: string): Promise<CallSession>;

  declineCall(callId: string): Promise<void>;

  endCall(callId: string): Promise<void>;

  reconnect(callId: string): Promise<CallSession>;

  // A device has at most one active call at a time.
  getSession(): CallSession | null;

  // Every call must start from clean state; no call may depend on a previous call's
  // leftover session/audio state.
  subscribe(listener: (session: CallSession | null) => void): () => void;
}
