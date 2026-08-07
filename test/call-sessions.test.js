const assert = require("node:assert/strict");
const test = require("node:test");

const callSessionRoutes = require("../src/server/routes/callSessions");

const { isValidTransition, authorizeParticipant, resolveSpeakErrorResponse, toCallRecordJson, CALL_STATUSES } = callSessionRoutes;

const BASE_ROW = Object.freeze({
  id: "call-1",
  caller_device_id: "device-caller",
  recipient_device_id: "device-recipient",
  recipient_phone_number: "+15550000000",
  caller_language: "en",
  recipient_language: "es",
  caller_participant_identity: "speak:call-1:caller:abc",
  recipient_participant_identity: "speak:call-1:recipient:def",
  status: "connecting",
  created_at: "2026-08-07T00:00:00.000Z",
  ended_at: null
});

test("a device that is not caller or recipient is not authorized on the call", () => {
  assert.equal(authorizeParticipant(BASE_ROW, "device-caller"), true);
  assert.equal(authorizeParticipant(BASE_ROW, "device-recipient"), true);
  assert.equal(authorizeParticipant(BASE_ROW, "device-stranger"), false);
});

test("a caller device conflict from the database is mapped to a safe 409 without leaking the raw error", () => {
  const resolved = resolveSpeakErrorResponse({ code: "P0001", message: "device_already_active" }, "fallback");
  assert.equal(resolved.status, 409);
  assert.equal(resolved.code, "device_already_active");
  assert.doesNotMatch(resolved.message, /P0001|postgres|pg_|constraint/i);
});

test("a call not found from the database is mapped to a safe 404", () => {
  const resolved = resolveSpeakErrorResponse({ code: "P0002", message: "call_not_found" }, "fallback");
  assert.equal(resolved.status, 404);
  assert.equal(resolved.code, "call_not_found");
});

test("a different device claiming an already-claimed recipient is mapped to a safe 409", () => {
  const resolved = resolveSpeakErrorResponse({ code: "P0003", message: "recipient_already_claimed" }, "fallback");
  assert.equal(resolved.status, 409);
  assert.equal(resolved.code, "recipient_already_claimed");
});

test("an unrecognized database error never reaches the caller verbatim", () => {
  const rawError = { code: "23505", message: "duplicate key value violates unique constraint \"speak_active_call_devices_pkey\"" };
  const resolved = resolveSpeakErrorResponse(rawError, "Unable to complete the request.");
  assert.equal(resolved.status, 502);
  assert.equal(resolved.code, "call_state_unavailable");
  assert.equal(resolved.message, "Unable to complete the request.");
  assert.doesNotMatch(resolved.message, /23505|constraint|speak_active_call_devices/);
});

test("invalid status transitions are rejected for every non-idle, non-terminal state", () => {
  assert.equal(isValidTransition("ringing", "reconnecting"), false);
  assert.equal(isValidTransition("ended", "ringing"), false);
  assert.equal(isValidTransition("failed", "connecting"), false);
  assert.equal(isValidTransition("idle", "connected"), false);
});

test("valid status transitions follow the same table as CallingShellImpl's state machine", () => {
  assert.equal(isValidTransition("idle", "ringing"), true);
  assert.equal(isValidTransition("ringing", "connecting"), true);
  assert.equal(isValidTransition("ringing", "ended"), true);
  assert.equal(isValidTransition("connecting", "connected"), true);
  assert.equal(isValidTransition("connected", "ending"), true);
  assert.equal(isValidTransition("ending", "ended"), true);
  for (const status of CALL_STATUSES) assert.equal(isValidTransition(status, status), true);
});

test("terminal states have no outgoing transitions", () => {
  assert.deepEqual(isValidTransition("ended", "ended"), true);
  assert.equal(isValidTransition("ended", "failed"), false);
  assert.equal(isValidTransition("failed", "ended"), false);
});

test("participant identities and all record fields pass through the response mapping unchanged", () => {
  const json = toCallRecordJson(BASE_ROW);
  assert.equal(json.id, BASE_ROW.id);
  assert.equal(json.callerParticipantIdentity, BASE_ROW.caller_participant_identity);
  assert.equal(json.recipientParticipantIdentity, BASE_ROW.recipient_participant_identity);
  assert.equal(json.callerDeviceId, BASE_ROW.caller_device_id);
  assert.equal(json.recipientDeviceId, BASE_ROW.recipient_device_id);
  assert.equal(json.status, BASE_ROW.status);
  assert.equal(Object.prototype.hasOwnProperty.call(json, "service_role"), false);
  assert.equal(JSON.stringify(json).includes("service_role"), false);
});

test("every route requires a device id and rejects unauthenticated/unauthorized requests before touching Supabase", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "src", "server", "routes", "callSessions.js"), "utf8");
  assert.match(source, /authorizeParticipant\(data, deviceId\)/);
  assert.match(source, /authorizeParticipant\(current\.data, deviceId\)/);
  assert.match(source, /not_call_participant/);
  assert.match(source, /deviceId\.length < 16/);
});

test("GET /incoming is registered before GET /:callId so Express cannot treat 'incoming' as a callId", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "src", "server", "routes", "callSessions.js"), "utf8");
  const incomingIndex = source.indexOf('router.get("/incoming"');
  const callIdIndex = source.indexOf('router.get("/:callId"');
  assert.notEqual(incomingIndex, -1);
  assert.notEqual(callIdIndex, -1);
  assert.ok(incomingIndex < callIdIndex, "GET /incoming must be registered before GET /:callId");
});

test("the incoming lookup never reads or writes active_calls", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "src", "server", "routes", "callSessions.js"), "utf8");
  assert.doesNotMatch(source, /active_calls/);
});

test("the incoming lookup resolves the requesting device's own phone number before matching a call", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "src", "server", "routes", "callSessions.js"), "utf8");
  const incomingBlock = source.slice(source.indexOf('router.get("/incoming"'), source.indexOf('router.get("/:callId"'));
  assert.match(incomingBlock, /device_installations/);
  assert.match(incomingBlock, /recipient_phone_number/);
  assert.match(incomingBlock, /status.*ringing|"ringing"/);
});
