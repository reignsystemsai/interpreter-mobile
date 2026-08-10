const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const contacts = fs.readFileSync(
  path.join(__dirname, "..", "mobile", "src", "features", "contacts", "ContactsPermissionPanel.tsx"),
  "utf8"
);

test("contact rows remain actionable while the search keyboard is open", () => {
  assert.match(contacts, /keyboardShouldPersistTaps="handled"/);
});
