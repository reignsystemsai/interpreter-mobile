create table public.speak_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 120),
  phone_e164 text not null unique check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.app_calls (
  id uuid primary key default gen_random_uuid(),
  caller_user_id uuid not null references auth.users(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'ringing' check (status in ('ringing', 'connected', 'ended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz
);

create index app_calls_recipient_status_idx on public.app_calls(recipient_user_id, status, created_at desc);

create function public.resolve_speak_user(phone_e164 text)
returns uuid language sql stable security definer set search_path = public as $$
  select user_id from public.speak_profiles where phone_e164 = resolve_speak_user.phone_e164
$$;

alter table public.speak_profiles enable row level security;
alter table public.app_calls enable row level security;

create policy "Users manage own speak profile" on public.speak_profiles for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Call participants select calls" on public.app_calls for select to authenticated using (auth.uid() in (caller_user_id, recipient_user_id));
create policy "Callers create calls" on public.app_calls for insert to authenticated with check (caller_user_id = auth.uid());
create policy "Call participants update calls" on public.app_calls for update to authenticated using (auth.uid() in (caller_user_id, recipient_user_id)) with check (auth.uid() in (caller_user_id, recipient_user_id));

grant execute on function public.resolve_speak_user(text) to authenticated;