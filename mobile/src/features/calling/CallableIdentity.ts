import * as SecureStore from 'expo-secure-store';
import { parsePhoneNumberFromString } from 'libphonenumber-js';

import { supabase } from '../../services/supabase';

const DEVICE_ID_KEY = 'interpreter.calling.device_id';
const SETUP_COMPLETE_KEY = 'interpreter.calling.setup_complete';
const DISPLAY_NAME_KEY = 'interpreter.calling.display_name';
const FIRST_NAME_KEY = 'interpreter.calling.first_name';
const LAST_NAME_KEY = 'interpreter.calling.last_name';
const PHONE_E164_KEY = 'interpreter.calling.phone_e164';
const EMAIL_KEY = 'interpreter.calling.email';
let registeredDeviceId: string | null = null;

export function normalizePhone(phone: string) {
  const parsed = parsePhoneNumberFromString(phone);
  if (!parsed || !parsed.isValid()) throw new Error('Enter a valid phone number with country code.');
  return parsed.number;
}

export async function getLocalCallableIdentity() {
  const [deviceId, displayName, firstName, lastName, phoneE164, email, complete] = await Promise.all([
    SecureStore.getItemAsync(DEVICE_ID_KEY),
    SecureStore.getItemAsync(DISPLAY_NAME_KEY),
    SecureStore.getItemAsync(FIRST_NAME_KEY),
    SecureStore.getItemAsync(LAST_NAME_KEY),
    SecureStore.getItemAsync(PHONE_E164_KEY),
    SecureStore.getItemAsync(EMAIL_KEY),
    SecureStore.getItemAsync(SETUP_COMPLETE_KEY),
  ]);
  if (complete !== 'true' || !deviceId || !displayName || !firstName || !lastName || !phoneE164 || !email) return null;
  return { deviceId, displayName, email, firstName, lastName, phoneE164 };
}

export async function createCallableIdentity(firstName: string, lastName: string, phone: string, email: string) {
  const normalizedFirstName = firstName.trim();
  const normalizedLastName = lastName.trim();
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedFirstName) throw new Error('Enter your first name.');
  if (!normalizedLastName) throw new Error('Enter your last name.');
  if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) throw new Error('Enter a valid email address.');
  const displayName = `${normalizedFirstName} ${normalizedLastName}`;
  const phoneE164 = normalizePhone(phone);
  const existingDeviceId = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  const deviceId = existingDeviceId ?? crypto.randomUUID();
  await Promise.all([
    SecureStore.setItemAsync(DEVICE_ID_KEY, deviceId),
    SecureStore.setItemAsync(DISPLAY_NAME_KEY, displayName),
    SecureStore.setItemAsync(FIRST_NAME_KEY, normalizedFirstName),
    SecureStore.setItemAsync(LAST_NAME_KEY, normalizedLastName),
    SecureStore.setItemAsync(PHONE_E164_KEY, phoneE164),
    SecureStore.setItemAsync(EMAIL_KEY, normalizedEmail),
    SecureStore.setItemAsync(SETUP_COMPLETE_KEY, 'true'),
  ]);
  return { deviceId, displayName, email: normalizedEmail, firstName: normalizedFirstName, lastName: normalizedLastName, phoneE164 };
}

export async function ensureCallableIdentity() {
  const localIdentity = await getLocalCallableIdentity();
  if (!localIdentity) throw new Error('CALL PROFILE\nCalling setup is required.');
  if (registeredDeviceId === localIdentity.deviceId) return localIdentity;
  const { data, error } = await supabase.rpc('register_calling_profile', {
    p_device_id: localIdentity.deviceId,
    p_email: localIdentity.email,
    p_first_name: localIdentity.firstName,
    p_last_name: localIdentity.lastName,
    p_phone_e164: localIdentity.phoneE164,
  });
  if (error || data?.device_id !== localIdentity.deviceId) throw new Error('CALL PROFILE\nUnable to save the calling profile.');
  registeredDeviceId = localIdentity.deviceId;
  return localIdentity;
}
