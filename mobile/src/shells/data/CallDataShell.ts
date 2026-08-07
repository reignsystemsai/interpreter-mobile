import type { CallStatus } from './CallSession';

// Supabase call-record contract only — no implementation yet.
// Supabase is never responsible for iOS microphone permission state.
export type CallRecord = {
  id: string;
  callerDeviceId: string;
  // Unknown when the call record is created. Resolved when the recipient answers.
  recipientDeviceId: string | null;
  recipientPhoneNumber: string;
  callerLanguage: string;
  recipientLanguage: string;
  // Immutable once created. Never regenerated during answer or reconnect.
  callerParticipantIdentity: string;
  recipientParticipantIdentity: string;
  status: CallStatus;
  createdAt: string;
  endedAt: string | null;
};

export interface CallDataShell {
  createCallRecord(input: {
    callerDeviceId: string;
    recipientDeviceId: string | null;
    recipientPhoneNumber: string;
    callerLanguage: string;
    recipientLanguage: string;
    callerParticipantIdentity: string;
    recipientParticipantIdentity: string;
  }): Promise<CallRecord>;

  // Atomically: finds the ringing call, verifies recipientDeviceId is null or already
  // this same device (idempotent), rejects a different device, reserves the device
  // against conflicting active calls, writes the resolved device, and moves the
  // record from "ringing" to "connecting".
  claimRecipient(callId: string, recipientDeviceId: string): Promise<CallRecord>;

  updateCallStatus(callId: string, status: CallStatus): Promise<void>;

  getCallRecord(callId: string): Promise<CallRecord | null>;
}
