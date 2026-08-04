const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "mobile", "app", "index.tsx"), "utf8");
const authSource = fs.readFileSync(path.join(root, "mobile", "src", "features", "account", "AuthProvider.tsx"), "utf8");
const callingSource = fs.readFileSync(path.join(root, "mobile", "src", "features", "calling", "CallingOverlay.tsx"), "utf8");
const contactsSource = fs.readFileSync(path.join(root, "mobile", "src", "features", "contacts", "ContactsPermissionPanel.tsx"), "utf8");
const contactsProviderSource = fs.readFileSync(path.join(root, "mobile", "src", "features", "contacts", "ContactsProvider.tsx"), "utf8");
const contactsRouteSource = fs.readFileSync(path.join(root, "src", "server", "routes", "contacts.js"), "utf8");
const contactsMigrationSource = fs.readFileSync(path.join(root, "supabase", "migrations", "202608030002_contacts_system.sql"), "utf8");
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

test("Phase 2 imports and synchronizes contacts only after permission", () => {
  assert.match(contactsProviderSource, /Contacts\.requestPermissionsAsync\(\)/);
  assert.match(contactsSource, /Allow Contacts & Import/);
  assert.match(contactsSource, /Not Now/);
  assert.match(contactsSource, /Stop Syncing/);
  assert.match(contactsSource, /Delete Imported Contacts/);
  assert.match(contactsProviderSource, /Contacts\.getContactsAsync/);
  assert.match(contactsProviderSource, /addContactsChangeListener/);
  assert.match(contactsProviderSource, /\/api\/v1\/contacts\/import/);
  assert.match(contactsProviderSource, /SecureStore\.setItemAsync/);
});

test("Phase 2 exposes search, favorites, recent, details, editing, deletion, language, calls, and invites", () => {
  for (const label of ["Search contacts", "Favorites", "Recently Called", "Contact details", "Edit Contact", "Delete Contact", "Preferred language", "Voice Call", "Video Call", "Business Video Call", "Invite to Interpreter"]) {
    assert.match(contactsSource, new RegExp(label));
  }
  assert.doesNotMatch(contactsSource, /LiveKit|createRoom|joinRoom|mediaDevices/);
});

test("contacts backend and migration enforce ownership and private directory matching", () => {
  assert.match(serverSource, /app\.use\("\/api\/v1\/contacts", contactRoutes\)/);
  for (const method of ["get", "post", "patch", "delete"]) assert.match(contactsRouteSource, new RegExp(`router\\.${method}\\(`));
  assert.match(contactsMigrationSource, /create table if not exists public\.contacts/);
  assert.match(contactsMigrationSource, /create table if not exists public\.contact_tombstones/);
  assert.match(contactsMigrationSource, /create table if not exists public\.interpreter_user_directory/);
  assert.match(contactsMigrationSource, /alter table public\.contacts enable row level security/);
  assert.match(contactsMigrationSource, /auth\.uid\(\) = owner_id/g);
  assert.match(contactsMigrationSource, /revoke all on table public\.interpreter_user_directory from anon, authenticated/);
});

test("authentication supports confirmation and password recovery deep links", () => {
  assert.match(authSource, /emailRedirectTo: Linking\.createURL\('auth\/callback'\)/);
  assert.match(authSource, /resetPasswordForEmail/);
  assert.match(authSource, /exchangeCodeForSession/);
  assert.match(authSource, /PASSWORD_RECOVERY/);
  assert.match(authSource, /updateUser\(\{ password \}\)/);
});
