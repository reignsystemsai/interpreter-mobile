const assert = require("node:assert/strict");
const test = require("node:test");

const { PLAN_CATALOG, publicPlans } = require("../src/server/plans");
const { isLiveKitConfigured } = require("../src/server/livekit");
const { hashIdentity, normalizeContactPayload, normalizeEmail, normalizePhone } = require("../src/server/contacts");

test("plan catalog preserves approved limits without exposing store identifiers", () => {
  assert.equal(PLAN_CATALOG.free.interpretedMinutes, 2);
  assert.equal(PLAN_CATALOG.free.allowancePeriod, "day");
  assert.equal(PLAN_CATALOG.pro.interpretedMinutes, 500);
  assert.equal(PLAN_CATALOG.unlimited.interpretedMinutes, 2000);
  assert.equal(PLAN_CATALOG.pro.rolloverPeriods, 1);
  assert.equal(PLAN_CATALOG.pro.trialDays, 7);
  assert.equal(publicPlans().some((plan) => "productId" in plan), false);
  assert.equal(publicPlans().some((plan) => "entitlementId" in plan), false);
});

test("LiveKit configuration requires the canonical environment names", () => {
  const previous = {
    url: process.env.LIVEKIT_URL,
    key: process.env.LIVEKIT_API_KEY,
    secret: process.env.LIVEKIT_API_SECRET
  };
  delete process.env.LIVEKIT_URL;
  delete process.env.LIVEKIT_API_KEY;
  delete process.env.LIVEKIT_API_SECRET;
  assert.equal(isLiveKitConfigured(), false);
  process.env.LIVEKIT_URL = "wss://example.invalid";
  process.env.LIVEKIT_API_KEY = "test-key";
  process.env.LIVEKIT_API_SECRET = "test-secret";
  assert.equal(isLiveKitConfigured(), true);
  for (const [name, value] of [
    ["LIVEKIT_URL", previous.url],
    ["LIVEKIT_API_KEY", previous.key],
    ["LIVEKIT_API_SECRET", previous.secret]
  ]) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test("contact normalization is deterministic and excludes unsafe duplicate data", () => {
  assert.equal(normalizeEmail(" Test@Example.COM "), "test@example.com");
  assert.equal(normalizePhone("+1 (555) 010-2000"), "15550102000");
  assert.equal(hashIdentity("email:test@example.com").length, 64);
  const contact = normalizeContactPayload({
    deviceContactId: "device-1",
    displayName: "  Ada\u0000 Lovelace  ",
    phoneNumbers: [{ label: "mobile", value: "+1 555 0100" }, { label: "other", value: "15550100" }],
    emailAddresses: [{ label: "work", value: "ADA@EXAMPLE.COM" }, { label: "home", value: "ada@example.com" }]
  });
  assert.equal(contact.displayName, "Ada  Lovelace");
  assert.equal(contact.emailAddresses.length, 1);
  assert.equal(contact.phoneNumbers.length, 1);
  assert.equal(contact.identityHash, hashIdentity("email:ada@example.com"));
});
