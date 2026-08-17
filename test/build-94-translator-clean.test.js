const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Build 94 keeps Translator Calls outside frozen Classic Call', () => {
  const classic = read('mobile/src/features/calling/CallService.ts');
  const translator = read('mobile/src/features/calling/TranslatorCallService.ts');
  assert.doesNotMatch(classic, /translator-calls|TranslatorCallService/);
  assert.match(translator, /\/api\/translator-calls/);
  assert.doesNotMatch(translator, /create_direct_app_call|app_calls/);
});

test('Build 94 permanently maps male and female to one OpenAI voice each', () => {
  const bridge = read('src/server/translator/TranslatorBridge.js');
  assert.match(bridge, /male: "cedar", female: "marin"/);
  assert.match(bridge, /output: \{ voice: this\.voice \}/);
});

test('Build 94 normalizes the proven LiveKit signer values', () => {
  const livekit = read('src/server/livekit.js');
  const calls = read('src/server/translator/TranslatorCalls.js');
  assert.match(livekit, /LIVEKIT_API_KEY\?\.trim\(\)/);
  assert.match(livekit, /LIVEKIT_API_SECRET\?\.trim\(\)/);
  assert.match(livekit, /LIVEKIT_URL\?\.trim\(\)/);
  assert.match(calls, /getLiveKitUrl\(\)/);
});

test('Build 94 presents both call choices', () => {
  const ui = read('mobile/src/features/contacts/ContactsPermissionPanel.tsx');
  assert.match(ui, />Classic Call</);
  assert.match(ui, />Translator Call</);
  assert.match(ui, /CallService\.createCall/);
  assert.match(ui, /TranslatorCallService\.createCall/);
});

test('Build 94 starts the translator before activating the call', () => {
  const calls = read('src/server/translator/TranslatorCalls.js');
  assert.ok(calls.indexOf('await bridge.start()') < calls.indexOf('call.status = "active"'));
});
