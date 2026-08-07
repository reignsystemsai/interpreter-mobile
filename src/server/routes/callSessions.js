const express = require("express");

const { getSupabaseAdmin, isSupabaseConfigured } = require("../supabase");

const router = express.Router();

const CALL_STATUSES = ["idle", "ringing", "connecting", "connected", "reconnecting", "ending", "ended", "failed"];

// Mirrors mobile/src/shells/calling/CallingShellImpl.ts's ALLOWED_TRANSITIONS. The
// speak_transition_call() Postgres function intentionally does not validate transition
// legality itself (see its comment in the migration) — this route is the enforcement
// point, so it must stay in sync with the shell's table.
const ALLOWED_TRANSITIONS = {
  idle: ["ringing"],
  ringing: ["connecting", "ended", "failed"],
  connecting: ["connected", "reconnecting", "ending", "failed"],
  connected: ["reconnecting", "ending", "failed"],
  reconnecting: ["connected", "ending", "failed"],
  ending: ["ended"],
  ended: [],
  failed: []
};

function isValidTransition(from, to) {
  if (from === to) return true;
  return Boolean(ALLOWED_TRANSITIONS[from]?.includes(to));
}

function cleanText(value, maxLength = 160) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function callError(res, status, code, message) {
  return res.status(status).json({ code, error: message });
}

function authorizeParticipant(row, deviceId) {
  return row.caller_device_id === deviceId || row.recipient_device_id === deviceId;
}

// Postgres errcodes raised by the speak_* functions (see the migration) mapped to safe,
// stable response shapes. Any other error is reported generically — the underlying
// Postgres/Supabase error is never forwarded to mobile callers.
function resolveSpeakErrorResponse(error, fallbackMessage) {
  const code = error?.code;
  if (code === "P0001") return { status: 409, code: "device_already_active", message: "One of the devices is already in a call." };
  if (code === "P0002") return { status: 404, code: "call_not_found", message: "This call is no longer available." };
  if (code === "P0003") return { status: 409, code: "recipient_already_claimed", message: "This call was already answered on another device." };
  return { status: 502, code: "call_state_unavailable", message: fallbackMessage };
}

function toCallRecordJson(row) {
  return {
    id: row.id,
    callerDeviceId: row.caller_device_id,
    recipientDeviceId: row.recipient_device_id,
    recipientPhoneNumber: row.recipient_phone_number,
    callerLanguage: row.caller_language,
    recipientLanguage: row.recipient_language,
    callerParticipantIdentity: row.caller_participant_identity,
    recipientParticipantIdentity: row.recipient_participant_identity,
    status: row.status,
    createdAt: row.created_at,
    endedAt: row.ended_at
  };
}

router.post("/", async (req, res) => {
  if (!isSupabaseConfigured()) return callError(res, 503, "calling_unavailable", "Calling is temporarily unavailable.");
  const callerDeviceId = cleanText(req.body?.callerDeviceId, 120);
  const recipientPhoneNumber = cleanText(req.body?.recipientPhoneNumber, 32);
  const callerLanguage = cleanText(req.body?.callerLanguage, 16);
  const recipientLanguage = cleanText(req.body?.recipientLanguage, 16);
  const callerParticipantIdentity = cleanText(req.body?.callerParticipantIdentity, 160);
  const recipientParticipantIdentity = cleanText(req.body?.recipientParticipantIdentity, 160);
  if (
    callerDeviceId.length < 16 ||
    !recipientPhoneNumber ||
    !callerLanguage ||
    !recipientLanguage ||
    !callerParticipantIdentity ||
    !recipientParticipantIdentity ||
    callerParticipantIdentity === recipientParticipantIdentity
  ) {
    return callError(res, 400, "invalid_call_request", "Unable to create the call.");
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc("speak_create_call", {
    p_caller_device_id: callerDeviceId,
    p_recipient_phone_number: recipientPhoneNumber,
    p_caller_language: callerLanguage,
    p_recipient_language: recipientLanguage,
    p_caller_participant_identity: callerParticipantIdentity,
    p_recipient_participant_identity: recipientParticipantIdentity
  });
  if (error) {
    const resolved = resolveSpeakErrorResponse(error, "Unable to create the call.");
    return callError(res, resolved.status, resolved.code, resolved.message);
  }
  return res.status(201).json(toCallRecordJson(data));
});

router.get("/:callId", async (req, res) => {
  if (!isSupabaseConfigured()) return callError(res, 503, "calling_unavailable", "Calling is temporarily unavailable.");
  const callId = cleanText(req.params.callId, 80);
  const deviceId = cleanText(req.query?.deviceId, 120);
  if (!callId || deviceId.length < 16) return callError(res, 400, "invalid_call_request", "Unable to check this call.");

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from("speak_call_sessions").select("*").eq("id", callId).maybeSingle();
  if (error) return callError(res, 502, "call_state_unavailable", "Unable to check this call.");
  if (!data) return res.status(200).json({ found: false });
  if (!authorizeParticipant(data, deviceId)) return callError(res, 403, "not_call_participant", "Unable to check this call.");
  return res.status(200).json({ found: true, call: toCallRecordJson(data) });
});

router.post("/:callId/claim", async (req, res) => {
  if (!isSupabaseConfigured()) return callError(res, 503, "calling_unavailable", "Calling is temporarily unavailable.");
  const callId = cleanText(req.params.callId, 80);
  const recipientDeviceId = cleanText(req.body?.recipientDeviceId, 120);
  if (!callId || recipientDeviceId.length < 16) return callError(res, 400, "invalid_call_request", "Unable to answer the call.");

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc("speak_claim_call_recipient", {
    p_call_id: callId,
    p_recipient_device_id: recipientDeviceId
  });
  if (error) {
    const resolved = resolveSpeakErrorResponse(error, "Unable to answer the call.");
    return callError(res, resolved.status, resolved.code, resolved.message);
  }
  return res.status(200).json(toCallRecordJson(data));
});

router.post("/:callId/transition", async (req, res) => {
  if (!isSupabaseConfigured()) return callError(res, 503, "calling_unavailable", "Calling is temporarily unavailable.");
  const callId = cleanText(req.params.callId, 80);
  const deviceId = cleanText(req.body?.deviceId, 120);
  const status = cleanText(req.body?.status, 24);
  if (!callId || deviceId.length < 16 || !CALL_STATUSES.includes(status)) {
    return callError(res, 400, "invalid_call_request", "Unable to update the call.");
  }

  const admin = getSupabaseAdmin();
  const current = await admin.from("speak_call_sessions").select("*").eq("id", callId).maybeSingle();
  if (current.error) return callError(res, 502, "call_state_unavailable", "Unable to update the call.");
  if (!current.data) return callError(res, 404, "call_not_found", "This call is no longer available.");
  if (!authorizeParticipant(current.data, deviceId)) return callError(res, 403, "not_call_participant", "Unable to update the call.");
  if (!isValidTransition(current.data.status, status)) {
    return callError(res, 409, "invalid_call_state", `Cannot transition call status from "${current.data.status}" to "${status}".`);
  }

  const { data, error } = await admin.rpc("speak_transition_call", { p_call_id: callId, p_status: status });
  if (error) {
    const resolved = resolveSpeakErrorResponse(error, "Unable to update the call.");
    return callError(res, resolved.status, resolved.code, resolved.message);
  }
  return res.status(200).json(toCallRecordJson(data));
});

router.isValidTransition = isValidTransition;
router.authorizeParticipant = authorizeParticipant;
router.resolveSpeakErrorResponse = resolveSpeakErrorResponse;
router.toCallRecordJson = toCallRecordJson;
router.CALL_STATUSES = CALL_STATUSES;

module.exports = router;
