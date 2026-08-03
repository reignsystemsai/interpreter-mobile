export const API_BASE_URL = (
  process.env.EXPO_PUBLIC_API_BASE_URL?.trim() ||
  'https://interpreter-api-fycw.onrender.com'
).replace(/\/+$/, '');

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? '';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? '';
export const REVENUECAT_ANDROID_API_KEY =
  process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY?.trim() ?? '';

export const ACCOUNT_SERVICES_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
export const LEGAL_REVIEW_APPROVED =
  process.env.EXPO_PUBLIC_LEGAL_REVIEW_APPROVED === 'true';
