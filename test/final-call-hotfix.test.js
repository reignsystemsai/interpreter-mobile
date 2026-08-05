const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const { normalizeE164 } = require("../src/server/devices");
const mobilePhone = fs.readFileSync(path.join(root, "mobile", "src", "services", "deviceRegistration.ts"), "utf8");
const contacts = fs.readFileSync(path.join(root, "mobile", "src", "features", "contacts", "ContactsPermissionPanel.tsx"), "utf8");
const callService = fs.readFileSync(path.join(root, "mobile", "src", "features", "calling", "CallService.ts"), "utf8");
const overlay = fs.readFileSync(path.join(root, "mobile", "src", "features", "calling", "CallingOverlay.tsx"), "utf8");
const home = fs.readFileSync(path.join(root, "mobile", "app", "index.tsx"), "utf8");

test("Colombian and international numbers normalize to E.164 before recipient lookup", () => {
  for (const value of ["+57 300 123 4567", "+573001234567", "300 123 4567", "3001234567"]) {
    assert.equal(normalizeE164(value, "CO"), "+573001234567");
  }
  assert.equal(normalizeE164("+44 20 7946 0018", "CO"), "+442079460018");
  assert.match(mobilePhone, /parsePhoneNumberFromString/);
  assert.match(contacts, /selectedPhone\.countryCode/);
  assert.match(contacts, /normalizeE164\(item\.value, region\)/);
  assert.match(mobilePhone, /api\/v1\/devices\/lookup/);
});

test("closing, failing, or ending a call immediately restores Home interaction", () => {
  const endCall = callService.slice(callService.indexOf("async endCall()"));
  const idleBeforeRelease = endCall.indexOf("this.setState({ callCode: null, status: 'idle' })");
  const releaseAfterIdle = endCall.indexOf("await this.releaseRoom(room)", idleBeforeRelease);
  assert.ok(idleBeforeRelease >= 0 && releaseAfterIdle > idleBeforeRelease);
  assert.match(overlay, /void CallService\.endCall\(\);[\s\S]*onClose\(\)/);
  assert.match(overlay, /else setView\('actions'\)/);
  assert.match(home, /overlay === null[\s\S]*CallService\.resetStaleCallState\(\)/);
  assert.doesNotMatch(overlay, /pointerEvents=["']none["']/);
});
