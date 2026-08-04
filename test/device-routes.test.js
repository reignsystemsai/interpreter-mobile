const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const routeSource = fs.readFileSync(path.join(__dirname, "..", "src", "server", "routes", "devices.js"), "utf8");
const { normalizeE164 } = require("../src/server/devices");

test("device registration route normalizes and upserts one unauthenticated installation", () => {
  assert.equal(normalizeE164("(305) 518-9384"), "+13055189384");
  assert.equal(normalizeE164("+1 689 282 8783"), "+16892828783");
  assert.match(routeSource, /router\.post\("\/register"/);
  assert.match(routeSource, /from\("device_installations"\)[\s\S]*onConflict: "device_id"/);
  assert.match(routeSource, /phone_number_e164: phoneNumberE164/);
  assert.doesNotMatch(routeSource, /requireUser|auth\.users/);
});

test("recipient lookup returns only availability and the matched installation id", () => {
  assert.match(routeSource, /router\.post\("\/lookup"/);
  assert.match(routeSource, /eq\("phone_number_e164", phoneNumberE164\)/);
  assert.match(routeSource, /eq\("enabled", true\)/);
  assert.match(routeSource, /available: true, recipient: \{ installationId: data\.id \}/);
  assert.doesNotMatch(routeSource.slice(routeSource.indexOf('router.post("/lookup"')), /push_token|device_id/);
});
