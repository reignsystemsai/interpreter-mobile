import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { AccessToken } from 'https://esm.sh/livekit-server-sdk@2';

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
  const body = await request.json().catch(() => null) as { call_id?: unknown; device_id?: unknown } | null;
  const callId = typeof body?.call_id === 'string' ? body.call_id.trim() : '';
  const deviceId = typeof body?.device_id === 'string' ? body.device_id.trim() : '';
  if (!callId || !deviceId) return json({ error: 'call_id and device_id are required.' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const livekitUrl = Deno.env.get('LIVEKIT_URL');
  const livekitApiKey = Deno.env.get('LIVEKIT_API_KEY');
  const livekitApiSecret = Deno.env.get('LIVEKIT_API_SECRET');
  if (!supabaseUrl || !supabaseKey || !livekitUrl || !livekitApiKey || !livekitApiSecret) return json({ error: 'Token service is not configured.' }, 500);

  const supabase = createClient(supabaseUrl, supabaseKey);
  const { data: device } = await supabase.from('speak_profiles').select('device_id').eq('device_id', deviceId).maybeSingle();
  if (!device) return json({ error: 'CALL TOKEN' }, 403);
  const { data: call, error: callError } = await supabase.from('app_calls').select('id, caller_device_id, recipient_device_id, status').eq('id', callId).maybeSingle();
  if (callError) return json({ error: 'CALL TOKEN' }, 500);
  if (!call || (call.caller_device_id !== deviceId && call.recipient_device_id !== deviceId)) return json({ error: 'CALL TOKEN' }, 403);
  if (call.status === 'declined' || call.status === 'ended') return json({ error: 'CALL TOKEN' }, 409);

  const participantToken = new AccessToken(livekitApiKey, livekitApiSecret, { identity: deviceId, ttl: '10m' });
  participantToken.addGrant({ canPublish: true, canSubscribe: true, room: call.id, roomJoin: true });
  return json({ participant_token: await participantToken.toJwt(), server_url: livekitUrl });
});