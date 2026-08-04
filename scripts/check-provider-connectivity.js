const crypto = require("node:crypto");

function sanitizedFailure(error) {
  if (error?.name === "AbortError") return "timeout";
  const code = error?.cause?.code;
  if (typeof code === "string" && /^[A-Z0-9_]+$/.test(code)) return code;
  return "network or configuration error";
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function checkSupabase() {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !publishableKey || !secretKey) {
    return { pass: false, error: "missing required configuration" };
  }
  try {
    const responses = await Promise.all([
      fetchWithTimeout(`${url}/auth/v1/settings`, { headers: { apikey: publishableKey } }),
      fetchWithTimeout(`${url}/rest/v1/`, { headers: { apikey: secretKey } })
    ]);
    if (responses.every((response) => response.ok)) return { pass: true };
    return { pass: false, error: `HTTP ${responses.map((response) => response.status).join("/")}` };
  } catch (error) {
    return { pass: false, error: sanitizedFailure(error) };
  }
}

function liveKitToken(apiKey, apiSecret) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    iss: apiKey,
    sub: apiKey,
    nbf: now - 10,
    exp: now + 60,
    video: { roomList: true }
  })}`;
  const signature = crypto.createHmac("sha256", apiSecret).update(unsigned).digest("base64url");
  return `${unsigned}.${signature}`;
}

async function checkLiveKit() {
  const url = process.env.LIVEKIT_URL
    ?.replace(/^wss:/, "https:")
    .replace(/^ws:/, "http:")
    .replace(/\/+$/, "");
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!url || !apiKey || !apiSecret) {
    return { pass: false, error: "missing required configuration" };
  }
  try {
    const response = await fetchWithTimeout(`${url}/twirp/livekit.RoomService/ListRooms`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${liveKitToken(apiKey, apiSecret)}`,
        "Content-Type": "application/json"
      },
      body: "{}"
    });
    return response.ok ? { pass: true } : { pass: false, error: `HTTP ${response.status}` };
  } catch (error) {
    return { pass: false, error: sanitizedFailure(error) };
  }
}

async function main() {
  const [supabase, livekit] = await Promise.all([checkSupabase(), checkLiveKit()]);
  console.log(`Supabase: ${supabase.pass ? "PASS" : `FAIL - ${supabase.error}`}`);
  console.log(`LiveKit: ${livekit.pass ? "PASS" : `FAIL - ${livekit.error}`}`);
  process.exitCode = supabase.pass && livekit.pass ? 0 : 1;
}

main().catch(() => {
  console.log("Supabase: FAIL - unexpected check error");
  console.log("LiveKit: FAIL - unexpected check error");
  process.exitCode = 1;
});
