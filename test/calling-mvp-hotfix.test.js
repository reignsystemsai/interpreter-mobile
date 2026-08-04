const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const deviceRoute = fs.readFileSync(path.join(root, 'src', 'server', 'routes', 'devices.js'), 'utf8');
const callRoute = fs.readFileSync(path.join(root, 'src', 'server', 'routes', 'calls.js'), 'utf8');
const { normalizeE164 } = require('../src/server/devices');

test('device-registration route accepts equivalent US formats and upserts the callable installation', () => {
  for (const input of ['+1 305-518-9384', '3055189384', '(305) 518-9384', '+13055189384']) {
    assert.equal(normalizeE164(input), '+13055189384');
  }
  assert.match(deviceRoute, /router\.post\("\/register"/);
  assert.match(deviceRoute, /onConflict: "phone_e164"/);
  assert.match(deviceRoute, /expo_push_token/);
});

test('recipient-lookup route resolves a registered installation without presence or cloud contacts', () => {
  assert.match(callRoute, /router\.post\("\/lookup-recipient"/);
  assert.match(callRoute, /from\("device_installations"\)[\s\S]*\.eq\("phone_e164", phoneE164\)/);
  assert.match(callRoute, /available: true, recipientId: data\.user_id, installationId: data\.installation_id/);
  const lookupSection = callRoute.slice(callRoute.indexOf('router.post("/lookup-recipient"'), callRoute.indexOf('router.post("/",'));
  assert.doesNotMatch(lookupSection, /presence|contacts|profile/);
});

test('call-creation route creates one room, targets the installation, and returns the caller credential', () => {
  const createSection = callRoute.slice(callRoute.indexOf('router.post("/",'), callRoute.indexOf('router.get("/incoming"'));
  assert.match(createSection, /await createCallRoom\(roomName\)/);
  assert.match(createSection, /sendIncomingCallPush[\s\S]*installationId/);
  assert.match(createSection, /createParticipantToken/);
  assert.match(createSection, /credential: \{ expiresIn: 600, livekitUrl: process\.env\.LIVEKIT_URL, token: callerToken \}/);
});
