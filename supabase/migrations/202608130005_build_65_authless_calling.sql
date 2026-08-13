drop function if exists public.resolve_speak_user(text);
drop table if exists public.app_calls cascade;
drop table if exists public.speak_profiles cascade;

create table public.speak_profiles (
  device_id uuid primary key,
  display_name text not null,
  phone_e164 text unique not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.app_calls (
  id uuid primary key default gen_random_uuid(),
  caller_device_id uuid not null references public.speak_profiles(device_id) on delete cascade,
  recipient_device_id uuid not null references public.speak_profiles(device_id) on delete cascade,
  status text not null check (status in ('ringing', 'active', 'declined', 'ended')),
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  constraint app_calls_distinct_devices check (caller_device_id <> recipient_device_id)
);

create index app_calls_recipient_status_idx on public.app_calls (recipient_device_id, status);

create or replace function public.resolve_speak_device(phone text)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select device_id from public.speak_profiles where phone_e164 = phone limit 1;
$$;

grant execute on function public.resolve_speak_device(text) to anon, authenticated;
alter publication supabase_realtime add table public.app_calls;