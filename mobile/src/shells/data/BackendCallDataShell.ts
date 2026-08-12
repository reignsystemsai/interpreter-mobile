import { API_BASE_URL } from '../../config/runtime';
import { CallingError } from '../calling/CallingError';
import type { DeviceIdentityProvider } from '../calling/DeviceIdentityProvider';
import type { CallStatus } from './CallSession';
import type { CallDataShell, CallRecord } from './CallDataShell';

type ApiErrorPayload = { code?: string; error?: string };

type CallSessionPayload = {
  id: string;
  callerDeviceId: string;
  recipientDeviceId: string | null;
  recipientUserId: string;
  recipientPhoneNumber: string;
  callerLanguage: string;
  recipientLanguage: string;
  callerParticipantIdentity: string;
  recipientParticipantIdentity: string;
  status: CallStatus;
  createdAt: string;
  endedAt: string | null;
};

// Maps the backend's stable JSON error codes (src/server/routes/callSessions.js) to the
// existing CallingErrorCode union. "not_call_participant" has no dedicated code in that
// union — it is mapped to CALL_NOT_FOUND, which is also the correct caller-facing
// behavior: a call this device isn't part of should be indistinguishable from one that
// doesn't exist.
function errorCodeFor(backendCode: string | undefined): CallingError['code'] {
  switch (backendCode) {
    case 'device_already_active':
      return 'DEVICE_ALREADY_ACTIVE';
    case 'call_not_found':
    case 'not_call_participant':
      return 'CALL_NOT_FOUND';
    case 'recipient_already_claimed':
      return 'RECIPIENT_ALREADY_CLAIMED';
    case 'invalid_call_state':
      return 'INVALID_CALL_STATE';
    default:
      return 'PERSISTENCE_FAILED';
  }
}

function toCallRecord(payload: CallSessionPayload): CallRecord {
  return {
    id: payload.id,
    callerDeviceId: payload.callerDeviceId,
    recipientDeviceId: payload.recipientDeviceId,
    recipientPhoneNumber: payload.recipientPhoneNumber,
    callerLanguage: payload.callerLanguage,
    recipientLanguage: payload.recipientLanguage,
    callerParticipantIdentity: payload.callerParticipantIdentity,
    recipientParticipantIdentity: payload.recipientParticipantIdentity,
    status: payload.status,
    createdAt: payload.createdAt,
    endedAt: payload.endedAt,
  };
}

// Talks only to the privileged backend (src/server/routes/callSessions.js), which alone
// holds Supabase service-role access. This shell never touches Supabase directly and
// never sees service-role credentials — consistent with how VoiceCallService (the
// active, unrelated production calling path) already reaches the backend, though this
// class does not import or depend on it.
//
// The CallDataShell contract's updateCallStatus/getCallRecord take no device identity,
// but the backend authorizes those requests by participant device id. This adapter
// resolves the current device via the existing DeviceIdentityProvider dependency
// internally, rather than widening the shared CallDataShell interface for one
// implementation.
export class BackendCallDataShell implements CallDataShell {
  private readonly deviceIdentity: DeviceIdentityProvider;

  constructor(deviceIdentity: DeviceIdentityProvider) {
    this.deviceIdentity = deviceIdentity;
  }

  private async requestJson<T>(path: string, init: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}${path}`, {
        ...init,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...init.headers },
      });
    } catch (cause) {
      throw new CallingError('PERSISTENCE_FAILED', 'Unable to reach the calling service.', { cause });
    }
    const payload = (await response.json().catch(() => ({}))) as T & ApiErrorPayload;
    if (!response.ok) {
      throw new CallingError(errorCodeFor(payload.code), payload.error || 'Unable to reach the calling service.');
    }
    return payload;
  }

  async createCallRecord(input: {
    callerDeviceId: string;
    recipientDeviceId: string | null;
    recipientPhoneNumber: string;
    callerLanguage: string;
    recipientLanguage: string;
    callerParticipantIdentity: string;
    recipientParticipantIdentity: string;
  }): Promise<CallRecord> {
    const payload = await this.requestJson<CallSessionPayload>('/api/v1/call-sessions', {
      method: 'POST',
      body: JSON.stringify({
        callerDeviceId: input.callerDeviceId,
        recipientPhoneNumber: input.recipientPhoneNumber,
        recipientUserId: input.recipientUserId,
        callerLanguage: input.callerLanguage,
        recipientLanguage: input.recipientLanguage,
        callerParticipantIdentity: input.callerParticipantIdentity,
        recipientParticipantIdentity: input.recipientParticipantIdentity,
      }),
    });
    return toCallRecord(payload);
  }

  async claimRecipient(callId: string, recipientDeviceId: string): Promise<CallRecord> {
    const payload = await this.requestJson<CallSessionPayload>(`/api/v1/call-sessions/${encodeURIComponent(callId)}/claim`, {
      method: 'POST',
      body: JSON.stringify({ recipientDeviceId }),
    });
    return toCallRecord(payload);
  }

  async updateCallStatus(callId: string, status: CallStatus): Promise<void> {
    const deviceId = await this.deviceIdentity.getDeviceId();
    await this.requestJson<CallSessionPayload>(`/api/v1/call-sessions/${encodeURIComponent(callId)}/transition`, {
      method: 'POST',
      body: JSON.stringify({ deviceId, status }),
    });
  }

  async getCallRecord(callId: string): Promise<CallRecord | null> {
    const deviceId = await this.deviceIdentity.getDeviceId();
    const payload = await this.requestJson<{ found: boolean; call?: CallSessionPayload }>(
      `/api/v1/call-sessions/${encodeURIComponent(callId)}?deviceId=${encodeURIComponent(deviceId)}`,
      { method: 'GET' },
    );
    return payload.found && payload.call ? toCallRecord(payload.call) : null;
  }
}
