const OUTPUT_LANGUAGE_CODES = Object.freeze({
  English: "en",
  Spanish: "es",
  "Brazilian Portuguese": "pt",
  Portuguese: "pt",
  French: "fr",
  German: "de",
  Italian: "it",
  Russian: "ru",
  "Mandarin Chinese": "zh",
  Chinese: "zh",
  Japanese: "ja",
  Korean: "ko",
  Hindi: "hi",
  Indonesian: "id",
  Vietnamese: "vi"
});

function outputLanguageCode(value) {
  if (typeof value !== "string") return null;
  return OUTPUT_LANGUAGE_CODES[value.trim()] ?? null;
}

module.exports = { OUTPUT_LANGUAGE_CODES, outputLanguageCode };
