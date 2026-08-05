begin;

drop table if exists public.call_interpretation_metrics cascade;
drop table if exists public.call_usage_charges cascade;
drop table if exists public.call_events cascade;
drop table if exists public.user_presence cascade;
drop table if exists public.calls cascade;
drop trigger if exists on_interpreter_presence_user_created on auth.users;
drop function if exists public.reserve_interpreter_call(uuid, text, uuid, uuid, uuid, text);
drop function if exists public.finalize_interpreter_call();
drop function if exists public.ensure_interpreter_presence();

drop table if exists public.active_calls cascade;
drop table if exists public.device_installations cascade;

create table public.device_installations (
  id uuid primary key default gen_random_uuid(),
  device_id text not null,
  phone_number_e164 text not null check (phone_number_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  platform text not null check (platform in ('ios', 'android')),
  push_token text,
  enabled boolean not null default true,
  app_version text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint device_installations_device_id_key unique (device_id)
);

create index device_installations_phone_number_e164_idx on public.device_installations(phone_number_e164);
create index device_installations_enabled_idx on public.device_installations(enabled);

create table public.active_calls (
  id uuid primary key default gen_random_uuid(),
  room_name text not null unique,
  caller_device_id text not null,
  recipient_device_id text not null,
  caller_phone_e164 text not null check (caller_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  recipient_phone_e164 text not null check (recipient_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  status text not null check (status in ('calling', 'ringing', 'accepted', 'declined', 'ended', 'failed', 'expired')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  ended_at timestamptz,
  check (caller_device_id <> recipient_device_id)
);

create index active_calls_caller_device_idx on public.active_calls(caller_device_id, created_at desc);
create index active_calls_recipient_device_idx on public.active_calls(recipient_device_id, created_at desc);
create index active_calls_open_status_idx on public.active_calls(status, created_at desc)
  where status in ('calling', 'ringing', 'accepted');

alter table public.device_installations enable row level security;
alter table public.active_calls enable row level security;

revoke all on table public.device_installations from anon, authenticated, service_role;
revoke all on table public.active_calls from anon, authenticated, service_role;
grant select, insert, update, delete on table public.device_installations to service_role;
grant select, insert, update, delete on table public.active_calls to service_role;

commit;
