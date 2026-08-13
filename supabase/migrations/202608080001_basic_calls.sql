-- Minimal basic-calling schema. Deliberately named distinctly from any prior
-- calling schema (calls / active_calls / speak_call_sessions) to avoid any
-- collision with orphaned objects those earlier, now-deleted migrations may
-- have already created live.

create table if not exists public.basic_calls (
  id uuid primary key default gen_random_uuid(),
  caller_device_id text not null,
  recipient_device_id text,
  caller_phone_e164 text not null,
  recipient_phone_e164 text not null,
  status text not null default 'ringing' check (status in ('ringing', 'connected', 'ended')),
  room_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz
);

create index if not exists basic_calls_recipient_phone_status_idx on public.basic_calls(recipient_phone_e164, status);
create index if not exists basic_calls_caller_device_status_idx on public.basic_calls(caller_device_id, status);

alter table public.basic_calls enable row level security;
revoke all on table public.basic_calls from anon, authenticated;
grant select, insert, update on table public.basic_calls to service_role;

-- One active (non-ended) call per caller device at a time. The row's id is
-- generated here (not left to the column default) so room_name can be derived
-- from it deterministically in the same statement — the app never has to
-- guess or reconcile a room name against the id afterward.
create or replace function public.basic_call_create(
  p_caller_device_id text,
  p_caller_phone text,
  p_recipient_phone text
) returns public.basic_calls
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.basic_calls;
  v_id uuid := gen_random_uuid();
begin
  if exists (
    select 1 from public.basic_calls
    where caller_device_id = p_caller_device_id and status <> 'ended'
  ) then
    raise exception 'device_already_active' using errcode = 'P0001';
  end if;

  insert into public.basic_calls (id, caller_device_id, caller_phone_e164, recipient_phone_e164, room_name)
  values (v_id, p_caller_device_id, p_caller_phone, p_recipient_phone, 'basic-' || v_id::text)
  returning * into v_row;

  return v_row;
end;
$$;

-- Atomic claim: only succeeds once, only from 'ringing' with no recipient yet.
create or replace function public.basic_call_accept(
  p_call_id uuid,
  p_recipient_device_id text
) returns public.basic_calls
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.basic_calls;
begin
  update public.basic_calls
  set recipient_device_id = p_recipient_device_id,
      status = 'connected',
      updated_at = now()
  where id = p_call_id
    and status = 'ringing'
    and recipient_device_id is null
  returning * into v_row;

  if v_row.id is null then
    raise exception 'invalid_call_state' using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

-- Idempotent terminal transition. Safe to call twice, or from either side.
create or replace function public.basic_call_end(
  p_call_id uuid
) returns public.basic_calls
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.basic_calls;
begin
  select * into v_row from public.basic_calls where id = p_call_id;
  if v_row.id is null then
    raise exception 'call_not_found' using errcode = 'P0003';
  end if;

  if v_row.status <> 'ended' then
    update public.basic_calls
    set status = 'ended', ended_at = now(), updated_at = now()
    where id = p_call_id
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

revoke execute on function public.basic_call_create(text, text, text) from public, anon, authenticated;
revoke execute on function public.basic_call_accept(uuid, text) from public, anon, authenticated;
revoke execute on function public.basic_call_end(uuid) from public, anon, authenticated;
grant execute on function public.basic_call_create(text, text, text) to service_role;
grant execute on function public.basic_call_accept(uuid, text) to service_role;
grant execute on function public.basic_call_end(uuid) to service_role;
