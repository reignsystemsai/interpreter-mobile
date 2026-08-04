do $$
begin
  if to_regclass('public.device_installations') is not null then
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'device_installations' and column_name = 'installation_id')
      and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'device_installations' and column_name = 'device_id') then
      alter table public.device_installations rename column installation_id to device_id;
    end if;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'device_installations' and column_name = 'phone_e164')
      and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'device_installations' and column_name = 'phone_number_e164') then
      alter table public.device_installations rename column phone_e164 to phone_number_e164;
    end if;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'device_installations' and column_name = 'expo_push_token')
      and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'device_installations' and column_name = 'push_token') then
      alter table public.device_installations rename column expo_push_token to push_token;
    end if;
  end if;
end $$;

create table if not exists public.device_installations (
  id uuid primary key default gen_random_uuid(),
  device_id text not null unique,
  phone_number_e164 text not null,
  platform text not null,
  push_token text,
  enabled boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.device_installations add column if not exists id uuid default gen_random_uuid();
alter table public.device_installations add column if not exists enabled boolean not null default true;
alter table public.device_installations drop column if exists user_id;
alter table public.device_installations alter column id set not null;

do $$
begin
  if exists (select 1 from pg_constraint where conrelid = 'public.device_installations'::regclass and contype = 'p' and conname = 'device_installations_pkey') then
    alter table public.device_installations drop constraint device_installations_pkey;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.device_installations'::regclass and contype = 'p') then
    alter table public.device_installations add constraint device_installations_pkey primary key (id);
  end if;
end $$;

create unique index if not exists device_installations_device_id_idx on public.device_installations(device_id);
create index if not exists device_installations_phone_enabled_idx on public.device_installations(phone_number_e164, enabled, last_seen_at desc);

alter table public.device_installations enable row level security;
revoke all on table public.device_installations from anon, authenticated;
grant select, insert, update, delete on table public.device_installations to service_role;
