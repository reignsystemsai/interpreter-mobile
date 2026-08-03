const assert = require("node:assert/strict");
const test = require("node:test");

const { PLAN_CATALOG, publicPlans } = require("../src/server/plans");

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
