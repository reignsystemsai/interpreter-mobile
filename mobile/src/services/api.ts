import { API_BASE_URL } from '../config/runtime';
import { supabase } from './supabase';

export async function authenticatedRequest<T>(path: string, init?: RequestInit) {
  const session = (await supabase?.auth.getSession())?.data.session;
  if (!session?.access_token) throw new Error('Sign in to continue.');
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      ...init?.headers,
    },
  });
  if (response.status === 204) return undefined as T;
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
  return payload;
}
