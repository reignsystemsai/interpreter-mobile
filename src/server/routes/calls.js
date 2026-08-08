const express = require("express");

const { normalizeE164 } = require("../devices");
const { getSupabaseAdmin, isSupabaseConfigured } = require("../supabase");
const { createVoiceToken, isLiveKitConfigured } = require("../livekit");

const router = express.Router();

function cleanText(value, maxLength = 160) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function callError(res, status, code, message) {
  return res.status(status).json({ code, error: message });
}

// One deterministic room per call, matching the deterministic-room pattern used
// elsewhere in this codebase for LiveKit. LiveKit creates the room automatically
// on first join, so there is nothing to pre-create here.
function roomNameForCall(callId) {
  return `basic-${callId}`;
}

function participantIdentityFor(role, callId) {
  return `${role}:${callId}`;
}

function authorizeParticipant(row, deviceId) {
  return row.caller_device_id === deviceId || row.recipient_device_id === deviceId;
}

// Postgres errcodes raised by the basic_call_* functions (see the migration),
// mapped to safe, stable response shapes. The underlying Postgres error is
// never forwarded to mobile callers.
function resolveBasicCallErrorResponse(error, fallbackMessage) {
  const code = error?.code;
  if (code === "P0001") return { status: 409, code: "device_already_active", message: "This device is already in a call." };
  if (code === "P0002") return { status: 409, code: "invalid_call_state", message: "This call is no longer available to answer." };
  if (code === "P0003") return { status: 404, code: "call_not_found", message: "This call is no longer available." };
  return { status: 502, code: "call_state_unavailable", message: fallbackMessage };
}

function toCallRecordJson(row) {
  return {
    id: row.id,
    callerDeviceId: row.caller_device_id,
    recipientDeviceId: row.recipient_device_id,
    callerPhoneNumber: row.caller_phone_e164,
    recipientPhoneNumber: row.recipient_phone_e164,
    status: row.status,
    roomName: row.room_name,
    createdAt: row.created_at,
    endedAt: row.ended_at
  };
}

router.post("/", async (req, res) => {
  if (!isSupabaseConfigured() || !isLiveKitConfigured()) return callError(res, 503, "calling_unavailable", "Calling is temporarily unavailable.");
  const callerDeviceId = cleanText(req.body?.callerDeviceId, 120);
  const recipientPhoneNumber = normalizeE164(req.body?.recipientPhoneNumber, req.body?.defaultRegion);
  if (callerDeviceId.length < 16 || !recipientPhoneNumber) {
    return callError(res, 400, "invalid_call_request", "Unable to create the call.");
  }

  const admin = getSupabaseAdmin();
  const caller = await admin.from("device_installations").select("phone_number_e164").eq("device_id", callerDeviceId).eq("enabled", true).maybeSingle();
  if (caller.error) return callError(res, 502, "call_state_unavailable", "Unable to create the call.");
  if (!caller.data) return callError(res, 400, "invalid_call_request", "Register this device before placing a call.");

  const recipient = await admin.from("device_installations").select("id").eq("phone_number_e164", recipientPhoneNumber).eq("enabled", true).maybeSingle();
  if (recipient.error) return callError(res, 502, "call_state_unavailable", "Unable to create the call.");
  if (!recipient.data) return callError(res, 404, "recipient_not_found", "This person does not have Interpreter yet.");

  const { data, error } = await admin.rpc("basic_call_create", {
    p_caller_device_id: callerDeviceId,
    p_caller_phone: caller.data.phone_number_e164,
    p_recipient_phone: recipientPhoneNumber
  });
  if (error) {
    const resolved = resolveBasicCallErrorResponse(error, "Unable to create the call.");
    return callError(res, resolved.status, resolved.code, resolved.message);
  }

  let token;
  try {
    token = await createVoiceToken({ identity: participantIdentityFor("caller", data.id), roomName: data.room_name });
  } catch (tokenError) {
    console.error("[Calls] caller token issuance failed", { callId: data.id, reason: tokenError instanceof Error ? tokenError.message : "unknown" });
    return callError(res, 502, "call_state_unavailable", "Unable to create the call.");
  }

  return res.status(201).json({ ...toCallRecordJson(data), livekitUrl: process.env.LIVEKIT_URL, token });
});

// Must be registered before GET "/:callId" — otherwise Express would match
// "incoming" as a :callId value on that route instead of reaching this one.
router.get("/incoming", async (req, res) => {
  if (!isSupabaseConfigured()) return callError(res, 503, "calling_unavailable", "Calling is temporarily unavailable.");
  const deviceId = cleanText(req.query?.deviceId, 120);
  if (deviceId.length < 16) return callError(res, 400, "invalid_call_request", "Unable to check incoming calls.");

  const admin = getSupabaseAdmin();
  const device = await admin.from("device_installations").select("phone_number_e164").eq("device_id", deviceId).eq("enabled", true).maybeSingle();
  if (device.error) return callError(res, 502, "call_state_unavailable", "Unable to check incoming calls.");
  if (!device.data) return res.status(200).json({ incoming: false });

  const call = await admin
    .from("basic_calls")
    .select("id,caller_phone_e164")
    .eq("recipient_phone_e164", device.data.phone_number_e164)
    .eq("status", "ringing")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (call.error) return callError(res, 502, "call_state_unavailable", "Unable to check incoming calls.");
  if (!call.data) return res.status(200).json({ incoming: false });

  return res.status(200).json({ incoming: true, callId: call.data.id, callerPhoneNumber: call.data.caller_phone_e164 });
});

router.get("/:callId", async (req, res) => {
  if (!isSupabaseConfigured()) return callError(res, 503, "calling_unavailable", "Calling is temporarily unavailable.");
  const callId = cleanText(req.params.callId, 80);
  const deviceId = cleanText(req.query?.deviceId, 120);
  if (!callId || deviceId.length < 16) return callError(res, 400, "invalid_call_request", "Unable to check this call.");

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from("basic_calls").select("*").eq("id", callId).maybeSingle();
  if (error) return callError(res, 502, "call_state_unavailable", "Unable to check this call.");
  if (!data) return res.status(200).json({ found: false });
  if (!authorizeParticipant(data, deviceId)) return callError(res, 403, "not_call_participant", "Unable to check this call.");
  return res.status(200).json({ found: true, call: toCallRecordJson(data) });
});

router.post("/:callId/accept", async (req, res) => {
  if (!isSupabaseConfigured() || !isLiveKitConfigured()) return callError(res, 503, "calling_unavailable", "Calling is temporarily unavailable.");
  const callId = cleanText(req.params.callId, 80);
  const recipientDeviceId = cleanText(req.body?.deviceId, 120);
  if (!callId || recipientDeviceId.length < 16) return callError(res, 400, "invalid_call_request", "Unable to answer the call.");

  const admin = getSupabaseAdmin();
  const current = await admin.from("basic_calls").select("recipient_phone_e164").eq("id", callId).maybeSingle();
  if (current.error) return callError(res, 502, "call_state_unavailable", "Unable to answer the call.");
  if (!current.data) return callError(res, 404, "call_not_found", "This call is no longer available.");
  const device = await admin.from("device_installations").select("phone_number_e164").eq("device_id", recipientDeviceId).eq("enabled", true).maybeSingle();
  if (device.error) return callError(res, 502, "call_state_unavailable", "Unable to answer the call.");
  if (!device.data || device.data.phone_number_e164 !== current.data.recipient_phone_e164) {
    return callError(res, 403, "not_call_participant", "Unable to answer the call.");
  }

  const { data, error } = await admin.rpc("basic_call_accept", { p_call_id: callId, p_recipient_device_id: recipientDeviceId });
  if (error) {
    const resolved = resolveBasicCallErrorResponse(error, "Unable to answer the call.");
    return callError(res, resolved.status, resolved.code, resolved.message);
  }

  let token;
  try {
    token = await createVoiceToken({ identity: participantIdentityFor("recipient", data.id), roomName: data.room_name });
  } catch (tokenError) {
    console.error("[Calls] recipient token issuance failed", { callId: data.id, reason: tokenError instanceof Error ? tokenError.message : "unknown" });
    return callError(res, 502, "call_state_unavailable", "Unable to answer the call.");
  }

  return res.status(200).json({ ...toCallRecordJson(data), livekitUrl: process.env.LIVEKIT_URL, token });
});

async function handleTerminalTransition(req, res, { requirePhoneForUnclaimed }) {
  if (!isSupabaseConfigured()) return callError(res, 503, "calling_unavailable", "Calling is temporarily unavailable.");
  const callId = cleanText(req.params.callId, 80);
  const deviceId = cleanText(req.body?.deviceId, 120);
  if (!callId || deviceId.length < 16) return callError(res, 400, "invalid_call_request", "Unable to update the call.");

  const admin = getSupabaseAdmin();
  const current = await admin.from("basic_calls").select("*").eq("id", callId).maybeSingle();
  if (current.error) return callError(res, 502, "call_state_unavailable", "Unable to update the call.");
  if (!current.data) return callError(res, 404, "call_not_found", "This call is no longer available.");

  let authorized = authorizeParticipant(current.data, deviceId);
  if (!authorized && requirePhoneForUnclaimed && current.data.recipient_device_id === null) {
    const device = await admin.from("device_installations").select("phone_number_e164").eq("device_id", deviceId).eq("enabled", true).maybeSingle();
    authorized = Boolean(device.data && device.data.phone_number_e164 === current.data.recipient_phone_e164);
  }
  if (!authorized) return callError(res, 403, "not_call_participant", "Unable to update the call.");

  const { data, error } = await admin.rpc("basic_call_end", { p_call_id: callId });
  if (error) {
    const resolved = resolveBasicCallErrorResponse(error, "Unable to update the call.");
    return callError(res, resolved.status, resolved.code, resolved.message);
  }
  return res.status(200).json(toCallRecordJson(data));
}

router.post("/:callId/decline", (req, res) => handleTerminalTransition(req, res, { requirePhoneForUnclaimed: true }));
router.post("/:callId/end", (req, res) => handleTerminalTransition(req, res, { requirePhoneForUnclaimed: false }));

router.roomNameForCall = roomNameForCall;
router.participantIdentityFor = participantIdentityFor;
router.authorizeParticipant = authorizeParticipant;
router.resolveBasicCallErrorResponse = resolveBasicCallErrorResponse;
router.toCallRecordJson = toCallRecordJson;

module.exports = router;
