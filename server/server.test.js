const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');

const { buildRealtimeSession, createApp } = require('./server');

let baseUrl;
let server;

before(async () => {
  delete process.env.OPENAI_API_KEY;
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(() => {
  server.close();
});

test('health reports service state without exposing configuration', async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    service: 'interpreter-ai-server',
    openaiConfigured: false,
  });
});

test('session endpoint fails safely when the API key is absent', async () => {
  const response = await fetch(`${baseUrl}/api/realtime/session`, {
    method: 'POST',
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: 'OpenAI is not configured on the server.',
  });
});

test('session uses server VAD, interruption, audio output, and strict instructions', () => {
  const config = buildRealtimeSession().session;
  assert.equal(config.type, 'realtime');
  assert.deepEqual(config.output_modalities, ['audio']);
  assert.equal(config.audio.input.turn_detection.type, 'server_vad');
  assert.equal(config.audio.input.turn_detection.create_response, true);
  assert.equal(config.audio.input.turn_detection.interrupt_response, true);
  assert.match(config.instructions, /English/);
  assert.match(config.instructions, /Brazilian Portuguese/);
  assert.match(config.instructions, /Output only the translated speech/);
});
