import type { CallDataShell, CallRecord } from '../data/CallDataShell';
import type { CallSession, CallStatus } from '../data/CallSession';
import { CallingError } from './CallingError';
import type { CallingShell } from './CallingShell';
import type { DeviceIdentityProvider } from './DeviceIdentityProvider';

export type CallingShellDependencies = {
  callData: CallDataShell;
  deviceIdentity: DeviceIdentityProvider;
  createId: () => string;
};

const ALLOWED_TRANSITIONS: Record<CallStatus, readonly CallStatus[]> = {
  idle: ['ringing'],
  ringing: ['connecting', 'ended', 'failed'],
  connecting: ['connected', 'reconnecting', 'ending', 'failed'],
  connected: ['reconnecting', 'ending', 'failed'],
  reconnecting: ['connected', 'ending', 'failed'],
  ending: ['ended'],
  ended: [],
  failed: [],
};

function isTerminalStatus(status: CallStatus): boolean {
  return status === 'ended' || status === 'failed';
}

function assertValidTransition(from: CallStatus, to: CallStatus): void {
  if (from === to) return; // repeating the current state is an idempotent no-op
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new CallingError('INVALID_CALL_STATE', `Cannot transition call status from "${from}" to "${to}".`);
  }
}

function recordToSession(record: CallRecord, status: CallStatus): CallSession {
  return {
    callId: record.id,
    callerDeviceId: record.callerDeviceId,
    recipientDeviceId: record.recipientDeviceId,
    callerLanguage: record.callerLanguage,
    recipientLanguage: record.recipientLanguage,
    callerParticipantIdentity: record.callerParticipantIdentity,
    recipientParticipantIdentity: record.recipientParticipantIdentity,
    status,
  };
}

function asCallingError(cause: unknown, code: 'PERSISTENCE_FAILED', message: string): CallingError {
  return cause instanceof CallingError ? cause : new CallingError(code, message, { cause });
}

// Public-contract implementation only. Not wired into the running app — the active
// VoiceCallService remains the production calling path. Holds at most one local
// CallSession; every mutating method commits through a monotonic operation token so
// a delayed async result from a superseded operation can never overwrite a newer one.
export class CallingShellImpl implements CallingShell {
  private readonly deps: CallingShellDependencies;
  private session: CallSession | null = null;
  private readonly listeners = new Set<(session: CallSession | null) => void>();
  private operationId = 0;

  constructor(deps: CallingShellDependencies) {
    this.deps = deps;
  }

  getSession(): CallSession | null {
    return this.session ? { ...this.session } : null;
  }

  subscribe(listener: (session: CallSession | null) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSession());
    let unsubscribed = false;
    return () => {
      if (unsubscribed) return;
      unsubscribed = true;
      this.listeners.delete(listener);
    };
  }

  async createCall(input: { callerDeviceId: string; recipientPhoneNumber: string; recipientUserId: string; callerLanguage: string; recipientLanguage: string }): Promise<CallSession> {
    if (this.session && !isTerminalStatus(this.session.status)) {
      throw new CallingError('ACTIVE_CALL_EXISTS', 'A call is already active on this device.');
    }
    const operationId = this.beginOperation();

    const callId = this.deps.createId();
    const callerParticipantIdentity = `speak:${callId}:caller:${this.deps.createId()}`;
    const recipientParticipantIdentity = `speak:${callId}:recipient:${this.deps.createId()}`;

    let record: CallRecord;
    try {
      record = await this.deps.callData.createCallRecord({
        callerDeviceId: input.callerDeviceId,
        recipientDeviceId: null,
        recipientPhoneNumber: input.recipientPhoneNumber,
        recipientUserId: input.recipientUserId,
        callerLanguage: input.callerLanguage,
        recipientLanguage: input.recipientLanguage,
        callerParticipantIdentity,
        recipientParticipantIdentity,
      });
    } catch (cause) {
      throw asCallingError(cause, 'PERSISTENCE_FAILED', 'Unable to create the call.');
    }

    const session = recordToSession(record, 'ringing');
    this.commit(operationId, session);
    return session;
  }

  presentIncomingCall(session: CallSession): void {
    if (session.status !== 'ringing') {
      throw new CallingError('INVALID_CALL_STATE', 'An incoming call must be presented in the "ringing" state.');
    }
    if (this.session && !isTerminalStatus(this.session.status)) {
      throw new CallingError('ACTIVE_CALL_EXISTS', 'A call is already active on this device.');
    }
    const operationId = this.beginOperation();
    this.commit(operationId, { ...session });
  }

  async answerCall(callId: string): Promise<CallSession> {
    const current = this.requireSession(callId, 'ringing');
    const operationId = this.beginOperation();

    const recipientDeviceId = await this.deps.deviceIdentity.getDeviceId();

    let record: CallRecord;
    try {
      record = await this.deps.callData.claimRecipient(callId, recipientDeviceId);
    } catch (cause) {
      throw asCallingError(cause, 'PERSISTENCE_FAILED', 'Unable to answer the call.');
    }

    if (
      record.callerParticipantIdentity !== current.callerParticipantIdentity ||
      record.recipientParticipantIdentity !== current.recipientParticipantIdentity
    ) {
      throw new CallingError('CALL_ID_MISMATCH', 'The claimed call record does not match the local session.');
    }

    const session = recordToSession(record, 'connecting');
    this.commit(operationId, session);
    return session;
  }

  async confirmConnected(callId: string): Promise<CallSession> {
    const current = this.requireSession(callId);
    assertValidTransition(current.status, 'connected');
    const operationId = this.beginOperation();

    try {
      await this.deps.callData.updateCallStatus(callId, 'connected');
    } catch (cause) {
      throw asCallingError(cause, 'PERSISTENCE_FAILED', 'Unable to confirm the call as connected.');
    }

    const session: CallSession = { ...current, status: 'connected' };
    this.commit(operationId, session);
    return session;
  }

  async declineCall(callId: string): Promise<void> {
    this.requireSession(callId, 'ringing');
    const operationId = this.beginOperation();

    try {
      // Locked contract uses the existing "ended" state for a normal decline.
      await this.deps.callData.updateCallStatus(callId, 'ended');
    } catch (cause) {
      const error = asCallingError(cause, 'PERSISTENCE_FAILED', 'Unable to decline the call.');
      // The backend already considers this call over (e.g. the other side ended or
      // declined it first) — that is the outcome we wanted anyway, so clear local
      // state instead of leaving a stale session that blocks a new call.
      if (error.code !== 'INVALID_CALL_STATE') throw error;
    }

    this.commit(operationId, null);
  }

  async endCall(callId: string): Promise<void> {
    const current = this.requireSession(callId);
    if (isTerminalStatus(current.status)) {
      throw new CallingError('INVALID_CALL_STATE', 'Cannot end a call that has already ended.');
    }
    const operationId = this.beginOperation();

    try {
      // "ringing" has no -> ending edge; it goes straight to "ended". Every other
      // nonterminal state passes through "ending" first.
      if (ALLOWED_TRANSITIONS[current.status].includes('ending')) {
        assertValidTransition(current.status, 'ending');
        await this.deps.callData.updateCallStatus(callId, 'ending');
      } else {
        assertValidTransition(current.status, 'ended');
      }
      await this.deps.callData.updateCallStatus(callId, 'ended');
    } catch (cause) {
      const error = asCallingError(cause, 'PERSISTENCE_FAILED', 'Unable to end the call. The call remains active locally for retry.');
      // INVALID_CALL_STATE here means the backend already has this call in a
      // terminal state (the other participant already ended/declined it) — that is
      // the outcome this call wanted anyway. Clear local state rather than leaving
      // it stuck, which would otherwise block placing a new call from this device.
      // Any other failure still leaves local state untouched so a retry is possible.
      if (error.code !== 'INVALID_CALL_STATE') throw error;
    }

    this.commit(operationId, null);
  }

  async reconnect(callId: string): Promise<CallSession> {
    const current = this.requireSession(callId);
    if (current.status !== 'connecting' && current.status !== 'connected' && current.status !== 'reconnecting') {
      throw new CallingError('INVALID_CALL_STATE', 'Reconnect is only valid from connecting, connected, or reconnecting.');
    }
    const operationId = this.beginOperation();

    if (current.status !== 'reconnecting') {
      try {
        await this.deps.callData.updateCallStatus(callId, 'reconnecting');
      } catch (cause) {
        throw asCallingError(cause, 'PERSISTENCE_FAILED', 'Unable to start reconnecting.');
      }
    }

    const record = await this.deps.callData.getCallRecord(callId);
    if (!record || record.id !== callId) {
      throw new CallingError('CALL_NOT_FOUND', 'The call record could not be found for reconnect.');
    }
    if (
      record.callerParticipantIdentity !== current.callerParticipantIdentity ||
      record.recipientParticipantIdentity !== current.recipientParticipantIdentity
    ) {
      throw new CallingError('CALL_ID_MISMATCH', 'Participant identities changed unexpectedly during reconnect.');
    }

    const session = recordToSession(record, 'reconnecting');
    this.commit(operationId, session);
    return session;
  }

  private beginOperation(): number {
    this.operationId += 1;
    return this.operationId;
  }

  private commit(operationId: number, session: CallSession | null): void {
    if (operationId !== this.operationId) {
      throw new CallingError('STALE_OPERATION', 'A newer call operation has already superseded this one.');
    }
    this.session = session;
    this.notify();
  }

  private notify(): void {
    const snapshot = this.getSession();
    for (const listener of [...this.listeners]) {
      try {
        listener(snapshot);
      } catch {
        // A single listener's failure must not block the others.
      }
    }
  }

  private requireSession(callId: string, expectedStatus?: CallStatus): CallSession {
    if (!this.session) throw new CallingError('CALL_NOT_FOUND', 'There is no active call.');
    if (this.session.callId !== callId) throw new CallingError('CALL_ID_MISMATCH', 'The provided call ID does not match the active session.');
    if (expectedStatus && this.session.status !== expectedStatus) {
      throw new CallingError('INVALID_CALL_STATE', `Expected call status "${expectedStatus}" but found "${this.session.status}".`);
    }
    return this.session;
  }
}
