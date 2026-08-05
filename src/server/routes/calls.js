const crypto = require("node:crypto");
const express = require("express");

const { normalizeE164 } = require("../devices");
const { createVoiceRoom, createVoiceToken, deleteVoiceRoom, isLiveKitConfigured } = require("../livekit");
const { sendIncomingVoiceCallPush } = require("../push");
const { getSupabaseAdmin, isSupabaseConfigured } = require("../supabase");

const router = express.Router();
const OPEN_STATUSES = ["calling", "ringing", "accepted"];

function cleanText(value, maxLength = 160) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function callError(res, status, code, message) {
  return res.status(status).json({ code, error: message });
}

async function loadCall(admin, callId) {
  return admin.from("active_calls").select("*").eq("id", callId).maybeSingle();
}

async function finishCall(admin, row, status) {
  const endedAt = new Date().toISOString();
  const result = await admin.from("active_calls").update({ status, ended_at: endedAt }).eq("id", row.id);
  if (result.error) throw result.error;
  await deleteVoiceRoom(row.room_name);
}

router.get("/incoming", async (req, res) => {
  if (!isSupabaseConfigured()) return callError(res, 503, "calling_unavailable", "Calling is temporarily unavailable.");
  const deviceId = cleanText(req.query?.deviceId, 120);
  if (deviceId.length < 16) return callError(res, 400, "invalid_device", "Unable to check incoming calls.");
  const { data, error } = await getSupabaseAdmin()
    .from("active_calls")
    .select("id,caller_phone_e164")
    .eq("recipient_device_id", deviceId)
    .eq("status", "ringing")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return callError(res, 502, "call_state_unavailable", "Unable to check incoming calls.");
  if (!data) return res.status(200).json({ incoming: false });
  return res.status(200).json({ incoming: true, callId: data.id, callerPhoneNumber: data.caller_phone_e164 });
});

router.get("/:callId", async (req, res) => {
  if (!isSupabaseConfigured()) return callError(res, 503, "calling_unavailable", "Calling is temporarily unavailable.");
  const callId = cleanText(req.params.callId, 80);
  const deviceId = cleanText(req.query?.deviceId, 120);
  if (!callId || deviceId.length < 16) return callError(res, 400, "invalid_call_request", "Unable to check this call.");
  const result = await loadCall(getSupabaseAdmin(), callId);
  if (result.error) return callError(res, 502, "call_state_unavailable", "Unable to check this call.");
  if (!result.data) return res.status(200).json({ active: false, status: "ended" });
  if (![result.data.caller_device_id, result.data.recipient_device_id].includes(deviceId)) {
    return callError(res, 403, "not_call_participant", "Unable to check this call.");
  }
  return res.status(200).json({ active: OPEN_STATUSES.includes(result.data.status), status: result.data.status });
});

router.post("/start", async (req, res) => {
  console.info("[VoiceCall] start request received");
  if (!isSupabaseConfigured() || !isLiveKitConfigured()) {
    return callError(res, 503, "calling_unavailable", "Calling is temporarily unavailable.");
  }
  const callerDeviceId = cleanText(req.body?.callerDeviceId, 120);
  const recipientPhoneNumber = normalizeE164(req.body?.recipientPhoneNumber, req.body?.defaultRegion);
  if (callerDeviceId.length < 16 || !recipientPhoneNumber) {
    return callError(res, 400, "invalid_call_request", "The selected phone number is invalid.");
  }

  const admin = getSupabaseAdmin();
  const [callerResult, recipientResult] = await Promise.all([
    admin.from("device_installations").select("id,device_id,phone_number_e164,platform").eq("device_id", callerDeviceId).eq("enabled", true).maybeSingle(),
    admin.from("device_installations").select("id,device_id,phone_number_e164,platform,push_token").eq("phone_number_e164", recipientPhoneNumber).eq("enabled", true).order("last_seen_at", { ascending: false }).limit(1).maybeSingle()
  ]);
  if (callerResult.error || recipientResult.error) {
    console.error("[VoiceCall] directory lookup failed");
    return callError(res, 502, "directory_lookup_failed", "Unable to start the call.");
  }
  if (!callerResult.data) return callError(res, 409, "caller_not_registered", "Register this device before calling.");
  if (!recipientResult.data) return callError(res, 404, "recipient_not_registered", "This person does not have Interpreter yet.");
  if (callerResult.data.device_id === recipientResult.data.device_id) {
    return callError(res, 409, "same_device", "Choose another Interpreter device.");
  }

  const [callerOpen, recipientOpen] = await Promise.all([
    admin.from("active_calls").select("id").in("status", OPEN_STATUSES).or(`caller_device_id.eq.${callerDeviceId},recipient_device_id.eq.${callerDeviceId}`).limit(1).maybeSingle(),
    admin.from("active_calls").select("id").in("status", OPEN_STATUSES).or(`caller_device_id.eq.${recipientResult.data.device_id},recipient_device_id.eq.${recipientResult.data.device_id}`).limit(1).maybeSingle()
  ]);
  if (callerOpen.error || recipientOpen.error) return callError(res, 502, "call_state_unavailable", "Unable to start the call.");
  if (callerOpen.data || recipientOpen.data) return callError(res, 409, "device_busy", "One of the devices is already in a call.");

  const roomName = `voice-${crypto.randomUUID()}`;
  let row;
  try {
    await createVoiceRoom(roomName);
    console.info("[VoiceCall] room created", { roomName });
    const inserted = await admin.from("active_calls").insert({
      room_name: roomName,
      caller_device_id: callerDeviceId,
      recipient_device_id: recipientResult.data.device_id,
      caller_phone_e164: callerResult.data.phone_number_e164,
      recipient_phone_e164: recipientPhoneNumber,
      status: "ringing"
    }).select("*").single();
    if (inserted.error) throw inserted.error;
    row = inserted.data;
    const callerToken = await createVoiceToken({ identity: `${callerDeviceId}:${row.id}:caller`, roomName });
    console.info("[VoiceCall] caller token generated", { callId: row.id });
    const push = await sendIncomingVoiceCallPush(admin, {
      callId: row.id,
      callerPhoneNumber: callerResult.data.phone_number_e164,
      installationId: recipientResult.data.id
    }).catch(() => ({ accepted: false }));
    console.info("[VoiceCall] incoming push delivery", { accepted: push.accepted, callId: row.id });
    return res.status(201).json({
      callId: row.id,
      roomName,
      livekitUrl: process.env.LIVEKIT_URL,
      callerToken,
      recipientStatus: "ringing"
    });
  } catch (error) {
    console.error("[VoiceCall] start failed", { reason: error instanceof Error ? error.message : "unknown" });
    if (row) await admin.from("active_calls").update({ status: "failed", ended_at: new Date().toISOString() }).eq("id", row.id);
    await deleteVoiceRoom(roomName).catch(() => undefined);
    return callError(res, 502, "call_start_failed", "Unable to reach this Interpreter device.");
  }
});

router.post("/:callId/accept", async (req, res) => {
  if (!isSupabaseConfigured() || !isLiveKitConfigured()) return callError(res, 503, "calling_unavailable", "Calling is temporarily unavailable.");
  const callId = cleanText(req.params.callId, 80);
  const recipientDeviceId = cleanText(req.body?.recipientDeviceId, 120);
  const admin = getSupabaseAdmin();
  const result = await loadCall(admin, callId);
  const row = result.data;
  if (result.error) return callError(res, 502, "call_state_unavailable", "Unable to accept the call.");
  if (!row || row.recipient_device_id !== recipientDeviceId || row.status !== "ringing") {
    return callError(res, 404, "call_not_available", "This call is no longer available.");
  }
  const updated = await admin.from("active_calls").update({ status: "accepted", accepted_at: new Date().toISOString() }).eq("id", callId).eq("status", "ringing").select("id").maybeSingle();
  if (updated.error || !updated.data) return callError(res, 409, "call_not_available", "This call is no longer available.");
  const recipientToken = await createVoiceToken({ identity: `${recipientDeviceId}:${callId}:recipient`, roomName: row.room_name });
  console.info("[VoiceCall] recipient token generated", { callId });
  return res.status(200).json({ callId, roomName: row.room_name, livekitUrl: process.env.LIVEKIT_URL, recipientToken });
});

router.post("/:callId/decline", async (req, res) => {
  if (!isSupabaseConfigured() || !isLiveKitConfigured()) return callError(res, 503, "calling_unavailable", "Calling is temporarily unavailable.");
  const callId = cleanText(req.params.callId, 80);
  const recipientDeviceId = cleanText(req.body?.recipientDeviceId, 120);
  const admin = getSupabaseAdmin();
  const result = await loadCall(admin, callId);
  const row = result.data;
  if (result.error) return callError(res, 502, "call_state_unavailable", "Unable to decline the call.");
  if (!row || row.recipient_device_id !== recipientDeviceId) return callError(res, 404, "call_not_available", "This call is no longer available.");
  await finishCall(admin, row, "declined");
  console.info("[VoiceCall] call declined", { callId });
  return res.status(204).end();
});

router.post("/:callId/end", async (req, res) => {
  if (!isSupabaseConfigured() || !isLiveKitConfigured()) return callError(res, 503, "calling_unavailable", "Calling is temporarily unavailable.");
  const callId = cleanText(req.params.callId, 80);
  const deviceId = cleanText(req.body?.deviceId, 120);
  const admin = getSupabaseAdmin();
  const result = await loadCall(admin, callId);
  const row = result.data;
  if (result.error) return callError(res, 502, "call_state_unavailable", "Unable to end the call.");
  if (!row) return res.status(204).end();
  if (![row.caller_device_id, row.recipient_device_id].includes(deviceId)) {
    return callError(res, 403, "not_call_participant", "Unable to end the call.");
  }
  if (!OPEN_STATUSES.includes(row.status)) return res.status(204).end();
  await finishCall(admin, row, "ended");
  console.info("[VoiceCall] call ended", { callId });
  return res.status(204).end();
});

module.exports = router;
