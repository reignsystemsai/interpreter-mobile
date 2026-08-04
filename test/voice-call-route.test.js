const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("voice-call route is one isolated in-memory LiveKit endpoint", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "server", "routes", "voice-call.js"), "utf8");
  assert.match(source, /router\.post\("\/create"/);
  assert.match(source, /createVoiceRoom\(roomName\)/);
  assert.match(source, /callerToken/);
  assert.match(source, /recipientToken/);
  assert.match(source, /temporaryCallCode/);
  assert.doesNotMatch(source, /supabase|account|presence|push|translation|video/i);
});
