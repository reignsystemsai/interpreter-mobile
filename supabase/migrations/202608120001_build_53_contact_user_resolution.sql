alter table public.speak_call_sessions
  add column if not exists recipient_user_id uuid references auth.users(id);

drop function if exists public.speak_create_call(text, text, text, text, text, text);

create or replace function public.speak_create_call(
  p_caller_device_id text,
  p_recipient_phone_number text,
  p_recipient_user_id uuid,
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
begin
  if exists (select 1 from public.speak_active_call_devices where device_id = p_caller_device_id) then
    raise exception 'device_already_active' using errcode = 'P0001';
  end if;

  insert into public.speak_call_sessions (
    caller_device_id, recipient_device_id, recipient_phone_number, recipient_user_id,
    caller_language, recipient_language, caller_participant_identity,
    recipient_participant_identity, status
  ) values (
    p_caller_device_id, null, p_recipient_phone_number, p_recipient_user_id,
    p_caller_language, p_recipient_language, p_caller_participant_identity,
    p_recipient_participant_identity, 'ringing'
  ) returning * into v_row;

  insert into public.speak_active_call_devices (device_id, call_id, role)
  values (p_caller_device_id, v_row.id, 'caller');
  return v_row;
end;
$$;

grant execute on function public.speak_create_call(text, text, uuid, text, text, text, text) to service_role;
