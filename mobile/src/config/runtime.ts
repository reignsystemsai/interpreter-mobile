import Constants from 'expo-constants';

export const API_BASE_URL = (
  process.env.EXPO_PUBLIC_API_BASE_URL?.trim() ||
  'https://speaktele-api.onrender.com'
).replace(/\/+$/, '');

const publicConfig = Constants.expoConfig?.extra ?? {};

export const SUPABASE_URL =
  typeof publicConfig.supabaseUrl === 'string' ? publicConfig.supabaseUrl.trim() : '';
export const SUPABASE_PUBLISHABLE_KEY =
  typeof publicConfig.supabasePublishableKey === 'string'
    ? publicConfig.supabasePublishableKey.trim()
    : '';
export const LIVEKIT_URL =
  typeof publicConfig.livekitUrl === 'string' ? publicConfig.livekitUrl.trim() : '';
export const REVENUECAT_ANDROID_API_KEY =
  process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY?.trim() ?? '';

export const ACCOUNT_SERVICES_CONFIGURED = Boolean(
  SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY,
);
export const LEGAL_REVIEW_APPROVED =
  process.env.EXPO_PUBLIC_LEGAL_REVIEW_APPROVED === 'true';
