const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Build 91 keeps Translator Calls outside the classic database call path', () => {
  const classic = read('mobile/src/features/calling/CallService.ts');
  const translator = read('mobile/src/features/calling/TranslatorCallService.ts');
  assert.doesNotMatch(classic, /translator-calls|TranslatorCallService/);
  assert.match(translator, /\/api\/translator-calls/);
  assert.doesNotMatch(translator, /create_direct_app_call|app_calls/);
});

test('Build 91 permanently maps male and female to one OpenAI voice each', () => {
  const bridge = read('src/server/translator/TranslatorBridge.js');
  assert.match(bridge, /male: "cedar", female: "marin"/);
  assert.match(bridge, /output: \{ voice: this\.voice \}/);
  assert.doesNotMatch(bridge, /voice.*update/i);
});

test('Build 91 presents Classic Call and Translator Call choices', () => {
  const ui = read('mobile/src/features/contacts/ContactsPermissionPanel.tsx');
  assert.match(ui, />Classic Call</);
  assert.match(ui, />Translator Call</);
  assert.match(ui, /CallService\.createCall/);
  assert.match(ui, /TranslatorCallService\.createCall/);
});

test('Build 91 requires the translator to start before the call becomes active', () => {
  const calls = read('src/server/translator/TranslatorCalls.js');
  assert.ok(calls.indexOf('await bridge.start()') < calls.indexOf('call.status = "active"'));
});
