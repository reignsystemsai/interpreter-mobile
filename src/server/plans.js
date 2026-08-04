const PLAN_CATALOG = Object.freeze({
  free: {
    id: "free",
    name: "Free",
    priceUsdMonthly: 0,
    interpretedMinutes: 3,
    allowancePeriod: "rolling_30_days",
    rolloverPeriods: 0,
    features: ["Voice calls", "Video calls", "Basic AI voices"]
  },
  pro: {
    id: "pro",
    name: "Interpreter Pro",
    productId: "interpreter_pro_monthly",
    entitlementId: "pro",
    priceUsdMonthly: 9.99,
    interpretedMinutes: 500,
    allowancePeriod: "month",
    rolloverPeriods: 1,
    trialDays: 7,
    features: [
      "Voice calls",
      "Video calls",
      "Faster AI",
      "Premium AI voices",
      "Saved transcripts",
      "Conversation summaries"
    ]
  },
  unlimited: {
    id: "unlimited",
    name: "Interpreter Unlimited",
    productId: "interpreter_unlimited_monthly",
    entitlementId: "unlimited",
    priceUsdMonthly: 19.99,
    interpretedMinutes: 2000,
    allowancePeriod: "month",
    rolloverPeriods: 1,
    trialDays: 7,
    fairUse: true,
    features: [
      "Everything in Interpreter Pro",
      "Highest priority processing",
      "Advanced AI voices",
      "Group calls",
      "Future premium AI features"
    ]
  }
});

function publicPlans() {
  return Object.values(PLAN_CATALOG).map(({ entitlementId, productId, ...plan }) => plan);
}

module.exports = { PLAN_CATALOG, publicPlans };
