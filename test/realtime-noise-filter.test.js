const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
  path.resolve(__dirname, '../mobile/src/hooks/useRealtimeInterpreter.ts'),
  'utf8',
);

test('Realtime input filters ambient noise before server VAD creates a turn', () => {
  assert.match(source, /noise_reduction: \{ type: 'near_field' \}/);
  assert.match(source, /threshold: 0\.65/);
  assert.match(source, /silence_duration_ms: 700/);
  assert.match(source, /dataChannel\.send\(SPEECH_DETECTION_UPDATE\)/);
});
