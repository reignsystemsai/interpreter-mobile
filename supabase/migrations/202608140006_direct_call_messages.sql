create table if not exists public.app_call_messages (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.app_calls(id) on delete cascade,
  sender_device_id uuid not null references public.speak_profiles(device_id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists app_call_messages_call_created_idx
  on public.app_call_messages(call_id, created_at);

alter table public.app_call_messages enable row level security;
revoke all on table public.app_call_messages from anon, authenticated;

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
      and status in ('ringing', 'active')
  ) then
    raise exception 'Message access denied.';
  end if;

  insert into public.app_call_messages(call_id, sender_device_id, body)
  values (p_call_id, p_sender_device_id, clean_body)
  returning id into message_id;

  return message_id;
end;
$$;

create or replace function public.list_direct_call_messages(
  p_call_id uuid,
  p_device_id uuid
)
returns table (
  id uuid,
  sender_device_id uuid,
  body text,
  created_at timestamptz
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.app_calls
    where app_calls.id = p_call_id
      and (caller_device_id = p_device_id or recipient_device_id = p_device_id)
  ) then
    raise exception 'Message access denied.';
  end if;

  return query
  select message.id, message.sender_device_id, message.body, message.created_at
  from public.app_call_messages message
  where message.call_id = p_call_id
  order by message.created_at asc;
end;
$$;

revoke all on function public.send_direct_call_message(uuid, uuid, text) from public;
revoke all on function public.list_direct_call_messages(uuid, uuid) from public;
grant execute on function public.send_direct_call_message(uuid, uuid, text) to anon, authenticated;
grant execute on function public.list_direct_call_messages(uuid, uuid) to anon, authenticated;
