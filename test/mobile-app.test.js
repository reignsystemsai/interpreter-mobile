const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

test("the clean call rebuild preserves the existing Home and translation entry point", () => {
  const home = read("mobile", "app", "index.tsx");
  const realtime = read("mobile", "src", "hooks", "useRealtimeInterpreter.ts");
  for (const copy of ["interpreter", "Speak any language.", "Speaker (1) language", "Speaker (2) language", "Start Conversation"]) assert.match(home, new RegExp(copy.replace(/[()]/g, "\\$&")));
  assert.match(home, /useRealtimeInterpreter\(languageOne, languageTwo\)/);
  assert.match(realtime, /export function useRealtimeInterpreter/);
});

test("bundle identifiers and local contacts permissions remain unchanged", () => {
  const config = JSON.parse(read("mobile", "app.json"));
  assert.equal(config.expo.ios.bundleIdentifier, "ai.interpreter.mobile");
  assert.equal(config.expo.android.package, "ai.interpreter.mobile");
  assert.ok(config.expo.android.permissions.includes("android.permission.READ_CONTACTS"));
  assert.ok(config.expo.android.blockedPermissions.includes("android.permission.WRITE_CONTACTS"));
});
