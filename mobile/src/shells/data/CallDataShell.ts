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
  }): Promise<CallRecord>;

  updateCallStatus(callId: string, status: CallStatus): Promise<void>;

  getCallRecord(callId: string): Promise<CallRecord | null>;
}
