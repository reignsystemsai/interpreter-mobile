alter table public.speak_profiles
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists email text;

create unique index if not exists speak_profiles_email_key
  on public.speak_profiles (lower(email))
  where email is not null;

drop function if exists public.register_calling_profile(uuid, text, text);
drop function if exists public.register_calling_profile(uuid, text, text, text, text);

create function public.register_calling_profile(
  p_device_id uuid,
  p_first_name text,
  p_last_name text,
  p_phone_e164 text,
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_first_name text := trim(p_first_name);
  normalized_last_name text := trim(p_last_name);
  normalized_email text := lower(trim(p_email));
  returning_user boolean;
begin
  if normalized_first_name = '' or normalized_last_name = '' or trim(p_phone_e164) = '' or normalized_email = '' then
    raise exception 'First name, last name, phone, and email are required.';
  end if;

  select exists (
    select 1
    from public.speak_profiles
    where phone_e164 = p_phone_e164
       or lower(email) = normalized_email
  ) into returning_user;

  delete from public.speak_profiles
  where device_id <> p_device_id
    and (phone_e164 = p_phone_e164 or lower(email) = normalized_email);

  insert into public.speak_profiles (
    device_id,
    display_name,
    first_name,
    last_name,
    phone_e164,
    email,
    updated_at
  ) values (
    p_device_id,
    normalized_first_name || ' ' || normalized_last_name,
    normalized_first_name,
    normalized_last_name,
    p_phone_e164,
    normalized_email,
    now()
  )
  on conflict (device_id) do update
  set display_name = excluded.display_name,
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      phone_e164 = excluded.phone_e164,
      email = excluded.email,
      updated_at = now();

  return jsonb_build_object(
    'device_id', p_device_id,
    'returning_user', returning_user
  );
end;
$$;

revoke all on function public.register_calling_profile(uuid, text, text, text, text) from public;
grant execute on function public.register_calling_profile(uuid, text, text, text, text) to anon, authenticated;
