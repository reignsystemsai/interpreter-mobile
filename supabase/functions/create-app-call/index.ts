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

  try {
    const body = await request.json().catch(() => null) as { caller_device_id?: unknown; recipient_phone_e164?: unknown } | null;
    const callerDeviceId = typeof body?.caller_device_id === 'string' ? body.caller_device_id.trim() : '';
    const recipientPhone = typeof body?.recipient_phone_e164 === 'string' ? body.recipient_phone_e164.trim() : '';

    if (!callerDeviceId || !recipientPhone) {
      return json({ error: 'caller_device_id and recipient_phone_e164 are required.' }, 400);
    }

    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) {
      return json({ error: 'Server configuration missing.' }, 500);
    }

    const supabase = createClient(url, key);

    // 1. Verify caller device profile
    const { data: caller, error: callerError } = await supabase
      .from('speak_profiles')
      .select('device_id')
      .eq('device_id', callerDeviceId)
      .maybeSingle();

    if (callerError) {
      console.error('Database error on caller lookup:', callerError);
      return json({ error: 'Database error validating caller.' }, 500);
    }
    if (!caller) {
      return json({ error: 'Caller profile not found.' }, 403);
    }

    // 2. Resolve recipient device ID via database RPC function
    const { data: rpcData, error: resolveError } = await supabase
      .rpc('resolve_speak_device', { phone: recipientPhone });

    if (resolveError) {
      console.error('RPC error on resolve_speak_device:', resolveError);
      return json({ error: 'Failed to resolve recipient device.' }, 500);
    }

    // Standardize RPC return format (handles text scalar or table/object arrays)
    let recipientDeviceId = '';
    if (typeof rpcData === 'string') {
      recipientDeviceId = rpcData;
    } else if (Array.isArray(rpcData) && rpcData.length > 0) {
      recipientDeviceId = rpcData[0].device_id || rpcData[0].resolve_speak_device || Object.values(rpcData[0])[0] || '';
    } else if (rpcData && typeof rpcData === 'object') {
      recipientDeviceId = (rpcData as Record<string, any>).device_id || Object.values(rpcData)[0] || '';
    }

    if (!recipientDeviceId || typeof recipientDeviceId !== 'string') {
      return json({ error: 'Recipient phone number is not registered to a device.' }, 404);
    }

    if (recipientDeviceId === callerDeviceId) {
      return json({ error: 'Cannot place a call to your own device.' }, 400);
    }

    // 3. Create active call row in app_calls table
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
      console.error('Database error creating call record:', callError);
      return json({ error: 'Failed to initialize call session.' }, 500);
    }

    return json({ 
      call_id: call.id, 
      recipient_device_id: recipientDeviceId 
    });

  } catch (err) {
    console.error('Unexpected edge function crash:', err);
    return json({ error: 'Internal server error.' }, 500);
  }
});