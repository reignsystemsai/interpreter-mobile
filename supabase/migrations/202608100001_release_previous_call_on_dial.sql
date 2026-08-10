-- A new outbound call is an explicit replacement for any stale call reservation
-- owned by the same device. End that call and release both sides atomically before
-- creating the new session.
create or replace function public.speak_create_call(
  p_caller_device_id text,
  p_recipient_phone_number text,
  p_caller_language text,
  p_recipient_language text,
  p_caller_participant_identity text,
  p_recipient_participant_identity text
) returns public.speak_call_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.speak_call_sessions;
  v_previous_call_id uuid;
begin
  select call_id into v_previous_call_id
    from public.speak_active_call_devices
    where device_id = p_caller_device_id
    for update;

  if v_previous_call_id is not null then
    update public.speak_call_sessions
      set status = 'ended', ended_at = coalesce(ended_at, now())
      where id = v_previous_call_id;
    delete from public.speak_active_call_devices where call_id = v_previous_call_id;
  end if;

  insert into public.speak_call_sessions (
    caller_device_id, recipient_device_id, recipient_phone_number,
    caller_language, recipient_language,
    caller_participant_identity, recipient_participant_identity,
    status
  ) values (
    p_caller_device_id, null, p_recipient_phone_number,
    p_caller_language, p_recipient_language,
    p_caller_participant_identity, p_recipient_participant_identity,
    'ringing'
  ) returning * into v_row;

  insert into public.speak_active_call_devices (device_id, call_id, role)
  values (p_caller_device_id, v_row.id, 'caller');

  return v_row;
end;
$$;

grant execute on function public.speak_create_call(text, text, text, text, text, text) to service_role;
