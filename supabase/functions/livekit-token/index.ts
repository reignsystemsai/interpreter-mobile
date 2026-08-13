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

  const authorization = request.headers.get('Authorization');
  const token = authorization?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: 'Authorization required.' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const livekitUrl = Deno.env.get('LIVEKIT_URL');
  const livekitApiKey = Deno.env.get('LIVEKIT_API_KEY');
  const livekitApiSecret = Deno.env.get('LIVEKIT_API_SECRET');
  if (!supabaseUrl || !supabaseKey || !livekitUrl || !livekitApiKey || !livekitApiSecret) return json({ error: 'Token service is not configured.' }, 500);

  const supabase = createClient(supabaseUrl, supabaseKey);
  const { data: { user }, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user) return json({ error: 'Invalid authorization.' }, 401);

  const body = await request.json().catch(() => null) as { callId?: unknown } | null;
  const callId = typeof body?.callId === 'string' ? body.callId.trim() : '';
  if (!callId) return json({ error: 'callId is required.' }, 400);

  const { data: call, error: callError } = await supabase
    .from('app_calls')
    .select('id, caller_user_id, recipient_user_id, status')
    .eq('id', callId)
    .maybeSingle();
  if (callError) return json({ error: 'Call lookup failed.' }, 500);
  if (!call || (call.caller_user_id !== user.id && call.recipient_user_id !== user.id)) return json({ error: 'Call access denied.' }, 403);
  if (call.status === 'declined' || call.status === 'ended') return json({ error: 'Call is no longer active.' }, 409);

  const participantToken = new AccessToken(livekitApiKey, livekitApiSecret, { identity: user.id, ttl: '10m' });
  participantToken.addGrant({ canPublish: true, canSubscribe: true, room: call.id, roomJoin: true });
  return json({ participant_token: await participantToken.toJwt(), server_url: livekitUrl });
});