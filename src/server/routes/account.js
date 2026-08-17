const express = require("express");
const { getSupabaseAdmin, requireUser } = require("../supabase");

const router = express.Router();
router.use(requireUser);

router.get("/me", async (req, res) => {
  const admin = getSupabaseAdmin();
  const userId = req.interpreterUser.id;
  const [profileResult, entitlementResult, preferencesResult] = await Promise.all([
    admin.from("profiles").select("full_name, phone, created_at").eq("id", userId).maybeSingle(),
    admin.from("subscription_entitlements").select("plan_id, status, expires_at, updated_at").eq("user_id", userId).maybeSingle(),
    admin.from("notification_preferences").select("membership, product_updates, new_languages, service_alerts, marketing").eq("user_id", userId).maybeSingle()
  ]);
  const failure = [profileResult.error, entitlementResult.error, preferencesResult.error].find(Boolean);
  if (failure) return res.status(500).json({ error: "Unable to load account" });
  return res.json({ id: userId, email: req.interpreterUser.email, profile: profileResult.data, membership: entitlementResult.data || { plan_id: "free", status: "active" }, notifications: preferencesResult.data });
});

router.patch("/me", async (req, res) => {
  const admin = getSupabaseAdmin();
  const fullName = typeof req.body?.fullName === "string" ? req.body.fullName.trim().slice(0, 120) : null;
  const phone = typeof req.body?.phone === "string" ? req.body.phone.trim().slice(0, 40) : null;
  const { data, error } = await admin.from("profiles").upsert({ id: req.interpreterUser.id, full_name: fullName, phone }, { onConflict: "id" }).select("full_name, phone, created_at").single();
  if (error) return res.status(500).json({ error: "Unable to update account" });
  return res.json({ profile: data });
});

router.delete("/me", async (req, res) => {
  const { error } = await getSupabaseAdmin().auth.admin.deleteUser(req.interpreterUser.id);
  if (error) return res.status(500).json({ error: "Unable to delete account" });
  return res.status(204).end();
});

module.exports = router;
