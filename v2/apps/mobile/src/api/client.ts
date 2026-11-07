/**
 * API klijent za mobilni. Isti ugovor kao web (jedan API, B8), ali token ide u
 * `Authorization` zaglavlju — Expo ne može koristiti cookie sesiju.
 *
 * Tokeni se drže u expo-secure-store (Keychain/Keystore), nikad u AsyncStorage.
 */
import * as SecureStore from "expo-secure-store";

const ACCESS_KEY = "gx_access";
const REFRESH_KEY = "gx_refresh";

export type ApiEnvelope<T> =
  | { success: true; data: T; meta?: Record<string, unknown> }
  | { success: false; error: { code: string; message: string } };

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function getBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  // U razvoju Expo web/emulator ide na lokalni API; na uređaju se postavlja EXPO_PUBLIC_API_URL.
  return "http://127.0.0.1:3000";
}

export async function saveTokens(access: string, refresh: string): Promise<void> {
  await SecureStore.setItemAsync(ACCESS_KEY, access);
  await SecureStore.setItemAsync(REFRESH_KEY, refresh);
}

export async function clearTokens(): Promise<void> {
  await SecureStore.deleteItemAsync(ACCESS_KEY);
  await SecureStore.deleteItemAsync(REFRESH_KEY);
}

export async function getAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(ACCESS_KEY);
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const token = await getAccessToken();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) headers.authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`${getBaseUrl()}${path}`, { ...init, headers });
  } catch {
    // Mrežni prekid NIJE greška servera: zapis ostaje u redu i šalje se ponovo.
    throw new ApiError("NETWORK_ERROR", "Nema veze sa serverom.", 0);
  }

  if (response.status === 401 && retry) {
    const refreshed = await refreshTokens();
    if (refreshed) return request<T>(path, init, false);
  }

  const body = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!body) throw new ApiError("INTERNAL", "Neispravan odgovor servera.", response.status);
  if (!body.success) throw new ApiError(body.error.code, body.error.message, response.status);
  return body.data;
}

export async function login(email: string, password: string): Promise<{ mustChangePassword: boolean }> {
  const data = await request<{
    accessToken: string;
    refreshToken: string;
    mustChangePassword: boolean;
  }>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }, false);
  await saveTokens(data.accessToken, data.refreshToken);
  return { mustChangePassword: data.mustChangePassword };
}

export async function refreshTokens(): Promise<boolean> {
  const refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
  if (!refreshToken) return false;
  try {
    const response = await fetch(`${getBaseUrl()}/api/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    const body = (await response.json().catch(() => null)) as ApiEnvelope<{
      accessToken: string;
      refreshToken: string;
    }> | null;
    if (!response.ok || !body || !body.success) {
      await clearTokens();
      return false;
    }
    await saveTokens(body.data.accessToken, body.data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

export type Me = {
  user: { id: string; firstName: string; lastName: string; roles: string[] };
  company: { name: string; currency: string } | null;
};

export function me(): Promise<Me> {
  return request<Me>("/api/me");
}

export function pushNotes(
  deviceId: string,
  items: { localId: string; entityType: "note"; payload: Record<string, unknown>; clientAt: string }[],
): Promise<{ results: { localId: string; serverId: string; duplicate: boolean }[] }> {
  return request("/api/sync/push", { method: "POST", body: JSON.stringify({ deviceId, items }) });
}

export function pullChanges(
  since: string,
): Promise<{ items: unknown[]; lastSyncTimestamp: string }> {
  return request(`/api/sync/pull?since=${encodeURIComponent(since)}`);
}
