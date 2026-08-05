const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const service = read("mobile", "src", "features", "calling", "VoiceCallService.ts");
const host = read("mobile", "src", "features", "calling", "VoiceCallHost.tsx");
const surface = read("mobile", "src", "features", "calling", "VoiceCallSurface.tsx");
const contacts = read("mobile", "src", "features", "contacts", "ContactsPermissionPanel.tsx");
const deviceRoutes = read("src", "server", "routes", "devices.js");
const callRoutes = read("src", "server", "routes", "calls.js");
const server = read("server.js");
const migration = read("supabase", "migrations", "202608050001_clean_voice_call_rebuild.sql");
const { normalizeE164 } = require("../src/server/devices");

test("one clean calling architecture replaces temporary and account-based calling", () => {
  for (const removed of [
    ["mobile", "src", "features", "calling", "CallService.ts"],
    ["mobile", "src", "features", "calling", "CallProvider.tsx"],
    ["mobile", "src", "features", "calling", "VoiceCallTestPanel.tsx"],
    ["src", "server", "routes", "voice-call.js"],
    ["src", "server", "calls.js"],
  ]) assert.equal(fs.existsSync(path.join(root, ...removed)), false);
  assert.match(service, /class CleanVoiceCallService/);
  assert.match(server, /app\.use\("\/api\/v1\/calls", callRoutes\)/);
  assert.match(server, /app\.use\("\/api\/v1\/livekit", liveKitTokenRoutes\)/);
  assert.doesNotMatch(server, /\/api\/v1\/voice-call|clearStaleVoiceRooms/);
});

test("registration, lookup, and the clean two-table migration enforce persistence", () => {
  assert.match(deviceRoutes, /onConflict: "device_id"/);
  assert.match(deviceRoutes, /select\("id,device_id,phone_number_e164,platform,enabled"\)/);
  assert.match(deviceRoutes, /registration_verification_failed/);
  assert.match(deviceRoutes, /found: true, installationId: data\.id, deviceId: data\.device_id, platform: data\.platform/);
  assert.match(migration, /create table public\.device_installations/);
  assert.match(migration, /constraint device_installations_device_id_key unique \(device_id\)/);
  assert.match(migration, /create table public\.active_calls/);
  assert.match(migration, /enable row level security/g);
  assert.doesNotMatch(migration, /auth\.users|push_token.*active_calls|token.*active_calls/);
});

test("Colombian and United States numbers normalize deterministically", () => {
  for (const value of ["+57 304 369 8334", "+573043698334", "57 304 369 8334", "304 369 8334", "3043698334"]) {
    assert.equal(normalizeE164(value, "CO"), "+573043698334");
  }
  assert.equal(normalizeE164("305 518 9384", "US"), "+13055189384");
  assert.match(contacts, /countryCode/);
  assert.match(contacts, /numberChoices/);
});

test("contact routing, incoming calls, and cleanup use the new service only", () => {
  assert.match(contacts, /lookupDeviceByPhone/);
  assert.match(contacts, /VoiceCallService\.startVoiceCall/);
  assert.match(callRoutes, /router\.post\("\/start"/);
  assert.match(callRoutes, /router\.post\("\/:callId\/accept"/);
  assert.match(callRoutes, /router\.post\("\/:callId\/decline"/);
  assert.match(callRoutes, /router\.post\("\/:callId\/end"/);
  assert.match(callRoutes, /router\.get\("\/:callId"/);
  assert.match(host, /addNotificationReceivedListener/);
  assert.match(host, /addNotificationResponseReceivedListener/);
  assert.match(surface, /Answer/);
  assert.match(surface, /Decline/);
  assert.match(surface, /End Call/);
  assert.match(service, /async resetVoiceCall/);
  assert.match(host, /if \(presented\) handledIncomingCallIds\.add\(callId\)/);
  assert.match(host, /offerCallNotificationsAfterFirstCall/);
  assert.match(host, /Never miss a call/);
  assert.match(service, /startCallStatusPolling/);
  assert.ok(service.indexOf("this.setState(INITIAL_STATE)") < service.indexOf("await Promise.all([this.releaseRoom(room), backendCleanup()])"));
  for (const cleanup of ["setMicrophoneEnabled(false)", "unpublishTrack", "track?.detach()", "stopAudioSession", "removeAllListeners", "setState(INITIAL_STATE)"]) {
    assert.ok(service.includes(cleanup), `missing cleanup: ${cleanup}`);
  }
});

test("normal Interpreter translation remains independent of voice calling", () => {
  const home = read("mobile", "app", "index.tsx");
  const realtime = read("mobile", "src", "hooks", "useRealtimeInterpreter.ts");
  assert.match(home, /useRealtimeInterpreter\(languageOne, languageTwo\)/);
  assert.match(home, /Start Conversation/);
  assert.match(realtime, /export function useRealtimeInterpreter/);
  assert.doesNotMatch(service, /useRealtimeInterpreter|OpenAI|translation/);
});
