create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text check (char_length(full_name) <= 120),
  phone text check (char_length(phone) <= 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subscription_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan_id text not null default 'free' check (plan_id in ('free', 'pro', 'unlimited')),
  product_id text,
  status text not null default 'active' check (status in ('active', 'inactive', 'trialing', 'grace_period')),
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.subscription_events (
  event_id text primary key,
  event_type text not null,
  user_id uuid references auth.users(id) on delete set null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now()
);

create table if not exists public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  membership boolean not null default true,
  product_updates boolean not null default true,
  new_languages boolean not null default true,
  service_alerts boolean not null default true,
  marketing boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.push_devices (
  token text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('android', 'ios')),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.usage_periods (
  user_id uuid not null references auth.users(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  plan_id text not null check (plan_id in ('free', 'pro', 'unlimited')),
  seconds_used integer not null default 0 check (seconds_used >= 0),
  rollover_seconds integer not null default 0 check (rollover_seconds >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, period_start)
);

create index if not exists subscription_events_user_id_idx on public.subscription_events(user_id, occurred_at desc);
create index if not exists push_devices_user_id_idx on public.push_devices(user_id);
create index if not exists usage_periods_active_idx on public.usage_periods(user_id, period_end desc);

alter table public.profiles enable row level security;
alter table public.subscription_entitlements enable row level security;
alter table public.subscription_events enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.push_devices enable row level security;
alter table public.usage_periods enable row level security;

create policy "Users read own profile" on public.profiles for select using (auth.uid() = id);
create policy "Users update own profile" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
create policy "Users read own entitlement" on public.subscription_entitlements for select using (auth.uid() = user_id);
create policy "Users read own notification preferences" on public.notification_preferences for select using (auth.uid() = user_id);
create policy "Users update own notification preferences" on public.notification_preferences for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users read own usage" on public.usage_periods for select using (auth.uid() = user_id);

create or replace function public.handle_new_interpreter_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name) values (new.id, new.raw_user_meta_data ->> 'full_name');
  insert into public.subscription_entitlements (user_id) values (new.id);
  insert into public.notification_preferences (user_id) values (new.id);
  return new;
end;
$$;

drop trigger if exists on_interpreter_user_created on auth.users;
create trigger on_interpreter_user_created after insert on auth.users
for each row execute procedure public.handle_new_interpreter_user();
