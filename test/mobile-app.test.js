const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "mobile", "app", "index.tsx"), "utf8");
const authSource = fs.readFileSync(path.join(root, "mobile", "src", "features", "account", "AuthProvider.tsx"), "utf8");
const callingSource = fs.readFileSync(path.join(root, "mobile", "src", "features", "calling", "CallingOverlay.tsx"), "utf8");
const callProviderSource = fs.readFileSync(path.join(root, "mobile", "src", "features", "calling", "CallProvider.tsx"), "utf8");
const callScreensSource = fs.readFileSync(path.join(root, "mobile", "src", "features", "calling", "CallScreens.tsx"), "utf8");
const contactsSource = fs.readFileSync(path.join(root, "mobile", "src", "features", "contacts", "ContactsPermissionPanel.tsx"), "utf8");
const contactsProviderSource = fs.readFileSync(path.join(root, "mobile", "src", "features", "contacts", "ContactsProvider.tsx"), "utf8");
const contactsRouteSource = fs.readFileSync(path.join(root, "src", "server", "routes", "contacts.js"), "utf8");
const contactsMigrationSource = fs.readFileSync(path.join(root, "supabase", "migrations", "202608030002_contacts_system.sql"), "utf8");
const callsMigrationSource = fs.readFileSync(path.join(root, "supabase", "migrations", "202608030003_calling_foundation.sql"), "utf8");
const callsRouteSource = fs.readFileSync(path.join(root, "src", "server", "routes", "calls.js"), "utf8");
const liveKitWebhookSource = fs.readFileSync(path.join(root, "src", "server", "routes", "livekit-webhook.js"), "utf8");
const interpretedHookSource = fs.readFileSync(path.join(root, "mobile", "src", "hooks", "useInterpretedCall.ts"), "utf8");
const realtimeHookSource = fs.readFileSync(path.join(root, "mobile", "src", "hooks", "useRealtimeInterpreter.ts"), "utf8");
const interpretedRouteSource = fs.readFileSync(path.join(root, "src", "server", "routes", "interpreted-calls.js"), "utf8");
const interpretedManagerSource = fs.readFileSync(path.join(root, "src", "server", "interpreted-call-manager.js"), "utf8");
const interpretedMigrationSource = fs.readFileSync(path.join(root, "supabase", "migrations", "202608030004_interpreted_calling.sql"), "utf8");
const trialMigrationSource = fs.readFileSync(path.join(root, "supabase", "migrations", "202608040001_three_minute_interpreter_trial.sql"), "utf8");
const callMessagesSource = fs.readFileSync(path.join(root, "mobile", "src", "features", "calling", "callMessages.ts"), "utf8");
const menuSource = fs.readFileSync(path.join(root, "mobile", "src", "features", "menu", "AppMenu.tsx"), "utf8");
const destinationSource = fs.readFileSync(path.join(root, "mobile", "src", "features", "menu", "DestinationSheet.tsx"), "utf8");
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
  assert.equal(appConfig.expo.android.versionCode, 10);
});

test("Phase 3 preserves the existing calling overlay and approved destinations", () => {
  for (const label of ["Voice Call", "Video Call", "Business Video Call", "My Contacts", "Call History"]) {
    assert.match(callingSource, new RegExp(label));
  }
  assert.match(appSource, /accessibilityLabel="Open calling"/);
  assert.match(appSource, /disabled=\{conversationRunning\}/);
  assert.match(appSource, /if \(recoveryMode\) setOverlay\('account'\)/);
  assert.match(callProviderSource, /\/api\/v1\/calls/);
  assert.match(callProviderSource, /RoomEvent\.Reconnecting/);
  assert.match(callProviderSource, /registerForCallNotifications/);
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
  assert.match(contactsSource, /startCall/);
});

test("Phase 3 implements secure calling lifecycle, controls, history, presence, and RLS", () => {
  for (const endpoint of ["incoming", "history", "accept", "active", "decline", "missed", "end", "token", "connection"]) assert.match(callsRouteSource, new RegExp(endpoint));
  assert.match(serverSource, /app\.use\("\/api\/v1\/calls", callRoutes\)/);
  assert.match(serverSource, /app\.use\("\/api\/v1\/presence", presenceRoutes\)/);
  for (const control of ["Accept", "Decline", "End Call", "Mute", "Speaker", "Camera", "Flip", "Reconnecting"]) assert.match(callScreensSource, new RegExp(control));
  for (const table of ["public.calls", "public.call_events", "public.user_presence"]) assert.match(callsMigrationSource, new RegExp(`create table if not exists ${table.replace('.', '\\.')}`));
  assert.match(callsMigrationSource, /enable row level security/g);
  assert.match(callsMigrationSource, /reserve_interpreter_call/);
  assert.match(callsMigrationSource, /grant select, insert, update, delete on table public\.calls to service_role/);
  assert.match(serverSource, /app\.use\("\/api\/v1\/livekit\/webhook", liveKitWebhookRoutes\)/);
  assert.match(liveKitWebhookSource, /WebhookReceiver/);
  assert.match(liveKitWebhookSource, /room_finished/);
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

test("Phase 4 keeps interpreted calls separate from the in-person interpreter", () => {
  assert.match(interpretedHookSource, /export function useInterpretedCall/);
  assert.doesNotMatch(interpretedHookSource, /useRealtimeInterpreter/);
  assert.match(realtimeHookSource, /export function useRealtimeInterpreter/);
  assert.match(callScreensSource, /useInterpretedCall/);
  assert.match(interpretedHookSource, /RoomEvent\.DataReceived/);
  assert.match(interpretedHookSource, /interpreter-to-/);
  assert.match(interpretedHookSource, /setRawAudioFallback/);
});

test("Phase 4 provides ephemeral transcripts, recovery, metering, and private metrics", () => {
  assert.match(serverSource, /app\.use\("\/api\/v1\/interpreted-calls", interpretedCallRoutes\)/);
  for (const endpoint of ["start", "status", "metrics", "stop"]) assert.match(interpretedRouteSource, new RegExp(endpoint));
  assert.match(interpretedManagerSource, /DirectionalRealtimeSession/);
  assert.match(interpretedManagerSource, /record_interpreted_usage/);
  assert.match(interpretedManagerSource, /speech-started/);
  assert.match(interpretedManagerSource, /clearQueue/);
  assert.match(interpretedMigrationSource, /call_interpretation_metrics/);
  assert.match(interpretedMigrationSource, /enable row level security/);
  assert.doesNotMatch(interpretedMigrationSource, /transcript_text|original_text|translated_text/);
  assert.match(callScreensSource, /Live interpretation/);
});

test("Phase 5 keeps connection feedback singular, temporary, and user friendly", () => {
  for (const status of ["Connecting...", "Ringing...", "Connected", "Reconnecting...", "Connection Lost", "Call Failed"]) {
    assert.match(callScreensSource, new RegExp(status.replace(/[.]/g, "\\.")));
  }
  assert.match(callScreensSource, /setTimeout\(\(\) => setShowConnected\(false\), 1_500\)/);
  assert.match(callProviderSource, /MAX_CONNECT_ATTEMPTS = 4/);
  assert.match(callProviderSource, /maxRetries: 3/);
  assert.match(callProviderSource, /retryCall/);
  for (const message of ["No internet connection.", "Call declined.", "User unavailable.", "Unable to connect. Please try again.", "The translation service is temporarily unavailable."]) {
    assert.match(callMessagesSource, new RegExp(message.replace(/[.]/g, "\\.")));
  }
  assert.doesNotMatch(callScreensSource, /error\.message/);
});

test("Phase 5 uses speech media protection and an informational calls sheet", () => {
  for (const setting of ["echoCancellation: true", "noiseSuppression: true", "autoGainControl: true", "voiceIsolation: { ideal: true }", "AudioPresets.speech", "dtx: true", "red: true"]) {
    assert.match(callProviderSource, new RegExp(setting.replace(/[.]/g, "\\.")));
  }
  assert.match(callProviderSource, /preferredOutputList: \['bluetooth', 'headset', 'speaker', 'earpiece'\]/);
  assert.match(menuSource, /Interpreter Calls/);
  assert.match(appSource, /overlay === 'interpreter_calls' \? null : 'menu'/);
  for (const copy of ["No switching apps.", "No typing.", "No passing the phone back and forth.", "Just conversation.", "Got It"]) {
    assert.match(destinationSource, new RegExp(copy.replace(/[.]/g, "\\.")));
  }
});

test("Phase 6 keeps the home visible, creates a guest session, and enforces rolling Interpreter Minutes", () => {
  assert.match(authSource, /signInAnonymously/);
  assert.match(authSource, /isGuest[\s\S]*updateUser\(\{ email:/);
  assert.match(callingSource, /3 free Interpreter Minutes every 30 days\. No account required\./);
  assert.match(callScreensSource, /transparent visible=\{Boolean\(currentCall\)\}/);
  assert.match(callScreensSource, /You've used all of your Interpreter Minutes\./);
  assert.match(callScreensSource, /Your free minutes renew on/);
  assert.match(callScreensSource, /Upgrade Membership/);
  assert.match(callScreensSource, /Add More Minutes/);
  assert.match(callScreensSource, /Maybe Later/);
  assert.match(callScreensSource, /void calling\.endCall\(\)/);
  for (const field of ['cycle_started_at', 'cycle_renews_at', 'included_seconds', 'used_seconds', 'remaining_seconds']) assert.match(trialMigrationSource, new RegExp(field));
  assert.match(trialMigrationSource, /interval '30 days'/);
  assert.match(trialMigrationSource, /interpreter_minute_credits/);
  for (const source of [menuSource, destinationSource, callScreensSource]) assert.match(source, /BlurView/);
  for (const source of [menuSource, destinationSource, callScreensSource, callingSource]) assert.match(source, /<Modal[\s\S]*transparent/);
  assert.doesNotMatch(appSource, /router\.(push|replace|navigate)|navigation\.(push|navigate)/);
  assert.match(appSource, /onPress=\{\(\) => setOverlay\('calling'\)\}/);
  assert.match(callingSource, /type === 'business_video' && isGuest/);
  assert.doesNotMatch(callingSource, /Sign in is required before starting a call/);
  assert.match(menuSource, /!isGuest \|\| !\['membership', 'billing'\]\.includes/);
  assert.match(interpretedRouteSource, /get_or_renew_interpreter_allowance/);
  assert.match(interpretedRouteSource, /router\.get\("\/allowance"/);
  for (const copy of ["Production integration", "Public project keys", "Server configuration", "Account services are not active yet"]) {
    assert.doesNotMatch(destinationSource, new RegExp(copy));
  }
});
