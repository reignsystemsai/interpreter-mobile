const required = [
  "EXPO_PUBLIC_API_BASE_URL",
  "LIVEKIT_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_URL"
];

const expectedBackend = "https://interpreter-api-fycw.onrender.com";

const legacy = [
  "EXPO_PUBLIC_LIVEKIT_URL",
  "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "EXPO_PUBLIC_SUPABASE_URL"
];

for (const name of required) {
  console.log(`${name}: ${process.env[name] ? "CONFIGURED" : "MISSING"}`);
}

for (const name of legacy) {
  console.log(`${name}: ${process.env[name] ? "CONFIGURED" : "MISSING"}`);
}

console.log(`PRODUCTION_BACKEND_MATCH: ${process.env.EXPO_PUBLIC_API_BASE_URL === expectedBackend ? "PASS" : "FAIL"}`);

if (required.some((name) => !process.env[name]) || process.env.EXPO_PUBLIC_API_BASE_URL !== expectedBackend) process.exitCode = 1;
