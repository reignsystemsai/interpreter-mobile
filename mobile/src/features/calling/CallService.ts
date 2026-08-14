async createCall(phone: string, remoteLabel: string) {
  const identity = await ensureCallableIdentity();
  const phoneE164 = normalizePhone(phone);

  const { data, error } = await supabase.rpc('create_direct_app_call', {
    p_caller_device_id: identity.deviceId,
    p_recipient_phone_e164: phoneE164,
  });

  if (error || !data?.call_id) {
    throw new Error(
      `CALL CREATE\n${error?.message || 'The call could not be started.'}`
    );
  }

  this.set({
    callId: data.call_id,
    remoteLabel,
    role: 'caller',
    status: 'ringing',
  });

  InCallManager.start({ media: 'audio' });
  InCallManager.startRingback('_DEFAULT_');

  await this.connectSpeakRoom(
    data.call_id,
    'caller',
    remoteLabel
  );
}