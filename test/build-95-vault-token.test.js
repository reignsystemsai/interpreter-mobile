const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Build 95 keeps Classic Call isolated from Translator Call", () => {
  const classic = read("mobile/src/features/calling/CallService.ts");
  assert.doesNotMatch(classic, /TranslatorCall|translator-calls|issue_translator/);
});

test("Translator tokens come only from the Supabase vault signer", () => {
  const route = read("src/server/translator/TranslatorCalls.js");
  assert.match(route, /issue_translator_livekit_token/);
  assert.doesNotMatch(route, /createVoiceToken|getLiveKitUrl|isLiveKitConfigured|require\("\.\.\/livekit"\)/);

  const sql = read("supabase/migrations/202608170004_build_95_translator_vault_token.sql");
  assert.match(sql, /vault\.decrypted_secrets/);
  assert.match(sql, /grant execute[\s\S]*service_role/);
  assert.doesNotMatch(sql, /grant execute[\s\S]*to anon|grant execute[\s\S]*to authenticated/);
});

test("Translator uses permanent male and female voices", () => {
  const bridge = read("src/server/translator/TranslatorBridge.js");
  assert.match(bridge, /male:\s*"cedar"/);
  assert.match(bridge, /female:\s*"marin"/);
});

test("Contacts expose separate Classic and Translator call choices", () => {
  const contacts = read("mobile/src/features/contacts/ContactsPermissionPanel.tsx");
  assert.match(contacts, /Classic Call/);
  assert.match(contacts, /Translator Call/);
});

test("Bridge starts before a Translator Call becomes active", () => {
  const route = read("src/server/translator/TranslatorCalls.js");
  assert.ok(route.indexOf("await bridge.start()") < route.indexOf('call.status = "active"'));
});
