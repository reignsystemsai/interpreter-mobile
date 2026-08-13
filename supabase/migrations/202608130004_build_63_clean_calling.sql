create table public.speak_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  phone_e164 text unique not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.app_calls (
  id uuid primary key default gen_random_uuid(),
  caller_user_id uuid not null references auth.users(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('ringing', 'active', 'declined', 'ended')),
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  constraint app_calls_distinct_participants check (caller_user_id <> recipient_user_id)
);

create index app_calls_recipient_status_idx on public.app_calls (recipient_user_id, status);

create or replace function public.resolve_speak_user(phone text)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select user_id from public.speak_profiles where phone_e164 = phone limit 1;
$$;

alter table public.speak_profiles enable row level security;
alter table public.app_calls enable row level security;

create policy speak_profiles_select_own on public.speak_profiles
  for select to authenticated using (auth.uid() = user_id);

create policy speak_profiles_insert_own on public.speak_profiles
  for insert to authenticated with check (auth.uid() = user_id);

create policy speak_profiles_update_own on public.speak_profiles
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy app_calls_select_participant on public.app_calls
  for select to authenticated using (auth.uid() = caller_user_id or auth.uid() = recipient_user_id);

create policy app_calls_insert_caller on public.app_calls
  for insert to authenticated with check (auth.uid() = caller_user_id);

create policy app_calls_update_participant on public.app_calls
  for update to authenticated
  using (auth.uid() = caller_user_id or auth.uid() = recipient_user_id)
  with check (auth.uid() = caller_user_id or auth.uid() = recipient_user_id);

grant execute on function public.resolve_speak_user(text) to authenticated;
alter publication supabase_realtime add table public.app_calls;