import * as SecureStore from 'expo-secure-store';
import { parsePhoneNumberFromString } from 'libphonenumber-js';

import { supabase } from '../../services/supabase';

const DEVICE_ID_KEY = 'interpreter.calling.device_id';
const SETUP_COMPLETE_KEY = 'interpreter.calling.setup_complete';
const DISPLAY_NAME_KEY = 'interpreter.calling.display_name';
const PHONE_E164_KEY = 'interpreter.calling.phone_e164';
let registeredDeviceId: string | null = null;

export function normalizePhone(phone: string) {
  const parsed = parsePhoneNumberFromString(phone);
  if (!parsed || !parsed.isValid()) throw new Error('Enter a valid phone number with country code.');
  return parsed.number;
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
  if (registeredDeviceId === localIdentity.deviceId) return localIdentity;
  const { data, error } = await supabase.rpc('register_calling_profile', {
    p_device_id: localIdentity.deviceId,
    p_display_name: localIdentity.displayName,
    p_phone_e164: localIdentity.phoneE164,
  });
  if (error || data !== localIdentity.deviceId) throw new Error('CALL PROFILE\nUnable to save the calling profile.');
  registeredDeviceId = localIdentity.deviceId;
  return localIdentity;
}
