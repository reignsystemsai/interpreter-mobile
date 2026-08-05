begin;

alter table public.active_calls
  add column translation_enabled boolean not null default false,
  add column caller_language_code text not null default 'en',
  add column recipient_language_code text not null default 'es';

alter table public.active_calls
  add constraint active_calls_caller_language_code_check
    check (caller_language_code in ('en', 'es', 'pt', 'fr', 'ja', 'ru', 'zh', 'de', 'ko', 'hi', 'id', 'vi', 'it')),
  add constraint active_calls_recipient_language_code_check
    check (recipient_language_code in ('en', 'es', 'pt', 'fr', 'ja', 'ru', 'zh', 'de', 'ko', 'hi', 'id', 'vi', 'it'));

commit;
