import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
};

const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  status,
});

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const body = await request.json().catch(() => null) as { device_id?: unknown; display_name?: unknown; phone_e164?: unknown } | null;
  const deviceId = typeof body?.device_id === 'string' ? body.device_id.trim() : '';
  const displayName = typeof body?.display_name === 'string' ? body.display_name.trim() : '';
  const phoneE164 = typeof body?.phone_e164 === 'string' ? body.phone_e164.trim() : '';
  if (!deviceId || !displayName || !phoneE164) return json({ error: 'device_id, display_name, and phone_e164 are required.' }, 400);

  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return json({ error: 'Profile service is not configured.' }, 500);
  const supabase = createClient(url, key);
  const { error } = await supabase.from('speak_profiles').upsert({ device_id: deviceId, display_name: displayName, phone_e164: phoneE164 }, { onConflict: 'device_id' });
  if (error) return json({ error: 'Profile registration failed.' }, 500);
  return json({ device_id: deviceId });
});