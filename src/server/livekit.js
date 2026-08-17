const { AccessToken, TrackSource } = require("livekit-server-sdk");

function isLiveKitConfigured() {
  return Boolean(getLiveKitUrl() && getLiveKitApiKey() && getLiveKitApiSecret());
}

function getLiveKitUrl() { return process.env.LIVEKIT_URL?.trim() || ""; }
function getLiveKitApiKey() { return process.env.LIVEKIT_API_KEY?.trim() || ""; }
function getLiveKitApiSecret() { return process.env.LIVEKIT_API_SECRET?.trim() || ""; }

async function createVoiceToken({ identity, roomName }) {
  if (!isLiveKitConfigured()) throw new Error("LiveKit is not configured");
  const token = new AccessToken(getLiveKitApiKey(), getLiveKitApiSecret(), {
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

module.exports = { createVoiceToken, getLiveKitUrl, isLiveKitConfigured };
