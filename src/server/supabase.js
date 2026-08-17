const { createClient } = require("@supabase/supabase-js");

let adminClient;
function isSupabaseConfigured() { return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY); }
function getSupabaseAdmin() {
  if (!isSupabaseConfigured()) return null;
  if (!adminClient) adminClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  return adminClient;
}
async function requireUser(req, res, next) {
  const admin = getSupabaseAdmin();
  if (!admin) return res.status(503).json({ error: "Account services are not configured" });
  const authorization = req.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
  if (!token) return res.status(401).json({ error: "Authentication required" });
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return res.status(401).json({ error: "Invalid or expired session" });
  req.interpreterUser = data.user;
  return next();
}

module.exports = { getSupabaseAdmin, isSupabaseConfigured, requireUser };
