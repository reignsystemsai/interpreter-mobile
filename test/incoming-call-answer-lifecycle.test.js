const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('canonical incoming calls remain available for Accept or Decline', () => {
  const service = read('mobile/src/features/calling/VoiceCallService.ts');
  const surface = read('mobile/src/features/calling/VoiceCallSurface.tsx');

  assert.match(service, /canonicalCallIds\.has\(callId\)/);
  assert.match(service, /async acceptIncomingCall\(\)/);
  assert.match(service, /async declineIncomingCall\(\)/);
  assert.match(surface, />Accept<\/Text>/);
  assert.match(surface, />Decline<\/Text>/);
});

test('canonical termination closes media and resets both call state machines', () => {
  const host = read('mobile/src/features/calling/VoiceCallHost.tsx');
  const shell = read('mobile/src/shells/calling/CallingShellImpl.ts');

  assert.match(host, /pollCanonicalCallLiveness/);
  assert.match(host, /CallingShellHost\.endCall\(callId\)/);
  assert.match(host, /VoiceCallService\.disconnectMedia\(\)/);
  assert.match(shell, /INVALID_CALL_STATE/);
  assert.match(shell, /this\.commit\(operationId, null\)/);
});
