const assert = require("node:assert/strict");
const test = require("node:test");

test("LiveKit participant token is short-lived and room-scoped", async () => {
  process.env.LIVEKIT_URL = "wss://test.livekit.cloud";
  process.env.LIVEKIT_API_KEY = "test-api-key";
  process.env.LIVEKIT_API_SECRET = "test-api-secret-with-sufficient-length";
  const { createVoiceToken } = require("../src/server/livekit");
  const issuedAt = Math.floor(Date.now() / 1000);
  const jwt = await createVoiceToken({ identity: "caller-test", roomName: "voice-test" });
  const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
  assert.equal(payload.sub, "caller-test");
  assert.equal(payload.video.room, "voice-test");
  assert.equal(payload.video.roomJoin, true);
  assert.ok(payload.exp - issuedAt <= 600);
  assert.ok(payload.exp > issuedAt);
});
