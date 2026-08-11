const crypto = require("node:crypto");
const express = require("express");

const { normalizeE164 } = require("../devices");
const { createVoiceRoom, createVoiceToken, deleteVoiceRoom, isLiveKitConfigured } = require("../livekit");
const { sendIncomingVoiceCallPush } = require("../push");
const { getSupabaseAdmin, isSupabaseConfigured } = require("../supabase");

const router = express.Router();
const OPEN_STATUSES = ["ringing", "accepted"];

function cleanText(value, maxLength = 160) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function callError(res, status, code, message) {
  return res.status(status).json({ code, error: message });
}

async function loadCall(admin, callId) {
  return admin.from("voice_calls").select("*").eq("id", callId).maybeSingle();
}

async function finishCall(admin, row, deviceId, status) {
  const result = await admin.rpc("voice_finish_call", {
    p_call_id: row.id,
    p_device_id: deviceId,
    p_status: status,
  }).single();
  if (result.error) throw result.error;
  await deleteVoiceRoom(row.room_name).catch(() => false);
}

router.get("/incoming", async (req, res) => {
  if (!isSupabaseConfigured()) return callError(res, 503, "calling_unavailable", "Calling is temporarily unavailable.");
  const deviceId = cleanText(req.query?.deviceId, 120);
  if (deviceId.length < 16) return callError(res, 400, "invalid_device", "Unable to check incoming calls.");

  const admin = getSupabaseAdmin();
  const cutoff = new Date(Date.now() - 60_000).toISOString();
  await admin.from("voice_calls").update({ status: "expired", ended_at: new Date().toISOString() })
    .eq("status", "ringing").lt("updated_at", cutoff);
  const { data, error } = await admin.from("voice_calls")
    .select("id,caller_phone_e164")
    .eq("recipient_device_id", deviceId)
    .eq("status", "ringing")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return callError(res, 502, "call_state_unavailable", "Unable to check incoming calls.");
  if (!data) return res.status(200).json({ incoming: false });
  return res.status(200).json({ incoming: true, callId: data.id, callerPhoneNumber: data.caller_phone_e164, callMode: "voice" });
});

router.get("/:callId", async (req, res) => {
  if (!isSupabaseConfigured()) return callError(res, 503, "calling_unavailable", "Calling is temporarily unavailable.");
  const callId = cleanText(req.params.callId, 80);
  const deviceId = cleanText(req.query?.deviceId, 120);
  if (!callId || deviceId.length < 16) return callError(res, 400, "invalid_call_request", "Unable to check this call.");
  const admin = getSupabaseAdmin();
  const result = await loadCall(admin, callId);
  if (result.error) return callError(res, 502, "call_state_unavailable", "Unable to check this call.");
  const row = result.data;
  if (!row) return res.status(200).json({ active: false, status: "ended" });
  if (![row.caller_device_id, row.recipient_device_id].includes(deviceId)) {
    return callError(res, 403, "not_call_participant", "Unable to check this call.");
  }
  if (OPEN_STATUSES.includes(row.status)) {
    await admin.from("voice_calls").update({ updated_at: new Date().toISOString() }).eq("id", callId);
  }
  return res.status(200).json({ active: OPEN_STATUSES.includes(row.status), status: row.status });
});

router.post("/start", async (req, res) => {
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
    admin.from("device_installations").select("id,device_id,phone_number_e164").eq("device_id", callerDeviceId).eq("enabled", true).maybeSingle(),
    admin.from("device_installations").select("id,device_id,phone_number_e164").eq("phone_number_e164", recipientPhoneNumber).eq("enabled", true).order("last_seen_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (callerResult.error || recipientResult.error) return callError(res, 502, "directory_lookup_failed", "Unable to start the call.");
  if (!callerResult.data) return callError(res, 409, "caller_not_registered", "Register this device before calling.");
  if (!recipientResult.data) return callError(res, 404, "recipient_not_registered", "This person does not have Interpreter yet.");
  if (callerDeviceId === recipientResult.data.device_id) return callError(res, 409, "same_device", "Choose another Interpreter device.");

  const roomName = `speak-voice-${crypto.randomUUID()}`;
  try {
    await createVoiceRoom(roomName);
    const inserted = await admin.rpc("voice_start_call", {
      p_room_name: roomName,
      p_caller_device_id: callerDeviceId,
      p_recipient_device_id: recipientResult.data.device_id,
      p_caller_phone_e164: callerResult.data.phone_number_e164,
      p_recipient_phone_e164: recipientPhoneNumber,
    }).single();
    if (inserted.error) throw inserted.error;
    const row = inserted.data;
    const callerToken = await createVoiceToken({ identity: `caller:${row.id}:${callerDeviceId}`, roomName });
    await sendIncomingVoiceCallPush(admin, {
      callId: row.id,
      callType: "voice",
      callerPhoneNumber: callerResult.data.phone_number_e164,
      installationId: recipientResult.data.id,
    }).catch(() => ({ accepted: false }));
    return res.status(201).json({ callId: row.id, callMode: "voice", roomName, livekitUrl: process.env.LIVEKIT_URL, callerToken });
  } catch (error) {
    await deleteVoiceRoom(roomName).catch(() => false);
    const busy = error instanceof Error && /device_busy|duplicate key/i.test(error.message);
    return callError(res, busy ? 409 : 502, busy ? "device_busy" : "call_start_failed", busy ? "One of the devices is already in a call." : "Unable to start the call.");
  }
});

router.post("/:callId/accept", async (req, res) => {
  if (!isSupabaseConfigured() || !isLiveKitConfigured()) return callError(res, 503, "calling_unavailable", "Calling is temporarily unavailable.");
  const callId = cleanText(req.params.callId, 80);
  const recipientDeviceId = cleanText(req.body?.recipientDeviceId, 120);
  const result = await getSupabaseAdmin().rpc("voice_accept_call", {
    p_call_id: callId,
    p_recipient_device_id: recipientDeviceId,
  }).single();
  if (result.error || !result.data) return callError(res, 404, "call_not_available", "This call is no longer available.");
  const row = result.data;
  const recipientToken = await createVoiceToken({ identity: `recipient:${row.id}:${recipientDeviceId}`, roomName: row.room_name });
  return res.status(200).json({ callId: row.id, callMode: "voice", roomName: row.room_name, livekitUrl: process.env.LIVEKIT_URL, recipientToken });
});

router.post("/:callId/decline", async (req, res) => {
  if (!isSupabaseConfigured()) return callError(res, 503, "calling_unavailable", "Calling is temporarily unavailable.");
  const callId = cleanText(req.params.callId, 80);
  const deviceId = cleanText(req.body?.recipientDeviceId, 120);
  const admin = getSupabaseAdmin();
  const result = await loadCall(admin, callId);
  if (result.error) return callError(res, 502, "call_state_unavailable", "Unable to decline the call.");
  if (!result.data) return res.status(204).end();
  if (result.data.recipient_device_id !== deviceId) return callError(res, 403, "not_call_participant", "Unable to decline the call.");
  await finishCall(admin, result.data, deviceId, "declined");
  return res.status(204).end();
});

router.post("/:callId/end", async (req, res) => {
  if (!isSupabaseConfigured()) return callError(res, 503, "calling_unavailable", "Calling is temporarily unavailable.");
  const callId = cleanText(req.params.callId, 80);
  const deviceId = cleanText(req.body?.deviceId, 120);
  const admin = getSupabaseAdmin();
  const result = await loadCall(admin, callId);
  if (result.error) return callError(res, 502, "call_state_unavailable", "Unable to end the call.");
  if (!result.data) return res.status(204).end();
  if (![result.data.caller_device_id, result.data.recipient_device_id].includes(deviceId)) {
    return callError(res, 403, "not_call_participant", "Unable to end the call.");
  }
  if (OPEN_STATUSES.includes(result.data.status)) await finishCall(admin, result.data, deviceId, "ended");
  return res.status(204).end();
});

module.exports = router;
