const express = require("express");

const { getSupabaseAdmin, isSupabaseConfigured } = require("../supabase");
const { createVoiceToken, isLiveKitConfigured } = require("../livekit");

const router = express.Router();

function cleanText(value, maxLength = 160) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function callError(res, status, code, message) {
  return res.status(status).json({ code, error: message });
}

// One deterministic room per call. LiveKit creates the room automatically when the
// first participant connects (see docs.livekit.io/intro/basics/connect) — this
// endpoint never calls createVoiceRoom, so there is no duplicate-room case to guard.
function roomNameForCall(callId) {
  return `speak-${callId}`;
}

// Caller is always authorized. A recipient is authorized only once claimed
// (recipient_device_id is null pre-claim, so it can never equal a real deviceId).
function participantIdentityFor(row, deviceId) {
  if (row.caller_device_id === deviceId) return row.caller_participant_identity;
  if (row.recipient_device_id === deviceId) return row.recipient_participant_identity;
  return null;
}

router.post("/:callId", async (req, res) => {
  if (!isSupabaseConfigured() || !isLiveKitConfigured()) {
    return callError(res, 503, "calling_unavailable", "Calling is temporarily unavailable.");
  }
  const callId = cleanText(req.params.callId, 80);
  const deviceId = cleanText(req.body?.deviceId, 120);
  if (!callId || deviceId.length < 16) {
    return callError(res, 400, "invalid_call_request", "Unable to start media for this call.");
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from("speak_call_sessions").select("*").eq("id", callId).maybeSingle();
  if (error) return callError(res, 502, "media_session_unavailable", "Unable to start media for this call.");
  if (!data) return callError(res, 404, "call_not_found", "This call is no longer available.");

  const identity = participantIdentityFor(data, deviceId);
  if (!identity) return callError(res, 403, "not_call_participant", "Unable to start media for this call.");

  const roomName = roomNameForCall(callId);
  let token;
  try {
    token = await createVoiceToken({ identity, roomName });
  } catch (tokenError) {
    console.error("[MediaSessions] token issuance failed", { callId, reason: tokenError instanceof Error ? tokenError.message : "unknown" });
    return callError(res, 502, "media_session_unavailable", "Unable to start media for this call.");
  }

  return res.status(200).json({
    callId,
    roomName,
    livekitUrl: process.env.LIVEKIT_URL,
    token,
    translationEnabled: false
  });
});

router.roomNameForCall = roomNameForCall;
router.participantIdentityFor = participantIdentityFor;

module.exports = router;
