import assert from 'node:assert/strict';
import test from 'node:test';

import type { CallDataShell, CallRecord } from '../data/CallDataShell';
import { resolveCallRole, type CallStatus } from '../data/CallSession';
import { CallingError } from './CallingError';
import { CallingShellImpl } from './CallingShellImpl';
import type { DeviceIdentityProvider } from './DeviceIdentityProvider';

class FakeCallDataShell implements CallDataShell {
  records = new Map<string, CallRecord>();
  activeDevices = new Map<string, string>(); // deviceId -> callId
  private nextId = 0;

  async createCallRecord(input: {
    callerDeviceId: string;
    recipientDeviceId: string | null;
    recipientPhoneNumber: string;
    callerLanguage: string;
    recipientLanguage: string;
    callerParticipantIdentity: string;
    recipientParticipantIdentity: string;
  }): Promise<CallRecord> {
    if (this.activeDevices.has(input.callerDeviceId)) {
      throw new CallingError('DEVICE_ALREADY_ACTIVE', 'Caller device already has an active call.');
    }
    const id = `call-${this.nextId++}`;
    const record: CallRecord = {
      id,
      callerDeviceId: input.callerDeviceId,
      recipientDeviceId: null,
      recipientPhoneNumber: input.recipientPhoneNumber,
      callerLanguage: input.callerLanguage,
      recipientLanguage: input.recipientLanguage,
      callerParticipantIdentity: input.callerParticipantIdentity,
      recipientParticipantIdentity: input.recipientParticipantIdentity,
      status: 'ringing',
      createdAt: new Date().toISOString(),
      endedAt: null,
    };
    this.records.set(id, record);
    this.activeDevices.set(input.callerDeviceId, id);
    return { ...record };
  }

  async claimRecipient(callId: string, recipientDeviceId: string): Promise<CallRecord> {
    const record = this.records.get(callId);
    if (!record) throw new CallingError('CALL_NOT_FOUND', 'Call not found.');
    if (record.recipientDeviceId !== null && record.recipientDeviceId !== recipientDeviceId) {
      throw new CallingError('RECIPIENT_ALREADY_CLAIMED', 'Call already claimed by another device.');
    }
    const existingCallForDevice = this.activeDevices.get(recipientDeviceId);
    if (existingCallForDevice && existingCallForDevice !== callId) {
      throw new CallingError('DEVICE_ALREADY_ACTIVE', 'Recipient device already has an active call.');
    }
    const updated: CallRecord = { ...record, recipientDeviceId, status: 'connecting' };
    this.records.set(callId, updated);
    this.activeDevices.set(recipientDeviceId, callId);
    return { ...updated };
  }

  async updateCallStatus(callId: string, status: CallStatus): Promise<void> {
    const record = this.records.get(callId);
    if (!record) throw new CallingError('CALL_NOT_FOUND', 'Call not found.');
    const updated: CallRecord = { ...record, status, endedAt: status === 'ended' ? new Date().toISOString() : record.endedAt };
    this.records.set(callId, updated);
    if (status === 'ended' || status === 'failed') {
      for (const [deviceId, id] of [...this.activeDevices.entries()]) {
        if (id === callId) this.activeDevices.delete(deviceId);
      }
    }
  }

  async getCallRecord(callId: string): Promise<CallRecord | null> {
    const record = this.records.get(callId);
    return record ? { ...record } : null;
  }
}

class FakeDeviceIdentityProvider implements DeviceIdentityProvider {
  private readonly deviceId: string;
  constructor(deviceId: string) {
    this.deviceId = deviceId;
  }
  async getDeviceId(): Promise<string> {
    return this.deviceId;
  }
}

function makeCreateId(prefix: string) {
  let count = 0;
  return () => `${prefix}-${count++}`;
}

function makeShell(overrides?: { callData?: CallDataShell; deviceId?: string; idPrefix?: string }) {
  const callData = overrides?.callData ?? new FakeCallDataShell();
  const deviceIdentity = new FakeDeviceIdentityProvider(overrides?.deviceId ?? 'device-recipient');
  const createId = makeCreateId(overrides?.idPrefix ?? 'id');
  return { callData, shell: new CallingShellImpl({ callData, createId, deviceIdentity }) };
}

const CALLER_INPUT = { callerDeviceId: 'device-caller', callerLanguage: 'en', recipientLanguage: 'es', recipientPhoneNumber: '+15550000000' };

test('outgoing call begins with recipientDeviceId null', async () => {
  const { shell } = makeShell();
  const session = await shell.createCall(CALLER_INPUT);
  assert.equal(session.recipientDeviceId, null);
  assert.equal(session.status, 'ringing');
});

test('both participant identities are generated once and persisted', async () => {
  const { callData, shell } = makeShell();
  const session = await shell.createCall(CALLER_INPUT);
  assert.ok(session.callerParticipantIdentity.length > 0);
  assert.ok(session.recipientParticipantIdentity.length > 0);
  assert.notEqual(session.callerParticipantIdentity, session.recipientParticipantIdentity);
  const stored = await callData.getCallRecord(session.callId);
  assert.equal(stored?.callerParticipantIdentity, session.callerParticipantIdentity);
  assert.equal(stored?.recipientParticipantIdentity, session.recipientParticipantIdentity);
});

test('answer resolves the recipient device without changing identities', async () => {
  const { shell } = makeShell();
  const created = await shell.createCall(CALLER_INPUT);
  const answered = await shell.answerCall(created.callId);
  assert.equal(answered.recipientDeviceId, 'device-recipient');
  assert.equal(answered.status, 'connecting');
  assert.equal(answered.callerParticipantIdentity, created.callerParticipantIdentity);
  assert.equal(answered.recipientParticipantIdentity, created.recipientParticipantIdentity);
});

test('a second device cannot claim an already claimed recipient', async () => {
  const callData = new FakeCallDataShell();
  const { shell } = makeShell({ callData });
  const created = await shell.createCall(CALLER_INPUT);
  await shell.answerCall(created.callId);
  await assert.rejects(
    () => callData.claimRecipient(created.callId, 'device-b'),
    (err: unknown) => err instanceof CallingError && err.code === 'RECIPIENT_ALREADY_CLAIMED',
  );
});

test('one device cannot own two active calls', async () => {
  const callData = new FakeCallDataShell();
  const { shell } = makeShell({ callData });
  await shell.createCall(CALLER_INPUT);
  await assert.rejects(
    () =>
      callData.createCallRecord({
        ...CALLER_INPUT,
        callerParticipantIdentity: 'x',
        recipientDeviceId: null,
        recipientParticipantIdentity: 'y',
      }),
    (err: unknown) => err instanceof CallingError && err.code === 'DEVICE_ALREADY_ACTIVE',
  );
});

test('invalid status transitions are rejected', async () => {
  const { shell } = makeShell();
  const created = await shell.createCall(CALLER_INPUT);
  // "ringing" cannot reconnect — reconnect is only valid from connecting/connected/reconnecting.
  await assert.rejects(() => shell.reconnect(created.callId), (err: unknown) => err instanceof CallingError && err.code === 'INVALID_CALL_STATE');
});

test('repeating the same status is idempotent', async () => {
  const { shell } = makeShell();
  const created = await shell.createCall(CALLER_INPUT);
  await shell.answerCall(created.callId);
  const first = await shell.reconnect(created.callId);
  const second = await shell.reconnect(created.callId);
  assert.equal(first.status, 'reconnecting');
  assert.equal(second.status, 'reconnecting');
});

test('reconnect preserves the call ID and participant identities', async () => {
  const { shell } = makeShell();
  const created = await shell.createCall(CALLER_INPUT);
  const answered = await shell.answerCall(created.callId);
  const reconnected = await shell.reconnect(answered.callId);
  assert.equal(reconnected.callId, created.callId);
  assert.equal(reconnected.callerParticipantIdentity, created.callerParticipantIdentity);
  assert.equal(reconnected.recipientParticipantIdentity, created.recipientParticipantIdentity);
});

test('end clears local state and releases reservations', async () => {
  const callData = new FakeCallDataShell();
  const { shell } = makeShell({ callData });
  const created = await shell.createCall(CALLER_INPUT);
  await shell.answerCall(created.callId);
  await shell.endCall(created.callId);
  assert.equal(shell.getSession(), null);
  const record = await callData.getCallRecord(created.callId);
  assert.equal(record?.status, 'ended');
  assert.equal(callData.activeDevices.size, 0);
});

test('failed terminal persistence does not falsely clear the call', async () => {
  const callData = new FakeCallDataShell();
  const originalUpdate = callData.updateCallStatus.bind(callData);
  callData.updateCallStatus = async (callId: string, status: CallStatus) => {
    if (status === 'ended') throw new Error('simulated db failure');
    return originalUpdate(callId, status);
  };
  const { shell } = makeShell({ callData });
  const created = await shell.createCall(CALLER_INPUT);
  await shell.answerCall(created.callId);
  await assert.rejects(() => shell.endCall(created.callId), (err: unknown) => err instanceof CallingError && err.code === 'PERSISTENCE_FAILED');
  assert.notEqual(shell.getSession(), null);
  assert.equal(shell.getSession()?.callId, created.callId);
});

test('subscribers receive correct changes and unsubscribe safely', async () => {
  const { shell } = makeShell();
  const received: Array<ReturnType<typeof shell.getSession>> = [];
  const unsubscribe = shell.subscribe((session) => received.push(session));
  await shell.createCall(CALLER_INPUT);
  unsubscribe();
  unsubscribe(); // idempotent — must not throw or double-remove
  assert.equal(received.length, 2); // initial null on subscribe, then the created session
  assert.equal(received[0], null);
  assert.notEqual(received[1], null);
});

test('a stale result from Call A cannot overwrite Call B', async () => {
  const callData = new FakeCallDataShell();
  let releaseA: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { releaseA = resolve; });
  let callCount = 0;
  const originalCreate = callData.createCallRecord.bind(callData);
  callData.createCallRecord = async (input) => {
    callCount += 1;
    if (callCount === 1) await gate; // only Call A stalls
    return originalCreate(input);
  };
  const { shell } = makeShell({ callData });

  const promiseA = shell.createCall({ ...CALLER_INPUT, callerDeviceId: 'device-a' });
  const sessionB = await shell.createCall({ ...CALLER_INPUT, callerDeviceId: 'device-b' });
  releaseA();
  await assert.rejects(() => promiseA, (err: unknown) => err instanceof CallingError && err.code === 'STALE_OPERATION');
  assert.equal(shell.getSession()?.callId, sessionB.callId);
});

test('caller and recipient roles remain deterministic', async () => {
  const { shell } = makeShell();
  const created = await shell.createCall(CALLER_INPUT);
  assert.equal(resolveCallRole(created, created.callerParticipantIdentity), 'caller');
  assert.equal(resolveCallRole(created, created.recipientParticipantIdentity), 'recipient');
  assert.equal(resolveCallRole(created, 'unknown-identity'), null);
});

test('decline moves a ringing call to ended and clears local state', async () => {
  const callData = new FakeCallDataShell();
  const { shell } = makeShell({ callData });
  const created = await shell.createCall(CALLER_INPUT);
  await shell.declineCall(created.callId);
  assert.equal(shell.getSession(), null);
  const record = await callData.getCallRecord(created.callId);
  assert.equal(record?.status, 'ended');
});
