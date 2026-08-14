create extension if not exists pgcrypto with schema extensions;

create or replace function public.issue_livekit_call_token(
  p_call_id uuid,
  p_device_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  call_record public.app_calls%rowtype;
  livekit_url text;
  livekit_api_key text;
  livekit_api_secret text;
  issued_at bigint := floor(extract(epoch from clock_timestamp()))::bigint;
  token_header text;
  token_payload text;
  token_signature text;
begin
  select *
  into call_record
  from public.app_calls
  where id = p_call_id;

  if not found
    or (call_record.caller_device_id <> p_device_id and call_record.recipient_device_id <> p_device_id) then
    raise exception 'Call access denied.';
  end if;

  if call_record.status in ('declined', 'ended') then
    raise exception 'Call is no longer active.';
  end if;

  select decrypted_secret into livekit_url
  from vault.decrypted_secrets
  where name = 'LIVEKIT_URL'
  order by updated_at desc
  limit 1;

  select decrypted_secret into livekit_api_key
  from vault.decrypted_secrets
  where name = 'LIVEKIT_API_KEY'
  order by updated_at desc
  limit 1;

  select decrypted_secret into livekit_api_secret
  from vault.decrypted_secrets
  where name = 'LIVEKIT_API_SECRET'
  order by updated_at desc
  limit 1;

  if nullif(trim(livekit_url), '') is null
    or nullif(trim(livekit_api_key), '') is null
    or nullif(trim(livekit_api_secret), '') is null then
    raise exception 'LiveKit Vault secrets are not configured.';
  end if;

  token_header := translate(
    encode(convert_to('{"alg":"HS256","typ":"JWT"}', 'UTF8'), 'base64'),
    E'+/=\n',
    '-_'
  );

  token_payload := translate(
    encode(
      convert_to(
        jsonb_build_object(
          'exp', issued_at + 600,
          'iss', trim(livekit_api_key),
          'nbf', issued_at - 5,
          'sub', p_device_id::text,
          'video', jsonb_build_object(
            'room', p_call_id::text,
            'roomJoin', true,
            'canPublish', true,
            'canPublishSources', jsonb_build_array('microphone', 'camera'),
            'canSubscribe', true
          )
        )::text,
        'UTF8'
      ),
      'base64'
    ),
    E'+/=\n',
    '-_'
  );

  token_signature := translate(
    encode(
      extensions.hmac(
        convert_to(token_header || '.' || token_payload, 'UTF8'),
        convert_to(trim(livekit_api_secret), 'UTF8'),
        'sha256'
      ),
      'base64'
    ),
    E'+/=\n',
    '-_'
  );

  return jsonb_build_object(
    'participant_token', token_header || '.' || token_payload || '.' || token_signature,
    'server_url', trim(livekit_url)
  );
end;
$$;

revoke all on function public.issue_livekit_call_token(uuid, uuid) from public;
grant execute on function public.issue_livekit_call_token(uuid, uuid) to anon, authenticated;
