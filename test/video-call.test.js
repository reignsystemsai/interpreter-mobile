const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

test("video calls reuse the existing LiveKit call lifecycle", () => {
  const service = read("mobile", "src", "features", "calling", "VoiceCallService.ts");
  const surface = read("mobile", "src", "features", "calling", "VoiceCallSurface.tsx");
  const contacts = read("mobile", "src", "features", "contacts", "ContactsPermissionPanel.tsx");
  const routes = read("src", "server", "routes", "calls.js");
  const migration = read("supabase", "migrations", "202608050002_video_calls.sql");

  assert.match(service, /startVideoCall/);
  assert.match(service, /setCameraEnabled\(true, FRONT_CAMERA_CAPTURE\)/);
  assert.match(service, /remoteVideoTrack/);
  assert.match(surface, /VideoView/);
  assert.match(surface, /Camera Off/);
  assert.match(contacts, /beginCall\('video'\)/);
  assert.match(routes, /callType === "video"/);
  assert.match(routes, /call_type: callType/);
  assert.match(routes, /createVoiceToken\([^\n]+callType/);
  assert.match(migration, /check \(call_type in \('voice', 'video'\)\)/);
});
