const { AccessToken, RoomServiceClient, TrackSource } = require("livekit-server-sdk");

function isLiveKitConfigured() {
  return Boolean(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET);
}

function liveKitHttpUrl() {
  return process.env.LIVEKIT_URL.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
}

function roomService() {
  if (!isLiveKitConfigured()) throw new Error("LiveKit is not configured");
  return new RoomServiceClient(liveKitHttpUrl(), process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
}

async function createVoiceRoom(roomName) {
  await roomService().createRoom({ name: roomName, emptyTimeout: 60, departureTimeout: 10, maxParticipants: 2 });
}

async function deleteVoiceRoom(roomName) {
  if (typeof roomName !== "string" || !roomName.startsWith("speak-voice-")) return false;
  try {
    await roomService().deleteRoom(roomName);
    return true;
  } catch (error) {
    if (/not found/i.test(error instanceof Error ? error.message : "")) return false;
    throw error;
  }
}

async function createVoiceToken({ identity, roomName }) {
  if (!isLiveKitConfigured()) throw new Error("LiveKit is not configured");
  const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
    identity,
    name: identity,
    ttl: "10m"
  });
  token.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canPublishData: false,
    canPublishSources: [TrackSource.MICROPHONE],
    canSubscribe: true
  });
  return token.toJwt();
}

module.exports = { createVoiceRoom, createVoiceToken, deleteVoiceRoom, isLiveKitConfigured, liveKitHttpUrl };
