import { API_BASE_URL } from '../config/runtime';

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly payload: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function authenticatedRequest<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  if (response.status === 204) return undefined as T;
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new ApiError(payload.error || `Request failed (${response.status}).`, response.status, payload as Record<string, unknown>);
  return payload;
}
