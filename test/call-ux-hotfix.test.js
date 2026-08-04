const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const contacts = fs.readFileSync(path.join(root, "mobile", "src", "features", "contacts", "ContactsPermissionPanel.tsx"), "utf8");
const overlay = fs.readFileSync(path.join(root, "mobile", "src", "features", "calling", "CallingOverlay.tsx"), "utf8");
const callService = fs.readFileSync(path.join(root, "mobile", "src", "features", "calling", "CallService.ts"), "utf8");
const callRoute = fs.readFileSync(path.join(root, "src", "server", "routes", "voice-call.js"), "utf8");
const livekit = fs.readFileSync(path.join(root, "src", "server", "livekit.js"), "utf8");

test("Voice Call requests contacts only after entering the calling flow", () => {
  assert.match(overlay, /setAutoRequestContacts\(type === 'voice'\)/);
  assert.match(contacts, /autoRequest[\s\S]*permission !== 'undetermined'/);
  assert.match(contacts, /requestAndImport\(\)/);
  assert.match(contacts, /Open Settings/);
});

test("End Call releases microphone, tracks, audio session, backend room, and local state", () => {
  assert.match(callService, /setMicrophoneEnabled\(false\)/);
  assert.match(callService, /unpublishTrack\(publication\.track\)/);
  assert.match(callService, /publication\.track\?\.detach\(\)/);
  assert.match(callService, /publication\.setSubscribed\(false\)/);
  assert.match(callService, /AudioSession\.stopAudioSession\(\)/);
  assert.match(callService, /api\/v1\/voice-call\/end/);
  assert.match(callService, /this\.activeCall = null/);
  assert.match(callService, /status: 'idle'/);
});

test("stale-call reset preserves only a real connecting or connected LiveKit room", () => {
  assert.match(callService, /ConnectionState\.Connecting/);
  assert.match(callService, /ConnectionState\.Connected/);
  assert.match(callService, /ConnectionState\.Reconnecting/);
  assert.match(callService, /async resetStaleCallState\(\)/);
  assert.match(overlay, /CallService\.resetStaleCallState\(\)/);
  assert.match(overlay, /state\.status !== 'connecting'[\s\S]*onClose\(\)/);
});

test("backend call end deletes the matching room and in-memory call entry", () => {
  assert.match(callRoute, /router\.post\("\/end"/);
  assert.match(callRoute, /temporaryCalls\.delete\(temporaryCallCode\)/);
  assert.match(callRoute, /await deleteVoiceRoom\(roomName\)/);
  assert.match(livekit, /roomService\(\)\.deleteRoom\(roomName\)/);
});
