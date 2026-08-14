create or replace function public.create_direct_app_call(
  p_caller_device_id uuid,
  p_recipient_phone_e164 text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  recipient_device_id uuid;
  new_call_id uuid;
begin
  if not exists (
    select 1 from public.speak_profiles
    where device_id = p_caller_device_id
  ) then
    raise exception 'Caller profile not found.';
  end if;

  select device_id
  into recipient_device_id
  from public.speak_profiles
  where phone_e164 = p_recipient_phone_e164
  limit 1;

  if recipient_device_id is null then
    raise exception 'Recipient phone number is not registered.';
  end if;

  if recipient_device_id = p_caller_device_id then
    raise exception 'Cannot place a call to your own device.';
  end if;

  insert into public.app_calls (
    caller_device_id,
    recipient_device_id,
    status
  ) values (
    p_caller_device_id,
    recipient_device_id,
    'ringing'
  )
  returning id into new_call_id;

  return jsonb_build_object(
    'call_id', new_call_id,
    'recipient_device_id', recipient_device_id
  );
end;
$$;

revoke all on function public.create_direct_app_call(uuid, text) from public;
grant execute on function public.create_direct_app_call(uuid, text) to anon, authenticated;
