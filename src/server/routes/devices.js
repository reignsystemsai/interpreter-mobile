const express = require("express");
const { normalizeE164 } = require("../devices");
const { getSupabaseAdmin, requireUser } = require("../supabase");

const router = express.Router();
router.use(requireUser);

router.post("/register", async (req, res) => {
  const phoneE164 = normalizeE164(req.body?.phoneNumber);
  const installationId = typeof req.body?.installationId === "string" ? req.body.installationId.trim().slice(0, 120) : "";
  const expoPushToken = typeof req.body?.expoPushToken === "string" ? req.body.expoPushToken.trim().slice(0, 300) : null;
  const platform = req.body?.platform === "ios" ? "ios" : "android";
  if (!phoneE164 || !installationId) return res.status(400).json({ error: "A valid phone number and installation ID are required" });

  const admin = getSupabaseAdmin();
  const now = new Date().toISOString();
  await admin.from("device_installations").delete().eq("installation_id", installationId).neq("phone_e164", phoneE164);
  const { error } = await admin.from("device_installations").upsert({
    installation_id: installationId,
    user_id: req.interpreterUser.id,
    phone_e164: phoneE164,
    expo_push_token: expoPushToken,
    platform,
    last_seen_at: now,
    updated_at: now
  }, { onConflict: "phone_e164" });
  if (error) return res.status(500).json({ error: "Unable to register this installation" });

  if (expoPushToken?.startsWith("ExponentPushToken[") || expoPushToken?.startsWith("ExpoPushToken[")) {
    await admin.from("push_devices").upsert({ token: expoPushToken, platform, user_id: req.interpreterUser.id, last_seen_at: now }, { onConflict: "token" });
  }
  return res.status(204).end();
});

module.exports = router;
