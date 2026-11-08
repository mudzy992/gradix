/**
 * API klijent za mobilni. Isti ugovor kao web (jedan API, B8), ali token ide u
 * `Authorization` zaglavlju — Expo ne može koristiti cookie sesiju.
 *
 * Tokeni se drže u `lib/store` (na uređaju Keychain/Keystore, na webu `localStorage`), nikad u AsyncStorage.
 */
import { ApiError, createClient, type ErrorCode } from "@gradix/contracts";
import type { LoginResponse, MeResponse, SyncPullResponse, SyncPushRequest, SyncPushResponse } from "@gradix/contracts";
import { deleteStore, readStore, writeStore } from "../lib/store";

const ACCESS_KEY = "gx_access";
const REFRESH_KEY = "gx_refresh";

/**
 * `ApiError` dolazi iz ugovora; ovdje se samo dodaje slučaj kojeg ugovor ne poznaje jer se ne
 * dešava na serveru — mrežni prekid. Kod je namjerno van `ErrorCode` kataloga i provjerava se
 * poređenjem, ne po tipu.
 */
export const NETWORK_ERROR = "NETWORK_ERROR" as ErrorCode;

export { ApiError };

export function getBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  // U razvoju Expo web/emulator ide na lokalni API; na uređaju se postavlja EXPO_PUBLIC_API_URL.
  return "http://127.0.0.1:3000";
}

export async function saveTokens(access: string, refresh: string): Promise<void> {
  await writeStore(ACCESS_KEY, access);
  await writeStore(REFRESH_KEY, refresh);
}

export async function clearTokens(): Promise<void> {
  await deleteStore(ACCESS_KEY);
  await deleteStore(REFRESH_KEY);
}

export async function getAccessToken(): Promise<string | null> {
  return readStore(ACCESS_KEY);
}

/**
 * Klijent iz ugovora + dva sloja koja su specifična za uređaj:
 * (1) mrežni prekid se pretvara u `NETWORK_ERROR` (zapis ostaje u redu i šalje se ponovo),
 * (2) 401 pokušava jednu rotaciju refresh tokena pa ponavlja zahtjev.
 */
async function authedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, init);
}

const client = createClient({ baseUrl: getBaseUrl(), fetch: authedFetch });

async function withToken<T>(call: (token: string | null) => Promise<T>): Promise<T> {
  const token = await getAccessToken();
  try {
    return await call(token);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    if (error.status === 0) {
      // Mrežni prekid NIJE greška servera: zapis ostaje u redu i šalje se ponovo.
      throw new ApiError({ code: NETWORK_ERROR, message: "Nema veze sa serverom.", status: 0 });
    }
    if (error.status !== 401) throw error;
    const refreshed = await refreshTokens();
    if (!refreshed) throw error;
    return call(await getAccessToken());
  }
}

export async function login(email: string, password: string): Promise<{ mustChangePassword: boolean }> {
  const { data } = await client.post("/api/auth/login", { email, password }, undefined, { accessToken: null });
  await saveTokens(data.accessToken, data.refreshToken);
  return { mustChangePassword: data.mustChangePassword };
}

export async function refreshTokens(): Promise<boolean> {
  const refreshToken = await readStore(REFRESH_KEY);
  if (!refreshToken) return false;
  try {
    const { data } = await client.post("/api/auth/refresh", { refreshToken }, undefined, { accessToken: null });
    await saveTokens(data.accessToken, data.refreshToken);
    return true;
  } catch {
    await clearTokens();
    return false;
  }
}

/** Tipovi dolaze iz ugovora — `Me` je ono što `GET /api/me` stvarno vraća. */
export type Me = MeResponse;

export async function me(): Promise<Me> {
  const { data } = await withToken((accessToken) => client.get("/api/me", undefined, { accessToken }));
  return data;
}

export async function pushNotes(
  deviceId: string,
  items: SyncPushRequest["items"],
): Promise<SyncPushResponse> {
  const { data } = await withToken((accessToken) =>
    client.post("/api/sync/push", { deviceId, items }, undefined, { accessToken }),
  );
  return data;
}

/** `lastSyncTimestamp` je u `meta` — ugovor ga tamo i stavlja. */
export async function pullChanges(
  since: string,
): Promise<{ items: SyncPullResponse["items"]; lastSyncTimestamp: string }> {
  const { data, meta } = await withToken((accessToken) =>
    client.get("/api/sync/pull", undefined, { query: { since }, accessToken }),
  );
  return { items: data.items, lastSyncTimestamp: String(meta?.lastSyncTimestamp ?? since) };
}

export type { LoginResponse };
