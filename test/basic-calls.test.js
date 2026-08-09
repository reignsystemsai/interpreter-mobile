const assert = require("node:assert/strict");
const test = require("node:test");

const callRoutes = require("../src/server/routes/calls");
const { createVoiceToken, isLiveKitConfigured } = require("../src/server/livekit");

test("room names are deterministic and derived only from the call id", () => {
  assert.equal(callRoutes.roomNameForCall("abc-123"), "basic-abc-123");
});

test("participant identity is derived from role and call id, never guessable across calls", () => {
  assert.equal(callRoutes.participantIdentityFor("caller", "call-1"), "caller:call-1");
  assert.equal(callRoutes.participantIdentityFor("recipient", "call-1"), "recipient:call-1");
  assert.notEqual(callRoutes.participantIdentityFor("caller", "call-1"), callRoutes.participantIdentityFor("caller", "call-2"));
});

test("authorization only recognizes the caller or claimed recipient device", () => {
  const row = { caller_device_id: "device-a", recipient_device_id: "device-b" };
  assert.equal(callRoutes.authorizeParticipant(row, "device-a"), true);
  assert.equal(callRoutes.authorizeParticipant(row, "device-b"), true);
  assert.equal(callRoutes.authorizeParticipant(row, "device-c"), false);
});

test("an unclaimed recipient can poll call status only through the matching registered phone", () => {
  const ringing = { recipient_device_id: null, recipient_phone_e164: "+15550000002" };
  assert.equal(callRoutes.authorizeUnclaimedRecipient(ringing, "+15550000002"), true);
  assert.equal(callRoutes.authorizeUnclaimedRecipient(ringing, "+15550000003"), false);
  assert.equal(callRoutes.authorizeUnclaimedRecipient({ ...ringing, recipient_device_id: "device-b" }, "+15550000002"), false);
});

test("Postgres errcodes map to stable, safe responses without leaking the raw error", () => {
  assert.deepEqual(callRoutes.resolveBasicCallErrorResponse({ code: "P0001" }, "fallback"), {
    status: 409, code: "device_already_active", message: "This device is already in a call."
  });
  assert.deepEqual(callRoutes.resolveBasicCallErrorResponse({ code: "P0002" }, "fallback"), {
    status: 409, code: "invalid_call_state", message: "This call is no longer available to answer."
  });
  assert.deepEqual(callRoutes.resolveBasicCallErrorResponse({ code: "P0003" }, "fallback"), {
    status: 404, code: "call_not_found", message: "This call is no longer available."
  });
  const unrecognized = callRoutes.resolveBasicCallErrorResponse({ code: "23505", message: "duplicate key value violates unique constraint" }, "fallback");
  assert.equal(unrecognized.status, 502);
  assert.equal(unrecognized.message, "fallback");
});

test("call record JSON never exposes internal push tokens or unrelated columns", () => {
  const row = {
    id: "call-1", caller_device_id: "device-a", recipient_device_id: null,
    caller_phone_e164: "+15550000001", recipient_phone_e164: "+15550000002",
    status: "ringing", room_name: "basic-call-1", created_at: "2026-01-01T00:00:00Z", ended_at: null,
    push_token: "should-never-appear"
  };
  const json = callRoutes.toCallRecordJson(row);
  assert.equal(json.id, "call-1");
  assert.equal(json.status, "ringing");
  assert.equal(json.roomName, "basic-call-1");
  assert.equal("push_token" in json, false);
});

test("LiveKit voice tokens use canonical configuration and microphone-only grants", async () => {
  const previous = { url: process.env.LIVEKIT_URL, key: process.env.LIVEKIT_API_KEY, secret: process.env.LIVEKIT_API_SECRET };
  process.env.LIVEKIT_URL = "wss://example.livekit.cloud";
  process.env.LIVEKIT_API_KEY = "test-key";
  process.env.LIVEKIT_API_SECRET = "test-secret-with-enough-entropy";
  assert.equal(isLiveKitConfigured(), true);
  const jwt = await createVoiceToken({ identity: "caller:call-1", roomName: "basic-call-1" });
  const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
  assert.equal(payload.sub, "caller:call-1");
  assert.equal(payload.video.room, "basic-call-1");
  assert.deepEqual(payload.video.canPublishSources, ["microphone"]);
  assert.ok(payload.exp - payload.nbf <= 600);
  for (const [name, value] of [["LIVEKIT_URL", previous.url], ["LIVEKIT_API_KEY", previous.key], ["LIVEKIT_API_SECRET", previous.secret]]) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});
