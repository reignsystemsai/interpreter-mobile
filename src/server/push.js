const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

function validExpoPushToken(token) {
  return typeof token === "string" && (token.startsWith("ExponentPushToken[") || token.startsWith("ExpoPushToken["));
}

async function sendIncomingCallPush(admin, { callId, callType, callerName, calleeId, installationId }) {
  const query = installationId
    ? admin.from("device_installations").select("expo_push_token").eq("installation_id", installationId).eq("user_id", calleeId)
    : admin.from("push_devices").select("token").eq("user_id", calleeId);
  const { data, error } = await query;
  if (error) throw new Error("Unable to load push devices");
  const tokens = (data || []).map((item) => item.expo_push_token || item.token).filter(validExpoPushToken);
  if (!tokens.length) return { attempted: 0, accepted: 0 };
  const messages = tokens.map((to) => ({
    to,
    sound: "default",
    priority: "high",
    channelId: "incoming-calls",
    categoryId: "incoming-call",
    title: `${callerName} is calling`,
    body: callType === "voice" ? "Incoming voice call" : callType === "business_video" ? "Incoming business video call" : "Incoming video call",
    data: { type: "incoming_call", callId, callType }
  }));
  const response = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(messages)
  });
  if (!response.ok) throw new Error(`Expo push returned ${response.status}`);
  const payload = await response.json().catch(() => ({}));
  const tickets = Array.isArray(payload?.data) ? payload.data : [];
  return { attempted: messages.length, accepted: tickets.filter((ticket) => ticket.status === "ok").length };
}

module.exports = { EXPO_PUSH_URL, sendIncomingCallPush, validExpoPushToken };
