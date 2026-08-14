import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { AccessToken, TrackSource } from 'npm:livekit-server-sdk@2.17.0';

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

  try {
    const body = await request.json().catch(() => null) as { call_id?: unknown; device_id?: unknown } | null;
    const callId = typeof body?.call_id === 'string' ? body.call_id.trim() : '';
    const deviceId = typeof body?.device_id === 'string' ? body.device_id.trim() : '';
    if (!callId || !deviceId) return json({ error: 'call_id and device_id are required.' }, 400);

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const requestApiKey = request.headers.get('apikey')?.trim();
    const livekitUrl = Deno.env.get('LIVEKIT_URL')?.trim();
    const livekitApiKey = Deno.env.get('LIVEKIT_API_KEY')?.trim();
    const livekitApiSecret = Deno.env.get('LIVEKIT_API_SECRET')?.trim();

    const missing = [
      !supabaseUrl && 'SUPABASE_URL',
      !requestApiKey && 'apikey header',
      !livekitUrl && 'LIVEKIT_URL',
      !livekitApiKey && 'LIVEKIT_API_KEY',
      !livekitApiSecret && 'LIVEKIT_API_SECRET',
    ].filter(Boolean);
    if (missing.length > 0) {
      console.error('LiveKit token configuration missing:', missing);
      return json({ error: 'Token service is not configured.', missing }, 500);
    }

    const supabase = createClient(supabaseUrl!, requestApiKey!, {
      auth: { persistSession: false },
    });
    const { data: call, error: callError } = await supabase
      .from('app_calls')
      .select('id, caller_device_id, recipient_device_id, status')
      .eq('id', callId)
      .maybeSingle();

    if (callError) {
      console.error('LiveKit call lookup failed:', callError);
      return json({ error: 'Call lookup failed.', detail: callError.message }, 500);
    }
    if (!call || (call.caller_device_id !== deviceId && call.recipient_device_id !== deviceId)) {
      return json({ error: 'Call access denied.' }, 403);
    }
    if (call.status === 'declined' || call.status === 'ended') {
      return json({ error: 'Call is no longer active.' }, 409);
    }

    const participantToken = new AccessToken(livekitApiKey!, livekitApiSecret!, {
      identity: deviceId,
      ttl: '10m',
    });
    participantToken.addGrant({
      canPublish: true,
      canPublishSources: [TrackSource.MICROPHONE, TrackSource.CAMERA],
      canSubscribe: true,
      room: call.id,
      roomJoin: true,
    });

    return json({
      participant_token: await participantToken.toJwt(),
      server_url: livekitUrl!,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown token-service failure.';
    console.error('LiveKit token failure:', detail);
    return json({ error: 'Token service failed.', detail }, 500);
  }
});
