const crypto = require("node:crypto");

const CALL_TYPES = new Set(["voice", "video", "business_video"]);
const OPEN_STATUSES = ["ringing", "accepted", "active"];
const TERMINAL_STATUSES = new Set(["declined", "ended", "missed", "busy", "failed", "canceled"]);
const RING_TIMEOUT_MS = 45_000;

function createRoomName() {
  return `interpreter-${Date.now()}-${crypto.randomBytes(12).toString("hex")}`;
}

function serializeCall(row, otherParty) {
  return {
    id: row.id,
    roomName: row.room_name,
    callerId: row.caller_id,
    calleeId: row.callee_id,
    contactId: row.contact_id,
    callType: row.call_type,
    status: row.status,
    ringingAt: row.ringing_at,
    answeredAt: row.answered_at,
    endedAt: row.ended_at,
    endedBy: row.ended_by,
    durationSeconds: row.duration_seconds,
    declineReason: row.decline_reason,
    interpretation: {
      enabled: row.interpretation_enabled !== false,
      callerSpokenLanguage: row.caller_spoken_language,
      callerHeardLanguage: row.caller_heard_language,
      calleeSpokenLanguage: row.callee_spoken_language,
      calleeHeardLanguage: row.callee_heard_language,
      startedAt: row.interpretation_started_at,
      endedAt: row.interpretation_ended_at,
      interpretedSeconds: row.interpreted_seconds || 0
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    otherParty
  };
}

function validTransition(current, next) {
  return {
    ringing: new Set(["accepted", "declined", "missed", "busy", "failed", "canceled"]),
    accepted: new Set(["active", "ended", "failed"]),
    active: new Set(["ended", "failed"])
  }[current]?.has(next) || false;
}

module.exports = { CALL_TYPES, createRoomName, OPEN_STATUSES, RING_TIMEOUT_MS, serializeCall, TERMINAL_STATUSES, validTransition };
