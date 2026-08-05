const express = require("express");

const { createVoiceToken, isLiveKitConfigured } = require("../livekit");
const { getSupabaseAdmin, isSupabaseConfigured } = require("../supabase");

const router = express.Router();

router.post("/token", async (req, res) => {
  if (!isSupabaseConfigured() || !isLiveKitConfigured()) return res.status(503).json({ error: "Calling is temporarily unavailable." });
  const callId = typeof req.body?.callId === "string" ? req.body.callId.trim() : "";
  const deviceId = typeof req.body?.deviceId === "string" ? req.body.deviceId.trim() : "";
  if (!callId || deviceId.length < 16) return res.status(400).json({ error: "Invalid token request." });
  const { data, error } = await getSupabaseAdmin().from("active_calls").select("room_name,caller_device_id,recipient_device_id,status").eq("id", callId).maybeSingle();
  if (error) return res.status(502).json({ error: "Unable to authorize this call." });
  if (!data || !["ringing", "accepted"].includes(data.status)) return res.status(404).json({ error: "This call is no longer available." });
  const role = data.caller_device_id === deviceId ? "caller" : data.recipient_device_id === deviceId ? "recipient" : "";
  if (!role) return res.status(403).json({ error: "Unable to authorize this call." });
  if (role === "recipient" && data.status !== "accepted") return res.status(409).json({ error: "Accept the call before connecting." });
  const token = await createVoiceToken({ identity: `${deviceId}:${callId}:${role}`, roomName: data.room_name });
  return res.status(200).json({ callId, livekitUrl: process.env.LIVEKIT_URL, roomName: data.room_name, token });
});

module.exports = router;
