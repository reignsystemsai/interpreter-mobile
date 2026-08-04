const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "mobile", "app", "index.tsx"), "utf8");
const authSource = fs.readFileSync(path.join(root, "mobile", "src", "features", "account", "AuthProvider.tsx"), "utf8");
const callingSource = fs.readFileSync(path.join(root, "mobile", "src", "features", "calling", "CallingOverlay.tsx"), "utf8");
const contactsSource = fs.readFileSync(path.join(root, "mobile", "src", "features", "contacts", "ContactsPermissionPanel.tsx"), "utf8");
const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");
const appConfig = JSON.parse(
  fs.readFileSync(path.join(root, "mobile", "app.json"), "utf8")
);

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

test("final MVP uses explicit mirrored directions without transcripts", () => {
  assert.match(appSource, /Speaker \(1\) language/);
  assert.match(appSource, /Speaker \(2\) language/);
  assert.match(appSource, /useRealtimeInterpreter\(languageOne, languageTwo\)/);
  assert.match(appSource, /Start Conversation/);
  assert.match(appSource, /End Conversation/);
  assert.match(serverSource, /mobile-pair/);
  assert.doesNotMatch(appSource, /showTranscript|conversationOpen|diagnosticMessage/);
  assert.equal(appConfig.expo.name, "interpreter");
  assert.equal(appConfig.expo.android.versionCode, 9);
});

test("Phase 1 calling overlay is UI-only and exposes exactly the approved destinations", () => {
  for (const label of ["Voice Call", "Video Call", "Business Video Call", "My Contacts"]) {
    assert.match(callingSource, new RegExp(label));
  }
  assert.match(appSource, /accessibilityLabel="Open calling"/);
  assert.match(appSource, /disabled=\{conversationRunning\}/);
  assert.match(appSource, /if \(recoveryMode\) setOverlay\('account'\)/);
  assert.doesNotMatch(callingSource, /LiveKit|createRoom|joinRoom|mediaDevices|authenticatedRequest/);
});

test("contacts flow requests permission without reading or syncing contacts", () => {
  assert.match(contactsSource, /Contacts\.requestPermissionsAsync\(\)/);
  assert.match(contactsSource, /Allow Contacts/);
  assert.match(contactsSource, /Not Now/);
  assert.match(contactsSource, /Stop Syncing/);
  assert.match(contactsSource, /Delete Imported Contacts/);
  assert.doesNotMatch(contactsSource, /getContactsAsync|authenticatedRequest|fetch\(/);
});

test("authentication supports confirmation and password recovery deep links", () => {
  assert.match(authSource, /emailRedirectTo: Linking\.createURL\('auth\/callback'\)/);
  assert.match(authSource, /resetPasswordForEmail/);
  assert.match(authSource, /exchangeCodeForSession/);
  assert.match(authSource, /PASSWORD_RECOVERY/);
  assert.match(authSource, /updateUser\(\{ password \}\)/);
});
