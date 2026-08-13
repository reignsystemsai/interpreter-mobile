import Constants from 'expo-constants';

export const API_BASE_URL = (
  process.env.EXPO_PUBLIC_API_BASE_URL?.trim() ||
  'https://interpreter-api-fycw.onrender.com'
).replace(/\/+$/, '');

const publicConfig = Constants.expoConfig?.extra ?? {};

export const LIVEKIT_URL =
  typeof publicConfig.livekitUrl === 'string' ? publicConfig.livekitUrl.trim() : '';
export const REVENUECAT_ANDROID_API_KEY =
  process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY?.trim() ?? '';

export const LEGAL_REVIEW_APPROVED =
  process.env.EXPO_PUBLIC_LEGAL_REVIEW_APPROVED === 'true';
