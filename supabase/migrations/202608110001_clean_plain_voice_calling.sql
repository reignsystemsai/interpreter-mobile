begin;

-- Remove every previous call-state experiment. Account, profile, contact, and
-- device-registration data deliberately remain intact.
drop function if exists public.speak_transition_call(uuid, text);
drop function if exists public.speak_claim_call_recipient(uuid, text);
drop function if exists public.speak_create_call(text, text, text, text, text, text);
drop table if exists public.speak_active_call_devices cascade;
drop table if exists public.speak_call_sessions cascade;
drop table if exists public.active_calls cascade;

create table public.voice_calls (
  id uuid primary key default gen_random_uuid(),
  room_name text not null unique,
  caller_device_id text not null,
  recipient_device_id text not null,
  caller_phone_e164 text not null check (caller_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  recipient_phone_e164 text not null check (recipient_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  status text not null check (status in ('ringing', 'accepted', 'declined', 'ended', 'failed', 'expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  accepted_at timestamptz,
  ended_at timestamptz,
  check (caller_device_id <> recipient_device_id)
);

create table public.voice_call_devices (
  device_id text primary key,
  call_id uuid not null references public.voice_calls(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index voice_calls_recipient_ringing_idx
  on public.voice_calls(recipient_device_id, created_at desc)
  where status = 'ringing';
create index voice_call_devices_call_idx on public.voice_call_devices(call_id);

alter table public.voice_calls enable row level security;
alter table public.voice_call_devices enable row level security;
revoke all on table public.voice_calls from anon, authenticated, service_role;
revoke all on table public.voice_call_devices from anon, authenticated, service_role;
grant select, insert, update, delete on table public.voice_calls to service_role;
grant select, insert, update, delete on table public.voice_call_devices to service_role;

create or replace function public.voice_start_call(
  p_room_name text,
  p_caller_device_id text,
  p_recipient_device_id text,
  p_caller_phone_e164 text,
  p_recipient_phone_e164 text
) returns public.voice_calls
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.voice_calls;
begin
  update public.voice_calls
     set status = 'expired', ended_at = now(), updated_at = now()
   where (status = 'ringing' and updated_at < now() - interval '60 seconds')
      or (status = 'accepted' and updated_at < now() - interval '30 seconds');

  delete from public.voice_call_devices d
   using public.voice_calls c
   where d.call_id = c.id and c.status in ('declined', 'ended', 'failed', 'expired');

  if exists (
    select 1 from public.voice_call_devices
     where device_id in (p_caller_device_id, p_recipient_device_id)
  ) then
    raise exception 'device_busy' using errcode = 'P0001';
  end if;

  insert into public.voice_calls (
    room_name, caller_device_id, recipient_device_id,
    caller_phone_e164, recipient_phone_e164, status
  ) values (
    p_room_name, p_caller_device_id, p_recipient_device_id,
    p_caller_phone_e164, p_recipient_phone_e164, 'ringing'
  ) returning * into v_row;

  insert into public.voice_call_devices(device_id, call_id)
  values (p_caller_device_id, v_row.id), (p_recipient_device_id, v_row.id);

  return v_row;
exception
  when unique_violation then
    raise exception 'device_busy' using errcode = 'P0001';
end;
$$;

create or replace function public.voice_accept_call(
  p_call_id uuid,
  p_recipient_device_id text
) returns public.voice_calls
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.voice_calls;
begin
  update public.voice_calls
     set status = 'accepted', accepted_at = coalesce(accepted_at, now()), updated_at = now()
   where id = p_call_id
     and recipient_device_id = p_recipient_device_id
     and status = 'ringing'
  returning * into v_row;
  if not found then raise exception 'call_not_available' using errcode = 'P0002'; end if;
  return v_row;
end;
$$;

create or replace function public.voice_finish_call(
  p_call_id uuid,
  p_device_id text,
  p_status text
) returns public.voice_calls
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.voice_calls;
begin
  if p_status not in ('declined', 'ended', 'failed', 'expired') then
    raise exception 'invalid_terminal_status' using errcode = 'P0003';
  end if;
  update public.voice_calls
     set status = p_status, ended_at = coalesce(ended_at, now()), updated_at = now()
   where id = p_call_id
     and p_device_id in (caller_device_id, recipient_device_id)
  returning * into v_row;
  if not found then raise exception 'not_call_participant' using errcode = 'P0004'; end if;
  delete from public.voice_call_devices where call_id = p_call_id;
  return v_row;
end;
$$;

grant execute on function public.voice_start_call(text, text, text, text, text) to service_role;
grant execute on function public.voice_accept_call(uuid, text) to service_role;
grant execute on function public.voice_finish_call(uuid, text, text) to service_role;

commit;
