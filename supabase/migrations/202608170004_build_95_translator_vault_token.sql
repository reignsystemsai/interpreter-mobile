begin;

create extension if not exists pgcrypto with schema extensions;

create or replace function public.issue_translator_livekit_token(
  p_room_name text,
  p_identity text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  livekit_url text;
  livekit_api_key text;
  livekit_api_secret text;
  issued_at bigint := floor(extract(epoch from clock_timestamp()))::bigint;
  token_header text;
  token_payload text;
  token_signature text;
begin
  if p_room_name !~ '^translator-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'Invalid Translator room.';
  end if;

  if length(p_identity) > 48 or (
    p_identity !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and p_identity !~ '^translator:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) then
    raise exception 'Invalid Translator identity.';
  end if;

  select decrypted_secret into livekit_url from vault.decrypted_secrets
  where name = 'LIVEKIT_URL' order by updated_at desc limit 1;
  select decrypted_secret into livekit_api_key from vault.decrypted_secrets
  where name = 'LIVEKIT_API_KEY' order by updated_at desc limit 1;
  select decrypted_secret into livekit_api_secret from vault.decrypted_secrets
  where name = 'LIVEKIT_API_SECRET' order by updated_at desc limit 1;

  if nullif(trim(livekit_url), '') is null
    or nullif(trim(livekit_api_key), '') is null
    or nullif(trim(livekit_api_secret), '') is null then
    raise exception 'LiveKit Vault secrets are not configured.';
  end if;

  token_header := translate(encode(convert_to('{"alg":"HS256","typ":"JWT"}', 'UTF8'), 'base64'), E'+/=\n', '-_');
  token_payload := translate(
    encode(convert_to(jsonb_build_object(
      'exp', issued_at + 600,
      'iss', trim(livekit_api_key),
      'nbf', issued_at - 5,
      'sub', p_identity,
      'video', jsonb_build_object(
        'room', p_room_name,
        'roomJoin', true,
        'canPublish', true,
        'canPublishSources', jsonb_build_array('microphone'),
        'canSubscribe', true
      )
    )::text, 'UTF8'), 'base64'), E'+/=\n', '-_'
  );
  token_signature := translate(
    encode(extensions.hmac(
      convert_to(token_header || '.' || token_payload, 'UTF8'),
      convert_to(trim(livekit_api_secret), 'UTF8'),
      'sha256'
    ), 'base64'), E'+/=\n', '-_'
  );

  return jsonb_build_object(
    'participant_token', token_header || '.' || token_payload || '.' || token_signature,
    'server_url', trim(livekit_url)
  );
end;
$$;

revoke all on function public.issue_translator_livekit_token(text, text) from public, anon, authenticated;
grant execute on function public.issue_translator_livekit_token(text, text) to service_role;

commit;
