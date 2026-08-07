begin;

-- Phase 2 call-data foundation for the new Speak shell architecture. Deliberately a
-- separate table from public.active_calls (the existing VoiceCallService/calls.js
-- system, unchanged) rather than an alteration of it: active_calls.recipient_device_id
-- is NOT NULL and resolved via phone-number lookup at call-start, whereas the shell
-- contract requires recipientDeviceId to start null and be claimed atomically on
-- answer. Same security posture as active_calls: RLS enabled, all grants revoked for
-- anon/authenticated, service_role only.

create table public.speak_call_sessions (
  id uuid primary key default gen_random_uuid(),
  caller_device_id text not null,
  recipient_device_id text,
  recipient_phone_number text not null check (recipient_phone_number ~ '^\+[1-9][0-9]{7,14}$'),
  caller_language text not null,
  recipient_language text not null,
  -- Immutable once created. Never regenerated during answer or reconnect.
  caller_participant_identity text not null,
  recipient_participant_identity text not null,
  status text not null check (status in ('idle', 'ringing', 'connecting', 'connected', 'reconnecting', 'ending', 'ended', 'failed')),
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  constraint speak_call_sessions_caller_recipient_distinct check (caller_device_id <> recipient_device_id)
);

create index speak_call_sessions_status_idx on public.speak_call_sessions(status, created_at desc);
create index speak_call_sessions_caller_device_idx on public.speak_call_sessions(caller_device_id, created_at desc);

-- One row per device with an active call. The primary key on device_id is the
-- concurrency authority: a second reservation attempt for the same device fails at
-- the constraint level, not via a "select first" race.
create table public.speak_active_call_devices (
  device_id text primary key,
  call_id uuid not null references public.speak_call_sessions(id) on delete cascade,
  role text not null check (role in ('caller', 'recipient')),
  created_at timestamptz not null default now()
);

create index speak_active_call_devices_call_id_idx on public.speak_active_call_devices(call_id);

alter table public.speak_call_sessions enable row level security;
alter table public.speak_active_call_devices enable row level security;

revoke all on table public.speak_call_sessions from anon, authenticated, service_role;
revoke all on table public.speak_active_call_devices from anon, authenticated, service_role;
grant select, insert, update, delete on table public.speak_call_sessions to service_role;
grant select, insert, update, delete on table public.speak_active_call_devices to service_role;

-- Atomically creates the session row and reserves the caller device. Raises
-- device_already_active if the caller device already owns an active call.
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
begin
  if exists (select 1 from public.speak_active_call_devices where device_id = p_caller_device_id) then
    raise exception 'device_already_active' using errcode = 'P0001';
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

-- Atomically resolves the recipient device. Idempotent for a repeated claim from the
-- same device; raises recipient_already_claimed for a different device attempting to
-- claim an already-claimed call, and device_already_active if the recipient device
-- already owns a different active call.
create or replace function public.speak_claim_call_recipient(
  p_call_id uuid,
  p_recipient_device_id text
) returns public.speak_call_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.speak_call_sessions;
  v_existing_call uuid;
begin
  select * into v_row from public.speak_call_sessions where id = p_call_id for update;
  if not found then
    raise exception 'call_not_found' using errcode = 'P0002';
  end if;

  if v_row.recipient_device_id is not null and v_row.recipient_device_id <> p_recipient_device_id then
    raise exception 'recipient_already_claimed' using errcode = 'P0003';
  end if;

  if v_row.recipient_device_id = p_recipient_device_id then
    return v_row;
  end if;

  select call_id into v_existing_call from public.speak_active_call_devices where device_id = p_recipient_device_id;
  if v_existing_call is not null and v_existing_call <> p_call_id then
    raise exception 'device_already_active' using errcode = 'P0001';
  end if;

  update public.speak_call_sessions
    set recipient_device_id = p_recipient_device_id, status = 'connecting'
    where id = p_call_id
    returning * into v_row;

  insert into public.speak_active_call_devices (device_id, call_id, role)
  values (p_recipient_device_id, p_call_id, 'recipient')
  on conflict (device_id) do nothing;

  return v_row;
end;
$$;

-- Applies a status write atomically and releases both devices' reservations when the
-- new status is terminal. Transition validity (the Phase 2 state machine) is enforced
-- by the calling application layer before this is invoked, not inside this function.
create or replace function public.speak_transition_call(
  p_call_id uuid,
  p_status text
) returns public.speak_call_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.speak_call_sessions;
begin
  select * into v_row from public.speak_call_sessions where id = p_call_id for update;
  if not found then
    raise exception 'call_not_found' using errcode = 'P0002';
  end if;

  update public.speak_call_sessions
    set status = p_status,
        ended_at = case when p_status in ('ended', 'failed') then now() else ended_at end
    where id = p_call_id
    returning * into v_row;

  if p_status in ('ended', 'failed') then
    delete from public.speak_active_call_devices where call_id = p_call_id;
  end if;

  return v_row;
end;
$$;

grant execute on function public.speak_create_call(text, text, text, text, text, text) to service_role;
grant execute on function public.speak_claim_call_recipient(uuid, text) to service_role;
grant execute on function public.speak_transition_call(uuid, text) to service_role;

commit;

-- Rollback (not applied automatically; run manually if this migration must be reverted):
-- begin;
--   drop function if exists public.speak_transition_call(uuid, text);
--   drop function if exists public.speak_claim_call_recipient(uuid, text);
--   drop function if exists public.speak_create_call(text, text, text, text, text, text);
--   drop table if exists public.speak_active_call_devices cascade;
--   drop table if exists public.speak_call_sessions cascade;
-- commit;
