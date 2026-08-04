const { AccessToken, RoomServiceClient, TrackSource } = require("livekit-server-sdk");

function isLiveKitConfigured() {
  return Boolean(
    process.env.LIVEKIT_URL &&
      process.env.LIVEKIT_API_KEY &&
      process.env.LIVEKIT_API_SECRET
  );
}

function liveKitHttpUrl() {
  return process.env.LIVEKIT_URL.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
}

function getRoomService() {
  if (!isLiveKitConfigured()) return null;
  return new RoomServiceClient(liveKitHttpUrl(), process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
}

async function createCallRoom(roomName) {
  const service = getRoomService();
  if (!service) throw new Error("LiveKit is not configured");
  // Two people plus one hidden, server-controlled translation bridge.
  await service.createRoom({ name: roomName, emptyTimeout: 60, departureTimeout: 30, maxParticipants: 3 });
}

async function deleteCallRoom(roomName) {
  const service = getRoomService();
  if (!service) return;
  await service.deleteRoom(roomName).catch(() => undefined);
}

async function createParticipantToken({ callType, identity, name, roomName }) {
  if (!isLiveKitConfigured()) throw new Error("LiveKit is not configured");
  const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
    identity,
    name,
    ttl: 600
  });
  token.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canPublishData: true,
    canPublishSources: callType === "voice" ? [TrackSource.MICROPHONE] : [TrackSource.MICROPHONE, TrackSource.CAMERA],
    canSubscribe: true
  });
  return token.toJwt();
}

async function createBridgeToken({ callId, roomName }) {
  if (!isLiveKitConfigured()) throw new Error("LiveKit is not configured");
  const identity = `interpreter-bridge-${callId}`;
  const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
    identity,
    name: "Interpreter.ai",
    ttl: 3600
  });
  token.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canPublishData: true,
    canPublishSources: [TrackSource.MICROPHONE],
    canSubscribe: true,
    hidden: true
  });
  return { identity, token: await token.toJwt() };
}

module.exports = { createBridgeToken, createCallRoom, createParticipantToken, deleteCallRoom, getRoomService, isLiveKitConfigured, liveKitHttpUrl };
