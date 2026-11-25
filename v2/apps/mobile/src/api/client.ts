/**
 * API klijent za mobilni. Isti ugovor kao web (jedan API, B8), ali token ide u
 * `Authorization` zaglavlju — Expo ne može koristiti cookie sesiju.
 *
 * Tokeni se drže u `lib/store` (na uređaju Keychain/Keystore, na webu `localStorage`), nikad u AsyncStorage.
 */
import { ApiError, createClient, isTwoFactorRequired, stripControlChars, type ErrorCode } from "@gradix/contracts";
import type {
  ForemanWorkersResponse,
  LoginResponse,
  MachinesResponse,
  MeResponse,
  MyPayrollResponse,
  ObligationsResponse,
  ProjectsResponse,
  SessionsResponse,
  CostCategory as CostCategoryDto,
  ProjectTask,
  TasksResponse,
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
  // A1: `trim()` NE skida NUL (\u0000), a mobilna tipkovnica/autofill ga zna ubaciti u email.
  // Server takav unos odbija s 400 (SafeText); ovdje se čisti PRIJE slanja, da prijava
  // radi i kad uređaj pošalje kontrolni znak. Lozinka se ne dira: kontrolni znak u njoj
  // znači pogrešan unos i tačno je da server odbije.
  const cleanEmail = stripControlChars(email).trim();
  const { data } = await client.post("/api/auth/login", { email: cleanEmail, password }, undefined, { accessToken: null });

  /*
   * F1: uredske role (OWNER/ADMIN/ACCOUNTANT) imaju obaveznu 2FA, pa prijava sa samom
   * lozinkom vraća `preAuthToken` i NEMA tokene. Ugovor je unija — provjera ide preko
   * diskriminanta, a ne preko `undefined`, da tipovi i ponašanje ostanu vezani.
   */
  if (isTwoFactorRequired(data)) {
    throw new ApiError({
      code: "AUTH_2FA_REQUIRED",
      message: "Ovaj nalog traži dvostepenu prijavu. Prijavite se na webu.",
      status: 401,
    });
  }

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
/**
 * Moji uređaji (F1, spec 01 §1.6.28). Isti endpoint kao web — telefon ne dobija poseban
 * spisak, samo svoj. Opoziv tuđeg uređaja ne dira tekući token.
 */
export async function mySessions(): Promise<SessionsResponse> {
  const { data } = await withToken((accessToken) =>
    client.get("/api/me/sessions", undefined, { accessToken }),
  );
  return data;
}

/** Opoziv jednog uređaja; tekući uređaj server odbija (`SESSION_CURRENT`). */
export async function revokeMySession(id: string): Promise<void> {
  await withToken((accessToken) => client.delete("/api/me/sessions/{id}", { id }, { accessToken }));
}

/** „Odjavi sve ostale“ — tekuća sesija ostaje, ostali moraju ponovo da se prijave. */
export async function revokeOtherSessions(): Promise<number> {
  const { data } = await withToken((accessToken) =>
    client.post("/api/me/sessions/revoke-others", undefined, undefined, { accessToken }),
  );
  return data.revoked;
}

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

/**
 * „Moj obračun“ (F6, spec 07 §4) — svoji sati za mjesec; iznosi tek kad je period odobren.
 *
 * `year`/`month` su OBAVEZNI, a ne „tekući mjesec po defaultu“: radnik koji u januaru provjerava
 * decembar mora dobiti decembar. Server bez parametara ne bi znao čiji mjesec, pa bi ekran tiho
 * pokazao pogrešan period.
 */
export async function myPayroll(input: { year: number; month: number }): Promise<MyPayrollResponse> {
  const { data } = await withToken((accessToken) =>
    client.get("/api/me/payroll", undefined, {
      query: { year: String(input.year), month: String(input.month) },
      accessToken,
    }),
  );
  return data as MyPayrollResponse;
}

/**
 * „Moj dan“ — jedan poziv koji nosi i današnji dan i zaboravljeni dan (F3).
 *
 * Namjerno jedan poziv: telefon na gradilištu ima lošu vezu, pa tri kruga za tri pitanja
 * znače tri prilike da ekran ostane prazan.
 */
export async function myDay(): Promise<unknown> {
  const { data } = await withToken((accessToken) => client.get("/api/me/day", undefined, { accessToken }));
  return data;
}

/** Timer: `start` / `pause` / `resume` / `finish`. `localId` čini ponovni poziv bezopasnim. */
export async function workdayTimer(input: {
  action: "start" | "pause" | "resume" | "finish";
  localId?: string;
  projectId?: string | null;
  machineId?: string | null;
  at?: string;
  tzOffsetMinutes?: number;
}): Promise<unknown> {
  const { data } = await withToken((accessToken) =>
    client.post("/api/workdays/timer", input, undefined, { accessToken }),
  );
  return data;
}

/** Zatvaranje zaboravljenog dana: `TIME`, `LAST_PING` ili `UNKNOWN`. */
export async function closeForgottenDay(input: {
  kind: "TIME" | "LAST_PING" | "UNKNOWN";
  endedAt?: string;
  lastPingAt?: string;
  note?: string | null;
}): Promise<unknown> {
  const { data } = await withToken((accessToken) =>
    client.post("/api/workdays/close-forgotten", input, undefined, { accessToken }),
  );
  return data;
}

/* ------------------------------------------------------------------ F5: zadaci i trošak */

/** Tipovi se uzimaju iz ugovora (jedan izvor), ne prepisuju u mobilnom. */
export type TaskListResponse = TasksResponse;
export type TaskRow = ProjectTask;
export type TaskStatus = ProjectTask["status"];
export type CostCategoriesResponse = { categories: CostCategoryDto[]; unmapped_sources: string[] };

/**
 * „Moji zadaci danas“ — jedan poziv, isti kao web `/ured/zadaci` sa filterom „moji + danas“.
 *
 * Zašto posebna funkcija, a ne opšti `tasks(query)`: terenski ekran postavlja ISTO pitanje svaki
 * put (moji, danas), pa bi opšti potpis svaki ekran tjerao da pogodi parametre — a pogrešan
 * parametar ovdje znači praznu listu koja izgleda kao „nemaš zadataka“.
 */
export async function myTasksToday(): Promise<TaskListResponse> {
  const { data } = await withToken((accessToken) =>
    client.get("/api/tasks", undefined, {
      query: { assignee: "ME", due: "TODAY" },
      accessToken,
    }),
  );
  return data as TaskListResponse;
}

/**
 * Djelimična izmjena zadatka — prelazak stanja šalje SAMO `status`.
 *
 * Putanja ide kroz parametre ugovora (`{id}`), ne kroz interpolaciju: klijent tada provjerava
 * tijelo po istoj šemi koju server traži, pa nemoguće stanje pada na telefonu, ne na serveru.
 */
export async function updateTask(
  id: string,
  input: { status?: TaskStatus; title?: string; description?: string | null },
): Promise<unknown> {
  const { data } = await withToken((accessToken) =>
    client.patch("/api/tasks/{id}", input, { id }, { accessToken }),
  );
  return data;
}

/**
 * Brzi unos troška sa gradilišta (fotografija računa je dio unosa, ne dodatak).
 *
 * `attachmentId` je OBAVEZAN u ovom pozivu: to je ekran „uslikaj račun“, a ne opšti ručni unos —
 * bez slike bi se na terenu knjižio iznos bez dokaza, što je upravo ono što spec 06 brani.
 */
export async function bookSiteCost(input: {
  projectId: string;
  categoryId: string;
  occurredOn: string;
  amount: string;
  attachmentId: string;
  phaseId?: string | null;
  note?: string | null;
}): Promise<unknown> {
  const { data } = await withToken((accessToken) =>
    client.post("/api/costs/manual", input, undefined, { accessToken }),
  );
  return data;
}

/**
 * Registracija priloga uz PROJEKAT (fotografija računa), pa potpisani PUT na bucket.
 *
 * `headBase64` su prva bajta fajla — server iz SADRŽAJA zaključuje tip (preimenovan `.exe` u
 * `.jpg` pada). Vraća se `attachmentId` koji ide u `bookSiteCost`, i `uploadUrl` na koji telefon
 * šalje bajte. Potvrda (`ready`) se radi tek poslije uspješnog PUT-a — bez nje trošak ne prolazi.
 */
export async function registerProjectAttachment(input: {
  projectId: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  headBase64: string;
}): Promise<{ attachment: { id: string }; uploadUrl: string }> {
  const { data } = await withToken((accessToken) =>
    client.post(
      "/api/attachments",
      {
        entityType: "PROJECT" as const,
        entityId: input.projectId,
        fileName: input.fileName,
        sizeBytes: input.sizeBytes,
        sha256: input.sha256,
        headBase64: input.headBase64,
      },
      undefined,
      { accessToken },
    ),
  );
  return data as { attachment: { id: string }; uploadUrl: string };
}

/** Potvrda uploada: prilog postaje `ready` tek kad objekat stvarno postoji i veličina se slaže. */
export async function confirmAttachment(id: string): Promise<void> {
  await withToken((accessToken) =>
    client.post("/api/attachments/{id}/confirm", undefined, { id }, { accessToken }),
  );
}

/** Kategorije troška firme — za izbor u brzom unosu. */
export async function costCategories(): Promise<CostCategoriesResponse> {
  const { data } = await withToken((accessToken) =>
    client.get("/api/cost-categories", undefined, { accessToken }),
  );
  return data as CostCategoriesResponse;
}

/**
 * F8 — servisni nalozi za mehaničara.
 *
 * Namjerno NIJE dio R4 sync pull-a: naloge mijenja radionica, a ne telefon. Telefon ih čita
 * online (kad ima veze) i drži zadnju listu u memoriji ekrana; offline radnje idu kroz outbox.
 */
export type MechanicOrdersResponse = {
  orders: {
    id: string;
    machine_id: string;
    machine_code: string;
    machine_name: string;
    description: string | null;
    status: string;
    priority: string;
    assigned_mechanic_worker_id: string | null;
    planned_for: string | null;
    opened_at: string;
    total_cost_amount: string;
    currency_code: string;
  }[];
};

export async function mechanicOrders(): Promise<MechanicOrdersResponse> {
  const { data } = await withToken((accessToken) =>
    client.get("/api/service-orders?mine=1", undefined, { accessToken }),
  );
  return data as MechanicOrdersResponse;
}

export async function machines(): Promise<MachinesResponse> {
  const { data } = await withToken((accessToken) => client.get("/api/equipment", undefined, { accessToken }));
  return data;
}

export type { LoginResponse };
