import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { authenticatedRequest } from './api';

const INSTALLATION_ID_KEY = 'interpreter.installation-id';
const DEVICE_PHONE_KEY = 'interpreter.device-phone-e164';
const CONFIGURED_DEVICE_PHONE_NUMBER = process.env.EXPO_PUBLIC_MVP_DEVICE_PHONE_NUMBER?.trim() ?? '';

export function normalizeE164(value: string) {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+') && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

async function installationId() {
  const stored = await SecureStore.getItemAsync(INSTALLATION_ID_KEY);
  if (stored) return stored;
  const created = `${Date.now().toString(36)}-${Array.from({ length: 4 }, () => Math.random().toString(36).slice(2)).join('')}`;
  await SecureStore.setItemAsync(INSTALLATION_ID_KEY, created);
  return created;
}

export async function provisionDevicePhoneNumber(value: string) {
  const phoneNumber = normalizeE164(value);
  if (!phoneNumber) throw new Error('A valid phone number is required.');
  await SecureStore.setItemAsync(DEVICE_PHONE_KEY, phoneNumber);
  return phoneNumber;
}

export async function registerCurrentInstallation(expoPushToken?: string) {
  const configuredPhoneNumber = normalizeE164(CONFIGURED_DEVICE_PHONE_NUMBER);
  const storedPhoneNumber = await SecureStore.getItemAsync(DEVICE_PHONE_KEY);
  const phoneNumber = storedPhoneNumber || configuredPhoneNumber;
  if (!phoneNumber) return false;
  if (!storedPhoneNumber) await SecureStore.setItemAsync(DEVICE_PHONE_KEY, phoneNumber);
  const currentInstallationId = await installationId();
  await authenticatedRequest<void>('/api/v1/devices/register', {
    method: 'POST',
    body: JSON.stringify({
      expoPushToken: expoPushToken || undefined,
      appVersion: Constants.expoConfig?.version ?? 'unknown',
      installationId: currentInstallationId,
      participantIdentity: `guest-${currentInstallationId}`,
      phoneNumber,
      platform: Platform.OS,
    }),
  });
  return true;
}
