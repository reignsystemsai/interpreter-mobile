const assert = require("node:assert/strict");
const test = require("node:test");

const { PLAN_CATALOG, publicPlans } = require("../src/server/plans");
const { createVoiceToken, isLiveKitConfigured, liveKitHttpUrl } = require("../src/server/livekit");
const { validExpoPushToken } = require("../src/server/push");
const { hashIdentity, normalizeContactPayload, normalizeEmail, normalizePhone } = require("../src/server/contacts");

test("plan catalog preserves approved limits without exposing store identifiers", () => {
  assert.equal(PLAN_CATALOG.free.interpretedMinutes, 3);
  assert.equal(PLAN_CATALOG.free.allowancePeriod, "rolling_30_days");
  assert.equal(publicPlans().some((plan) => "productId" in plan), false);
});

test("LiveKit voice tokens use canonical configuration and microphone-only grants", async () => {
  const previous = { url: process.env.LIVEKIT_URL, key: process.env.LIVEKIT_API_KEY, secret: process.env.LIVEKIT_API_SECRET };
  process.env.LIVEKIT_URL = "wss://example.livekit.cloud";
  process.env.LIVEKIT_API_KEY = "test-key";
  process.env.LIVEKIT_API_SECRET = "test-secret-with-enough-entropy";
  assert.equal(isLiveKitConfigured(), true);
  assert.equal(liveKitHttpUrl(), "https://example.livekit.cloud");
  const jwt = await createVoiceToken({ identity: "device-1:call-1:caller", roomName: "voice-room-1" });
  const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
  assert.equal(payload.sub, "device-1:call-1:caller");
  assert.equal(payload.video.room, "voice-room-1");
  assert.deepEqual(payload.video.canPublishSources, ["microphone"]);
  assert.ok(payload.exp - payload.nbf <= 600);
  assert.equal(validExpoPushToken("ExpoPushToken[test]"), true);
  for (const [name, value] of [["LIVEKIT_URL", previous.url], ["LIVEKIT_API_KEY", previous.key], ["LIVEKIT_API_SECRET", previous.secret]]) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});

test("contact normalization remains deterministic", () => {
  assert.equal(normalizeEmail(" Test@Example.COM "), "test@example.com");
  assert.equal(normalizePhone("+1 (555) 010-2000"), "15550102000");
  assert.equal(hashIdentity("email:test@example.com").length, 64);
  const contact = normalizeContactPayload({ displayName: " Ada Lovelace ", emailAddresses: [{ label: "work", value: "ADA@EXAMPLE.COM" }] });
  assert.equal(contact.displayName, "Ada Lovelace");
  assert.equal(contact.emailAddresses.length, 1);
});
