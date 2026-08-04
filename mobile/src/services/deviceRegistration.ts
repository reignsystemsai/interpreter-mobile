import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { API_BASE_URL } from '../config/runtime';

const DEVICE_ID_KEY = 'interpreter.device_id';
const PHONE_KEY = 'interpreter.phone_e164';
const PHONE_PROMPTED_KEY = 'interpreter.phone_prompted';

export function normalizeE164(value: string) {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+') && /^[1-9][0-9]{7,14}$/.test(digits)) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return '';
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

export async function registerDeviceInstallation(phoneNumber: string) {
  const phoneNumberE164 = normalizeE164(phoneNumber);
  if (!phoneNumberE164) throw new Error('Enter a valid phone number including area code.');
  const deviceId = await getDeviceId();
  const pushToken = await getPushToken().catch(() => null);
  const response = await fetch(`${API_BASE_URL}/api/v1/devices/register`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, phoneNumber: phoneNumberE164, platform: Platform.OS, pushToken }),
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

export async function wasPhoneNumberPrompted() {
  return (await SecureStore.getItemAsync(PHONE_PROMPTED_KEY)) === '1';
}

export async function dismissPhoneNumberPrompt() {
  await SecureStore.setItemAsync(PHONE_PROMPTED_KEY, '1');
}

export async function lookupDeviceByPhone(phoneNumber: string) {
  const normalized = normalizeE164(phoneNumber);
  if (!normalized) throw new Error('This contact does not have a valid phone number.');
  const response = await fetch(`${API_BASE_URL}/api/v1/devices/lookup`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ phoneNumber: normalized }),
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
