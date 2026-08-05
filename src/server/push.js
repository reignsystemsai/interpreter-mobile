const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

function validExpoPushToken(token) {
  return typeof token === "string" && (token.startsWith("ExponentPushToken[") || token.startsWith("ExpoPushToken["));
}

async function sendIncomingVoiceCallPush(admin, { callId, callerPhoneNumber, installationId }) {
  const { data, error } = await admin
    .from("device_installations")
    .select("push_token")
    .eq("id", installationId)
    .eq("enabled", true)
    .maybeSingle();
  if (error) throw new Error("Unable to load the recipient device");
  if (!validExpoPushToken(data?.push_token)) return { accepted: false };
  const response = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      to: data.push_token,
      sound: "default",
      priority: "high",
      channelId: "incoming-calls",
      categoryId: "incoming-call",
      title: "Incoming Interpreter call",
      body: `${callerPhoneNumber} is calling.`,
      data: { type: "incoming_voice_call", callId, callerPhoneNumber, callType: "voice" }
    })
  });
  if (!response.ok) throw new Error(`Expo push returned ${response.status}`);
  const payload = await response.json().catch(() => ({}));
  return { accepted: payload?.data?.status === "ok" };
}

module.exports = { EXPO_PUSH_URL, sendIncomingVoiceCallPush, validExpoPushToken };
