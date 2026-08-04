const crypto = require("node:crypto");
const express = require("express");
const { CALL_TYPES, createRoomName, OPEN_STATUSES, RING_TIMEOUT_MS, serializeCall, validTransition } = require("../calls");
const { createCallRoom, createParticipantToken, deleteCallRoom, isLiveKitConfigured } = require("../livekit");
const { sendIncomingCallPush } = require("../push");
const { getSupabaseAdmin, requireUser } = require("../supabase");
const { stopInterpretedCall } = require("../interpreted-call-manager");

const router = express.Router();
const CALL_SELECT = "id,room_name,caller_id,callee_id,contact_id,call_type,status,ringing_at,answered_at,ended_at,ended_by,duration_seconds,decline_reason,interpretation_enabled,caller_spoken_language,caller_heard_language,callee_spoken_language,callee_heard_language,interpretation_started_at,interpretation_ended_at,interpreted_seconds,created_at,updated_at";

router.use(requireUser);

async function setPresence(admin, userId, status, activeCallId = null) {
  const { error } = await admin.from("user_presence").upsert({ user_id: userId, status, active_call_id: activeCallId, last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw new Error("Unable to update presence");
}

async function restoreParticipants(admin, call) {
  await Promise.all([
    setPresence(admin, call.caller_id, "available"),
    setPresence(admin, call.callee_id, "available")
  ]);
}

async function addEvent(admin, callId, actorId, eventType, details = {}) {
  const { error } = await admin.from("call_events").insert({ call_id: callId, actor_id: actorId, event_type: eventType, details });
  if (error) throw new Error("Unable to record call event");
}

async function hydrateCalls(admin, rows, viewerId) {
  if (!rows.length) return [];
  const otherIds = [...new Set(rows.map((row) => row.caller_id === viewerId ? row.callee_id : row.caller_id))];
  const { data: profiles } = await admin.from("profiles").select("id,full_name,phone").in("id", otherIds);
  const profileMap = new Map((profiles || []).map((profile) => [profile.id, profile]));
  return rows.map((row) => {
    const otherUserId = row.caller_id === viewerId ? row.callee_id : row.caller_id;
    const profile = profileMap.get(otherUserId);
    return serializeCall(row, { userId: otherUserId, displayName: profile?.full_name || "Interpreter user", phone: profile?.phone || null });
  });
}

async function expireMissedCalls(admin) {
  const cutoff = new Date(Date.now() - RING_TIMEOUT_MS).toISOString();
  const { data } = await admin.from("calls").select(CALL_SELECT).eq("status", "ringing").lt("ringing_at", cutoff).limit(100);
  for (const call of data || []) {
    const { data: updated } = await admin.from("calls").update({ status: "missed", decline_reason: "no_answer" }).eq("id", call.id).eq("status", "ringing").select(CALL_SELECT).maybeSingle();
    if (updated) {
      await addEvent(admin, call.id, null, "missed").catch(() => undefined);
      await restoreParticipants(admin, updated).catch(() => undefined);
      await stopInterpretedCall(call.id, "missed").catch(() => undefined);
      await deleteCallRoom(updated.room_name);
    }
  }
}

async function loadParticipantCall(admin, callId, userId) {
  const { data, error } = await admin.from("calls").select(CALL_SELECT).eq("id", callId).or(`caller_id.eq.${userId},callee_id.eq.${userId}`).maybeSingle();
  if (error) throw new Error("Unable to load call");
  return data;
}

router.post("/", async (req, res) => {
  if (!isLiveKitConfigured()) return res.status(503).json({ error: "Calling services are not configured" });
  const callType = typeof req.body?.callType === "string" ? req.body.callType : "";
  const contactId = typeof req.body?.contactId === "string" ? req.body.contactId : "";
  if (!CALL_TYPES.has(callType) || !contactId) return res.status(400).json({ error: "A valid contact and call type are required" });
  const admin = getSupabaseAdmin();
  await expireMissedCalls(admin);
  const { data: contact, error: contactError } = await admin.from("contacts").select("id,interpreter_user_id,display_name").eq("id", contactId).eq("owner_id", req.interpreterUser.id).maybeSingle();
  if (contactError) return res.status(500).json({ error: "Unable to load contact" });
  if (!contact?.interpreter_user_id) return res.status(409).json({ error: "Invite this contact to Interpreter before calling" });
  if (contact.interpreter_user_id === req.interpreterUser.id) return res.status(400).json({ error: "You cannot call your own account" });

  const callId = crypto.randomUUID();
  const roomName = createRoomName();
  try {
    await createCallRoom(roomName);
    const { data: call, error } = await admin.rpc("reserve_interpreter_call", {
      p_call_id: callId,
      p_room_name: roomName,
      p_caller_id: req.interpreterUser.id,
      p_callee_id: contact.interpreter_user_id,
      p_contact_id: contact.id,
      p_call_type: callType
    }).single();
    if (error) {
      await deleteCallRoom(roomName);
      if (error.message?.includes("participant_busy")) {
        const now = new Date().toISOString();
        const { data: busyCall } = await admin.from("calls").insert({
          id: callId,
          room_name: roomName,
          caller_id: req.interpreterUser.id,
          callee_id: contact.interpreter_user_id,
          contact_id: contact.id,
          call_type: callType,
          status: "busy",
          ended_at: now,
          decline_reason: "participant_busy"
        }).select(CALL_SELECT).maybeSingle();
        if (busyCall) await addEvent(admin, callId, req.interpreterUser.id, "busy").catch(() => undefined);
        const serialized = busyCall ? (await hydrateCalls(admin, [busyCall], req.interpreterUser.id))[0] : null;
        return res.status(409).json({ error: "This person is busy", status: "busy", call: serialized });
      }
      throw error;
    }
    const callerSpokenLanguage = validLanguage(req.body?.callerSpokenLanguage, "English");
    const callerHeardLanguage = validLanguage(req.body?.callerHeardLanguage, callerSpokenLanguage);
    const calleeSpokenLanguage = validLanguage(req.body?.calleeSpokenLanguage, "Spanish");
    const calleeHeardLanguage = validLanguage(req.body?.calleeHeardLanguage, calleeSpokenLanguage);
    const { data: configuredCall, error: languageError } = await admin.from("calls").update({
      interpretation_enabled: true,
      caller_spoken_language: callerSpokenLanguage,
      caller_heard_language: callerHeardLanguage,
      callee_spoken_language: calleeSpokenLanguage,
      callee_heard_language: calleeHeardLanguage
    }).eq("id", callId).select(CALL_SELECT).single();
    if (languageError) throw languageError;
    const { data: callerProfile } = await admin.from("profiles").select("full_name").eq("id", req.interpreterUser.id).maybeSingle();
    await admin.from("contacts").update({ last_called_at: new Date().toISOString() }).eq("id", contact.id).eq("owner_id", req.interpreterUser.id);
    void sendIncomingCallPush(admin, { callId, callType, callerName: callerProfile?.full_name || "Interpreter user", calleeId: contact.interpreter_user_id }).catch(() => console.warn("[Calls] Push delivery failed", { category: "notification" }));
    const [serialized] = await hydrateCalls(admin, [configuredCall], req.interpreterUser.id);
    return res.status(201).json({ call: serialized });
  } catch {
    await deleteCallRoom(roomName);
    console.error("[Calls] Creation failed", { category: "call_setup" });
    return res.status(500).json({ error: "Unable to create call" });
  }
});

router.get("/incoming", async (req, res) => {
  const admin = getSupabaseAdmin();
  await expireMissedCalls(admin);
  const { data, error } = await admin.from("calls").select(CALL_SELECT).eq("callee_id", req.interpreterUser.id).eq("status", "ringing").order("ringing_at", { ascending: false }).limit(1).maybeSingle();
  if (error) return res.status(500).json({ error: "Unable to load incoming call" });
  const calls = data ? await hydrateCalls(admin, [data], req.interpreterUser.id) : [];
  return res.json({ call: calls[0] || null });
});

router.get("/history", async (req, res) => {
  const admin = getSupabaseAdmin();
  await expireMissedCalls(admin);
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 200);
  const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
  const { data, error } = await admin.from("calls").select(CALL_SELECT).or(`caller_id.eq.${req.interpreterUser.id},callee_id.eq.${req.interpreterUser.id}`).order("created_at", { ascending: false }).range(offset, offset + limit - 1);
  if (error) return res.status(500).json({ error: "Unable to load call history" });
  return res.json({ calls: await hydrateCalls(admin, data || [], req.interpreterUser.id), hasMore: (data || []).length === limit });
});

router.get("/:callId", async (req, res) => {
  const admin = getSupabaseAdmin();
  await expireMissedCalls(admin);
  const call = await loadParticipantCall(admin, req.params.callId, req.interpreterUser.id);
  if (!call) return res.status(404).json({ error: "Call not found" });
  const [serialized] = await hydrateCalls(admin, [call], req.interpreterUser.id);
  return res.json({ call: serialized });
});

router.post("/:callId/accept", async (req, res) => {
  const admin = getSupabaseAdmin();
  await expireMissedCalls(admin);
  const call = await loadParticipantCall(admin, req.params.callId, req.interpreterUser.id);
  if (!call) return res.status(404).json({ error: "Call not found" });
  if (call.callee_id !== req.interpreterUser.id) return res.status(403).json({ error: "Only the recipient can accept this call" });
  if (!validTransition(call.status, "accepted")) return res.status(409).json({ error: "Call is no longer ringing", status: call.status });
  const { data, error } = await admin.from("calls").update({ status: "accepted", answered_at: new Date().toISOString() }).eq("id", call.id).eq("status", "ringing").select(CALL_SELECT).maybeSingle();
  if (error || !data) return res.status(409).json({ error: "Call is no longer available" });
  await Promise.all([addEvent(admin, call.id, req.interpreterUser.id, "accepted"), setPresence(admin, call.caller_id, "in_call", call.id), setPresence(admin, call.callee_id, "in_call", call.id)]);
  const [serialized] = await hydrateCalls(admin, [data], req.interpreterUser.id);
  return res.json({ call: serialized });
});

router.post("/:callId/active", async (req, res) => {
  const admin = getSupabaseAdmin();
  const call = await loadParticipantCall(admin, req.params.callId, req.interpreterUser.id);
  if (!call) return res.status(404).json({ error: "Call not found" });
  if (call.status === "active") return res.json({ call: (await hydrateCalls(admin, [call], req.interpreterUser.id))[0] });
  if (!validTransition(call.status, "active")) return res.status(409).json({ error: "Call cannot become active", status: call.status });
  const { data, error } = await admin.from("calls").update({ status: "active" }).eq("id", call.id).eq("status", "accepted").select(CALL_SELECT).maybeSingle();
  if (error || !data) return res.status(409).json({ error: "Call state changed" });
  await addEvent(admin, call.id, req.interpreterUser.id, "active");
  return res.json({ call: (await hydrateCalls(admin, [data], req.interpreterUser.id))[0] });
});

router.post("/:callId/connection", async (req, res) => {
  const state = req.body?.state;
  if (!["reconnecting", "reconnected"].includes(state)) return res.status(400).json({ error: "A valid connection state is required" });
  const admin = getSupabaseAdmin();
  const call = await loadParticipantCall(admin, req.params.callId, req.interpreterUser.id);
  if (!call) return res.status(404).json({ error: "Call not found" });
  if (!["accepted", "active"].includes(call.status)) return res.status(409).json({ error: "Call is not active", status: call.status });
  await addEvent(admin, call.id, req.interpreterUser.id, state);
  return res.status(204).end();
});

router.post("/:callId/decline", async (req, res) => {
  const admin = getSupabaseAdmin();
  const call = await loadParticipantCall(admin, req.params.callId, req.interpreterUser.id);
  if (!call) return res.status(404).json({ error: "Call not found" });
  if (call.callee_id !== req.interpreterUser.id) return res.status(403).json({ error: "Only the recipient can decline this call" });
  if (!validTransition(call.status, "declined")) return res.status(409).json({ error: "Call is no longer ringing", status: call.status });
  const { data, error } = await admin.from("calls").update({ status: "declined", ended_by: req.interpreterUser.id, decline_reason: "declined" }).eq("id", call.id).eq("status", "ringing").select(CALL_SELECT).maybeSingle();
  if (error || !data) return res.status(409).json({ error: "Call state changed" });
  await Promise.all([addEvent(admin, call.id, req.interpreterUser.id, "declined"), restoreParticipants(admin, data), stopInterpretedCall(call.id, "declined"), deleteCallRoom(data.room_name)]);
  return res.json({ call: (await hydrateCalls(admin, [data], req.interpreterUser.id))[0] });
});

router.post("/:callId/missed", async (req, res) => {
  const admin = getSupabaseAdmin();
  const call = await loadParticipantCall(admin, req.params.callId, req.interpreterUser.id);
  if (!call) return res.status(404).json({ error: "Call not found" });
  if (call.status !== "ringing" || Date.now() - new Date(call.ringing_at).getTime() < RING_TIMEOUT_MS) return res.status(409).json({ error: "Call has not timed out", status: call.status });
  const { data } = await admin.from("calls").update({ status: "missed", decline_reason: "no_answer" }).eq("id", call.id).eq("status", "ringing").select(CALL_SELECT).maybeSingle();
  if (!data) return res.status(409).json({ error: "Call state changed" });
  await Promise.all([addEvent(admin, call.id, req.interpreterUser.id, "missed"), restoreParticipants(admin, data), stopInterpretedCall(call.id, "missed"), deleteCallRoom(data.room_name)]);
  return res.json({ call: (await hydrateCalls(admin, [data], req.interpreterUser.id))[0] });
});

router.post("/:callId/end", async (req, res) => {
  const admin = getSupabaseAdmin();
  const call = await loadParticipantCall(admin, req.params.callId, req.interpreterUser.id);
  if (!call) return res.status(404).json({ error: "Call not found" });
  const nextStatus = call.status === "ringing" && call.caller_id === req.interpreterUser.id ? "canceled" : "ended";
  if (!validTransition(call.status, nextStatus)) return res.status(409).json({ error: "Call is already complete", status: call.status });
  const { data, error } = await admin.from("calls").update({ status: nextStatus, ended_by: req.interpreterUser.id }).eq("id", call.id).eq("status", call.status).select(CALL_SELECT).maybeSingle();
  if (error || !data) return res.status(409).json({ error: "Call state changed" });
  await Promise.all([addEvent(admin, call.id, req.interpreterUser.id, nextStatus), restoreParticipants(admin, data), stopInterpretedCall(call.id, nextStatus), deleteCallRoom(data.room_name)]);
  return res.json({ call: (await hydrateCalls(admin, [data], req.interpreterUser.id))[0] });
});

router.post("/:callId/token", async (req, res) => {
  const admin = getSupabaseAdmin();
  const call = await loadParticipantCall(admin, req.params.callId, req.interpreterUser.id);
  if (!call) return res.status(404).json({ error: "Call not found" });
  if (!["accepted", "active"].includes(call.status)) return res.status(409).json({ error: "Call must be accepted before joining", status: call.status });
  const { data: profile } = await admin.from("profiles").select("full_name").eq("id", req.interpreterUser.id).maybeSingle();
  try {
    const token = await createParticipantToken({ callType: call.call_type, identity: req.interpreterUser.id, name: profile?.full_name || "Interpreter user", roomName: call.room_name });
    return res.json({ expiresIn: 600, livekitUrl: process.env.LIVEKIT_URL, token });
  } catch {
    return res.status(503).json({ error: "Unable to create call credential" });
  }
});

module.exports = router;
module.exports.expireMissedCalls = expireMissedCalls;
module.exports.hydrateCalls = hydrateCalls;
module.exports.setPresence = setPresence;

function validLanguage(value, fallback) {
  return typeof value === "string" && value.trim() && value.trim().length <= 80 ? value.trim() : fallback;
}
