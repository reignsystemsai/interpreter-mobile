const express = require("express");
const { WebhookReceiver } = require("livekit-server-sdk");
const { getSupabaseAdmin } = require("../supabase");
const { stopInterpretedCall } = require("../interpreted-call-manager");

const router = express.Router();

router.post("/", express.raw({ type: "application/webhook+json", limit: "256kb" }), async (req, res) => {
  if (!process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET || !Buffer.isBuffer(req.body)) {
    return res.status(503).json({ error: "Calling webhook is unavailable" });
  }
  try {
    const receiver = new WebhookReceiver(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
    const event = await receiver.receive(req.body.toString("utf8"), req.get("Authorization"));
    if (event.event !== "room_finished" || !event.room?.name) return res.status(204).end();
    const admin = getSupabaseAdmin();
    const { data: call } = await admin.from("calls").select("id,caller_id,callee_id,status").eq("room_name", event.room.name).in("status", ["ringing", "accepted", "active"]).maybeSingle();
    if (!call) return res.status(204).end();
    const status = call.status === "ringing" ? "missed" : "failed";
    const { data: updated } = await admin.from("calls").update({ status, decline_reason: "room_finished" }).eq("id", call.id).eq("status", call.status).select("id").maybeSingle();
    if (updated) {
      const now = new Date().toISOString();
      await Promise.all([
        stopInterpretedCall(call.id, "room_finished"),
        admin.from("call_events").insert({ call_id: call.id, actor_id: null, event_type: status, details: { source: "livekit_webhook" } }),
        admin.from("user_presence").upsert({ user_id: call.caller_id, status: "available", active_call_id: null, last_seen_at: now, updated_at: now }, { onConflict: "user_id" }),
        admin.from("user_presence").upsert({ user_id: call.callee_id, status: "available", active_call_id: null, last_seen_at: now, updated_at: now }, { onConflict: "user_id" })
      ]);
    }
    return res.status(204).end();
  } catch {
    console.warn("[LiveKit] Rejected webhook", { category: "invalid_signature" });
    return res.status(401).json({ error: "Invalid webhook signature" });
  }
});

module.exports = router;
