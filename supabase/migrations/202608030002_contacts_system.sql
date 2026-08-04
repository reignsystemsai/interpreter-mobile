create extension if not exists pgcrypto with schema extensions;

create table if not exists public.interpreter_user_directory (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email_hash text,
  phone_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists interpreter_user_directory_email_idx
  on public.interpreter_user_directory(email_hash) where email_hash is not null;
create index if not exists interpreter_user_directory_phone_idx
  on public.interpreter_user_directory(phone_hash) where phone_hash is not null;

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  identity_hash text not null,
  device_contact_id text,
  display_name text not null check (char_length(display_name) between 1 and 200),
  given_name text check (char_length(given_name) <= 120),
  family_name text check (char_length(family_name) <= 120),
  company text check (char_length(company) <= 200),
  phone_numbers jsonb not null default '[]'::jsonb check (jsonb_typeof(phone_numbers) = 'array'),
  email_addresses jsonb not null default '[]'::jsonb check (jsonb_typeof(email_addresses) = 'array'),
  preferred_language text not null default 'English' check (char_length(preferred_language) between 1 and 80),
  is_favorite boolean not null default false,
  last_called_at timestamptz,
  interpreter_user_id uuid references auth.users(id) on delete set null,
  is_manually_edited boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, identity_hash)
);

create table if not exists public.contact_tombstones (
  owner_id uuid not null references auth.users(id) on delete cascade,
  identity_hash text not null,
  deleted_at timestamptz not null default now(),
  primary key (owner_id, identity_hash)
);

create index if not exists contacts_owner_name_idx on public.contacts(owner_id, lower(display_name));
create index if not exists contacts_owner_favorites_idx on public.contacts(owner_id, is_favorite, lower(display_name));
create index if not exists contacts_owner_recent_idx on public.contacts(owner_id, last_called_at desc) where last_called_at is not null;
create index if not exists contacts_interpreter_user_idx on public.contacts(interpreter_user_id) where interpreter_user_id is not null;

alter table public.interpreter_user_directory enable row level security;
alter table public.contacts enable row level security;
alter table public.contact_tombstones enable row level security;

create policy "Users read own contacts" on public.contacts for select using (auth.uid() = owner_id);
create policy "Users insert own contacts" on public.contacts for insert with check (auth.uid() = owner_id);
create policy "Users update own contacts" on public.contacts for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "Users delete own contacts" on public.contacts for delete using (auth.uid() = owner_id);
create policy "Users read own contact tombstones" on public.contact_tombstones for select using (auth.uid() = owner_id);
create policy "Users insert own contact tombstones" on public.contact_tombstones for insert with check (auth.uid() = owner_id);
create policy "Users delete own contact tombstones" on public.contact_tombstones for delete using (auth.uid() = owner_id);

create or replace function public.sync_interpreter_directory_user()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into public.interpreter_user_directory (user_id, email_hash, updated_at)
  values (
    new.id,
    case when new.email is null then null else encode(digest(lower(trim(new.email)), 'sha256'), 'hex') end,
    now()
  )
  on conflict (user_id) do update set email_hash = excluded.email_hash, updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_interpreter_directory_user_changed on auth.users;
create trigger on_interpreter_directory_user_changed
after insert or update of email on auth.users
for each row execute procedure public.sync_interpreter_directory_user();

create or replace function public.sync_interpreter_directory_phone()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into public.interpreter_user_directory (user_id, phone_hash, updated_at)
  values (
    new.id,
    case
      when nullif(regexp_replace(coalesce(new.phone, ''), '[^0-9]', '', 'g'), '') is null then null
      else encode(digest(regexp_replace(new.phone, '[^0-9]', '', 'g'), 'sha256'), 'hex')
    end,
    now()
  )
  on conflict (user_id) do update set phone_hash = excluded.phone_hash, updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_interpreter_directory_profile_changed on public.profiles;
create trigger on_interpreter_directory_profile_changed
after insert or update of phone on public.profiles
for each row execute procedure public.sync_interpreter_directory_phone();

create or replace function public.set_contact_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_contact_updated on public.contacts;
create trigger on_contact_updated before update on public.contacts
for each row execute procedure public.set_contact_updated_at();

insert into public.interpreter_user_directory (user_id, email_hash, phone_hash)
select
  users.id,
  case when users.email is null then null else encode(extensions.digest(lower(trim(users.email)), 'sha256'), 'hex') end,
  case
    when nullif(regexp_replace(coalesce(profiles.phone, ''), '[^0-9]', '', 'g'), '') is null then null
    else encode(extensions.digest(regexp_replace(profiles.phone, '[^0-9]', '', 'g'), 'sha256'), 'hex')
  end
from auth.users as users
left join public.profiles as profiles on profiles.id = users.id
on conflict (user_id) do update
set email_hash = excluded.email_hash, phone_hash = excluded.phone_hash, updated_at = now();

revoke all on table public.interpreter_user_directory from anon, authenticated;
revoke all on table public.interpreter_user_directory from service_role;
grant select on table public.interpreter_user_directory to service_role;
revoke all on table public.contacts from anon, authenticated;
revoke all on table public.contacts from service_role;
grant select, insert, update, delete on table public.contacts to service_role;
revoke all on table public.contact_tombstones from anon, authenticated;
revoke all on table public.contact_tombstones from service_role;
grant select, insert on table public.contact_tombstones to service_role;
