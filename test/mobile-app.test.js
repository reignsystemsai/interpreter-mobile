const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "mobile", "app", "index.tsx"), "utf8");
const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");

const supportedLanguages = [
  "English",
  "Spanish",
  "Brazilian Portuguese",
  "French",
  "German",
  "Italian",
  "Dutch",
  "Russian",
  "Polish",
  "Romanian",
  "Turkish",
  "Arabic",
  "Hebrew",
  "Hindi",
  "Japanese",
  "Korean",
  "Mandarin Chinese",
  "Cantonese",
  "Vietnamese",
  "Thai"
];

test("mobile and backend expose the same 20 target languages", () => {
  assert.equal(supportedLanguages.length, 20);
  for (const language of supportedLanguages) {
    assert.match(appSource, new RegExp(`['\"]${language}['\"]`));
    assert.match(serverSource, new RegExp(`(?:['\"]${language}['\"]|${language}:)`));
  }
});

test("final MVP remains one-screen and hides transcripts by default", () => {
  assert.match(appSource, /Language to interpret to/);
  assert.match(appSource, /Start Conversation/);
  assert.match(appSource, /End Conversation/);
  assert.match(appSource, /const \[showTranscript, setShowTranscript\] = useState\(false\)/);
  assert.doesNotMatch(appSource, /conversationOpen|Companion|diagnosticMessage/);
});
