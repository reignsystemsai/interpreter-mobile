const express = require("express");
const { getSupabaseAdmin, requireUser } = require("../supabase");

const router = express.Router();
const PREFERENCE_KEYS = ["membership", "product_updates", "new_languages", "service_alerts", "marketing"];
router.use(requireUser);

router.put("/preferences", async (req, res) => {
  const values = { user_id: req.interpreterUser.id };
  for (const key of PREFERENCE_KEYS) if (typeof req.body?.[key] === "boolean") values[key] = req.body[key];
  const { data, error } = await getSupabaseAdmin().from("notification_preferences").upsert(values, { onConflict: "user_id" }).select(PREFERENCE_KEYS.join(",")).single();
  if (error) return res.status(500).json({ error: "Unable to save notification preferences" });
  return res.json({ notifications: data });
});

router.post("/devices", async (req, res) => {
  const token = typeof req.body?.expoPushToken === "string" ? req.body.expoPushToken.trim().slice(0, 300) : "";
  const platform = req.body?.platform === "ios" ? "ios" : "android";
  if (!token.startsWith("ExponentPushToken[") && !token.startsWith("ExpoPushToken[")) return res.status(400).json({ error: "Invalid Expo push token" });
  const { error } = await getSupabaseAdmin().from("push_devices").upsert({ token, platform, user_id: req.interpreterUser.id, last_seen_at: new Date().toISOString() }, { onConflict: "token" });
  if (error) return res.status(500).json({ error: "Unable to register device" });
  return res.status(204).end();
});

module.exports = router;
