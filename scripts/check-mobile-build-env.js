const required = [
  "LIVEKIT_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_URL"
];

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

if (required.some((name) => !process.env[name])) process.exitCode = 1;
