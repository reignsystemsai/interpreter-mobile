const crypto = require("crypto");
const express = require("express");

const { getSupabaseAdmin, isSupabaseConfigured } = require("../supabase");
const { LANGUAGE_NAMES, TranslatorBridge } = require("./TranslatorBridge");

const router = express.Router();
const calls = new Map();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FINAL = new Set(["declined", "ended", "failed"]);
const VOICES = new Set(["male", "female"]);

async function issueTranslatorToken(roomName, identity) {
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error("Supabase token signer is not configured");
  const { data, error } = await admin.rpc("issue_translator_livekit_token", {
    p_room_name: roomName,
    p_identity: identity
  });
  if (error || !data?.participant_token || !data?.server_url) {
    throw new Error(error?.message || "Translator token could not be issued");
  }
  return { participantToken: data.participant_token, serverUrl: data.server_url };
}

function publicCall(call) {
  return {
    id: call.id, callerIdentity: call.callerIdentity, callerLabel: call.callerLabel,
    recipientIdentity: call.recipientIdentity, recipientLabel: call.recipientLabel,
    status: call.status, createdAt: call.createdAt
  };
}

function participant(call, deviceId) {
  return call && (call.callerIdentity === deviceId || call.recipientIdentity === deviceId);
}

function expireCalls() {
  const cutoff = Date.now() - 30 * 60_000;
  for (const [id, call] of calls) {
    if (call.createdAt < cutoff || (FINAL.has(call.status) && call.endedAt < Date.now() - 60_000)) {
      void call.bridge?.stop();
      calls.delete(id);
    }
  }
}

router.post("/", (req, res) => {
  expireCalls();
  const { callerIdentity, callerLabel, callerLanguage, callerVoice, recipientIdentity, recipientLabel, recipientLanguage, recipientVoice } = req.body ?? {};
  if (!UUID.test(callerIdentity) || !UUID.test(recipientIdentity) || callerIdentity === recipientIdentity
    || !LANGUAGE_NAMES[callerLanguage] || !LANGUAGE_NAMES[recipientLanguage] || callerLanguage === recipientLanguage
    || !VOICES.has(callerVoice) || !VOICES.has(recipientVoice)) {
    return res.status(400).json({ error: "Invalid Translator Call configuration." });
  }
  if ([...calls.values()].some((call) => !FINAL.has(call.status) && [call.callerIdentity, call.recipientIdentity].some((id) => id === callerIdentity || id === recipientIdentity))) {
    return res.status(409).json({ error: "One of these devices is already in a Translator Call." });
  }
  const id = crypto.randomUUID();
  calls.set(id, {
    id, callerIdentity, callerLabel: String(callerLabel || "Caller").slice(0, 100), callerLanguage, callerVoice,
    recipientIdentity, recipientLabel: String(recipientLabel || "Contact").slice(0, 100), recipientLanguage, recipientVoice,
    status: "ringing", createdAt: Date.now(), endedAt: null, bridge: null
  });
  return res.status(201).json({ call: publicCall(calls.get(id)) });
});

router.get("/incoming", (req, res) => {
  expireCalls();
  const deviceId = req.query.deviceId;
  if (!UUID.test(deviceId)) return res.status(400).json({ error: "Invalid device." });
  const call = [...calls.values()].find((candidate) => candidate.recipientIdentity === deviceId && candidate.status === "ringing");
  return res.json({ call: call ? publicCall(call) : null });
});

router.get("/:callId", (req, res) => {
  const call = calls.get(req.params.callId);
  if (!participant(call, req.query.deviceId)) return res.status(404).json({ error: "Translator Call not found." });
  return res.json({ call: publicCall(call) });
});

router.post("/:callId/answer", async (req, res) => {
  const call = calls.get(req.params.callId);
  if (!call || call.recipientIdentity !== req.body?.deviceId || call.status !== "ringing") return res.status(409).json({ error: "Translator Call is no longer available." });
  if (!isSupabaseConfigured()) return res.status(503).json({ error: "Calling is not configured." });
  call.status = "connecting";
  try {
    const roomName = `translator-${call.id}`;
    const bridgeAccess = await issueTranslatorToken(roomName, `translator:${call.id}`);
    const bridge = new TranslatorBridge(call, bridgeAccess.serverUrl, bridgeAccess.participantToken);
    await bridge.start();
    call.bridge = bridge;
    call.status = "active";
    const recipientAccess = await issueTranslatorToken(roomName, call.recipientIdentity);
    return res.json({ call: publicCall(call), serverUrl: recipientAccess.serverUrl, participantToken: recipientAccess.participantToken });
  } catch (error) {
    call.status = "failed"; call.endedAt = Date.now();
    await call.bridge?.stop().catch(() => undefined);
    console.error("[Translator] startup failed", { callId: call.id, reason: error instanceof Error ? error.message : "unknown" });
    return res.status(502).json({ error: "Translator could not start. Please try again." });
  }
});

router.post("/:callId/token", async (req, res) => {
  const call = calls.get(req.params.callId);
  const deviceId = req.body?.deviceId;
  if (!participant(call, deviceId) || call.status !== "active") return res.status(409).json({ error: "Translator Call is not active." });
  try {
    const access = await issueTranslatorToken(`translator-${call.id}`, deviceId);
    return res.json({ serverUrl: access.serverUrl, participantToken: access.participantToken });
  } catch (error) {
    console.error("[Translator] token failed", { callId: call.id, reason: error instanceof Error ? error.message : "unknown" });
    return res.status(502).json({ error: "Translator could not connect. Please try again." });
  }
});

router.post("/:callId/end", async (req, res) => {
  const call = calls.get(req.params.callId);
  if (!participant(call, req.body?.deviceId)) return res.status(404).json({ error: "Translator Call not found." });
  call.status = req.body?.status === "declined" ? "declined" : "ended";
  call.endedAt = Date.now();
  await call.bridge?.stop().catch(() => undefined);
  call.bridge = null;
  return res.status(204).end();
});

module.exports = { calls, issueTranslatorToken, participant, publicCall, router };
