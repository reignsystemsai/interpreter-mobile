const assert = require("node:assert/strict");
const test = require("node:test");

const { PLAN_CATALOG, publicPlans } = require("../src/server/plans");
const { validExpoPushToken } = require("../src/server/push");
const { hashIdentity, normalizeContactPayload, normalizeEmail, normalizePhone } = require("../src/server/contacts");

test("plan catalog preserves approved limits without exposing store identifiers", () => {
  assert.equal(PLAN_CATALOG.free.interpretedMinutes, 3);
  assert.equal(PLAN_CATALOG.free.allowancePeriod, "rolling_30_days");
  assert.equal(publicPlans().some((plan) => "productId" in plan), false);
});

test("push token validation remains strict", () => {
  assert.equal(validExpoPushToken("ExpoPushToken[test]"), true);
});

test("contact normalization remains deterministic", () => {
  assert.equal(normalizeEmail(" Test@Example.COM "), "test@example.com");
  assert.equal(normalizePhone("+1 (555) 010-2000"), "15550102000");
  assert.equal(hashIdentity("email:test@example.com").length, 64);
  const contact = normalizeContactPayload({ displayName: " Ada Lovelace ", emailAddresses: [{ label: "work", value: "ADA@EXAMPLE.COM" }] });
  assert.equal(contact.displayName, "Ada Lovelace");
  assert.equal(contact.emailAddresses.length, 1);
});
