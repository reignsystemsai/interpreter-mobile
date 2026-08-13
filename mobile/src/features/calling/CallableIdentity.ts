import * as SecureStore from 'expo-secure-store';
import { parsePhoneNumberFromString } from 'libphonenumber-js';

import { supabase } from '../../services/supabase';

const DEVICE_ID_KEY = 'interpreter.calling.device_id';
const SETUP_COMPLETE_KEY = 'interpreter.calling.setup_complete';
const DISPLAY_NAME_KEY = 'interpreter.calling.display_name';
const PHONE_E164_KEY = 'interpreter.calling.phone_e164';

export function normalizePhone(phone: string) {
  const parsed = parsePhoneNumberFromString(phone);
  if (!parsed || !parsed.isValid()) throw new Error('Enter a valid phone number with country code.');
  return parsed.number;
}

export async function getCallableIdentity() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const { data, error } = await supabase.from('speak_profiles').select('user_id').eq('user_id', session.user.id).maybeSingle();
  if (error) throw error;
  return data ? { phoneE164: '', userId: session.user.id } : null;
}

export async function getLocalCallableIdentity() {
  const [deviceId, displayName, phoneE164, complete] = await Promise.all([
    SecureStore.getItemAsync(DEVICE_ID_KEY),
    SecureStore.getItemAsync(DISPLAY_NAME_KEY),
    SecureStore.getItemAsync(PHONE_E164_KEY),
    SecureStore.getItemAsync(SETUP_COMPLETE_KEY),
  ]);
  if (complete !== 'true' || !deviceId || !displayName || !phoneE164) return null;
  return { deviceId, displayName, phoneE164 };
}

export async function createCallableIdentity(displayName: string, phone: string) {
  const normalizedName = displayName.trim();
  if (!normalizedName) throw new Error('Enter your name.');
  const phoneE164 = normalizePhone(phone);
  const existingDeviceId = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  const deviceId = existingDeviceId ?? crypto.randomUUID();
  await Promise.all([
    SecureStore.setItemAsync(DEVICE_ID_KEY, deviceId),
    SecureStore.setItemAsync(DISPLAY_NAME_KEY, normalizedName),
    SecureStore.setItemAsync(PHONE_E164_KEY, phoneE164),
    SecureStore.setItemAsync(SETUP_COMPLETE_KEY, 'true'),
  ]);
  return { deviceId, displayName: normalizedName, phoneE164 };
}

export async function ensureCallableIdentity() {
  const localIdentity = await getLocalCallableIdentity();
  if (!localIdentity) throw new Error('CALL PROFILE\nCalling setup is required.');
  const { data, error } = await supabase.functions.invoke('register-calling-device', {
    body: {
      device_id: localIdentity.deviceId,
      display_name: localIdentity.displayName,
      phone_e164: localIdentity.phoneE164,
    },
  });
  if (error || !data?.device_id) throw new Error('CALL PROFILE\nUnable to save the calling profile.');
  return localIdentity;
}