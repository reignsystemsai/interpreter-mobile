grant select, insert, update on table public.basic_calls to authenticated;

create policy "Authenticated users can create calls for their own normalized phone"
on public.basic_calls for insert
with check (
  auth.uid() is not null
  and exists (
    select 1
    from public.profiles as p
    where p.id = auth.uid()
      and regexp_replace(coalesce(p.phone, ''), '[^0-9]', '', 'g')
          = regexp_replace(coalesce(caller_phone_e164, ''), '[^0-9]', '', 'g')
  )
);

create policy "Authenticated users can read calls for their normalized phone"
on public.basic_calls for select
using (
  auth.uid() is not null
  and (
    exists (
      select 1
      from public.profiles as p
      where p.id = auth.uid()
        and regexp_replace(coalesce(p.phone, ''), '[^0-9]', '', 'g')
            = regexp_replace(coalesce(caller_phone_e164, ''), '[^0-9]', '', 'g')
    )
    or exists (
      select 1
      from public.profiles as p
      where p.id = auth.uid()
        and regexp_replace(coalesce(p.phone, ''), '[^0-9]', '', 'g')
            = regexp_replace(coalesce(recipient_phone_e164, ''), '[^0-9]', '', 'g')
    )
  )
);

create policy "Authenticated users can update their own call state"
on public.basic_calls for update
using (
  auth.uid() is not null
  and (
    exists (
      select 1
      from public.profiles as p
      where p.id = auth.uid()
        and regexp_replace(coalesce(p.phone, ''), '[^0-9]', '', 'g')
            = regexp_replace(coalesce(caller_phone_e164, ''), '[^0-9]', '', 'g')
    )
    or exists (
      select 1
      from public.profiles as p
      where p.id = auth.uid()
        and regexp_replace(coalesce(p.phone, ''), '[^0-9]', '', 'g')
            = regexp_replace(coalesce(recipient_phone_e164, ''), '[^0-9]', '', 'g')
    )
  )
)
with check (
  auth.uid() is not null
  and (
    exists (
      select 1
      from public.profiles as p
      where p.id = auth.uid()
        and regexp_replace(coalesce(p.phone, ''), '[^0-9]', '', 'g')
            = regexp_replace(coalesce(caller_phone_e164, ''), '[^0-9]', '', 'g')
    )
    or exists (
      select 1
      from public.profiles as p
      where p.id = auth.uid()
        and regexp_replace(coalesce(p.phone, ''), '[^0-9]', '', 'g')
            = regexp_replace(coalesce(recipient_phone_e164, ''), '[^0-9]', '', 'g')
    )
  )
);
