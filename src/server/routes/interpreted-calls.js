const express = require("express");
const { ensureInterpretedCall, getInterpretedCallState, stopInterpretedCall } = require("../interpreted-call-manager");
const { PLAN_CATALOG } = require("../plans");
const { getSupabaseAdmin, requireUser } = require("../supabase");

const router = express.Router();
const LANGUAGES = new Set([
  "English", "Spanish", "Brazilian Portuguese", "French", "German", "Italian",
  "Dutch", "Russian", "Polish", "Romanian", "Turkish", "Arabic", "Hebrew",
  "Hindi", "Japanese", "Korean", "Mandarin Chinese", "Cantonese", "Vietnamese", "Thai"
]);
const CALL_SELECT = "id,room_name,caller_id,callee_id,status,interpretation_enabled,caller_spoken_language,caller_heard_language,callee_spoken_language,callee_heard_language,interpretation_started_at,interpreted_seconds";

router.use(requireUser);

async function loadCall(admin, callId, userId) {
  const { data, error } = await admin.from("calls").select(CALL_SELECT).eq("id", callId).or(`caller_id.eq.${userId},callee_id.eq.${userId}`).maybeSingle();
  if (error) throw new Error("Unable to load interpreted call");
  return data;
}

async function allowanceFor(admin, userId) {
  const { data: entitlement } = await admin.from("subscription_entitlements").select("plan_id,status,expires_at").eq("user_id", userId).maybeSingle();
  const entitlementActive = entitlement && ["active", "trialing", "grace_period"].includes(entitlement.status) && (!entitlement.expires_at || new Date(entitlement.expires_at) > new Date());
  const plan = PLAN_CATALOG[entitlementActive ? entitlement.plan_id : "free"] || PLAN_CATALOG.free;
  const periodStart = plan.allowancePeriod === "day" ? new Date().toISOString().slice(0, 10) : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString().slice(0, 10);
  const { data: usage } = await admin.from("usage_periods").select("seconds_used,rollover_seconds").eq("user_id", userId).eq("period_start", periodStart).maybeSingle();
  const limitSeconds = plan.interpretedMinutes * 60 + (usage?.rollover_seconds || 0);
  const usedSeconds = usage?.seconds_used || 0;
  return { planId: plan.id, limitSeconds, usedSeconds, remainingSeconds: Math.max(0, limitSeconds - usedSeconds) };
}

router.post("/:callId/start", async (req, res) => {
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: "Interpretation service is not configured" });
  const admin = getSupabaseAdmin();
  try {
    let call = await loadCall(admin, req.params.callId, req.interpreterUser.id);
    if (!call) return res.status(404).json({ error: "Call not found" });
    if (!["accepted", "active"].includes(call.status)) return res.status(409).json({ error: "Call must be active before interpretation starts" });
    const allowance = await allowanceFor(admin, req.interpreterUser.id);
    if (allowance.remainingSeconds <= 0) return res.status(402).json({ error: "Your interpreted-minute allowance is exhausted", allowance });

    const spokenLanguage = LANGUAGES.has(req.body?.spokenLanguage) ? req.body.spokenLanguage : null;
    const heardLanguage = LANGUAGES.has(req.body?.heardLanguage) ? req.body.heardLanguage : null;
    if (spokenLanguage || heardLanguage) {
      const caller = call.caller_id === req.interpreterUser.id;
      const update = caller
        ? { caller_spoken_language: spokenLanguage || call.caller_spoken_language, caller_heard_language: heardLanguage || call.caller_heard_language }
        : { callee_spoken_language: spokenLanguage || call.callee_spoken_language, callee_heard_language: heardLanguage || call.callee_heard_language };
      const result = await admin.from("calls").update(update).eq("id", call.id).select(CALL_SELECT).single();
      if (result.error) throw result.error;
      call = result.data;
    }
    await ensureInterpretedCall({ admin, call, remainingSeconds: allowance.remainingSeconds, userId: req.interpreterUser.id });
    return res.json({ allowance, interpretation: getInterpretedCallState(call.id) });
  } catch {
    console.error("[Interpreted call] Start failed", { category: "translation_setup" });
    return res.status(503).json({ error: "Unable to start call interpretation" });
  }
});

router.get("/:callId/status", async (req, res) => {
  const admin = getSupabaseAdmin();
  const call = await loadCall(admin, req.params.callId, req.interpreterUser.id).catch(() => null);
  if (!call) return res.status(404).json({ error: "Call not found" });
  return res.json({ interpretation: getInterpretedCallState(call.id) });
});

router.get("/:callId/metrics", async (req, res) => {
  const admin = getSupabaseAdmin();
  const call = await loadCall(admin, req.params.callId, req.interpreterUser.id).catch(() => null);
  if (!call) return res.status(404).json({ error: "Call not found" });
  const { data, error } = await admin.from("call_interpretation_metrics").select("first_audio_latency_ms,total_latency_ms,interruption_count,recovery_count,error_count").eq("call_id", call.id).order("created_at", { ascending: false }).limit(500);
  if (error) return res.status(500).json({ error: "Unable to load interpretation metrics" });
  return res.json({ metrics: summarizeMetrics(data || []) });
});

router.post("/:callId/stop", async (req, res) => {
  const admin = getSupabaseAdmin();
  const call = await loadCall(admin, req.params.callId, req.interpreterUser.id).catch(() => null);
  if (!call) return res.status(404).json({ error: "Call not found" });
  await stopInterpretedCall(call.id, "participant_stopped");
  return res.status(204).end();
});

function summarizeMetrics(rows) {
  const firstAudio = rows.map((row) => row.first_audio_latency_ms).filter(Number.isFinite).sort((a, b) => a - b);
  const total = rows.map((row) => row.total_latency_ms).filter(Number.isFinite).sort((a, b) => a - b);
  const average = (values) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
  const percentile95 = (values) => values.length ? values[Math.min(values.length - 1, Math.ceil(values.length * 0.95) - 1)] : null;
  return {
    utterances: rows.length,
    averageFirstAudioLatencyMs: average(firstAudio),
    p95FirstAudioLatencyMs: percentile95(firstAudio),
    averageTotalLatencyMs: average(total),
    interruptions: rows.reduce((sum, row) => sum + row.interruption_count, 0),
    recoveries: rows.reduce((sum, row) => sum + row.recovery_count, 0),
    errors: rows.reduce((sum, row) => sum + row.error_count, 0)
  };
}

module.exports = router;
module.exports.allowanceFor = allowanceFor;
module.exports.summarizeMetrics = summarizeMetrics;
