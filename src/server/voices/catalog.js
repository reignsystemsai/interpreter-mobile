const SPEAK_VOICE_IDS = Object.freeze([
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "sage",
  "shimmer",
  "verse",
  "marin",
  "cedar"
]);

const SPEAK_VOICE_ID_SET = new Set(SPEAK_VOICE_IDS);

function isSpeakVoiceId(value) {
  return typeof value === "string" && SPEAK_VOICE_ID_SET.has(value);
}

module.exports = { SPEAK_VOICE_IDS, isSpeakVoiceId };
