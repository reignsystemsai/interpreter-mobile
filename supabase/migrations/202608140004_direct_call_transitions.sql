create or replace function public.answer_direct_app_call(
  p_call_id uuid,
  p_recipient_device_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  current_status text;
begin
  update public.app_calls
  set status = 'active',
      answered_at = coalesce(answered_at, now())
  where id = p_call_id
    and recipient_device_id = p_recipient_device_id
    and status = 'ringing'
  returning status into current_status;

  if current_status = 'active' then
    return current_status;
  end if;

  select status into current_status
  from public.app_calls
  where id = p_call_id
    and recipient_device_id = p_recipient_device_id;

  if current_status = 'active' then
    return current_status;
  end if;

  raise exception 'Call cannot be answered.';
end;
$$;

create or replace function public.finish_direct_app_call(
  p_call_id uuid,
  p_device_id uuid,
  p_final_status text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  current_status text;
begin
  if p_final_status not in ('declined', 'ended') then
    raise exception 'Invalid final call status.';
  end if;

  update public.app_calls
  set status = p_final_status,
      ended_at = coalesce(ended_at, now())
  where id = p_call_id
    and (caller_device_id = p_device_id or recipient_device_id = p_device_id)
    and status not in ('declined', 'ended')
  returning status into current_status;

  if current_status is not null then
    return current_status;
  end if;

  select status into current_status
  from public.app_calls
  where id = p_call_id
    and (caller_device_id = p_device_id or recipient_device_id = p_device_id);

  if current_status in ('declined', 'ended') then
    return current_status;
  end if;

  raise exception 'Call cannot be ended.';
end;
$$;

revoke all on function public.answer_direct_app_call(uuid, uuid) from public;
revoke all on function public.finish_direct_app_call(uuid, uuid, text) from public;
grant execute on function public.answer_direct_app_call(uuid, uuid) to anon, authenticated;
grant execute on function public.finish_direct_app_call(uuid, uuid, text) to anon, authenticated;
