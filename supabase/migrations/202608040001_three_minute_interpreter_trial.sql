create table if not exists public.interpreter_minute_cycles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan_id text not null default 'free' check (plan_id in ('free', 'pro', 'unlimited')),
  cycle_started_at timestamptz not null,
  cycle_renews_at timestamptz not null,
  included_seconds integer not null check (included_seconds >= 0),
  used_seconds integer not null default 0 check (used_seconds >= 0),
  remaining_seconds integer not null check (remaining_seconds >= 0),
  updated_at timestamptz not null default now(),
  check (cycle_renews_at > cycle_started_at),
  check (used_seconds + remaining_seconds = included_seconds)
);

create table if not exists public.interpreter_minute_credits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  purchased_seconds integer not null default 0 check (purchased_seconds >= 0),
  used_seconds integer not null default 0 check (used_seconds >= 0),
  updated_at timestamptz not null default now(),
  check (used_seconds <= purchased_seconds)
);

alter table public.interpreter_minute_cycles enable row level security;
alter table public.interpreter_minute_credits enable row level security;

create policy "Users read own Interpreter minute cycle" on public.interpreter_minute_cycles
for select using (auth.uid() = user_id);

create policy "Users read own Interpreter minute credits" on public.interpreter_minute_credits
for select using (auth.uid() = user_id);

create or replace function public.get_or_renew_interpreter_allowance(p_user_id uuid)
returns table (
  plan_id text,
  cycle_started_at timestamptz,
  cycle_renews_at timestamptz,
  included_seconds integer,
  used_seconds integer,
  remaining_seconds integer,
  purchased_seconds integer,
  purchased_remaining_seconds integer,
  total_remaining_seconds integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_plan text;
  selected_included integer;
  entitlement_renews_at timestamptz;
  existing_cycle public.interpreter_minute_cycles%rowtype;
  next_started_at timestamptz;
  next_renews_at timestamptz;
  elapsed_cycles integer;
  credit_purchased integer := 0;
  credit_used integer := 0;
begin
  select coalesce(e.plan_id, 'free'), e.expires_at
  into selected_plan, entitlement_renews_at
  from (select p_user_id as user_id) u
  left join public.subscription_entitlements e on e.user_id = u.user_id
    and e.status in ('active', 'trialing', 'grace_period')
    and e.plan_id in ('pro', 'unlimited')
    and (e.expires_at is null or e.expires_at > now());

  selected_included := case selected_plan when 'pro' then 30000 when 'unlimited' then 120000 else 180 end;
  select * into existing_cycle from public.interpreter_minute_cycles where user_id = p_user_id for update;

  if existing_cycle.user_id is null or existing_cycle.plan_id <> selected_plan then
    if selected_plan = 'free' then
      next_started_at := now();
      next_renews_at := now() + interval '30 days';
    else
      next_renews_at := coalesce(entitlement_renews_at, now() + interval '1 month');
      next_started_at := least(now(), next_renews_at - interval '1 month');
    end if;
    insert into public.interpreter_minute_cycles (
      user_id, plan_id, cycle_started_at, cycle_renews_at,
      included_seconds, used_seconds, remaining_seconds, updated_at
    ) values (
      p_user_id, selected_plan, next_started_at, next_renews_at,
      selected_included, 0, selected_included, now()
    ) on conflict (user_id) do update set
      plan_id = excluded.plan_id,
      cycle_started_at = excluded.cycle_started_at,
      cycle_renews_at = excluded.cycle_renews_at,
      included_seconds = excluded.included_seconds,
      used_seconds = 0,
      remaining_seconds = excluded.remaining_seconds,
      updated_at = now();
  elsif now() >= existing_cycle.cycle_renews_at then
    if selected_plan = 'free' then
      elapsed_cycles := greatest(1, floor(extract(epoch from (now() - existing_cycle.cycle_started_at)) / 2592000)::integer);
      next_started_at := existing_cycle.cycle_started_at + elapsed_cycles * interval '30 days';
      next_renews_at := next_started_at + interval '30 days';
    else
      next_started_at := existing_cycle.cycle_renews_at;
      next_renews_at := coalesce(entitlement_renews_at, next_started_at + interval '1 month');
      if next_renews_at <= next_started_at then next_renews_at := next_started_at + interval '1 month'; end if;
    end if;
    update public.interpreter_minute_cycles set
      cycle_started_at = next_started_at,
      cycle_renews_at = next_renews_at,
      included_seconds = selected_included,
      used_seconds = 0,
      remaining_seconds = selected_included,
      updated_at = now()
    where user_id = p_user_id;
  end if;

  select coalesce(c.purchased_seconds, 0), coalesce(c.used_seconds, 0)
  into credit_purchased, credit_used
  from (select p_user_id as user_id) u
  left join public.interpreter_minute_credits c on c.user_id = u.user_id;

  return query
  select c.plan_id, c.cycle_started_at, c.cycle_renews_at, c.included_seconds,
    c.used_seconds, c.remaining_seconds, credit_purchased,
    greatest(0, credit_purchased - credit_used),
    c.remaining_seconds + greatest(0, credit_purchased - credit_used)
  from public.interpreter_minute_cycles c where c.user_id = p_user_id;
end;
$$;

create or replace function public.record_interpreted_usage(
  p_call_id uuid,
  p_user_id uuid,
  p_total_seconds integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_seconds integer;
  delta_seconds integer;
  included_charge integer;
  credit_charge integer;
  cycle_row public.interpreter_minute_cycles%rowtype;
  credit_remaining integer;
begin
  if p_total_seconds < 0 or not exists (
    select 1 from public.calls where id = p_call_id and p_user_id in (caller_id, callee_id)
  ) then
    raise exception using message = 'invalid_interpreted_usage', errcode = 'P0001';
  end if;

  perform public.get_or_renew_interpreter_allowance(p_user_id);
  select * into cycle_row from public.interpreter_minute_cycles where user_id = p_user_id for update;

  insert into public.call_usage_charges (call_id, user_id, seconds_charged)
  values (p_call_id, p_user_id, 0) on conflict (call_id, user_id) do nothing;
  select seconds_charged into previous_seconds from public.call_usage_charges
  where call_id = p_call_id and user_id = p_user_id for update;

  delta_seconds := greatest(0, p_total_seconds - previous_seconds);
  included_charge := least(delta_seconds, cycle_row.remaining_seconds);
  select greatest(0, purchased_seconds - used_seconds) into credit_remaining
  from public.interpreter_minute_credits where user_id = p_user_id for update;
  credit_remaining := coalesce(credit_remaining, 0);
  credit_charge := least(delta_seconds - included_charge, credit_remaining);
  delta_seconds := included_charge + credit_charge;
  if delta_seconds = 0 then return 0; end if;

  update public.interpreter_minute_cycles set
    used_seconds = used_seconds + included_charge,
    remaining_seconds = remaining_seconds - included_charge,
    updated_at = now()
  where user_id = p_user_id;

  if credit_charge > 0 then
    update public.interpreter_minute_credits set used_seconds = used_seconds + credit_charge, updated_at = now()
    where user_id = p_user_id;
  end if;

  update public.call_usage_charges set seconds_charged = previous_seconds + delta_seconds, updated_at = now()
  where call_id = p_call_id and user_id = p_user_id;
  return delta_seconds;
end;
$$;

revoke all on table public.interpreter_minute_cycles from anon, authenticated, service_role;
revoke all on table public.interpreter_minute_credits from anon, authenticated, service_role;
revoke all on function public.get_or_renew_interpreter_allowance(uuid) from public;
revoke all on function public.record_interpreted_usage(uuid, uuid, integer) from public;
grant select, insert, update on table public.interpreter_minute_cycles to service_role;
grant select, insert, update on table public.interpreter_minute_credits to service_role;
grant execute on function public.get_or_renew_interpreter_allowance(uuid) to service_role;
grant execute on function public.record_interpreted_usage(uuid, uuid, integer) to service_role;
