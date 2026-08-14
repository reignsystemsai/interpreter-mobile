create or replace function public.register_calling_profile(
  p_device_id uuid,
  p_display_name text,
  p_phone_e164 text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.speak_profiles
  where phone_e164 = p_phone_e164
    and device_id <> p_device_id;

  insert into public.speak_profiles (
    device_id,
    display_name,
    phone_e164,
    updated_at
  ) values (
    p_device_id,
    trim(p_display_name),
    p_phone_e164,
    now()
  )
  on conflict (device_id) do update
  set display_name = excluded.display_name,
      phone_e164 = excluded.phone_e164,
      updated_at = now();

  return p_device_id;
end;
$$;

revoke all on function public.register_calling_profile(uuid, text, text) from public;
grant execute on function public.register_calling_profile(uuid, text, text) to anon, authenticated;
