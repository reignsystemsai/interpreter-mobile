create or replace function public.send_direct_call_message(
  p_call_id uuid,
  p_sender_device_id uuid,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  message_id uuid;
  clean_body text := trim(p_body);
begin
  if clean_body is null or char_length(clean_body) = 0 or char_length(clean_body) > 2000 then
    raise exception 'Message must contain between 1 and 2000 characters.';
  end if;

  if not exists (
    select 1
    from public.app_calls
    where id = p_call_id
      and (caller_device_id = p_sender_device_id or recipient_device_id = p_sender_device_id)
      and status in ('ringing', 'active', 'declined', 'ended')
  ) then
    raise exception 'Message access denied.';
  end if;

  insert into public.app_call_messages(call_id, sender_device_id, body)
  values (p_call_id, p_sender_device_id, clean_body)
  returning id into message_id;

  return message_id;
end;
$$;

revoke all on function public.send_direct_call_message(uuid, uuid, text) from public;
grant execute on function public.send_direct_call_message(uuid, uuid, text) to anon, authenticated;
