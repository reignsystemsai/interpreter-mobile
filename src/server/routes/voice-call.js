const crypto = require("crypto");
const express = require("express");
const { createVoiceRoom, createVoiceToken, isLiveKitConfigured } = require("../livekit");
const { sendTemporaryVoiceCallPush } = require("../push");
const { getSupabaseAdmin } = require("../supabase");

const router = express.Router();
const temporaryCalls = new Map();

function callCode() {
  return crypto.randomBytes(5).toString("hex").toUpperCase();
}

function removeExpiredCalls() {
  const now = Date.now();
  for (const [code, call] of temporaryCalls) {
    if (call.expiresAt <= now) temporaryCalls.delete(code);
  }
}

router.post("/create", async (req, res) => {
  console.info("[LiveKitCall] backend request received");
  if (!isLiveKitConfigured()) return res.status(503).json({ error: "Calling is temporarily unavailable." });
  removeExpiredCalls();
  const requestedCode = typeof req.body?.temporaryCallCode === "string" ? req.body.temporaryCallCode.trim().toUpperCase() : "";
  if (requestedCode) {
    const existing = temporaryCalls.get(requestedCode);
    if (!existing || existing.recipientClaimed) return res.status(404).json({ error: "Call code is invalid or expired." });
    existing.recipientClaimed = true;
    return res.json(existing.response);
  }

  const roomName = `voice-${crypto.randomUUID()}`;
  const recipientInstallationId = typeof req.body?.recipientInstallationId === "string"
    ? req.body.recipientInstallationId.trim()
    : "";
  const callerIdentity = `caller-${crypto.randomUUID()}`;
  const recipientIdentity = `recipient-${crypto.randomUUID()}`;
  try {
    await createVoiceRoom(roomName);
    console.info("[LiveKitCall] room created");
    const callerToken = await createVoiceToken({ identity: callerIdentity, roomName });
    console.info("[LiveKitCall] caller token generated");
    const recipientToken = await createVoiceToken({ identity: recipientIdentity, roomName });
    console.info("[LiveKitCall] recipient token generated");
    let temporaryCallCode = callCode();
    while (temporaryCalls.has(temporaryCallCode)) temporaryCallCode = callCode();
    const response = {
      roomName,
      livekitUrl: process.env.LIVEKIT_URL,
      callerToken,
      recipientToken,
      temporaryCallCode
    };
    temporaryCalls.set(temporaryCallCode, { expiresAt: Date.now() + 10 * 60 * 1000, recipientClaimed: false, response });
    if (recipientInstallationId) {
      try {
        const delivery = await sendTemporaryVoiceCallPush(getSupabaseAdmin(), { installationId: recipientInstallationId, temporaryCallCode });
        console.info("[LiveKitCall] push delivery", { accepted: delivery.accepted });
      } catch {
        console.warn("[LiveKitCall] push delivery failed");
      }
    }
    return res.status(201).json(response);
  } catch {
    return res.status(502).json({ error: "Unable to create the voice call." });
  }
});

module.exports = router;
