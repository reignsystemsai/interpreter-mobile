const { parsePhoneNumberFromString } = require("libphonenumber-js");

function normalizeE164(value, defaultRegion) {
  if (typeof value !== "string") return "";
  const region = typeof defaultRegion === "string" && /^[A-Za-z]{2}$/.test(defaultRegion)
    ? defaultRegion.toUpperCase()
    : undefined;
  try {
    const phoneNumber = parsePhoneNumberFromString(value.trim(), region);
    return phoneNumber?.isValid() ? phoneNumber.number : "";
  } catch {
    return "";
  }
}

module.exports = { normalizeE164 };
