const assert = require("node:assert/strict");
const test = require("node:test");

const mediaSessionRoutes = require("../src/server/routes/mediaSessions");

const { roomNameForCall, participantIdentityFor } = mediaSessionRoutes;

const CLAIMED_ROW = Object.freeze({
  id: "call-1",
  caller_device_id: "device-caller",
  recipient_device_id: "device-recipient",
  caller_participant_identity: "speak:call-1:caller:abc",
  recipient_participant_identity: "speak:call-1:recipient:def"
});

const UNCLAIMED_ROW = Object.freeze({
  ...CLAIMED_ROW,
  recipient_device_id: null
});

test("room naming is deterministic and derived only from the call ID", () => {
  assert.equal(roomNameForCall("call-1"), "speak-call-1");
  assert.equal(roomNameForCall("call-1"), roomNameForCall("call-1"));
  assert.notEqual(roomNameForCall("call-1"), roomNameForCall("call-2"));
});

test("the caller device resolves to the caller's participant identity", () => {
  assert.equal(participantIdentityFor(CLAIMED_ROW, "device-caller"), "speak:call-1:caller:abc");
});

test("a claimed recipient device resolves to the recipient's participant identity", () => {
  assert.equal(participantIdentityFor(CLAIMED_ROW, "device-recipient"), "speak:call-1:recipient:def");
});

test("an unclaimed recipient device is rejected because recipient_device_id is still null", () => {
  assert.equal(participantIdentityFor(UNCLAIMED_ROW, "device-recipient"), null);
});

test("a stranger device is rejected", () => {
  assert.equal(participantIdentityFor(CLAIMED_ROW, "device-stranger"), null);
});

test("createVoiceRoom is never imported or called by this route", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "src", "server", "routes", "mediaSessions.js"), "utf8");
  assert.doesNotMatch(source, /require\("\.\.\/livekit"\)[^;]*createVoiceRoom|createVoiceRoom\(/);
});

test("only createVoiceToken is used to mint media credentials, and errors from it are mapped safely", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "src", "server", "routes", "mediaSessions.js"), "utf8");
  assert.match(source, /createVoiceToken/);
  assert.match(source, /media_session_unavailable/);
  assert.match(source, /catch \(tokenError\)/);
});

test("this route never creates, claims, or transitions call state", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "src", "server", "routes", "mediaSessions.js"), "utf8");
  assert.doesNotMatch(source, /\.insert\(|\.update\(|\.rpc\(/);
});
