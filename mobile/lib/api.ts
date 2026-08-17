import { useAuthStore } from '@/lib/auth-store';
import { ApiError, type Envelope, type EnvelopeError, type MeUser } from '@/lib/api-types';
import { clearRefreshToken, readRefreshToken, writeRefreshToken } from '@/lib/secure';

const SKIP_REFRESH = new Set(['/auth/login', '/auth/refresh']);

export function apiBase(): string {
  return process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000/api';
}

let refreshInFlight: Promise<boolean> | null = null;

async function rotateRefresh(): Promise<boolean> {
  const refreshToken = await readRefreshToken();
  if (!refreshToken) {
    return false;
  }
  const response = await fetch(`${apiBase()}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  const body = (await response.json()) as Envelope<{ accessToken: string; refreshToken: string }> | EnvelopeError;
  if (!response.ok || !body.success) {
    await clearRefreshToken();
    useAuthStore.getState().clear();
    return false;
  }
  useAuthStore.getState().setAccessToken(body.data.accessToken);
  await writeRefreshToken(body.data.refreshToken);
  return true;
}

export function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = rotateRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  formData?: FormData;
  skipRefresh?: boolean;
};

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = useAuthStore.getState().accessToken;
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  let body: BodyInit | undefined;
  if (options.formData) {
    body = options.formData;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  const response = await fetch(`${apiBase()}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body,
  });
  const parsed = (await response.json()) as (Envelope<T> & { meta?: { total?: number } }) | EnvelopeError;
  if (response.status === 401 && !options.skipRefresh && !SKIP_REFRESH.has(path)) {
    const ok = await refreshSession();
    if (ok) {
      return api<T>(path, { ...options, skipRefresh: true });
    }
  }
  if (!parsed.success) {
    throw new ApiError(parsed.error.code, parsed.error.message, parsed.error.details);
  }
  return parsed.data;
}

export async function apiList<T>(path: string, options: RequestOptions = {}): Promise<{ data: T; total: number }> {
  const token = useAuthStore.getState().accessToken;
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${apiBase()}${path}`, {
    method: options.method ?? 'GET',
    headers,
  });
  const parsed = (await response.json()) as
    | { success: true; data: T; meta?: { total?: number } }
    | EnvelopeError;
  if (response.status === 401 && !options.skipRefresh) {
    const ok = await refreshSession();
    if (ok) {
      return apiList<T>(path, { ...options, skipRefresh: true });
    }
  }
  if (!parsed.success) {
    throw new ApiError(parsed.error.code, parsed.error.message, parsed.error.details);
  }
  return { data: parsed.data, total: parsed.meta?.total ?? 0 };
}

export async function loginRequest(identifier: string, password: string) {
  const payload = identifier.includes('@') ? { email: identifier, password } : { phone: identifier, password };
  const data = await api<{ accessToken: string; refreshToken: string; user: MeUser }>('/auth/login', {
    method: 'POST',
    body: payload,
    skipRefresh: true,
  });
  useAuthStore.getState().setAccessToken(data.accessToken);
  useAuthStore.getState().setUser(data.user);
  await writeRefreshToken(data.refreshToken);
  return data.user;
}

export async function logoutRequest(): Promise<void> {
  const refreshToken = await readRefreshToken();
  if (refreshToken) {
    try {
      await api('/auth/logout', { method: 'POST', body: { refreshToken } });
    } catch {
      /* still clear local */
    }
  }
  await clearRefreshToken();
  useAuthStore.getState().clear();
}
