import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { AccessToken } from 'npm:livekit-server-sdk@2.17.0';

const corsHeaders = { 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
  const authorization = request.headers.get('authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return new Response(JSON.stringify({ error: 'Authentication required' }), { status: 401, headers: corsHeaders });
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  const callId = (await request.json().catch(() => ({}))).callId;
  if (userError || !userData.user || typeof callId !== 'string') return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 401, headers: corsHeaders });
  const { data: call, error: callError } = await supabase.from('app_calls').select('id,caller_user_id,recipient_user_id,status').eq('id', callId).maybeSingle();
  if (callError || !call || ![call.caller_user_id, call.recipient_user_id].includes(userData.user.id)) return new Response(JSON.stringify({ error: 'Call unavailable' }), { status: 403, headers: corsHeaders });
  const room = `speak-${call.id}`;
  const accessToken = new AccessToken(Deno.env.get('LIVEKIT_API_KEY')!, Deno.env.get('LIVEKIT_API_SECRET')!, { identity: userData.user.id, ttl: '10m' });
  accessToken.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishSources: ['microphone', 'camera'] });
  return new Response(JSON.stringify({ server_url: Deno.env.get('LIVEKIT_URL'), participant_token: await accessToken.toJwt() }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});