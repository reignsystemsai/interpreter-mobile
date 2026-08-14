create or replace function public.get_direct_call_remote_profile(
  p_call_id uuid,
  p_device_id uuid
)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select jsonb_build_object(
    'display_name', profile.display_name,
    'phone_e164', profile.phone_e164
  )
  from public.app_calls call_record
  join public.speak_profiles profile
    on profile.device_id = case
      when call_record.caller_device_id = p_device_id then call_record.recipient_device_id
      when call_record.recipient_device_id = p_device_id then call_record.caller_device_id
      else null
    end
  where call_record.id = p_call_id
    and (call_record.caller_device_id = p_device_id or call_record.recipient_device_id = p_device_id)
  limit 1;
$$;

revoke all on function public.get_direct_call_remote_profile(uuid, uuid) from public;
grant execute on function public.get_direct_call_remote_profile(uuid, uuid) to anon, authenticated;
