const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const { SPEAK_VOICE_IDS, isSpeakVoiceId } = require("../src/server/voices/catalog");
const {
  DEFAULT_PREVIEW_MODEL,
  PREVIEW_SAMPLE_KEY,
  PREVIEW_SAMPLE_TEXT,
  PREVIEW_RESPONSE_FORMAT,
  clearVoicePreviewCache,
  generatePreview,
  getVoicePreview,
  issueVoicePreviewToken,
  resolveVoicePreviewToken
} = require("../src/server/voices/preview");
const callsRouter = require("../src/server/routes/calls");

const expectedVoiceIds = ["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar"];

test("supported voice catalog contains the ten approved IDs exactly once", () => {
  assert.deepEqual([...SPEAK_VOICE_IDS].sort(), [...expectedVoiceIds].sort());
  assert.equal(new Set(SPEAK_VOICE_IDS).size, 10);
  for (const voiceId of expectedVoiceIds) assert.equal(isSpeakVoiceId(voiceId), true);
  assert.equal(isSpeakVoiceId("unsupported"), false);
});

test("mobile catalog keeps product categories, Voice N labels, defaults, and technical IDs out of the screen", () => {
  const catalog = read("mobile", "src", "features", "calling", "voiceCatalog.ts");
  const screen = read("mobile", "src", "features", "calling", "CallLanguageSelection.tsx");
  for (const voiceId of expectedVoiceIds) assert.equal((catalog.match(new RegExp(`id: '${voiceId}'`, "g")) || []).length, 1);
  assert.match(catalog, /cedar'[\s\S]*label: 'Voice 1'[\s\S]*presentationCategory: 'male'/);
  assert.match(catalog, /marin'[\s\S]*label: 'Voice 1'[\s\S]*presentationCategory: 'female'/);
  assert.match(catalog, /adjacentVoiceId[\s\S]*% options\.length/);
  assert.doesNotMatch(screen, />alloy<|>ash<|>ballad<|>coral<|>echo<|>sage<|>shimmer<|>verse<|>marin<|>cedar</);
});

test("call voice payload accepts every approved ID and preserves independent sides", () => {
  for (const callerHearsVoiceId of expectedVoiceIds) {
    const recipientHearsVoiceId = expectedVoiceIds[(expectedVoiceIds.indexOf(callerHearsVoiceId) + 1) % expectedVoiceIds.length];
    assert.deepEqual(callsRouter.callVoiceIdsFromRequest({ callerHearsVoiceId, recipientHearsVoiceId }), {
      callerHearsVoiceId,
      recipientHearsVoiceId
    });
  }
  assert.deepEqual(callsRouter.callVoiceIdsFromRequest({ callerHearsVoiceId: "bad", recipientHearsVoiceId: "bad" }), {
    callerHearsVoiceId: "cedar",
    recipientHearsVoiceId: "marin"
  });
});

test("preview rejects unsupported inputs without contacting OpenAI", async () => {
  let requests = 0;
  const fetchImpl = async () => { requests += 1; throw new Error("should not run"); };
  assert.deepEqual(await getVoicePreview("bad", PREVIEW_SAMPLE_KEY, fetchImpl), { error: "unsupported_voice", status: 400 });
  assert.deepEqual(await getVoicePreview("cedar", "bad", fetchImpl), { error: "unsupported_sample", status: 400 });
  assert.equal(requests, 0);
});

test("preview uses the supported speech contract and preserves the selected call voice", async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_PREVIEW_TTS_MODEL;
  process.env.OPENAI_API_KEY = "test-only";
  delete process.env.OPENAI_PREVIEW_TTS_MODEL;
  let request;
  try {
    const audio = await generatePreview("cedar", async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return { ok: true, arrayBuffer: async () => Uint8Array.from([4, 5, 6]).buffer };
    });
    assert.deepEqual([...audio], [4, 5, 6]);
    assert.equal(request.url, "https://api.openai.com/v1/audio/speech");
    assert.deepEqual(request.body, {
      model: DEFAULT_PREVIEW_MODEL,
      voice: "cedar",
      input: PREVIEW_SAMPLE_TEXT,
      response_format: PREVIEW_RESPONSE_FORMAT
    });
    assert.equal(request.options.headers.Authorization, "Bearer test-only");
  } finally {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.OPENAI_PREVIEW_TTS_MODEL;
    else process.env.OPENAI_PREVIEW_TTS_MODEL = originalModel;
  }
});

test("preview preserves only sanitized OpenAI error details", async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-only";
  try {
    await assert.rejects(
      generatePreview("cedar", async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: { type: "invalid_request_error", code: "invalid_value", message: "Unsupported model and voice combination." } })
      })),
      (error) => {
        assert.deepEqual(error.openAI, {
          status: 400,
          type: "invalid_request_error",
          code: "invalid_value",
          message: "Unsupported model and voice combination.",
          model: DEFAULT_PREVIEW_MODEL,
          voice: "cedar",
          responseFormat: PREVIEW_RESPONSE_FORMAT
        });
        assert.doesNotMatch(error.message, /test-only|Bearer|Authorization/);
        return true;
      }
    );
  } finally {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  }
});

test("preview generation is deduplicated, cached, and clearable", async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-only";
  clearVoicePreviewCache();
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
    await new Promise((resolve) => setImmediate(resolve));
    return { ok: true, arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer };
  };
  try {
    const [first, second] = await Promise.all([
      getVoicePreview("cedar", PREVIEW_SAMPLE_KEY, fetchImpl),
      getVoicePreview("cedar", PREVIEW_SAMPLE_KEY, fetchImpl)
    ]);
    assert.equal(requests, 1);
    assert.deepEqual(first.audio, second.audio);
    const cached = await getVoicePreview("cedar", PREVIEW_SAMPLE_KEY, fetchImpl);
    assert.equal(cached.cache, "HIT");
    assert.equal(requests, 1);
    clearVoicePreviewCache();
    await getVoicePreview("cedar", PREVIEW_SAMPLE_KEY, fetchImpl);
    assert.equal(requests, 2);
  } finally {
    clearVoicePreviewCache();
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  }
});

test("preview playback token is short-lived and resolves only its approved sample", () => {
  clearVoicePreviewCache();
  const token = issueVoicePreviewToken("marin", PREVIEW_SAMPLE_KEY, 1_000);
  assert.deepEqual(resolveVoicePreviewToken(token, 1_001), { voiceId: "marin", sampleKey: PREVIEW_SAMPLE_KEY });
  assert.equal(resolveVoicePreviewToken(token, 1_000 + (5 * 60 * 1000)), null);
  assert.equal(resolveVoicePreviewToken("unknown", 1_001), null);
  clearVoicePreviewCache();
});

test("screen text and controls reflect the approved UI corrections", () => {
  const screen = read("mobile", "src", "features", "calling", "CallLanguageSelection.tsx");
  const player = read("mobile", "src", "features", "calling", "useVoicePreviewPlayer.ts");
  assert.match(screen, /Speak Voice Call/);
  assert.match(screen, /Start Voice Call/);
  assert.match(screen, /SPEAK CALLING/);
  assert.doesNotMatch(screen, /You hear <Text[\s\S]*hears <Text/);
  assert.match(screen, /onPress=\{\(\) => onCategoryChange\(category\)\}/);
  assert.match(screen, /onVoiceStep\(-1\)/);
  assert.match(screen, /onVoiceStep\(1\)/);
  assert.match(screen, /onPreview/);
  assert.match(player, /Preview unavailable\. Try again\./);
});

test("shared preview player enforces one active sample and cleanup boundaries", () => {
  const player = read("mobile", "src", "features", "calling", "useVoicePreviewPlayer.ts");
  const screen = read("mobile", "src", "features", "calling", "CallLanguageSelection.tsx");
  assert.equal((player.match(/useAudioPlayer\(/g) || []).length, 1);
  assert.match(player, /generation\.current \+= 1/);
  assert.match(player, /player\.pause\(\)/);
  assert.match(player, /player\.replace\(null\)/);
  assert.match(player, /AppState\.addEventListener\('change'/);
  assert.match(player, /return \(\) => subscription\.remove\(\)/);
  assert.match(player, /previewUrl\.startsWith\('http'\)/);
  assert.match(screen, /const start = \(\) => \{\s*stopPreview\(\)/);
  assert.match(screen, /const chooseVoiceCategory[\s\S]*stopPreview\(\)/);
  assert.match(screen, /const stepVoice[\s\S]*stopPreview\(\)/);
});
