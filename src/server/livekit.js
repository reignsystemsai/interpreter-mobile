const { AccessToken, TrackSource } = require("livekit-server-sdk");

function isLiveKitConfigured() {
  return Boolean(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET);
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

module.exports = { createVoiceToken, isLiveKitConfigured };
