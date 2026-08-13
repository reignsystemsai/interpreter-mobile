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

  const body = await request.json().catch(() => null) as { caller_device_id?: unknown; recipient_phone_e164?: unknown } | null;
  const callerDeviceId = typeof body?.caller_device_id === 'string' ? body.caller_device_id.trim() : '';
  const recipientPhone = typeof body?.recipient_phone_e164 === 'string' ? body.recipient_phone_e164.trim() : '';

  if (!callerDeviceId || !recipientPhone) {
    return json({ error: 'caller_device_id and recipient_phone_e164 are required.' }, 400);
  }

  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return json({ error: 'Call service is not configured.' }, 500);

  const supabase = createClient(url, key);

  // 1. Verify caller profile exists
  const { data: caller, error: callerError } = await supabase
    .from('speak_profiles')
    .select('device_id')
    .eq('device_id', callerDeviceId)
    .maybeSingle();

  if (callerError) {
    console.error('Caller lookup error:', callerError);
    return json({ error: 'CALL PROFILE ERROR' }, 500);
  }
  if (!caller) return json({ error: 'Caller profile not found.' }, 403);

  // 2. Resolve recipient device via RPC
  const { data: rpcData, error: resolveError } = await supabase
    .rpc('resolve_speak_device', { phone: recipientPhone });

  if (resolveError) {
    console.error('RPC resolve_speak_device error:', resolveError);
    return json({ error: 'CALL RESOLVE ERROR' }, 500);
  }

  // Handle various potential return formats from RPC (scalar vs array/object)
  let recipientDeviceId = '';
  if (typeof rpcData === 'string') {
    recipientDeviceId = rpcData;
  } else if (Array.isArray(rpcData) && rpcData.length > 0) {
    recipientDeviceId = rpcData[0].device_id || rpcData[0].resolve_speak_device || Object.values(rpcData[0])[0];
  } else if (rpcData && typeof rpcData === 'object') {
    recipientDeviceId = (rpcData as Record<string, any>).device_id || Object.values(rpcData)[0];
  }

  if (!recipientDeviceId || recipientDeviceId === callerDeviceId) {
    return json({ error: 'Recipient device could not be resolved or is invalid.' }, 404);
  }

  // 3. Create the call record
  const { data: call, error: callError } = await supabase
    .from('app_calls')
    .insert({
      caller_device_id: callerDeviceId,
      recipient_device_id: recipientDeviceId,
      status: 'ringing'
    })
    .select('id')
    .single();

  if (callError || !call) {
    console.error('App call insert error:', callError);
    return json({ error: 'CALL CREATE ERROR' }, 500);
  }

  return json({ call_id: call.id, recipient_device_id: recipientDeviceId });
});
