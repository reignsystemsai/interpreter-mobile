const SPEAK_VOICE_IDS = Object.freeze([
  "cedar",
  "ash",
  "echo",
  "ballad",
  "verse",
  "marin",
  "coral",
  "shimmer",
  "sage",
  "alloy"
]);

const SPEAK_VOICE_ID_SET = new Set(SPEAK_VOICE_IDS);

function isSpeakVoiceId(value) {
  return typeof value === "string" && SPEAK_VOICE_ID_SET.has(value);
}

module.exports = { SPEAK_VOICE_IDS, isSpeakVoiceId };
