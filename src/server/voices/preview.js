const { isSpeakVoiceId } = require("./catalog");
const crypto = require("node:crypto");

const PREVIEW_SAMPLE_KEY = "speak-default-introduction";
const PREVIEW_SAMPLE_TEXT = "Hello. Speak will translate your conversation using this voice.";
const PREVIEW_CONTENT_TYPE = "audio/mpeg";
const PREVIEW_RESPONSE_FORMAT = "mp3";
const DEFAULT_PREVIEW_MODEL = "gpt-4o-mini-tts";
const previewCache = new Map();
const pendingPreviews = new Map();
const previewTokens = new Map();
const PREVIEW_TOKEN_TTL_MS = 5 * 60 * 1000;
const MAX_PREVIEW_TOKENS = 100;

async function generatePreview(voiceId, fetchImpl = fetch) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OpenAI preview service is unavailable");
  const model = process.env.OPENAI_PREVIEW_TTS_MODEL || DEFAULT_PREVIEW_MODEL;
  const response = await fetchImpl("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      voice: voiceId,
      input: PREVIEW_SAMPLE_TEXT,
      response_format: PREVIEW_RESPONSE_FORMAT
    })
  });
  if (!response.ok) {
    let payload = {};
    try { payload = await response.json(); } catch {}
    const details = payload?.error ?? {};
    const message = typeof details.message === "string" ? details.message : "Speech generation request was rejected.";
    const error = new Error(`OpenAI preview generation failed (${response.status}): ${message}`);
    error.openAI = {
      status: response.status,
      type: typeof details.type === "string" ? details.type : null,
      code: typeof details.code === "string" ? details.code : null,
      message,
      model,
      voice: voiceId,
      responseFormat: PREVIEW_RESPONSE_FORMAT
    };
    throw error;
  }
  return Buffer.from(await response.arrayBuffer());
}

async function getVoicePreview(voiceId, sampleKey, fetchImpl = fetch) {
  if (!isSpeakVoiceId(voiceId)) return { error: "unsupported_voice", status: 400 };
  if (sampleKey !== PREVIEW_SAMPLE_KEY) return { error: "unsupported_sample", status: 400 };
  const cacheKey = `${voiceId}:${sampleKey}`;
  const cached = previewCache.get(cacheKey);
  if (cached) return { audio: cached, cache: "HIT" };
  let pending = pendingPreviews.get(cacheKey);
  if (!pending) {
    pending = generatePreview(voiceId, fetchImpl)
      .then((audio) => {
        previewCache.set(cacheKey, audio);
        return audio;
      })
      .finally(() => pendingPreviews.delete(cacheKey));
    pendingPreviews.set(cacheKey, pending);
  }
  return { audio: await pending, cache: "MISS" };
}

function clearVoicePreviewCache() {
  previewCache.clear();
  pendingPreviews.clear();
  previewTokens.clear();
}

function issueVoicePreviewToken(voiceId, sampleKey, now = Date.now()) {
  for (const [token, entry] of previewTokens) {
    if (entry.expiresAt <= now) previewTokens.delete(token);
  }
  while (previewTokens.size >= MAX_PREVIEW_TOKENS) previewTokens.delete(previewTokens.keys().next().value);
  const token = crypto.randomUUID();
  previewTokens.set(token, { voiceId, sampleKey, expiresAt: now + PREVIEW_TOKEN_TTL_MS });
  return token;
}

function resolveVoicePreviewToken(token, now = Date.now()) {
  const entry = typeof token === "string" ? previewTokens.get(token) : null;
  if (!entry || entry.expiresAt <= now) {
    if (entry) previewTokens.delete(token);
    return null;
  }
  return { voiceId: entry.voiceId, sampleKey: entry.sampleKey };
}

module.exports = {
  PREVIEW_CONTENT_TYPE,
  DEFAULT_PREVIEW_MODEL,
  PREVIEW_RESPONSE_FORMAT,
  PREVIEW_SAMPLE_KEY,
  PREVIEW_SAMPLE_TEXT,
  clearVoicePreviewCache,
  generatePreview,
  getVoicePreview,
  issueVoicePreviewToken,
  resolveVoicePreviewToken
};
