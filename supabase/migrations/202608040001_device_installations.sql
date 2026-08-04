create table if not exists public.device_installations (
  installation_id text primary key check (char_length(installation_id) between 16 and 120),
  user_id uuid not null references auth.users(id) on delete cascade,
  phone_e164 text not null unique check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  expo_push_token text,
  platform text not null check (platform in ('android', 'ios')),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists device_installations_user_id_idx on public.device_installations(user_id);
create index if not exists device_installations_last_seen_idx on public.device_installations(last_seen_at desc);

alter table public.device_installations enable row level security;
revoke all on table public.device_installations from anon, authenticated, service_role;
grant select, insert, update, delete on table public.device_installations to service_role;
