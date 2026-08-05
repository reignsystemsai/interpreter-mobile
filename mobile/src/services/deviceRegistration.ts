import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import { Platform } from 'react-native';

import { API_BASE_URL } from '../config/runtime';

const DEVICE_ID_KEY = 'interpreter.device_id';
const PHONE_KEY = 'interpreter.phone_e164';
const PHONE_PROMPTED_KEY = 'interpreter.phone_prompted';

export function normalizePhoneRegion(value?: string | null): CountryCode | undefined {
  const normalized = value?.trim().toUpperCase() ?? '';
  if (/^[A-Z]{2}$/.test(normalized)) return normalized as CountryCode;
  if (/^\+?57$/.test(normalized)) return 'CO';
  if (/^\+?1$/.test(normalized)) return 'US';
  return undefined;
}

export function deviceDefaultPhoneRegion(): CountryCode {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale;
  return normalizePhoneRegion(locale.split(/[-_]/).at(-1)) ?? 'US';
}

export function normalizeE164(value: string, defaultRegion: CountryCode = deviceDefaultPhoneRegion()) {
  try {
    const phoneNumber = parsePhoneNumberFromString(value.trim(), defaultRegion);
    return phoneNumber?.isValid() ? phoneNumber.number : '';
  } catch {
    return '';
  }
}

export function phoneRegionFromE164(value?: string | null) {
  if (!value) return undefined;
  try { return parsePhoneNumberFromString(value)?.country; }
  catch { return undefined; }
}

async function getDeviceId() {
  const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (existing) return existing;
  const created = `${Platform.OS}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  await SecureStore.setItemAsync(DEVICE_ID_KEY, created);
  return created;
}

async function getPushToken() {
  if (!Device.isDevice) return null;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('incoming-calls', {
      importance: Notifications.AndroidImportance.MAX,
      name: 'Incoming calls',
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
    });
  }
  const current = await Notifications.getPermissionsAsync();
  const status = current.status === 'undetermined'
    ? (await Notifications.requestPermissionsAsync()).status
    : current.status;
  if (status !== 'granted') return null;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (typeof projectId !== 'string' || !projectId) return null;
  return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
}

export async function registerDeviceInstallation(phoneNumber: string, defaultRegion = deviceDefaultPhoneRegion()) {
  const phoneNumberE164 = normalizeE164(phoneNumber, defaultRegion);
  if (!phoneNumberE164) throw new Error('Enter a valid phone number including area code.');
  const deviceId = await getDeviceId();
  const pushToken = await getPushToken().catch(() => null);
  const response = await fetch(`${API_BASE_URL}/api/v1/devices/register`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ defaultRegion, deviceId, phoneNumber: phoneNumberE164, platform: Platform.OS, pushToken }),
  });
  if (!response.ok) throw new Error('Device registration is temporarily unavailable.');
  await SecureStore.setItemAsync(PHONE_KEY, phoneNumberE164);
  await SecureStore.setItemAsync(PHONE_PROMPTED_KEY, '1');
  return phoneNumberE164;
}

export async function restoreAndRefreshDeviceRegistration() {
  const phoneNumber = await SecureStore.getItemAsync(PHONE_KEY);
  if (!phoneNumber) return false;
  await registerDeviceInstallation(phoneNumber);
  return true;
}

export async function getRegisteredPhoneNumber() {
  return SecureStore.getItemAsync(PHONE_KEY);
}

export async function wasPhoneNumberPrompted() {
  return (await SecureStore.getItemAsync(PHONE_PROMPTED_KEY)) === '1';
}

export async function dismissPhoneNumberPrompt() {
  await SecureStore.setItemAsync(PHONE_PROMPTED_KEY, '1');
}

export async function lookupDeviceByPhone(phoneNumber: string, defaultRegion = deviceDefaultPhoneRegion()) {
  const normalized = normalizeE164(phoneNumber, defaultRegion);
  if (!normalized) throw new Error('This contact does not have a valid phone number.');
  const response = await fetch(`${API_BASE_URL}/api/v1/devices/lookup`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ defaultRegion, phoneNumber: normalized }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    available?: boolean;
    recipient?: { installationId?: string };
  };
  if (!response.ok) throw new Error('Unable to check this contact right now.');
  return payload.available && payload.recipient?.installationId
    ? { available: true as const, installationId: payload.recipient.installationId }
    : { available: false as const };
}
