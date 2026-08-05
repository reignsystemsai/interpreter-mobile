begin;

alter table public.active_calls
  add column if not exists call_type text not null default 'voice';

alter table public.active_calls
  drop constraint if exists active_calls_call_type_check;

alter table public.active_calls
  add constraint active_calls_call_type_check
  check (call_type in ('voice', 'video'));

commit;
