export type CallStatus = 'idle' | 'ringing' | 'connecting' | 'connected' | 'reconnecting' | 'ending' | 'ended' | 'failed';

// Roles are deterministic from participant identity, set once at call creation.
// Never inferred from track order, connection order, language, or who speaks first.
export type CallSession = {
  callId: string;
  callerDeviceId: string;
  // Unknown when the caller creates the call. Resolved when the recipient answers.
  recipientDeviceId: string | null;
  callerLanguage: string;
  recipientLanguage: string;
  callerParticipantIdentity: string;
  recipientParticipantIdentity: string;
  status: CallStatus;
};

export type CallRole = 'caller' | 'recipient';

export function resolveCallRole(session: Pick<CallSession, 'callerParticipantIdentity' | 'recipientParticipantIdentity'>, participantIdentity: string): CallRole | null {
  if (participantIdentity === session.callerParticipantIdentity) return 'caller';
  if (participantIdentity === session.recipientParticipantIdentity) return 'recipient';
  return null;
}
