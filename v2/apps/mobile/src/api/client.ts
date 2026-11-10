/**
 * API klijent za mobilni. Isti ugovor kao web (jedan API, B8), ali token ide u
 * `Authorization` zaglavlju — Expo ne može koristiti cookie sesiju.
 *
 * Tokeni se drže u `lib/store` (na uređaju Keychain/Keystore, na webu `localStorage`), nikad u AsyncStorage.
 */
import { ApiError, createClient, type ErrorCode } from "@gradix/contracts";
import type {
  ForemanWorkersResponse,
  LoginResponse,
  MachinesResponse,
  MeResponse,
  ObligationsResponse,
  ProjectsResponse,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
} from "@gradix/contracts";
import { deleteStore, readStore, writeStore } from "../lib/store";
import { assertSyncAccount, type AccountIdentity } from "./account-binding";

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

/** Revoke the current server session when online, then always remove local auth tokens. */
export async function logoutServerSession(): Promise<boolean> {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    await clearTokens();
    return false;
  }
  try {
    await withToken((token) => client.post("/api/auth/logout", undefined, undefined, { accessToken: token }));
    await clearTokens();
    return true;
  } catch {
    await clearTokens();
    return false;
  }
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

/** Resolve and pin the current bearer token to the account that owns a local outbox partition. */
async function tokenForAccount(account: AccountIdentity): Promise<string> {
  const token = await getAccessToken();
  if (!token) throw Object.assign(new Error("Prijava je istekla; sačuvani redovi nisu poslani."), { code: "AUTH_REQUIRED" });
  const { data } = await client.get("/api/me", undefined, { accessToken: token });
  assertSyncAccount(account, {
    companyId: data.company?.id ?? "",
    userId: data.user.id,
  });
  return token;
}

/** Account-bound push never refreshes/re-reads a token mid-request under a different login. */
export async function pushSyncItems(
  account: AccountIdentity,
  items: readonly SyncPushRequest["items"][number][],
): Promise<SyncPushResponse> {
  const token = await tokenForAccount(account);
  const { data } = await client.post("/api/sync/push", { items: [...items] }, undefined, { accessToken: token });
  return data;
}

/** Opaque cursors are persisted as-is; clients must not compare or derive their sequence.
 * The expected account is mandatory so a stale account's cursor cannot use the current login. */
export async function pullSyncChanges(
  account: AccountIdentity,
  cursor: string,
  limit = 100,
): Promise<SyncPullResponse> {
  const token = await tokenForAccount(account);
  const { data } = await client.get("/api/sync/pull", undefined, {
    query: cursor ? { cursor, limit: String(limit) } : { limit: String(limit) },
    accessToken: token,
  });
  return data;
}

/** Šefov minimalni worker roster; server ograničava ga na R3 dodjele važeće na workDate. */
export async function pullForemanWorkers(projectId: string, workDate: string): Promise<ForemanWorkersResponse> {
  const { data } = await withToken((accessToken) =>
    client.get("/api/sync/foreman-workers", undefined, {
      query: { projectId, workDate },
      accessToken,
    }),
  );
  return data;
}

/** Rokovi na telefonu: samo čitanje (R2). Filter `mine=1` daje obaveze gdje sam odgovoran
 * ili je radnik vezan za moj nalog — a to je jedino što terenski čovjek traži. */
export async function myObligations(): Promise<ObligationsResponse> {
  const { data } = await withToken((accessToken) =>
    client.get("/api/obligations", undefined, { query: { mine: "1" }, accessToken }),
  );
  return data;
}

/**
 * Moji projekti (R3) — samo oni na koje je osoba dodijeljena.
 *
 * `mine=1` je filter na serveru, a opseg (`COMPANY`/`PROJECTS`) ostaje serverska stvar: telefon ne
 * odlučuje šta vidi, samo traži svoje. Tako mobilni i web ne mogu dati različite spiskove.
 */
export async function myProjects(): Promise<ProjectsResponse> {
  const { data } = await withToken((accessToken) =>
    client.get("/api/projects", undefined, { query: { mine: "1" }, accessToken }),
  );
  return data;
}

export async function machines(): Promise<MachinesResponse> {
  const { data } = await withToken((accessToken) => client.get("/api/equipment", undefined, { accessToken }));
  return data;
}

export type { LoginResponse };
