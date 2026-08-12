const express = require("express");
const { normalizeE164 } = require("../devices");
const { getSupabaseAdmin, isSupabaseConfigured } = require("../supabase");

const router = express.Router();

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

router.post("/register", async (req, res) => {
  if (!isSupabaseConfigured()) return res.status(503).json({ error: "Device registration is temporarily unavailable." });
  const deviceId = cleanText(req.body?.deviceId, 120);
  const phoneNumberE164 = normalizeE164(req.body?.phoneNumber, req.body?.defaultRegion);
  const platform = req.body?.platform === "ios" ? "ios" : req.body?.platform === "android" ? "android" : "";
  const pushToken = cleanText(req.body?.pushToken, 300) || null;
  const appVersion = cleanText(req.body?.appVersion, 40) || null;
  if (deviceId.length < 16 || !phoneNumberE164 || !platform) {
    return res.status(400).json({ error: "Invalid device registration." });
  }

  const now = new Date().toISOString();
  const registration = {
    device_id: deviceId,
    enabled: true,
    last_seen_at: now,
    phone_number_e164: phoneNumberE164,
    platform,
    app_version: appVersion,
    updated_at: now
  };
  if (pushToken) registration.push_token = pushToken;
  const { data, error } = await getSupabaseAdmin()
    .from("device_installations")
    .upsert(registration, { onConflict: "device_id" })
    .select("id,device_id,phone_number_e164,platform,enabled")
    .single();
  if (error) {
    console.error("[VoiceCall] device registration persistence failed", { code: error.code || "unknown" });
    return res.status(500).json({ error: "Unable to register this device.", code: "registration_persistence_failed" });
  }
  if (!data || data.device_id !== deviceId || data.phone_number_e164 !== phoneNumberE164) {
    return res.status(500).json({ error: "Unable to verify device registration.", code: "registration_verification_failed" });
  }
  console.info("[DeviceRouting] device registered", { deviceId: data.device_id, platform });
  return res.status(200).json({
    installationId: data.id,
    deviceId: data.device_id,
    phoneNumberE164: data.phone_number_e164,
    platform: data.platform,
    enabled: data.enabled
  });
});

router.post("/lookup", async (req, res) => {
  if (!isSupabaseConfigured()) return res.status(503).json({ error: "Device lookup is temporarily unavailable." });
  const phoneNumberE164 = normalizeE164(req.body?.phoneNumber, req.body?.defaultRegion);
  if (!phoneNumberE164) return res.status(400).json({ error: "Invalid phone number." });
  const { data, error } = await getSupabaseAdmin()
    .from("device_installations")
    .select("id,device_id,platform")
    .eq("phone_number_e164", phoneNumberE164)
    .eq("enabled", true)
    .order("last_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return res.status(500).json({ error: "Unable to look up this device." });
  if (!data) return res.status(200).json({ found: false });
  const member = await getSupabaseAdmin().from("profiles").select("id").eq("phone", phoneNumberE164).maybeSingle();
  if (member.error) return res.status(500).json({ error: "Unable to look up this member." });
  if (!member.data) return res.status(200).json({ found: false });
  return res.status(200).json({ found: true, installationId: data.id, deviceId: data.device_id, platform: data.platform, userId: member.data.id });
});

module.exports = router;
