const express = require("express");
const { getSupabaseAdmin, requireUser } = require("../supabase");

const router = express.Router();
router.use(requireUser);

function serializePresence(row) {
  const stale = Date.now() - new Date(row.last_seen_at).getTime() > 60_000;
  const status = stale && ["online", "available"].includes(row.status) ? "offline" : row.status;
  return { userId: row.user_id, status, activeCallId: row.active_call_id, lastSeenAt: row.last_seen_at };
}

router.post("/heartbeat", async (req, res) => {
  const admin = getSupabaseAdmin();
  const requested = req.body?.status === "offline" ? "offline" : "available";
  const { data: current } = await admin.from("user_presence").select("status,active_call_id").eq("user_id", req.interpreterUser.id).maybeSingle();
  const protectedStatus = current?.active_call_id && ["busy", "ringing", "in_call"].includes(current.status);
  const values = { user_id: req.interpreterUser.id, status: protectedStatus ? current.status : requested, active_call_id: protectedStatus ? current.active_call_id : null, last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  const { data, error } = await admin.from("user_presence").upsert(values, { onConflict: "user_id" }).select("user_id,status,active_call_id,last_seen_at").single();
  if (error) return res.status(500).json({ error: "Unable to update presence" });
  return res.json({ presence: serializePresence(data) });
});

router.get("/", async (req, res) => {
  const contactIds = typeof req.query.contactIds === "string" ? req.query.contactIds.split(",").filter(Boolean).slice(0, 200) : [];
  if (!contactIds.length) return res.json({ presence: [] });
  const admin = getSupabaseAdmin();
  const { data: contacts, error: contactError } = await admin.from("contacts").select("interpreter_user_id").eq("owner_id", req.interpreterUser.id).in("id", contactIds).not("interpreter_user_id", "is", null);
  if (contactError) return res.status(500).json({ error: "Unable to load contacts" });
  const userIds = [...new Set((contacts || []).map((contact) => contact.interpreter_user_id))];
  if (!userIds.length) return res.json({ presence: [] });
  const { data, error } = await admin.from("user_presence").select("user_id,status,active_call_id,last_seen_at").in("user_id", userIds);
  if (error) return res.status(500).json({ error: "Unable to load presence" });
  return res.json({ presence: (data || []).map(serializePresence) });
});

module.exports = router;
module.exports.serializePresence = serializePresence;
