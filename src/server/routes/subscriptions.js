const crypto = require("crypto");
const express = require("express");
const { PLAN_CATALOG, publicPlans } = require("../plans");
const { getSupabaseAdmin, isSupabaseConfigured } = require("../supabase");

const router = express.Router();

function constantTimeEqual(left, right) {
  const leftBuffer = Buffer.from(left || "");
  const rightBuffer = Buffer.from(right || "");
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

router.get("/plans", (_req, res) => res.json({ plans: publicPlans() }));

router.post("/revenuecat/webhook", async (req, res) => {
  if (!isSupabaseConfigured() || !process.env.REVENUECAT_WEBHOOK_AUTH) {
    return res.status(503).json({ error: "Subscription services are not configured" });
  }
  if (!constantTimeEqual(req.get("authorization"), process.env.REVENUECAT_WEBHOOK_AUTH)) {
    return res.status(401).json({ error: "Invalid webhook authorization" });
  }

  const event = req.body?.event;
  if (!event?.id || !event?.app_user_id) {
    return res.status(400).json({ error: "Invalid RevenueCat event" });
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(event.app_user_id)) {
    return res.status(400).json({ error: "RevenueCat user is not linked to an Interpreter account" });
  }
  const admin = getSupabaseAdmin();
  const { error: eventError } = await admin.from("subscription_events").insert({
    event_id: String(event.id),
    event_type: String(event.type || "UNKNOWN"),
    user_id: String(event.app_user_id),
    occurred_at: event.event_timestamp_ms ? new Date(event.event_timestamp_ms).toISOString() : new Date().toISOString()
  });
  if (eventError?.code === "23505") return res.status(204).end();
  if (eventError) return res.status(500).json({ error: "Unable to record subscription event" });

  const plan = Object.values(PLAN_CATALOG).find((candidate) => candidate.productId === event.product_id) || PLAN_CATALOG.free;
  const inactiveTypes = new Set(["EXPIRATION", "CANCELLATION", "BILLING_ISSUE"]);
  const status = inactiveTypes.has(event.type) ? "inactive" : "active";
  const { error } = await admin.from("subscription_entitlements").upsert({
    user_id: String(event.app_user_id),
    plan_id: plan.id,
    product_id: event.product_id || null,
    status,
    expires_at: event.expiration_at_ms ? new Date(event.expiration_at_ms).toISOString() : null,
    updated_at: new Date().toISOString()
  }, { onConflict: "user_id" });
  if (error) return res.status(500).json({ error: "Unable to update subscription entitlement" });
  return res.status(204).end();
});

module.exports = router;
