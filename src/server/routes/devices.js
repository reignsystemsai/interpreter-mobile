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
  if (deviceId.length < 16 || !phoneNumberE164 || !platform) {
    return res.status(400).json({ error: "Invalid device registration." });
  }

  const now = new Date().toISOString();
  const { data, error } = await getSupabaseAdmin()
    .from("device_installations")
    .upsert({
      device_id: deviceId,
      enabled: true,
      last_seen_at: now,
      phone_number_e164: phoneNumberE164,
      platform,
      push_token: pushToken,
      updated_at: now
    }, { onConflict: "device_id" })
    .select("id,device_id,phone_number_e164")
    .single();
  if (error) return res.status(500).json({ error: "Unable to register this device." });
  console.info("[DeviceRouting] device registered", { deviceId: data.device_id, platform });
  return res.status(200).json({ registered: true, installationId: data.id });
});

router.post("/lookup", async (req, res) => {
  if (!isSupabaseConfigured()) return res.status(503).json({ error: "Device lookup is temporarily unavailable." });
  const phoneNumberE164 = normalizeE164(req.body?.phoneNumber, req.body?.defaultRegion);
  if (!phoneNumberE164) return res.status(400).json({ error: "Invalid phone number." });
  const { data, error } = await getSupabaseAdmin()
    .from("device_installations")
    .select("id")
    .eq("phone_number_e164", phoneNumberE164)
    .eq("enabled", true)
    .order("last_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return res.status(500).json({ error: "Unable to look up this device." });
  if (!data) return res.status(200).json({ available: false });
  return res.status(200).json({ available: true, recipient: { installationId: data.id } });
});

module.exports = router;
