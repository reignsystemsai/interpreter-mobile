const crypto = require("node:crypto");

const MAX_CONTACTS_PER_IMPORT = 200;
const MAX_TEXT = 200;
const SUPPORTED_CONTACT_LANGUAGES = new Set([
  "English", "Spanish", "Brazilian Portuguese", "French", "German", "Italian",
  "Dutch", "Russian", "Polish", "Romanian", "Turkish", "Arabic", "Hebrew",
  "Hindi", "Japanese", "Korean", "Mandarin Chinese", "Cantonese", "Vietnamese", "Thai"
]);

function cleanText(value, maxLength = MAX_TEXT) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxLength) : "";
}

function normalizeEmail(value) {
  return cleanText(value, 254).toLowerCase();
}

function normalizePhone(value) {
  return cleanText(value, 80).replace(/\D/g, "");
}

function hashIdentity(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function cleanEntries(value, type) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const entries = [];
  for (const item of value.slice(0, 20)) {
    const rawValue = typeof item === "string" ? item : item?.value;
    const normalized = type === "email" ? normalizeEmail(rawValue) : normalizePhone(rawValue);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    entries.push({ label: cleanText(item?.label, 40) || type, value: cleanText(rawValue, type === "email" ? 254 : 80) });
  }
  return entries;
}

function normalizeContactPayload(value) {
  const phoneNumbers = cleanEntries(value?.phoneNumbers, "phone");
  const emailAddresses = cleanEntries(value?.emailAddresses, "email");
  const deviceContactId = cleanText(value?.deviceContactId, 200);
  const displayName = cleanText(value?.displayName, 200)
    || [cleanText(value?.givenName, 120), cleanText(value?.familyName, 120)].filter(Boolean).join(" ")
    || phoneNumbers[0]?.value
    || emailAddresses[0]?.value;
  if (!displayName) return null;
  const primaryEmail = emailAddresses[0] ? normalizeEmail(emailAddresses[0].value) : "";
  const primaryPhone = phoneNumbers[0] ? normalizePhone(phoneNumbers[0].value) : "";
  const identitySource = primaryEmail ? `email:${primaryEmail}` : primaryPhone ? `phone:${primaryPhone}` : deviceContactId ? `device:${deviceContactId}` : `name:${displayName.toLowerCase()}`;
  return {
    identityHash: hashIdentity(identitySource),
    deviceContactId: deviceContactId || null,
    displayName,
    givenName: cleanText(value?.givenName, 120) || null,
    familyName: cleanText(value?.familyName, 120) || null,
    company: cleanText(value?.company, 200) || null,
    phoneNumbers,
    emailAddresses,
    emailHashes: emailAddresses.map((entry) => hashIdentity(normalizeEmail(entry.value))),
    phoneHashes: phoneNumbers.map((entry) => hashIdentity(normalizePhone(entry.value)))
  };
}

module.exports = {
  MAX_CONTACTS_PER_IMPORT,
  SUPPORTED_CONTACT_LANGUAGES,
  cleanText,
  hashIdentity,
  normalizeContactPayload,
  normalizeEmail,
  normalizePhone
};
