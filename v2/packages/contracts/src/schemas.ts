/**
 * Šeme odgovora i zahtjeva — JEDAN izvor za OpenAPI, tipove i klijent.
 *
 * Zašto ručno, a ne izvedeno iz ruta: `route.ts` fajlovi vraćaju `Response`, pa tip iz koda ne
 * postoji. Alternativa je da svaka ruta piše `zod` i vraća ga kroz helper — to je veći rez i
 * mijenja sve rute. Zato ovdje stoji ugovor, a `src/contract.test.ts` provjerava da se **ključevi
 * poklapaju sa onim što rute stvarno vraćaju** (čita `route.ts` i traži `ok({...})` pozive).
 * Kad ruta promijeni oblik a ugovor ne, test pada — to je „CI provjera ažurnosti“ iz vlasničkih
 * odluka, bez generisanja koda iz ruta.
 */
import { z } from "zod";

/* ------------------------------------------------------------------ zajedničko */

/** Iste vrijednosti kao `CREATE TYPE "Role"` u bazi (init migracija) — jedan izvor istine. */
export const Role = z.enum([
  "OWNER",
  "ADMIN",
  "PROJECT_MANAGER",
  "SITE_SUPERVISOR",
  "WORKER",
  "DRIVER",
  "MACHINE_OPERATOR",
  "MECHANIC",
  "ACCOUNTANT",
]);
export type Role = z.infer<typeof Role>;

export const Scope = z.enum(["COMPANY", "PROJECTS", "SELF"]);
export type Scope = z.infer<typeof Scope>;

export const IsoDate = z.string().describe("ISO 8601, UTC");
export const Uuid = z.string().min(1);

export const Meta = z.record(z.string(), z.unknown());

/**
 * Zajednički čuvar granice API-ja (A1): tekst NE smije sadržavati kontrolne znakove,
 * uključujući NUL. Postgres odbija `\u0000` u stringovima i jsonb-u („invalid byte
 * sequence for encoding "UTF8": 0x00“), pa bi takav unos bez ove provjere stigao do
 * baze i vratio 500. Dozvoljeni su tab (\t), novi red (\n) i povratnik (\r) — tekst
 * u više redova je legitiman unos. Sve ŠEME ZAHTJEVA koriste `SafeText` umjesto
 * golog `z.string()`; izuzetak je `SyncPushRequest`, koji kontroliše po stavci
 * (jedna loša stavka dobija svoj ishod, ne ruši batch — vidi r4-sync-service).
 */
// eslint-disable-next-line no-control-regex -- regex namjerno prepoznaje kontrolne znakove (A1)
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export function hasControlChars(value: string): boolean {
  return CONTROL_CHARS.test(value);
}

/**
 * Uklanja kontrolne znakove iz teksta (A1, mobilni): `trim()` NE skida NUL, pa mobilni
 * klijent prije slanja čisti email — server i dalje odbija takav unos s 400 (odbrana
 * u dubini), ali prijava radi čak i kad tipkovnica/autofill ubaci kontrolni znak.
 */
export function stripControlChars(value: string): string {
  return value.replace(CONTROL_CHARS, "");
}

export const SafeText = z.string().refine((value) => !CONTROL_CHARS.test(value), {
  message: "Polje sadrži nedozvoljene kontrolne znakove.",
});

/* ------------------------------------------------------------------ identitet */

export const MeResponse = z.object({
  user: z.object({
    id: z.string(),
    email: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    roles: z.array(z.string()),
    mustChangePassword: z.boolean(),
  }),
  company: z
    .object({
      id: z.string(),
      name: z.string(),
      slug: z.string(),
      currency: z.string(),
      timezone: z.string(),
    })
    .nullable(),
  machineCount: z.number(),
  // A2 (2026-11-07): mobilna navigacija zavisi od veze korisnik-radnik, ne samo role.
  // workerId = povezani radnički zapis (ili null); foremanScope = šef ima bar jednu
  // aktivnu R3 dodjelu danas (pa mu Grupa ima smisla).
  workerId: z.string().nullable(),
  foremanScope: z.boolean(),
});
export type MeResponse = z.infer<typeof MeResponse>;

/**
 * F0.4 — inbox obavještenja. In-app je OBAVEZAN kanal (radi bez SMTP-a), pa ugovor nosi
 * samo ono što inbox treba: naslov, tekst, link i stanje čitanja.
 */
export const Notification = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  body: z.string(),
  /** Putanja u aplikaciji; obavezna (`LIKE '/%'`) — obavještenje bez linka je slijepa ulica. */
  href: z.string(),
  severity: z.enum(["INFO", "WARN", "CRITICAL"]),
  createdAt: IsoDate,
  readAt: IsoDate.nullable(),
});
export type Notification = z.infer<typeof Notification>;

export const NotificationsResponse = z.object({
  notifications: z.array(Notification),
  unreadCount: z.number(),
});
export type NotificationsResponse = z.infer<typeof NotificationsResponse>;

export const NotificationReadInput = z.object({
  /** Bez `id` i uz `all: true` — „označi sve kao pročitano“. Id je `SafeText`: NUL ne ide u bazu. */
  id: SafeText.optional(),
  all: z.boolean().optional(),
});
export type NotificationReadInput = z.infer<typeof NotificationReadInput>;

/** F0.4 — stanje reda poslova; `available: false` znači „worker nikad nije pokrenut“. */
export const QueueHealthResponse = z.object({
  available: z.boolean(),
  active: z.number(),
  created: z.number(),
  retry: z.number(),
  failed: z.number(),
  completed: z.number(),
  stuck: z.number(),
  lastPingAt: IsoDate.nullable(),
  stale: z.boolean(),
});
export type QueueHealthResponse = z.infer<typeof QueueHealthResponse>;

/**
 * F0.3 — `GET /api/me/blockers`: šta blokira MENE i mašine koje smijem koristiti.
 *
 * Mobilni dobija ODLUKU servera i ne može je zaobići; UI samo prikazuje. Zato odgovor nosi
 * gotove poruke (`blockMessage`) pored strukturiranih uzroka — da radnik na terenu vidi isti
 * tekst koji bi vidio u uredu.
 */
export const UsageCause = z.object({
  source: z.enum(["OBLIGATION", "FAULT", "SERVICE", "MAINTENANCE", "CATEGORY"]),
  label: z.string(),
  state: z.string(),
  overridden: z.boolean(),
  reason: z.string().optional(),
});

export const UsageDecision = z.object({
  allowed: z.boolean(),
  blockers: z.array(UsageCause),
  warns: z.array(UsageCause),
  overrideAvailable: z.boolean(),
});

export const UsageDecisionWithMessages = UsageDecision.extend({
  blockMessage: z.string().nullable(),
  warnMessage: z.string().nullable(),
});

export const MeBlockersResponse = z.object({
  /** `YYYY-MM-DD` — poslovni datum firme, isti koji koristi blokada. */
  today: z.string(),
  workerId: z.string().nullable(),
  /** Radnik: `assign` i `workday` (radni dan ne blokira — samo traka). */
  worker: z.object({
    assign: UsageDecisionWithMessages,
    workday: UsageDecisionWithMessages,
  }).nullable(),
  /** Mašine koje korisnik smije koristiti, sa odlukom za svaku radnju. */
  machines: z.array(
    z.object({
      id: z.string(),
      code: z.string(),
      name: z.string(),
      haul: UsageDecisionWithMessages,
      machineHours: UsageDecisionWithMessages,
      fuel: UsageDecisionWithMessages,
    }),
  ),
});
export type MeBlockersResponse = z.infer<typeof MeBlockersResponse>;

export const LoginRequest = z.object({
  email: SafeText.min(3).max(200),
  password: SafeText.min(1).max(200),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

/**
 * F1: `POST /api/auth/login` ima DVIJE ishoda i oba su uspjeh.
 *
 *  - puna prijava (role bez obavezne 2FA): tokeni + `user`;
 *  - 2FA vrata (OWNER/ADMIN/ACCOUNTANT): `preAuthToken` i `gate`, BEZ sesije.
 *
 * Ugovor je ranije opisivao samo prvi slučaj, pa je mobilni klijent tiho dobijao
 * `undefined` tokene i pad validacije. Zato je sada unija — klijent mora odlučiti.
 */
export const LoginSessionResponse = z.object({
  user: z.object({
    id: z.string(),
    displayName: z.string(),
    roles: z.array(z.string()),
  }),
  companyId: z.string(),
  mustChangePassword: z.boolean(),
  /** Mobile čita odavde; web dobija i cookie. */
  accessToken: z.string(),
  refreshToken: z.string(),
  passwordPolicy: z.string().optional(),
  /**
   * Sesija izdata samo za uparivanje 2FA (`gate: ENROLL`). Takva sesija vidi isključivo
   * Postavke → Sigurnost; polje je u ugovoru da je klijent ne zamijeni punom sesijom.
   */
  enrollmentRequired: z.boolean().optional(),
});
export type LoginSessionResponse = z.infer<typeof LoginSessionResponse>;

/** Drugi korak još nije prošao: nema sesije, samo kratkotrajni pre-auth token. */
export const LoginTwoFactorRequiredResponse = z.object({
  twoFactor: z.object({
    required: z.literal(true),
    /** `VERIFY` — korisnik ima TOTP; `ENROLL` — tek treba da ga upari. */
    gate: z.enum(["VERIFY", "ENROLL"]),
  }),
  preAuthToken: z.string(),
  user: z.object({ id: z.string() }),
});
export type LoginTwoFactorRequiredResponse = z.infer<typeof LoginTwoFactorRequiredResponse>;

export const LoginResponse = z.union([LoginSessionResponse, LoginTwoFactorRequiredResponse]);
export type LoginResponse = z.infer<typeof LoginResponse>;

/** Diskriminant za klijente. Bez njega svaki pozivalac pogađa oblik odgovora. */
export function isTwoFactorRequired(response: LoginResponse): response is LoginTwoFactorRequiredResponse {
  return "preAuthToken" in response;
}

export const RefreshRequest = z.object({ refreshToken: SafeText.optional() });
export const RefreshResponse = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});
export type RefreshResponse = z.infer<typeof RefreshResponse>;

export const OkResponse = z.object({ ok: z.literal(true) });
/** Kraj dodjele ili jednokratno poništavanje pogrešnog reda; nema DELETE semantike. */
export const AssignmentChangedResponse = z.object({
  ok: z.literal(true),
  action: z.enum(["END", "VOID"]),
  scopeNotice: z.string().nullable(),
});
export type AssignmentChangedResponse = z.infer<typeof AssignmentChangedResponse>;
export const LoggedOutResponse = z.object({ loggedOut: z.literal(true) });

export const ChangePasswordRequest = z.object({
  currentPassword: SafeText.min(1).max(200),
  newPassword: SafeText.min(10).max(200),
});
export const ChangePasswordResponse = z.object({
  ok: z.literal(true),
  revokedSessions: z.number(),
});
export type ChangePasswordResponse = z.infer<typeof ChangePasswordResponse>;

/* ------------------------------------------------------------------ korisnici */

export const UserRow = z.object({
  id: z.string(),
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  isActive: z.boolean(),
  mustChangePassword: z.boolean(),
  roles: z.array(z.string()),
  scope: z.string(),
  createdAt: IsoDate,
});
export type UserRow = z.infer<typeof UserRow>;

export const UsersResponse = z.object({ users: z.array(UserRow) });
export type UsersResponse = z.infer<typeof UsersResponse>;

export const InviteRequest = z.object({
  email: SafeText.min(3).max(200),
  roles: z.array(Role).min(1),
  scope: Scope,
});
export type InviteRequest = z.infer<typeof InviteRequest>;

export const InviteResponse = z.object({
  id: z.string(),
  email: z.string(),
  /** Sirovi link — postoji samo u ovom odgovoru, nigdje u bazi. */
  link: z.string(),
  expiresAt: IsoDate,
});
export type InviteResponse = z.infer<typeof InviteResponse>;

export const ResetPasswordResponse = z.object({
  id: z.string(),
  link: z.string(),
  expiresAt: IsoDate,
});
export type ResetPasswordResponse = z.infer<typeof ResetPasswordResponse>;

export const MembershipPatch = z.object({
  roles: z.array(Role).min(1),
  scope: Scope,
});
export type MembershipPatch = z.infer<typeof MembershipPatch>;

export const ActivePatch = z.object({ active: z.boolean() });
export type ActivePatch = z.infer<typeof ActivePatch>;

export const SetActiveResponse = z.object({
  ok: z.literal(true),
  revokedSessions: z.number(),
});
export type SetActiveResponse = z.infer<typeof SetActiveResponse>;

export const InvitationPreview = z.object({
  email: z.string(),
  companyName: z.string(),
  roles: z.array(z.string()),
  expiresAt: IsoDate,
});
export type InvitationPreview = z.infer<typeof InvitationPreview>;

export const AcceptInvitationRequest = z.object({
  firstName: SafeText.min(1).max(100),
  lastName: SafeText.min(1).max(100),
  password: SafeText.min(10).max(200),
});
export type AcceptInvitationRequest = z.infer<typeof AcceptInvitationRequest>;

export const ApplyPasswordResetRequest = z.object({
  password: SafeText.min(10).max(200),
});
export type ApplyPasswordResetRequest = z.infer<
  typeof ApplyPasswordResetRequest
>;

/* ------------------------------------------------------------------ role i audit */

export const RolesResponse = z.object({
  permissions: z.array(
    z.object({ key: z.string(), label: z.string(), description: z.string() }),
  ),
  roles: z.array(
    z.object({
      role: z.string(),
      label: z.string(),
      description: z.string(),
      permissions: z.array(z.string()),
      assignableBy: z.array(z.string()),
    }),
  ),
  editable: z.boolean(),
});
export type RolesResponse = z.infer<typeof RolesResponse>;

export const AuditEvent = z.object({
  id: z.string(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  actorId: z.string().nullable(),
  actorEmail: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: IsoDate,
});
export type AuditEvent = z.infer<typeof AuditEvent>;

export const AuditResponse = z.object({
  rows: z.array(AuditEvent),
  nextCursor: z.string().nullable(),
});
export type AuditResponse = z.infer<typeof AuditResponse>;

/* ------------------------------------------------------------------ R2a: radnici i mašine */

export const Engagement = z.enum([
  "PERMANENT",
  "FIXED_TERM",
  "SEASONAL",
  "CONTRACT",
]);
export const Meter = z.enum(["HOURS", "KM"]);
export const Ownership = z.enum(["OWN", "RENT"]);

export const Worker = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  jobTitle: z.string().nullable(),
  engagement: z.string(),
  hiredAt: z.string().describe("Poslovni datum, gggg-mm-dd"),
  endedAt: z.string().nullable(),
  team: z.string().nullable(),
  supervisorId: z.string().nullable(),
  supervisorName: z.string().nullable(),
  /** Opciona veza na nalog; `null` je uobičajen slučaj. */
  userId: z.string().nullable(),
  userEmail: z.string().nullable(),
  isActive: z.boolean(),
});
export type Worker = z.infer<typeof Worker>;

export const WorkerInput = z.object({
  firstName: SafeText.min(1).max(100),
  lastName: SafeText.min(1).max(100),
  phone: SafeText.max(40).nullable().optional(),
  email: SafeText.max(200).nullable().optional(),
  jobTitle: SafeText.max(120).nullable().optional(),
  engagement: Engagement.optional(),
  hiredAt: SafeText,
  endedAt: SafeText.nullable().optional(),
  team: SafeText.max(120).nullable().optional(),
  supervisorId: SafeText.nullable().optional(),
});
export type WorkerInput = z.infer<typeof WorkerInput>;

export const WorkersResponse = z.object({ workers: z.array(Worker) });
export type WorkersResponse = z.infer<typeof WorkersResponse>;
export const WorkerResponse = z.object({ worker: Worker });
export type WorkerResponse = z.infer<typeof WorkerResponse>;

export const WorkerActivePatch = z.object({ active: z.boolean() });
export const WorkerLinkPatch = z.object({ userId: SafeText.nullable() });

export const EquipmentCategory = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  meter: Meter,
  isActive: z.boolean(),
  sortOrder: z.number(),
  machineCount: z.number(),
  // A2 (2026-11-07): mobilna navigacija zavisi od veze korisnik-radnik, ne samo role.
  // workerId = povezani radnički zapis (ili null); foremanScope = šef ima bar jednu
  // aktivnu R3 dodjelu danas (pa mu Grupa ima smisla).
  workerId: z.string().nullable(),
  foremanScope: z.boolean(),
});
export type EquipmentCategory = z.infer<typeof EquipmentCategory>;

export const CategoryInput = z.object({
  code: SafeText.min(2).max(40),
  name: SafeText.min(1).max(80),
  meter: Meter,
  sortOrder: z.number().optional(),
});

export const CategoriesResponse = z.object({
  categories: z.array(EquipmentCategory),
});
export type CategoriesResponse = z.infer<typeof CategoriesResponse>;

export const Machine = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  categoryId: z.string(),
  categoryName: z.string(),
  categoryCode: z.string(),
  make: z.string().nullable(),
  model: z.string().nullable(),
  serialNo: z.string().nullable(),
  plate: z.string().nullable(),
  year: z.number().nullable(),
  ownership: Ownership,
  meter: Meter,
  /** Samo TRENUTNA vrijednost; historija očitanja je R5. */
  meterValue: z.number().nullable(),
  meterUpdatedAt: IsoDate.nullable(),
  isActive: z.boolean(),
});
export type Machine = z.infer<typeof Machine>;

export const MachineInput = z.object({
  code: SafeText.min(2).max(20),
  name: SafeText.min(1).max(120),
  categoryId: SafeText,
  make: SafeText.max(80).nullable().optional(),
  model: SafeText.max(80).nullable().optional(),
  serialNo: SafeText.max(80).nullable().optional(),
  plate: SafeText.max(20).nullable().optional(),
  year: z.number().int().nullable().optional(),
  ownership: Ownership.optional(),
  meter: Meter.optional(),
  meterValue: z.number().nullable().optional(),
  /** `false` = deaktivacija; mašina i njena istorija ostaju. */
  isActive: z.boolean().optional(),
});
export type MachineInput = z.infer<typeof MachineInput>;

export const MachinesResponse = z.object({ machines: z.array(Machine) });
export type MachinesResponse = z.infer<typeof MachinesResponse>;
export const MachineResponse = z.object({ machine: Machine });
export type MachineResponse = z.infer<typeof MachineResponse>;

export const MeterPatch = z.object({
  value: z.number(),
  /** Izričita ispravka manje vrijednosti (dozvola `equipment.manage`). */
  correct: z.boolean().optional(),
});

/* ------------------------------------------------------------------ uvoz iz Excela */

export const ImportKind = z.enum(["workers", "equipment", "projects"]);
export type ImportKind = z.infer<typeof ImportKind>;

export const ImportRowOutcome = z.enum([
  "import",
  "skip",
  "error",
  "duplicate",
]);
export type ImportRowOutcome = z.infer<typeof ImportRowOutcome>;

export const ImportPreviewRow = z.object({
  rowNumber: z.number(),
  outcome: ImportRowOutcome,
  reason: z.string().optional(),
  summary: z.string(),
});
export type ImportPreviewRow = z.infer<typeof ImportPreviewRow>;

export const ImportPreview = z.object({
  kind: ImportKind,
  mapping: z.record(z.string(), z.string().nullable()),
  ignoredSheets: z.number(),
  sheetName: z.string(),
  headers: z.array(z.string()),
  fileName: z.string(),
  rows: z.array(ImportPreviewRow),
  counts: z.object({
    import: z.number(),
    skip: z.number(),
    error: z.number(),
    duplicate: z.number(),
  }),
  /** Razlozi zbog kojih uvoz ne može da krene; dok ih ima, potvrda je onemogućena. */
  blockers: z.array(z.string()),
  /** Neuvežene kolone i slično: ne blokira, ali korisnik mora vidjeti prije potvrde. */
  notices: z.array(z.string()),
});
export type ImportPreview = z.infer<typeof ImportPreview>;

export const ImportDecision = z.object({
  rowNumber: z.number(),
  action: z.enum(["import", "skip", "update"]),
});
export type ImportDecision = z.infer<typeof ImportDecision>;

export const ImportResult = z.object({
  imported: z.number(),
  updated: z.number(),
  skipped: z.number(),
  failed: z.number(),
  errors: z.array(z.object({ rowNumber: z.number(), message: z.string() })),
});
export type ImportResult = z.infer<typeof ImportResult>;

/* ------------------------------------------------------------------ obaveze (R2b) */

export const ObligationEntityKind = z.enum(["WORKER", "MACHINE", "PROJECT", "COMPANY", "TENDER"]);
export type ObligationEntityKind = z.infer<typeof ObligationEntityKind>;

/**
 * F2 dodaje `missing` (računato, nikad red), `expired`/`rejected`/`pending_review` i
 * `review_due`. Redoslijed je po hitnosti — isti kao `OBLIGATION_STATE_ORDER` u domeni.
 */
export const ObligationStateEnum = z.enum([
  "missing",
  "expired",
  "rejected",
  "pending_review",
  "expiring",
  "review_due",
  "valid",
  "no_expiry",
  "superseded",
]);
export type ObligationStateName = z.infer<typeof ObligationStateEnum>;

export const ObligationType = z.object({
  id: z.string(),
  code: z.string(),
  label: z.string(),
  entityKind: ObligationEntityKind,
  /** Pragovi podsjetnika u danima, najveći prvi. Prazan niz = nema upozorenja prije isteka. */
  defaultReminderDays: z.array(z.number()),
  requiresAttachment: z.boolean(),
  /** R3: blokira li istek ovog tipa dodjelu radnika/mašine na projekat (B5.4). */
  blocksAssignment: z.boolean(),
  isActive: z.boolean(),
  sortOrder: z.number(),
  obligationCount: z.number(),
});
export type ObligationType = z.infer<typeof ObligationType>;

export const ObligationTypeInput = z.object({
  code: SafeText.min(2).max(40),
  label: SafeText.min(1).max(80),
  entityKind: ObligationEntityKind,
  defaultReminderDays: z.array(z.number().int().min(0).max(365)).max(8).optional(),
  requiresAttachment: z.boolean().optional(),
  blocksAssignment: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});
export type ObligationTypeInput = z.infer<typeof ObligationTypeInput>;

export const ObligationTypesResponse = z.object({ types: z.array(ObligationType) });
export const ObligationTypeResponse = z.object({ type: ObligationType });

/** Verzija obaveze — obnova dodaje novu, stara ostaje za historiju. */
export const ObligationVersion = z.object({
  version: z.number(),
  number: z.string().nullable(),
  issuer: z.string().nullable(),
  issuedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  note: z.string().nullable(),
  attachmentId: z.string().nullable(),
  createdAt: IsoDate,
  createdBy: z.string().nullable(),
});
export type ObligationVersion = z.infer<typeof ObligationVersion>;

export const ObligationAttachment = z.object({
  id: z.string(),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number(),
  status: z.enum(["pending", "ready"]),
  createdAt: IsoDate,
});
export type ObligationAttachment = z.infer<typeof ObligationAttachment>;

/**
 * Registracija priloga (A1): ime i kontrolni zbir su tekst na granici API-ja, pa idu
 * kroz `SafeText` — NUL u imenu fajla ne smije stići do baze. `headBase64` su prva
 * 32 bajta fajla (base64), samo za određivanje tipa iz sadržaja.
 */
export const AttachmentRegisterRequest = z.object({
  fileName: SafeText,
  sizeBytes: z.number(),
  sha256: SafeText,
  headBase64: SafeText.optional(),
});
export type AttachmentRegisterRequest = z.infer<typeof AttachmentRegisterRequest>;

/**
 * F0.2 — jedan obrazac za priloge svih modula. `entityType` određuje koja dozvola treba
 * (vidi `attachment-access.ts` u webu), pa ugovor nosi tip, a ne četiri skoro iste rute.
 */
export const AttachmentEntityType = z.enum([
  "OBLIGATION",
  "TENDER",
  "MACHINE_DAILY_CHECK",
  /** F5: fotografija računa uz projekat (trošak nastaje poslije slike). */
  "PROJECT",
]);
export type AttachmentEntityType = z.infer<typeof AttachmentEntityType>;

export const Attachment = z.object({
  id: z.string(),
  entityType: AttachmentEntityType,
  entityId: z.string(),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number(),
  status: z.enum(["pending", "ready", "deleted"]),
  createdAt: IsoDate,
});
export type Attachment = z.infer<typeof Attachment>;

export const AttachmentListResponse = z.object({ attachments: z.array(Attachment) });
export type AttachmentListResponse = z.infer<typeof AttachmentListResponse>;

export const AttachmentRegisterBody = AttachmentRegisterRequest.extend({
  entityType: AttachmentEntityType,
  // Id je tekst na granici API-ja, pa ide kroz `SafeText` kao i ime fajla: NUL u id-u
  // ne smije stići do baze.
  entityId: SafeText.refine((value) => value.length > 0, { message: "Id entiteta je obavezan." }),
});
export type AttachmentRegisterBody = z.infer<typeof AttachmentRegisterBody>;

export const AttachmentRegisterResponse = z.object({
  attachment: Attachment,
  uploadUrl: z.string(),
  uploadExpiresAt: IsoDate,
});
export type AttachmentRegisterResponse = z.infer<typeof AttachmentRegisterResponse>;

export const AttachmentConfirmResponse = z.object({ attachment: Attachment });
export type AttachmentConfirmResponse = z.infer<typeof AttachmentConfirmResponse>;

export const AttachmentUrlResponse = z.object({ url: z.string(), expiresAt: IsoDate });
export type AttachmentUrlResponse = z.infer<typeof AttachmentUrlResponse>;

export const Obligation = z.object({
  id: z.string(),
  typeId: z.string(),
  typeLabel: z.string(),
  typeCode: z.string(),
  entityKind: ObligationEntityKind,
  workerId: z.string().nullable(),
  workerName: z.string().nullable(),
  machineId: z.string().nullable(),
  machineCode: z.string().nullable(),
  machineName: z.string().nullable(),
  /** R3: obaveza može visjeti na projektu (građevinska dozvola, saglasnosti). */
  projectId: z.string().nullable(),
  projectCode: z.string().nullable(),
  projectName: z.string().nullable(),
  /** R7: obaveza na tenderu. */
  tenderId: z.string().nullable(),
  tenderTitle: z.string().nullable(),
  number: z.string().nullable(),
  issuer: z.string().nullable(),
  issuedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  currentVersion: z.number(),
  responsibleUserId: z.string().nullable(),
  responsibleName: z.string().nullable(),
  note: z.string().nullable(),
  /** Izvedeno iz roka i pragova tipa; nikad se ne čuva kao kolona. */
  state: ObligationStateEnum,
  daysLeft: z.number().nullable(),
  reminderDays: z.array(z.number()),
  /** F2: datum do kojeg ured provjerava trajnu obavezu (`expires_at IS NULL`). */
  reviewAt: z.string().nullable(),
  reviewState: z.enum(["none", "pending_review", "rejected"]),
  /** Zašto je odbijeno — obavezan kad je `reviewState` `rejected`. */
  reviewNote: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  /** Koje radnje tip blokira kad je istekao/odbijen (`canUseEntity`). */
  blocksActions: z.array(z.string()),
  attachments: z.array(ObligationAttachment),
  createdAt: IsoDate,
});
export type Obligation = z.infer<typeof Obligation>;

export const ObligationsResponse = z.object({
  obligations: z.array(Obligation),
  counts: z.object({
    all: z.number(),
    expired: z.number(),
    expiring: z.number(),
    valid: z.number(),
    no_expiry: z.number(),
    /** F2: posao ureda — koliko dokumenata čeka odluku. */
    pending_review: z.number(),
    rejected: z.number(),
    review_due: z.number(),
  }),
  /** Današnji poslovni datum firme — ekran ga prikazuje da se zna po kojoj se zoni računa. */
  today: z.string(),
});
export type ObligationsResponse = z.infer<typeof ObligationsResponse>;

export const ObligationResponse = z.object({
  obligation: Obligation,
  versions: z.array(ObligationVersion),
});
export type ObligationResponse = z.infer<typeof ObligationResponse>;

export const ObligationInput = z.object({
  typeId: SafeText,
  workerId: SafeText.nullable().optional(),
  machineId: SafeText.nullable().optional(),
  projectId: SafeText.nullable().optional(),
  tenderId: SafeText.nullable().optional(),
  scopeCompany: z.boolean().optional(),
  number: SafeText.max(120).nullable().optional(),
  issuer: SafeText.max(200).nullable().optional(),
  issuedAt: SafeText.nullable().optional(),
  expiresAt: SafeText.nullable().optional(),
  /** F2: obavezan kad `expiresAt` nema — trajna obaveza se provjerava do tog datuma. */
  reviewAt: SafeText.nullable().optional(),
  responsibleUserId: SafeText.nullable().optional(),
  note: SafeText.max(2000).nullable().optional(),
});
export type ObligationInput = z.infer<typeof ObligationInput>;

/** Obnova = nova verzija. Stara ostaje; `expiresAt` je novi rok. */
export const ObligationRenewInput = z.object({
  number: SafeText.max(120).nullable().optional(),
  issuer: SafeText.max(200).nullable().optional(),
  issuedAt: SafeText.nullable().optional(),
  expiresAt: SafeText,
  note: SafeText.max(2000).nullable().optional(),
});
export type ObligationRenewInput = z.infer<typeof ObligationRenewInput>;

/** Ispravka greške u unosu — dozvoljena 24 h od unosa, bilježi se sa starom i novom vrijednošću. */
export const ObligationCorrectInput = ObligationRenewInput.partial({ expiresAt: true }).extend({
  expiresAt: SafeText.nullable().optional(),
});
export type ObligationCorrectInput = z.infer<typeof ObligationCorrectInput>;

/* ------------------------------------------------------------------ R4 sync */

const OffsetDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/);

export const SyncWorkEntryPayload = z.object({
  kind: z.enum(["WORK", "BREAK"]),
  startedAt: OffsetDateTime,
  endedAt: OffsetDateTime.nullable(),
  endState: z.enum(["OPEN", "KNOWN_END", "UNKNOWN_END"]),
  projectId: z.string().min(1).max(128).nullable(),
  machineId: z.string().min(1).max(128).nullable(),
  note: z.string().max(2000).nullable(),
}).strict();

export const SyncMachineWorkLogPayload = z.object({
  machineId: z.string().min(1).max(128),
  projectId: z.string().min(1).max(128).nullable(),
  startedAt: OffsetDateTime,
  endedAt: OffsetDateTime,
  mode: z.enum(["WORK", "IDLE", "BREAKDOWN"]),
  meterEnd: z.number().finite().min(0).nullable(),
  note: z.string().max(2000).nullable(),
}).strict();

export const SyncPushItem = z.discriminatedUnion("entityType", [
  z.object({
    localId: z.string().uuid(),
    entityType: z.literal("work_entry"),
    /** Only group submissions include this; the server enforces R3 assignment scope by work_date. */
    workerId: z.string().min(1).max(128).optional(),
    workdayId: z.string().uuid(),
    workEntryId: z.string().uuid(),
    baseVersion: z.number().int().positive().optional(),
    deviceSentAt: OffsetDateTime,
    entry: SyncWorkEntryPayload,
  }).strict(),
  z.object({
    localId: z.string().uuid(),
    entityType: z.literal("workday"),
    workerId: z.string().min(1).max(128).optional(),
    workdayId: z.string().uuid(),
    baseVersion: z.number().int().positive(),
    deviceSentAt: OffsetDateTime,
    status: z.literal("SUBMITTED"),
  }).strict(),
  z.object({
    localId: z.string().uuid(),
    entityType: z.literal("machine_work_log"),
    workLogId: z.string().min(1).max(128),
    deviceSentAt: OffsetDateTime,
    log: SyncMachineWorkLogPayload,
  }).strict(),
  z.object({
    localId: z.string().uuid(),
    entityType: z.literal("fuel_entry"),
    fuelEntryId: z.string().min(1).max(128),
    deviceSentAt: OffsetDateTime,
    entry: z.object({
      machineId: z.string().min(1).max(128),
      projectId: z.string().min(1).max(128).nullable(),
      filledAt: OffsetDateTime,
      liters: z.number().finite().positive(),
      totalAmount: z.string().min(1).nullable(),
      currencyCode: z.string().length(3),
      unitPriceAmount: z.string().min(1).nullable(),
      meterReading: z.number().finite().min(0).nullable(),
      note: z.string().max(2000).nullable(),
    }).strict(),
  }).strict(),
  z.object({
    localId: z.string().uuid(),
    entityType: z.literal("haul"),
    haulId: z.string().min(1).max(128),
    deviceSentAt: OffsetDateTime,
    haul: z.object({
      machineId: z.string().min(1).max(128),
      projectId: z.string().min(1).max(128).nullable(),
      segmentId: z.string().min(1).max(128).nullable(),
      hauledAt: OffsetDateTime,
      originText: z.string().min(1).max(200),
      destinationText: z.string().min(1).max(200),
      materialText: z.string().min(1).max(200),
      quantity: z.number().finite().positive(),
      quantityUnit: z.enum(["M3", "T"]),
      scaleTicketText: z.string().max(120).nullable(),
      tripCount: z.number().int().positive(),
      note: z.string().max(2000).nullable(),
    }).strict(),
  }).strict(),
  z.object({
    localId: z.string().uuid(),
    entityType: z.literal("machine_daily_check"),
    checkId: z.string().min(1).max(128),
    deviceSentAt: OffsetDateTime,
    check: z.object({
      machineId: z.string().min(1).max(128),
      projectId: z.string().min(1).max(128).nullable(),
      checkedAt: OffsetDateTime,
      result: z.enum(["PASS", "FAIL", "CONDITIONAL"]),
      checklistJson: z.record(z.string(), z.unknown()),
      note: z.string().max(2000).nullable(),
    }).strict(),
  }).strict(),
  z.object({
    localId: z.string().uuid(),
    entityType: z.literal("machine_fault"),
    faultId: z.string().min(1).max(128),
    deviceSentAt: OffsetDateTime,
    fault: z.object({
      machineId: z.string().min(1).max(128),
      projectId: z.string().min(1).max(128).nullable(),
      partnerId: z.string().min(1).max(128).nullable(),
      reportedAt: OffsetDateTime,
      title: SafeText.min(1).max(200),
      description: SafeText.max(4000).nullable(),
      priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
      estimatedCostAmount: z.string().min(1).nullable(),
      currencyCode: z.string().length(3).nullable(),
      downtimeMinutes: z.number().int().min(0).nullable(),
    }).strict(),
  }).strict(),
  z.object({
    localId: z.string().uuid(),
    entityType: z.literal("service_order_action"),
    /** Ključ idempotencije radnje — isti ID dvaput ne skida dio dvaput. */
    actionId: z.string().min(1).max(128),
    serviceOrderId: z.string().min(1).max(128),
    deviceSentAt: OffsetDateTime,
    action: z.object({
      kind: z.enum(["START", "WAIT_PARTS", "FINISH", "PART"]),
      laborHours: z.string().regex(/^\d{1,3}(?:\.\d{1,2})?$/).nullable(),
      externalCostAmount: z.string().min(1).nullable(),
      warrantyUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
      note: SafeText.max(1000).nullable(),
      part: z.object({
        itemId: z.string().min(1).max(128),
        quantity: z.string().regex(/^\d{1,9}(?:\.\d{1,3})?$/),
        unitCostAmount: z.string().min(1).nullable(),
        note: SafeText.max(1000).nullable(),
      }).strict().nullable(),
    }).strict(),
  }).strict(),
  /* ------------------------------------------------ F9: dnevnik građenja i HSE (spec 10) */
  z.object({
    localId: z.string().uuid(),
    entityType: z.literal("site_diary"),
    diaryId: z.string().min(1).max(128),
    deviceSentAt: OffsetDateTime,
    baseVersion: z.number().int().min(1),
    diary: z.object({
      projectId: z.string().min(1).max(128),
      diaryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      weather: z.enum(["CLEAR", "CLOUDY", "RAIN", "SNOW", "WIND", "FROST", "HEAT"]).nullable(),
      temperatureC: z.string().regex(/^-?\d{1,3}(?:\.\d)?$/).nullable(),
      workedHours: z.string().regex(/^\d{1,2}(?:\.\d{1,2})?$/).nullable(),
      description: SafeText.max(4000).nullable(),
      visitors: SafeText.max(2000).nullable(),
      events: SafeText.max(4000).nullable(),
      signedName: SafeText.min(2).max(200).nullable(),
      signature: z.object({ signedAt: OffsetDateTime, autoSnapshotJson: z.string().min(2).max(200_000) }).strict().optional(),
      delays: z.array(z.object({
        kind: z.enum(["RAIN", "SNOW", "WIND", "FROST", "SUBCONTRACTOR", "MATERIAL", "PERMIT", "OTHER"]),
        fromAt: OffsetDateTime,
        toAt: OffsetDateTime,
        hours: z.string().regex(/^\d{1,2}(?:\.\d{1,2})?$/),
        note: SafeText.max(1000).nullable(),
      }).strict()).max(20),
    }).strict(),
  }).strict(),
  z.object({
    localId: z.string().uuid(),
    entityType: z.literal("site_diary_item"),
    diaryItemId: z.string().min(1).max(128),
    diaryProjectId: z.string().min(1).max(128).optional(),
    diaryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    deviceSentAt: OffsetDateTime,
    item: z.object({
      boqItemId: z.string().min(1).max(128).nullable(),
      description: SafeText.min(1).max(500),
      unit: z.string().min(1).max(20),
      quantity: z.string().regex(/^\d{1,14}(?:\.\d{1,3})?$/),
      source: z.enum(["MANUAL", "HAUL", "BOQ"]),
    }).strict(),
  }).strict(),
  z.object({
    localId: z.string().uuid(),
    entityType: z.literal("hse_incident"),
    incidentId: z.string().min(1).max(128),
    deviceSentAt: OffsetDateTime,
    incident: z.object({
      kind: z.enum(["ACCIDENT", "NEAR_MISS", "PROPERTY_DAMAGE", "ENVIRONMENTAL", "OCCUPATIONAL_ILLNESS"]),
      severity: z.enum(["MINOR", "MODERATE", "SEVERE", "FATAL"]),
      occurredAt: OffsetDateTime,
      projectId: z.string().min(1).max(128).nullable(),
      locationText: SafeText.max(300).nullable(),
      lat: z.string().regex(/^-?\d{1,3}(?:\.\d{1,6})?$/).nullable(),
      lng: z.string().regex(/^-?\d{1,3}(?:\.\d{1,6})?$/).nullable(),
      description: SafeText.min(5).max(4000),
      immediateAction: SafeText.max(2000).nullable(),
      injuredWorkerId: z.string().min(1).max(128).nullable(),
      involvedWorkers: z.array(z.object({ workerId: z.string().min(1).max(128), injured: z.boolean() }).strict()).max(100).optional(),
      lostDays: z.number().int().min(0).max(3650),
      reportableToAuthority: z.boolean(),
      photos: z.array(z.object({
        fileName: z.string().min(1).max(200),
        contentType: z.enum(["image/jpeg", "image/png", "image/webp", "image/heic"]),
        sizeBytes: z.number().int().min(1).max(10_485_760),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
      }).strict()).max(10),
      updateBody: SafeText.max(4000).nullable(),
    }).strict(),
  }).strict(),
  z.object({
    localId: z.string().uuid(),
    entityType: z.literal("hse_action"),
    actionId: z.string().min(1).max(128),
    deviceSentAt: OffsetDateTime,
    action: z.object({
      incidentId: z.string().min(1).max(128).nullable(),
      inspectionId: z.string().min(1).max(128).nullable(),
      description: SafeText.min(5).max(1000),
      responsibleWorkerId: z.string().min(1).max(128),
      dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }).strict(),
  }).strict(),
  z.object({
    localId: z.string().uuid(),
    entityType: z.literal("hse_training"),
    trainingId: z.string().min(1).max(128),
    deviceSentAt: OffsetDateTime,
    training: z.object({
      kind: z.enum(["INDUCTION", "TOOLBOX", "TASK_INSTRUCTION", "CERTIFICATION", "DRILL"]),
      title: SafeText.min(2).max(200),
      topic: SafeText.max(1000).nullable(),
      heldAt: OffsetDateTime,
      projectId: z.string().min(1).max(128).nullable(),
      location: SafeText.max(200).nullable(),
      durationMinutes: z.number().int().min(1).max(600).nullable(),
      attendees: z.array(z.object({
        workerId: z.string().min(1).max(128),
        signatureName: SafeText.min(2).max(200),
        signedAt: OffsetDateTime,
      }).strict()).min(1).max(100),
    }).strict(),
  }).strict(),
]);
export type SyncPushItem = z.infer<typeof SyncPushItem>;

export const SyncPushRequest = z.object({
  items: z.array(SyncPushItem).min(1).max(100),
}).strict();
export type SyncPushRequest = z.infer<typeof SyncPushRequest>;

export const SyncPushResponse = z.object({
  results: z.array(z.object({
    localId: z.string().uuid(),
    status: z.enum(["APPLIED", "DUPLICATE", "CONFLICT", "REJECTED"]),
    entityId: z.string().nullable(),
    version: z.number().int().positive().nullable(),
    cursor: z.string().nullable(),
    canonicalWorkdayId: z.string().optional(),
    conflictId: z.string().optional(),
    code: z.string().optional(),
  })),
});
export type SyncPushResponse = z.infer<typeof SyncPushResponse>;

export const SyncPullEvent = z.object({
  id: z.string(),
  cursorSeq: z.string(),
  entityType: z.enum([
    "workday", "work_entry", "sync_conflict", "machine_work_log", "fuel_entry", "haul",
    "machine_daily_check", "machine_fault", "service_order_action",
    /* F9: dnevnik građenja i HSE. */
    "site_diary", "site_diary_item", "hse_incident", "hse_action", "hse_training",
  ]),
  entityId: z.string(),
  entityVersion: z.number().int().positive(),
  payload: z.record(z.string(), z.unknown()).nullable(),
  tombstone: z.boolean(),
  createdAt: IsoDate,
});
export type SyncPullEvent = z.infer<typeof SyncPullEvent>;

export const SyncPullResponse = z.object({
  events: z.array(SyncPullEvent),
  cursor: z.string(),
  cursorFloor: z.string(),
  hasMore: z.boolean(),
});
export type SyncPullResponse = z.infer<typeof SyncPullResponse>;

/** Minimalni R3-scoped worker roster for SITE_SUPERVISOR group-entry; no PII beyond display name. */
export const ForemanWorker = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(260),
}).strict();
export type ForemanWorker = z.infer<typeof ForemanWorker>;

export const ForemanWorkersResponse = z.object({
  workDate: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/),
  workers: z.array(ForemanWorker),
}).strict();
export type ForemanWorkersResponse = z.infer<typeof ForemanWorkersResponse>;

/** Promjena rola i opsega — vraća stanje prije i poslije (UI prikazuje razliku). */
export const MembershipChange = z.object({
  userId: z.string(),
  email: z.string(),
  before: z.object({ roles: z.array(z.string()), scope: z.string() }),
  after: z.object({ roles: z.array(z.string()), scope: z.string() }),
});
export type MembershipChange = z.infer<typeof MembershipChange>;

/* ------------------------------------------------------- projekti i dodjele (R3) */

export const ProjectStatus = z.enum(["PLANNED", "ACTIVE", "PAUSED", "FINISHED", "CANCELLED"]);
export type ProjectStatus = z.infer<typeof ProjectStatus>;

/**
 * Projekt na listi i u detalju.
 *
 * `overdueObligations` je namjerno broj, a ne spisak: lista projekata prikazuje koliko toga gori, a
 * pojedinačne rokove daje ekran rokova filtriran po projektu. Tako se ne šalje isti spisak dvaput.
 */
export const Project = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  status: ProjectStatus,
  siteAddress: z.string().nullable(),
  sitePlace: z.string().nullable(),
  startsOn: z.string().nullable(),
  endsOn: z.string().nullable(),
  managerWorkerId: z.string().nullable(),
  managerName: z.string().nullable(),
  note: z.string().nullable(),
  isActive: z.boolean(),
  workerCount: z.number(),
  machineCount: z.number(),
  overdueObligations: z.number(),
  expiringObligations: z.number(),
  createdAt: IsoDate,
});
export type Project = z.infer<typeof Project>;

export const ProjectsResponse = z.object({ projects: z.array(Project) });
export type ProjectsResponse = z.infer<typeof ProjectsResponse>;

export const ProjectResponse = z.object({ project: Project });
export type ProjectResponse = z.infer<typeof ProjectResponse>;

export const ProjectInput = z.object({
  code: SafeText.min(1).max(40),
  name: SafeText.min(1).max(200),
  status: ProjectStatus.optional(),
  siteAddress: SafeText.max(300).nullable().optional(),
  sitePlace: SafeText.max(120).nullable().optional(),
  startsOn: SafeText.nullable().optional(),
  endsOn: SafeText.nullable().optional(),
  managerWorkerId: SafeText.nullable().optional(),
  note: SafeText.max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
});
export type ProjectInput = z.infer<typeof ProjectInput>;

/**
 * Dodjela: radnik ILI mašina, sa periodom.
 *
 * `overrides` su iznimke od blokade — idu uz upis, jer odobrenje iznimke i sama dodjela su jedan
 * čin (dodjela bez iznimke bi bila odbijena, a iznimka bez dodjele ne visi ni o čemu).
 */
export const AssignmentInput = z.object({
  workerId: SafeText.nullable().optional(),
  machineId: SafeText.nullable().optional(),
  fromDate: SafeText,
  toDate: SafeText.nullable().optional(),
  note: SafeText.max(500).nullable().optional(),
  overrides: z
    .array(
      z.object({
        obligationId: SafeText,
        reason: SafeText.max(500),
        validUntil: SafeText,
      }),
    )
    .max(20)
    .optional(),
});
export type AssignmentInput = z.infer<typeof AssignmentInput>;

export const AssignmentChangeInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("END") }),
  z.object({ action: z.literal("VOID"), reason: SafeText.trim().min(10).max(500) }),
]);
export type AssignmentChangeInput = z.infer<typeof AssignmentChangeInput>;

export const ProjectAssignment = z.object({
  id: z.string(),
  projectId: z.string(),
  workerId: z.string().nullable(),
  workerName: z.string().nullable(),
  machineId: z.string().nullable(),
  machineCode: z.string().nullable(),
  machineName: z.string().nullable(),
  fromDate: z.string(),
  toDate: z.string().nullable(),
  note: z.string().nullable(),
  voidedAt: IsoDate.nullable(),
  voidedByName: z.string().nullable(),
  voidReason: z.string().nullable(),
  /** Blokade zbog isteklih obaveza, sa iznimkom ili bez nje. */
  blocked: z.array(
    z.object({
      obligationId: z.string(),
      typeLabel: z.string(),
      covered: z.boolean(),
      reason: z.string().optional(),
    }),
  ),
  createdAt: IsoDate,
});
export type ProjectAssignment = z.infer<typeof ProjectAssignment>;

export const ProjectAssignmentsResponse = z.object({
  assignments: z.array(ProjectAssignment),
  /** Današnji poslovni datum firme — isti razlog kao kod rokova. */
  today: z.string(),
});
export type ProjectAssignmentsResponse = z.infer<typeof ProjectAssignmentsResponse>;

export const ProjectAssignmentResponse = z.object({ assignment: ProjectAssignment });
export type ProjectAssignmentResponse = z.infer<typeof ProjectAssignmentResponse>;

/* ---------------------------------------------- zahtjev za iznimku (R3) */

/**
 * Zahtjev za iznimku od blokade.
 *
 * Postoji zato što iznimku odobrava `projects.override` (vlasnik/admin), a dodjeljuje
 * `projects.assign` (i PM). Bez zahtjeva bi PM morao zvati vlasnika telefonom.
 */
export const OverrideRequest = z.object({
  id: z.string(),
  projectId: z.string(),
  obligationId: z.string(),
  typeLabel: z.string(),
  workerId: z.string().nullable(),
  machineId: z.string().nullable(),
  targetName: z.string(),
  reason: z.string(),
  requestedBy: z.string().nullable(),
  requestedByName: z.string().nullable(),
  createdAt: IsoDate,
});
export type OverrideRequest = z.infer<typeof OverrideRequest>;

export const OverrideRequestsResponse = z.object({ requests: z.array(OverrideRequest) });
export type OverrideRequestsResponse = z.infer<typeof OverrideRequestsResponse>;

export const OverrideRequestInput = z.object({
  obligationId: SafeText,
  workerId: SafeText.nullable().optional(),
  machineId: SafeText.nullable().optional(),
  reason: SafeText.min(10).max(500),
  fromDate: SafeText,
  toDate: SafeText.nullable().optional(),
});
export type OverrideRequestInput = z.infer<typeof OverrideRequestInput>;

export const OverrideRequestResponse = z.object({ request: OverrideRequest });
export type OverrideRequestResponse = z.infer<typeof OverrideRequestResponse>;

/** Odobrenje: rok je OBAVEZAN — iznimka bez roka je trajno gašenje pravila. */
export const OverrideApproveInput = z.object({
  validUntil: SafeText,
  fromDate: SafeText.optional(),
  toDate: SafeText.nullable().optional(),
});
export type OverrideApproveInput = z.infer<typeof OverrideApproveInput>;

/* ------------------------------------------- R4a-2 razrješenje sukoba */

export const ConflictEntryTimes = z.object({
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  endState: z.string(),
});
export type ConflictEntryTimes = z.infer<typeof ConflictEntryTimes>;

export const WorkdayConflict = z.object({
  id: z.string(),
  status: z.enum(["OPEN", "RESOLVED"]),
  createdAt: IsoDate,
  ageDays: z.number(),
  workerName: z.string().nullable(),
  projectId: z.string().nullable(),
  projectCode: z.string().nullable(),
  projectName: z.string().nullable(),
  workDate: z.string().nullable(),
  serverTimes: ConflictEntryTimes.nullable(),
  receivedTimes: ConflictEntryTimes.nullable(),
  resolutionKind: z.enum(["ACCEPT_SERVER", "ACCEPT_RECEIVED", "CORRECTED_TIMES", "REJECTED"]).nullable(),
  resolvedByName: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  resolvedByParty: z.boolean(),
});
export type WorkdayConflict = z.infer<typeof WorkdayConflict>;

export const WorkdayConflictsResponse = z.object({
  conflicts: z.array(WorkdayConflict),
  total: z.number(),
});
export type WorkdayConflictsResponse = z.infer<typeof WorkdayConflictsResponse>;

export const WorkdayConflictListQuery = z.object({
  status: z.enum(["OPEN", "RESOLVED"]).optional(),
  projectId: z.string().optional(),
  olderThanDays: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
export type WorkdayConflictListQuery = z.infer<typeof WorkdayConflictListQuery>;

export const WorkdayConflictDetail = WorkdayConflict.extend({
  reason: z.string().nullable(),
  internalNote: z.string().nullable(),
  clockSkewMinutes: z.number().nullable(),
  server: z.object({
    authorName: z.string().nullable(),
    source: z.literal("server"),
    receivedAt: z.string().nullable(),
    kind: z.string().nullable(),
    projectId: z.string().nullable(),
    machineLabel: z.string().nullable(),
    times: ConflictEntryTimes.nullable(),
  }).nullable(),
  received: z.object({
    authorName: z.string().nullable(),
    source: z.literal("telefon"),
    receivedAt: z.string(),
    kind: z.string().nullable(),
    projectId: z.string().nullable(),
    machineId: z.string().nullable(),
    times: ConflictEntryTimes.nullable(),
  }).nullable(),
});
export type WorkdayConflictDetail = z.infer<typeof WorkdayConflictDetail>;

export const WorkdayConflictDetailResponse = z.object({ conflict: WorkdayConflictDetail });
export type WorkdayConflictDetailResponse = z.infer<typeof WorkdayConflictDetailResponse>;

export const WorkdayConflictCountsResponse = z.object({
  open: z.number(),
  olderThanThreshold: z.number(),
  thresholdDays: z.number(),
});
export type WorkdayConflictCountsResponse = z.infer<typeof WorkdayConflictCountsResponse>;

/** Razlog je vidljiv autoru odbačenog unosa; interna napomena nikad ne ide na uređaj. */
export const ResolveConflictInput = z.object({
  kind: z.enum(["ACCEPT_SERVER", "ACCEPT_RECEIVED", "CORRECTED_TIMES", "REJECTED"]),
  reason: SafeText.min(10).max(500),
  internalNote: SafeText.min(1).max(2000).nullable().optional(),
  idempotencyKey: SafeText.min(1).max(200),
  correctedTimes: ConflictEntryTimes.optional(),
  correctedTarget: z.enum(["SERVER", "RECEIVED"]).optional(),
});
export type ResolveConflictInput = z.infer<typeof ResolveConflictInput>;

export const ResolveConflictResponse = z.object({
  outcome: z.enum(["RESOLVED", "ALREADY_RESOLVED", "VALIDATION_FAILED", "FORBIDDEN", "NOT_FOUND"]),
  conflictId: z.string(),
  kind: z.enum(["ACCEPT_SERVER", "ACCEPT_RECEIVED", "CORRECTED_TIMES", "REJECTED"]).optional(),
  resolvedBy: z.string().optional(),
  resolvedAt: z.string().optional(),
  reason: z.string().optional(),
  resolvedByParty: z.boolean().optional(),
  oldTimes: ConflictEntryTimes.nullable().optional(),
  newTimes: ConflictEntryTimes.nullable().optional(),
  rejectedEntryId: z.string().nullable().optional(),
  acceptedEntryId: z.string().nullable().optional(),
  code: z.string().optional(),
});
export type ResolveConflictResponse = z.infer<typeof ResolveConflictResponse>;

/* ============================================================ C.1 — Pregled */

/**
 * „Šta traži pažnju“ — podaci, ne kopija. Ekran (i samo ekran) redoslijed, nazive,
 * tonove i linkove; servis vraća brojeve i najstarije/najbliže primjere, pa broj na
 * početnoj stranici i lista na koju red vodi računaju ISTO stanje.
 *
 * `date` polja su poslovni datumi firme (`YYYY-MM-DD`), trenuci (`lastSyncAt`) su UTC
 * ISO trenuci — prikaz ih formatuje u zoni firme.
 */
export const PregledObligationExample = z.object({
  typeLabel: z.string(),
  /** Radnik (ime i prezime) ili šifra mašine — nosilac obaveze. */
  target: z.string(),
  expiresAt: IsoDate,
});
export type PregledObligationExample = z.infer<typeof PregledObligationExample>;

export const PregledConflictExample = z.object({
  workerName: z.string(),
  /** Kada je sukob otvoren (UTC ISO trenutak). */
  createdAt: IsoDate,
});
export type PregledConflictExample = z.infer<typeof PregledConflictExample>;

export const PregledReviewDayExample = z.object({
  workerName: z.string(),
  workDate: IsoDate,
  /** `open` = otvoren segment (kraj nije ni poslan), `unknown` = kraj nepoznat. */
  kind: z.enum(["open", "unknown"]),
});
export type PregledReviewDayExample = z.infer<typeof PregledReviewDayExample>;

export const PregledBlockedExample = z.object({
  /** Radnik ili šifra mašine čija dodjela stoji na isteklom dokumentu. */
  target: z.string(),
  typeLabel: z.string(),
});
export type PregledBlockedExample = z.infer<typeof PregledBlockedExample>;

export const PregledAttention = z.object({
  expired: z.object({
    count: z.number(),
    /** Najstarije tri — „zašto ovaj red postoji“. */
    oldest: z.array(PregledObligationExample),
  }),
  conflicts: z.object({
    count: z.number(),
    olderThanThreshold: z.number(),
    thresholdDays: z.number(),
    oldest: z.array(PregledConflictExample),
  }),
  expiring30: z.object({
    count: z.number(),
    nearest: PregledObligationExample.nullable(),
  }),
  reviewDays: z.object({
    count: z.number(),
    oldest: z.array(PregledReviewDayExample),
  }),
  blockedAssignments: z.object({
    count: z.number(),
    examples: z.array(PregledBlockedExample),
  }),
  expiring3190: z.object({
    count: z.number(),
    nearest: PregledObligationExample.nullable(),
  }),
});
export type PregledAttention = z.infer<typeof PregledAttention>;

export const PregledSummary = z.object({
  activeProjects: z.number(),
  activeWorkers: z.number(),
  activeMachines: z.number(),
  entriesThisWeek: z.number(),
});
export type PregledSummary = z.infer<typeof PregledSummary>;

/** R6.2 dashboard agregati (dashboard.view); null ako osoba nema dozvolu. */
export const PregledDashboard = z.object({
  activeProjects: z.number(),
  bookedCostsAmount: z.string(),
  bookedCostsCurrency: z.string(),
  hoursInPeriod: z.string(),
  periodFrom: IsoDate,
  periodTo: IsoDate,
});
export type PregledDashboard = z.infer<typeof PregledDashboard>;

/**
 * Sinhronizacija po korisniku koji je ikad poslao stavku: zadnji trenutak i broj
 * njegovih neuspješnih stavki (odbijeni računi + nerazriješeni sukobi).
 */
export const PregledSyncRow = z.object({
  userId: z.string(),
  name: z.string(),
  lastSyncAt: IsoDate,
  failedItems: z.number(),
});
export type PregledSyncRow = z.infer<typeof PregledSyncRow>;

export const PregledResponse = z.object({
  /** Poslovni datum firme po kojem se sva stanja računaju (`YYYY-MM-DD`). */
  today: IsoDate,
  /** Vremenska zona firme (IANA) — ekran formatuje trenutke u njoj. */
  timezone: z.string(),
  attention: PregledAttention,
  summary: PregledSummary,
  /** R6.2: null bez `dashboard.view`. */
  dashboard: PregledDashboard.nullable(),
  /** Samo OWNER i ADMIN; ostali ne dobijaju ni praznu listu, nego `null`. */
  sync: z.array(PregledSyncRow).nullable(),
  /** `"projects"` = brojevi su suženi na opseg iz sesije (PM/šef s PROJECTS opsegom). */
  scope: z.enum(["company", "projects"]),
});
export type PregledResponse = z.infer<typeof PregledResponse>;

/* ============================================================ R4b — potvrda / sedmica */

export const WorkdayApprovalOutcome = z.object({
  outcome: z.enum(["OK", "VALIDATION_FAILED", "FORBIDDEN", "NOT_FOUND", "CONFLICT"]),
  workdayId: z.string().optional(),
  weekStart: z.string().optional(),
  status: z.string().optional(),
  code: z.string().optional(),
  message: z.string().optional(),
});
export type WorkdayApprovalOutcome = z.infer<typeof WorkdayApprovalOutcome>;

const BusinessDate = SafeText.regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/);

export const WeekDecideInput = z.object({
  weekStart: BusinessDate,
  decision: z.enum(["APPROVE", "REJECT"]),
  reason: SafeText.min(10).max(500).optional(),
});
export type WeekDecideInput = z.infer<typeof WeekDecideInput>;

export const WeekLockInput = z.object({ weekStart: BusinessDate });
export type WeekLockInput = z.infer<typeof WeekLockInput>;

export const WorkdayReviseInput = z.object({
  reason: SafeText.min(10).max(500),
  payload: z.record(z.string(), z.unknown()).default({}),
});
export type WorkdayReviseInput = z.infer<typeof WorkdayReviseInput>;

/* ============================================================ R5.1 — sati mašine */

export const MachineWorkLogRow = z.object({
  id: z.string(),
  machine_id: z.string(),
  machine_code: z.string(),
  machine_name: z.string(),
  worker_id: z.string(),
  worker_name: z.string(),
  project_id: z.string().nullable(),
  project_code: z.string().nullable(),
  project_name: z.string().nullable(),
  started_at: z.string(),
  ended_at: z.string(),
  mode: z.enum(["WORK", "IDLE", "BREAKDOWN"]),
  meter_end: z.number().nullable(),
  note: z.string().nullable(),
  version: z.number().int().positive(),
  created_at: z.string(),
});
export type MachineWorkLogRow = z.infer<typeof MachineWorkLogRow>;

export const MachineWorkLogsResponse = z.object({
  logs: z.array(MachineWorkLogRow),
});
export type MachineWorkLogsResponse = z.infer<typeof MachineWorkLogsResponse>;

export const MachineWorkLogCreateInput = z.object({
  machineId: z.string().min(1).max(128),
  workerId: z.string().min(1).max(128).nullable().optional(),
  projectId: z.string().min(1).max(128).nullable().optional(),
  startedAt: OffsetDateTime,
  endedAt: OffsetDateTime,
  mode: z.enum(["WORK", "IDLE", "BREAKDOWN"]),
  meterEnd: z.number().finite().nonnegative().nullable().optional(),
  note: SafeText.max(2000).nullable().optional(),
}).strict();
export type MachineWorkLogCreateInput = z.infer<typeof MachineWorkLogCreateInput>;

export const MachineWorkLogMutationOutcome = z.object({
  outcome: z.enum(["OK", "VALIDATION_FAILED", "FORBIDDEN", "CONFLICT"]),
  id: z.string().optional(),
  code: z.string().optional(),
  message: z.string().optional(),
});
export type MachineWorkLogMutationOutcome = z.infer<typeof MachineWorkLogMutationOutcome>;

export const MachineWorkLogReviseInput = z.object({
  reason: SafeText.min(10).max(500),
  payload: z.record(z.string(), z.unknown()).default({}),
});
export type MachineWorkLogReviseInput = z.infer<typeof MachineWorkLogReviseInput>;

/* ============================================================ R5.2 — gorivo */

export const FuelEntryRow = z.object({
  id: z.string(),
  machine_id: z.string(),
  machine_code: z.string(),
  machine_name: z.string(),
  driver_worker_id: z.string(),
  driver_name: z.string(),
  project_id: z.string().nullable(),
  project_code: z.string().nullable(),
  project_name: z.string().nullable(),
  filled_at: z.string(),
  liters: z.number(),
  amount: z.string().nullable(),
  currency_code: z.string().nullable(),
  unit_price: z.string().nullable(),
  meter_reading: z.number().nullable(),
  note: z.string().nullable(),
  version: z.number().int().positive(),
  created_at: z.string(),
});
export type FuelEntryRow = z.infer<typeof FuelEntryRow>;

export const FuelEntriesResponse = z.object({
  entries: z.array(FuelEntryRow),
});
export type FuelEntriesResponse = z.infer<typeof FuelEntriesResponse>;

const MoneyAmount = z.string().regex(/^\d+\.\d{2}$/);

export const FuelEntryCreateInput = z.object({
  machineId: z.string().min(1).max(128),
  driverWorkerId: z.string().min(1).max(128).nullable().optional(),
  projectId: z.string().min(1).max(128).nullable().optional(),
  filledAt: OffsetDateTime,
  liters: z.number().finite().positive(),
  totalAmount: MoneyAmount.nullable().optional(),
  currencyCode: z.string().length(3).optional(),
  unitPriceAmount: MoneyAmount.nullable().optional(),
  meterReading: z.number().finite().nonnegative().nullable().optional(),
  note: SafeText.max(2000).nullable().optional(),
}).strict();
export type FuelEntryCreateInput = z.infer<typeof FuelEntryCreateInput>;

export const FuelEntryPriceInput = z.object({
  totalAmount: MoneyAmount,
}).strict();
export type FuelEntryPriceInput = z.infer<typeof FuelEntryPriceInput>;

export const FuelEntryMutationOutcome = z.object({
  outcome: z.enum(["OK", "VALIDATION_FAILED", "FORBIDDEN", "CONFLICT"]),
  id: z.string().optional(),
  code: z.string().optional(),
  message: z.string().optional(),
});
export type FuelEntryMutationOutcome = z.infer<typeof FuelEntryMutationOutcome>;

export const FuelEntryReviseInput = z.object({
  reason: SafeText.min(10).max(500),
  payload: z.record(z.string(), z.unknown()).default({}),
});
export type FuelEntryReviseInput = z.infer<typeof FuelEntryReviseInput>;

/* ============================================================ R5.3 — ture */

export const HaulRow = z.object({
  id: z.string(),
  machine_id: z.string(),
  machine_code: z.string(),
  machine_name: z.string(),
  driver_worker_id: z.string(),
  driver_name: z.string(),
  project_id: z.string().nullable(),
  project_code: z.string().nullable(),
  project_name: z.string().nullable(),
  segment_id: z.string().nullable(),
  segment_code: z.string().nullable(),
  segment_name: z.string().nullable(),
  hauled_at: z.string(),
  origin_text: z.string(),
  destination_text: z.string(),
  material_text: z.string(),
  quantity: z.number(),
  quantity_unit: z.enum(["M3", "T"]),
  scale_ticket_text: z.string().nullable(),
  trip_count: z.number().int().positive(),
  note: z.string().nullable(),
  version: z.number().int().positive(),
  created_at: z.string(),
});
export type HaulRow = z.infer<typeof HaulRow>;

export const HaulsResponse = z.object({
  hauls: z.array(HaulRow),
});
export type HaulsResponse = z.infer<typeof HaulsResponse>;

export const HaulCreateInput = z.object({
  machineId: z.string().min(1).max(128),
  driverWorkerId: z.string().min(1).max(128).nullable().optional(),
  projectId: z.string().min(1).max(128).nullable().optional(),
  segmentId: z.string().min(1).max(128).nullable().optional(),
  hauledAt: OffsetDateTime,
  originText: z.string().min(1).max(200),
  destinationText: z.string().min(1).max(200),
  materialText: z.string().min(1).max(200),
  quantity: z.number().finite().positive(),
  quantityUnit: z.enum(["M3", "T"]),
  scaleTicketText: z.string().max(120).nullable().optional(),
  tripCount: z.number().int().positive().optional(),
  note: SafeText.max(2000).nullable().optional(),
}).strict();
export type HaulCreateInput = z.infer<typeof HaulCreateInput>;

export const HaulMutationOutcome = z.object({
  outcome: z.enum(["OK", "VALIDATION_FAILED", "FORBIDDEN", "CONFLICT"]),
  id: z.string().optional(),
  code: z.string().optional(),
  message: z.string().optional(),
});
export type HaulMutationOutcome = z.infer<typeof HaulMutationOutcome>;

export const HaulReviseInput = z.object({
  reason: SafeText.min(10).max(500),
  payload: z.record(z.string(), z.unknown()).default({}),
});
export type HaulReviseInput = z.infer<typeof HaulReviseInput>;

/* ============================================================ R5.4 — dnevni pregled */

export const DailyCheckRow = z.object({
  id: z.string(),
  machine_id: z.string(),
  machine_code: z.string(),
  machine_name: z.string(),
  worker_id: z.string(),
  worker_name: z.string(),
  project_id: z.string().nullable(),
  project_code: z.string().nullable(),
  project_name: z.string().nullable(),
  checked_at: z.string(),
  result: z.enum(["PASS", "FAIL", "CONDITIONAL"]),
  checklist_json: z.record(z.string(), z.unknown()),
  note: z.string().nullable(),
  version: z.number().int().positive(),
  created_at: z.string(),
});
export type DailyCheckRow = z.infer<typeof DailyCheckRow>;

export const DailyChecksResponse = z.object({
  checks: z.array(DailyCheckRow),
});
export type DailyChecksResponse = z.infer<typeof DailyChecksResponse>;

export const DailyCheckCreateInput = z.object({
  machineId: z.string().min(1).max(128),
  workerId: z.string().min(1).max(128).nullable().optional(),
  projectId: z.string().min(1).max(128).nullable().optional(),
  checkedAt: OffsetDateTime,
  result: z.enum(["PASS", "FAIL", "CONDITIONAL"]),
  checklistJson: z.record(z.string(), z.unknown()).optional(),
  note: SafeText.max(2000).nullable().optional(),
}).strict();
export type DailyCheckCreateInput = z.infer<typeof DailyCheckCreateInput>;

export const DailyCheckMutationOutcome = z.object({
  outcome: z.enum(["OK", "VALIDATION_FAILED", "FORBIDDEN", "CONFLICT"]),
  id: z.string().optional(),
  code: z.string().optional(),
  message: z.string().optional(),
});
export type DailyCheckMutationOutcome = z.infer<typeof DailyCheckMutationOutcome>;

export const DailyCheckReviseInput = z.object({
  reason: SafeText.min(10).max(500),
  payload: z.record(z.string(), z.unknown()).default({}),
});
export type DailyCheckReviseInput = z.infer<typeof DailyCheckReviseInput>;

export const DailyCheckAttachment = z.object({
  id: z.string(),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number(),
  status: z.enum(["pending", "confirmed"]),
  createdAt: IsoDate,
});
export type DailyCheckAttachment = z.infer<typeof DailyCheckAttachment>;

export const DailyCheckAttachmentsResponse = z.object({
  attachments: z.array(DailyCheckAttachment),
});
export type DailyCheckAttachmentsResponse = z.infer<typeof DailyCheckAttachmentsResponse>;

export const DailyCheckAttachmentRegisterResponse = z.object({
  attachment: DailyCheckAttachment,
  uploadUrl: z.string(),
  uploadExpiresAt: IsoDate,
});
export type DailyCheckAttachmentRegisterResponse = z.infer<typeof DailyCheckAttachmentRegisterResponse>;

export const MachineFaultRow = z.object({
  id: z.string(),
  machine_id: z.string(),
  machine_code: z.string(),
  machine_name: z.string(),
  reporter_worker_id: z.string().nullable(),
  reporter_name: z.string().nullable(),
  project_id: z.string().nullable(),
  project_code: z.string().nullable(),
  project_name: z.string().nullable(),
  partner_id: z.string().nullable(),
  partner_name: z.string().nullable(),
  reported_at: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  status: z.enum(["OPEN", "WAITING_APPROVAL", "APPROVED", "IN_PROGRESS", "DONE", "CANCELLED"]),
  estimated_cost: z.string().nullable(),
  currency_code: z.string().nullable(),
  downtime_minutes: z.number().int().nullable(),
  version: z.number().int().positive(),
  created_at: z.string(),
  approval_request_id: z.string().nullable(),
  approval_status: z.string().nullable(),
});
export type MachineFaultRow = z.infer<typeof MachineFaultRow>;

export const MachineFaultsResponse = z.object({
  faults: z.array(MachineFaultRow),
});
export type MachineFaultsResponse = z.infer<typeof MachineFaultsResponse>;

export const MachineFaultCreateInput = z.object({
  machineId: z.string().min(1).max(128),
  reporterWorkerId: z.string().min(1).max(128).nullable().optional(),
  projectId: z.string().min(1).max(128).nullable().optional(),
  partnerId: z.string().min(1).max(128).nullable().optional(),
  reportedAt: OffsetDateTime,
  title: SafeText.min(1).max(200),
  description: SafeText.max(4000).nullable().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  estimatedCostAmount: z.string().min(1).nullable().optional(),
  currencyCode: z.string().length(3).nullable().optional(),
  downtimeMinutes: z.number().int().min(0).nullable().optional(),
}).strict();
export type MachineFaultCreateInput = z.infer<typeof MachineFaultCreateInput>;

export const MachineFaultMutationOutcome = z.object({
  outcome: z.enum(["OK", "VALIDATION_FAILED", "FORBIDDEN", "CONFLICT"]),
  id: z.string().optional(),
  code: z.string().optional(),
  message: z.string().optional(),
});
export type MachineFaultMutationOutcome = z.infer<typeof MachineFaultMutationOutcome>;

export const MachineFaultReviseInput = z.object({
  reason: SafeText.min(10).max(500),
  payload: z.record(z.string(), z.unknown()).default({}),
});
export type MachineFaultReviseInput = z.infer<typeof MachineFaultReviseInput>;

export const MachineFaultRejectInput = z.object({
  reason: SafeText.min(10).max(500).nullable().optional(),
}).strict();
export type MachineFaultRejectInput = z.infer<typeof MachineFaultRejectInput>;

export const PartnerRole = z.enum(["VENDOR", "SERVICE", "OTHER", "CLIENT", "SUBCONTRACTOR"]);
export type PartnerRole = z.infer<typeof PartnerRole>;

export const PartnerRoleInput = z.object({ role: PartnerRole }).strict();
export const PartnerRolePatchInput = z.object({ role: PartnerRole, isActive: z.boolean() }).strict();
export const PartnerRolesResponse = z.object({
  roles: z.array(z.object({ role: PartnerRole, isActive: z.boolean(), primary: z.boolean() })),
});

export const PartnerRow = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  kind: PartnerRole,
  note: z.string().nullable(),
  active: z.boolean(),
});
export type PartnerRow = z.infer<typeof PartnerRow>;

export const PartnersResponse = z.object({
  partners: z.array(PartnerRow),
});
export type PartnersResponse = z.infer<typeof PartnersResponse>;

export const PartnerCreateInput = z.object({
  code: SafeText.min(1).max(64),
  name: SafeText.min(1).max(200),
  kind: PartnerRole,
  note: SafeText.max(2000).nullable().optional(),
}).strict();
export type PartnerCreateInput = z.infer<typeof PartnerCreateInput>;

export const PartnerPatchInput = z.object({
  name: SafeText.min(1).max(200).optional(),
  kind: PartnerRole.optional(),
  note: SafeText.max(2000).nullable().optional(),
  active: z.boolean().optional(),
}).strict();
export type PartnerPatchInput = z.infer<typeof PartnerPatchInput>;

export const PartnerMutationOutcome = z.object({
  outcome: z.enum(["OK", "VALIDATION_FAILED", "FORBIDDEN", "CONFLICT"]),
  id: z.string().optional(),
  code: z.string().optional(),
  message: z.string().optional(),
});
export type PartnerMutationOutcome = z.infer<typeof PartnerMutationOutcome>;

/* ------------------------------------------------------------------ R7/F7 tenderi */

export const TenderStatus = z.enum([
  "OPPORTUNITY", "GO_NO_GO", "PREPARATION", "SUBMITTED", "EVALUATION",
  "WON", "LOST", "WITHDRAWN", "CANCELLED",
]);
export type TenderStatus = z.infer<typeof TenderStatus>;

export const TenderSource = z.enum(["PORTAL", "INVITATION", "DIRECT", "OTHER"]);
export type TenderSource = z.infer<typeof TenderSource>;

export const TenderRow = z.object({
  id: z.string(),
  title: z.string(),
  partnerId: z.string(),
  partnerName: z.string(),
  submittedValueAmount: z.string(),
  currencyCode: z.string().length(3),
  submittedAt: z.string().nullable(),
  status: TenderStatus,
  note: z.string().nullable(),
  convertedProjectId: z.string().nullable(),
  deadlineAt: z.string().nullable(),
  questionsDeadlineAt: z.string().nullable(),
  siteVisitAt: z.string().nullable(),
  openedAt: z.string().nullable(),
  source: z.string().nullable(),
  portalName: z.string().nullable(),
  externalRef: z.string().nullable(),
  estimatedValueAmount: z.string().nullable(),
  priceSource: z.enum(["CALCULATED", "MANUAL"]),
  /** `null` = nema podatka ILI rola ne smije vidjeti maržu (ACCOUNTANT). */
  markupPct: z.string().nullable(),
  currentRevision: z.number().int().nonnegative(),
  participate: z.boolean().nullable(),
  decisionReason: z.string().nullable(),
  decidedByName: z.string().nullable(),
  decidedAt: z.string().nullable(),
  daysToDeadline: z.number().int().nullable(),
});
export type TenderRow = z.infer<typeof TenderRow>;

export const TendersResponse = z.object({ tenders: z.array(TenderRow) });
export type TendersResponse = z.infer<typeof TendersResponse>;

export const TenderCreateInput = z.object({
  title: SafeText.min(1).max(300),
  partnerId: z.string().min(1),
  submittedValueAmount: z.string().regex(/^\d+\.\d{2}$/),
  currencyCode: z.string().length(3),
  note: SafeText.max(4000).nullable().optional(),
  deadlineAt: IsoDate.nullable().optional(),
  questionsDeadlineAt: IsoDate.nullable().optional(),
  siteVisitAt: IsoDate.nullable().optional(),
  openedAt: IsoDate.nullable().optional(),
  source: TenderSource.nullable().optional(),
  portalName: SafeText.max(120).nullable().optional(),
  externalRef: SafeText.max(60).nullable().optional(),
  estimatedValueAmount: z.string().regex(/^\d+\.\d{2}$/).nullable().optional(),
}).strict();
export type TenderCreateInput = z.infer<typeof TenderCreateInput>;

export const TenderPatchInput = z.object({
  title: SafeText.min(1).max(300).optional(),
  partnerId: z.string().min(1).optional(),
  submittedValueAmount: z.string().regex(/^\d+\.\d{2}$/).optional(),
  currencyCode: z.string().length(3).optional(),
  status: TenderStatus.optional(),
  note: SafeText.max(4000).nullable().optional(),
  deadlineAt: IsoDate.nullable().optional(),
  questionsDeadlineAt: IsoDate.nullable().optional(),
  siteVisitAt: IsoDate.nullable().optional(),
  openedAt: IsoDate.nullable().optional(),
  source: TenderSource.nullable().optional(),
  portalName: SafeText.max(120).nullable().optional(),
  externalRef: SafeText.max(60).nullable().optional(),
  estimatedValueAmount: z.string().regex(/^\d+\.\d{2}$/).nullable().optional(),
  priceReason: SafeText.max(1000).nullable().optional(),
}).strict();
export type TenderPatchInput = z.infer<typeof TenderPatchInput>;

export const TenderMutationOutcome = z.object({
  outcome: z.enum(["OK", "VALIDATION_FAILED", "FORBIDDEN", "CONFLICT", "NOT_FOUND"]),
  id: z.string().optional(),
  projectId: z.string().optional(),
  code: z.string().optional(),
  message: z.string().optional(),
});
export type TenderMutationOutcome = z.infer<typeof TenderMutationOutcome>;

export const TenderDecisionInput = z.object({
  participate: z.boolean(),
  reason: SafeText.min(3).max(1000),
}).strict();
export type TenderDecisionInput = z.infer<typeof TenderDecisionInput>;

/* --- predmjer i resursi --- */

export const TenderBoqItemRow = z.object({
  id: z.string(),
  code: z.string(),
  description: z.string(),
  unit: z.string(),
  quantity: z.string(),
  unitCostAmount: z.string(),
  unitPriceAmount: z.string(),
  totalCostAmount: z.string(),
  sortOrder: z.number().int(),
});
export type TenderBoqItemRow = z.infer<typeof TenderBoqItemRow>;

export const TenderBoqResponse = z.object({ items: z.array(TenderBoqItemRow) });
export type TenderBoqResponse = z.infer<typeof TenderBoqResponse>;

export const TenderBoqInput = z.object({
  code: SafeText.min(1).max(40),
  description: SafeText.min(1).max(500),
  unit: SafeText.min(1).max(16),
  quantity: z.string().regex(/^\d+(\.\d{1,3})?$/),
  unitCostAmount: z.string().regex(/^\d+\.\d{2}$/),
  unitPriceAmount: z.string().regex(/^\d+\.\d{2}$/).optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
}).strict();
export type TenderBoqInput = z.infer<typeof TenderBoqInput>;

export const TenderResourceKind = z.enum(["LABOR", "MACHINE", "MATERIAL", "SUBCONTRACTOR", "OTHER"]);
export type TenderResourceKind = z.infer<typeof TenderResourceKind>;

export const TenderResourceRow = z.object({
  id: z.string(),
  kind: TenderResourceKind,
  description: z.string(),
  quantity: z.string(),
  unit: z.string(),
  unitCostAmount: z.string(),
  currencyCode: z.string().length(3),
  machineId: z.string().nullable(),
  workerRateRef: z.string().nullable(),
});
export type TenderResourceRow = z.infer<typeof TenderResourceRow>;

export const TenderResourcesResponse = z.object({ resources: z.array(TenderResourceRow) });
export type TenderResourcesResponse = z.infer<typeof TenderResourcesResponse>;

export const TenderResourceInput = z.object({
  kind: TenderResourceKind,
  description: SafeText.min(1).max(300),
  quantity: z.string().regex(/^\d+(\.\d{1,3})?$/),
  unit: SafeText.min(1).max(16),
  unitCostAmount: z.string().regex(/^\d+\.\d{2}$/),
  machineId: z.string().nullable().optional(),
  workerRateRef: z.string().nullable().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
}).strict();
export type TenderResourceInput = z.infer<typeof TenderResourceInput>;

/* --- kalkulacija i revizije --- */

export const TenderCalculation = z.object({
  directCostAmount: z.string(),
  boqCostAmount: z.string(),
  resourcesCostAmount: z.string(),
  baseAmount: z.string(),
  offeredValueAmount: z.string(),
  marginAmount: z.string(),
  marginPct: z.string().nullable(),
  markupPct: z.string(),
  riskReservePct: z.string(),
  discountPct: z.string(),
  currencyCode: z.string().length(3),
  needsApproval: z.boolean(),
  changePct: z.string().nullable(),
  approvalReasons: z.array(z.enum(["ABOVE_CHANGE_THRESHOLD", "BELOW_MIN_MARKUP"])),
  minMarkupPct: z.string(),
});
export type TenderCalculation = z.infer<typeof TenderCalculation>;

export const TenderCalculationResponse = z.object({ calculation: TenderCalculation });
export type TenderCalculationResponse = z.infer<typeof TenderCalculationResponse>;

export const TenderPriceRevisionRow = z.object({
  id: z.string(),
  revision: z.number().int().positive(),
  offeredValueAmount: z.string(),
  directCostAmount: z.string(),
  markupPct: z.string(),
  riskReservePct: z.string(),
  discountPct: z.string(),
  currencyCode: z.string().length(3),
  reason: z.string().nullable(),
  approvedAt: z.string().nullable(),
  approvedByName: z.string().nullable(),
  createdAt: z.string(),
});
export type TenderPriceRevisionRow = z.infer<typeof TenderPriceRevisionRow>;

export const TenderPriceRevisionsResponse = z.object({
  revisions: z.array(TenderPriceRevisionRow),
});
export type TenderPriceRevisionsResponse = z.infer<typeof TenderPriceRevisionsResponse>;

export const TenderPriceRevisionInput = z.object({
  markupPct: z.string().regex(/^-?\d+(\.\d{1,2})?$/),
  riskReservePct: z.string().regex(/^\d+(\.\d{1,2})?$/),
  discountPct: z.string().regex(/^\d+(\.\d{1,2})?$/),
  reason: SafeText.max(1000).nullable().optional(),
}).strict();
export type TenderPriceRevisionInput = z.infer<typeof TenderPriceRevisionInput>;

export const TenderPriceRevisionResult = z.object({
  outcome: z.enum(["OK", "VALIDATION_FAILED", "FORBIDDEN", "CONFLICT", "NOT_FOUND"]),
  revision: z.number().int().positive().optional(),
  needsApproval: z.boolean().optional(),
  offeredValueAmount: z.string().optional(),
  code: z.string().optional(),
  message: z.string().optional(),
});
export type TenderPriceRevisionResult = z.infer<typeof TenderPriceRevisionResult>;

/* --- checklista i garancije --- */

export const TenderChecklistItemRow = z.object({
  id: z.string(),
  code: z.string(),
  label: z.string(),
  required: z.boolean(),
  status: z.enum(["MISSING", "ATTACHED", "NOT_APPLICABLE"]),
  attachmentId: z.string().nullable(),
  validUntil: z.string().nullable(),
  note: z.string().nullable(),
  guaranteeType: z.enum(["BID", "PERFORMANCE", "ADVANCE", "WARRANTY"]).nullable(),
  bank: z.string().nullable(),
  amount: z.string().nullable(),
  returnedAt: z.string().nullable(),
  sortOrder: z.number().int(),
});
export type TenderChecklistItemRow = z.infer<typeof TenderChecklistItemRow>;

export const TenderChecklistResponse = z.object({
  items: z.array(TenderChecklistItemRow),
  /** Blokirajuće stavke — imena, ne broj: poruka mora reći ŠTA nedostaje. */
  blocking: z.array(z.string()),
});
export type TenderChecklistResponse = z.infer<typeof TenderChecklistResponse>;

export const TenderChecklistPatchInput = z.object({
  status: z.enum(["MISSING", "ATTACHED", "NOT_APPLICABLE"]).optional(),
  attachmentId: z.string().nullable().optional(),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  note: SafeText.max(1000).nullable().optional(),
  guaranteeType: z.enum(["BID", "PERFORMANCE", "ADVANCE", "WARRANTY"]).nullable().optional(),
  bank: SafeText.max(120).nullable().optional(),
  amount: z.string().regex(/^\d+\.\d{2}$/).nullable().optional(),
}).strict();
export type TenderChecklistPatchInput = z.infer<typeof TenderChecklistPatchInput>;

export const TenderGuaranteeInput = z.object({
  code: SafeText.min(1).max(40),
  label: SafeText.min(1).max(200),
  guaranteeType: z.enum(["BID", "PERFORMANCE", "ADVANCE", "WARRANTY"]),
  bank: SafeText.max(120).nullable().optional(),
  amount: z.string().regex(/^\d+\.\d{2}$/).nullable().optional(),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: SafeText.max(1000).nullable().optional(),
}).strict();
export type TenderGuaranteeInput = z.infer<typeof TenderGuaranteeInput>;

export const TenderChecklistTemplateRow = z.object({
  id: z.string(),
  code: z.string(),
  label: z.string(),
  required: z.boolean(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
});
export type TenderChecklistTemplateRow = z.infer<typeof TenderChecklistTemplateRow>;

export const TenderChecklistTemplatesResponse = z.object({
  templates: z.array(TenderChecklistTemplateRow),
});
export type TenderChecklistTemplatesResponse = z.infer<typeof TenderChecklistTemplatesResponse>;

export const TenderChecklistTemplateInput = z.object({
  code: SafeText.min(1).max(40),
  label: SafeText.min(1).max(200),
  required: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
}).strict();
export type TenderChecklistTemplateInput = z.infer<typeof TenderChecklistTemplateInput>;

/* --- ishod i uspješnost --- */

export const TenderOutcomeResult = z.enum(["WON", "LOST", "WITHDRAWN", "CANCELLED"]);
export type TenderOutcomeResult = z.infer<typeof TenderOutcomeResult>;

export const TenderLostReason = z.enum([
  "PRICE", "TECHNICAL", "DOCUMENTATION", "RELATIONSHIP", "SCOPE", "OTHER",
]);
export type TenderLostReason = z.infer<typeof TenderLostReason>;

export const TenderOutcomeInput = z.object({
  result: TenderOutcomeResult,
  lostReason: TenderLostReason.nullable().optional(),
  winnerPartnerId: z.string().nullable().optional(),
  winnerValueAmount: z.string().regex(/^\d+\.\d{2}$/).nullable().optional(),
  biddersCount: z.number().int().min(1).max(1000).nullable().optional(),
  ourRank: z.number().int().min(1).max(1000).nullable().optional(),
  note: SafeText.max(2000).nullable().optional(),
}).strict();
export type TenderOutcomeInput = z.infer<typeof TenderOutcomeInput>;

export const TenderOutcomeRow = z.object({
  tenderId: z.string(),
  result: TenderOutcomeResult,
  lostReason: TenderLostReason.nullable(),
  winnerPartnerId: z.string().nullable(),
  winnerPartnerName: z.string().nullable(),
  winnerValueAmount: z.string().nullable(),
  biddersCount: z.number().int().nullable(),
  ourRank: z.number().int().nullable(),
  note: z.string().nullable(),
  recordedAt: z.string(),
});
export type TenderOutcomeRow = z.infer<typeof TenderOutcomeRow>;

export const TenderPerformance = z.object({
  from: z.string().nullable(),
  to: z.string().nullable(),
  totalCount: z.number().int(),
  wonCount: z.number().int(),
  lostCount: z.number().int(),
  winRateByCount: z.string().nullable(),
  wonValueAmount: z.string(),
  totalValueAmount: z.string(),
  winRateByValue: z.string().nullable(),
  /** Prosječna marža dobijenih vs izgubljenih, u procentima (null kad podatka nema). */
  avgMarginWonPct: z.string().nullable(),
  avgMarginLostPct: z.string().nullable(),
  currencyCode: z.string().length(3),
  /** „Vrijednost u toku“ = suma ponuda u statusima prije ishoda. */
  inProgressValueAmount: z.string(),
  inProgressCount: z.number().int(),
  byPartner: z.array(z.object({
    partnerId: z.string(),
    partnerName: z.string(),
    totalCount: z.number().int(),
    wonCount: z.number().int(),
    wonValueAmount: z.string(),
  })),
});
export type TenderPerformance = z.infer<typeof TenderPerformance>;

export const TenderCopyInput = z.object({
  copyFromTenderId: SafeText.min(1),
}).strict();
export type TenderCopyInput = z.infer<typeof TenderCopyInput>;

/* --- predloženi tim i faze tendera (§1.6/22.6) --- */

export const TenderTeamMemberRow = z.object({
  workerId: z.string(),
  name: z.string(),
  role: z.enum(["PM", "SUPERVISOR", "MEMBER"]),
});
export type TenderTeamMemberRow = z.infer<typeof TenderTeamMemberRow>;

export const TenderTeamInput = z.object({
  workerId: SafeText.min(1).max(64),
  role: z.enum(["PM", "SUPERVISOR", "MEMBER"]).optional(),
}).strict();
export type TenderTeamInput = z.infer<typeof TenderTeamInput>;

export const TenderPhaseRow = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  weight: z.number().int(),
  plannedStart: z.string().nullable(),
  plannedEnd: z.string().nullable(),
});
export type TenderPhaseRow = z.infer<typeof TenderPhaseRow>;

export const TenderTeamResponse = z.object({
  team: z.array(TenderTeamMemberRow),
  phases: z.array(TenderPhaseRow),
});
export type TenderTeamResponse = z.infer<typeof TenderTeamResponse>;

export const TenderPhaseInput = z.object({
  code: SafeText.min(1).max(20),
  name: SafeText.min(1).max(200),
  weight: z.number().int().min(1).max(1000).optional(),
  plannedStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  plannedEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
}).strict();
export type TenderPhaseInput = z.infer<typeof TenderPhaseInput>;

export const TenderAttachment = z.object({
  id: z.string(),
  tenderId: z.string(),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number(),
  status: z.enum(["pending", "ready"]),
  createdAt: IsoDate,
});
export type TenderAttachment = z.infer<typeof TenderAttachment>;

export const TenderAttachmentsResponse = z.object({
  attachments: z.array(TenderAttachment),
});
export type TenderAttachmentsResponse = z.infer<typeof TenderAttachmentsResponse>;

export const TenderAttachmentRegisterResponse = z.object({
  attachment: TenderAttachment,
  uploadUrl: z.string(),
  uploadExpiresAt: IsoDate,
});
export type TenderAttachmentRegisterResponse = z.infer<typeof TenderAttachmentRegisterResponse>;

/* ------------------------------------------------------------------ R6.1 trošak mašine */

export const MachineCostRateRow = z.object({
  id: z.string(),
  machine_id: z.string(),
  machine_code: z.string(),
  machine_name: z.string(),
  amount: z.string(),
  currency_code: z.string(),
  valid_from: z.string(),
  valid_to: z.string().nullable(),
  created_at: z.string(),
});
export type MachineCostRateRow = z.infer<typeof MachineCostRateRow>;

export const MachineCostRatesResponse = z.object({
  rates: z.array(MachineCostRateRow),
});
export type MachineCostRatesResponse = z.infer<typeof MachineCostRatesResponse>;

export const MachineCostRateUpsertInput = z.object({
  id: SafeText.min(1).max(128).optional(),
  machineId: SafeText.min(1).max(128),
  amount: SafeText.regex(/^\d+\.\d{2}$/),
  currencyCode: SafeText.length(3).optional(),
  validFrom: SafeText.min(10).max(10),
  validTo: SafeText.min(10).max(10).nullable().optional(),
}).strict();
export type MachineCostRateUpsertInput = z.infer<typeof MachineCostRateUpsertInput>;

export const MachineCostRateMutationOutcome = z.object({
  outcome: z.enum(["OK", "VALIDATION_FAILED", "FORBIDDEN", "CONFLICT"]),
  id: z.string().optional(),
  code: z.string().optional(),
  message: z.string().optional(),
});
export type MachineCostRateMutationOutcome = z.infer<typeof MachineCostRateMutationOutcome>;

/* ============================================================ R6.2 — obračun sati CSV */

export const HoursExportQuery = z.object({
  from: BusinessDate,
  to: BusinessDate,
});
export type HoursExportQuery = z.infer<typeof HoursExportQuery>;

/** Odgovor je text/csv (raw), ne JSON envelope. */
export const HoursExportCsv = z.string();
export type HoursExportCsv = z.infer<typeof HoursExportCsv>;

/* ==========================================================================
 * Faza 1 — Modul 1: firma, postavke, praznici, sesije, 2FA, platforma
 * ========================================================================== */

/** Datum bez vremena (`YYYY-MM-DD`). Praznik je kalendarski datum, ne trenutak. */
export const CalendarDateText = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Datum mora biti u obliku GGGG-MM-DD.");

/** Vrijeme `HH:MM` — noćni prozor. Sekunde nemaju smisla za prag u obračunu. */
export const ClockText = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Vrijeme mora biti HH:MM.");

export const CompanySettings = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  legalName: z.string().nullable(),
  taxId: z.string().nullable(),
  vatId: z.string().nullable(),
  vatRegistered: z.boolean(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  postalCode: z.string().nullable(),
  country: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  web: z.string().nullable(),
  iban: z.string().nullable(),
  bankName: z.string().nullable(),
  logoObjectKey: z.string().nullable(),
  currency: z.string(),
  locale: z.string(),
  timezone: z.string(),
  weekStart: z.enum(["MON", "SUN"]),
  workdayHours: z.number(),
  overtimeDailyThreshold: z.number(),
  nightFrom: z.string().nullable(),
  nightTo: z.string().nullable(),
  holidayPaid: z.boolean(),
  approvalThreshold: z.string().nullable(),
  approvalThresholdCurrency: z.string().nullable(),
  isActive: z.boolean(),
  settingsUpdatedAt: IsoDate.nullable(),
});
export type CompanySettings = z.infer<typeof CompanySettings>;

export const CompanySettingsResponse = z.object({ company: CompanySettings });

/**
 * Izmjena postavki. Sva polja su opcionalna (PATCH), ali `null` je EKSPLICITNO brisanje:
 * razlika „nije poslano“ i „obrisano“ mora postojati, inače korisnik ne može ukloniti IBAN.
 */
export const CompanySettingsPatch = z.object({
  name: SafeText.min(1).max(200).optional(),
  legalName: SafeText.max(200).nullable().optional(),
  taxId: SafeText.max(30).nullable().optional(),
  vatId: SafeText.max(30).nullable().optional(),
  vatRegistered: z.boolean().optional(),
  address: SafeText.max(200).nullable().optional(),
  city: SafeText.max(100).nullable().optional(),
  postalCode: SafeText.max(20).nullable().optional(),
  country: SafeText.regex(/^[A-Z]{2}$/, "Država je dvoslovna oznaka (BA, HR, RS…).").optional(),
  phone: SafeText.max(40).nullable().optional(),
  email: z
    .union([z.literal(""), z.string().email("Email nije ispravan.")])
    .nullable()
    .optional(),
  web: SafeText.max(200).nullable().optional(),
  iban: SafeText.max(34).nullable().optional(),
  bankName: SafeText.max(120).nullable().optional(),
  logoObjectKey: SafeText.max(300).nullable().optional(),
  weekStart: z.enum(["MON", "SUN"]).optional(),
  workdayHours: z.number().gt(0).max(24).optional(),
  overtimeDailyThreshold: z.number().min(0).max(24).optional(),
  nightFrom: ClockText.nullable().optional(),
  nightTo: ClockText.nullable().optional(),
  holidayPaid: z.boolean().optional(),
  approvalThreshold: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, "Iznos je decimalni broj, npr. 500.00")
    .nullable()
    .optional(),
  approvalThresholdCurrency: z.string().length(3).nullable().optional(),
});
export type CompanySettingsPatch = z.infer<typeof CompanySettingsPatch>;

export const CompanyHoliday = z.object({
  id: z.string(),
  date: CalendarDateText,
  name: z.string(),
  isPaid: z.boolean(),
  isWorking: z.boolean(),
});
export type CompanyHoliday = z.infer<typeof CompanyHoliday>;

export const CompanyHolidaysResponse = z.object({
  holidays: z.array(CompanyHoliday),
  /** Godina na koju se lista odnosi; UI mijenja godinu bez novog oblika odgovora. */
  year: z.number(),
});

export const CompanyHolidayInput = z.object({
  date: CalendarDateText,
  name: SafeText.min(1).max(120),
  isPaid: z.boolean().default(true),
  /** `true` = prenesena radna subota (radi se iako je neradni dan). */
  isWorking: z.boolean().default(false),
});
export type CompanyHolidayInput = z.infer<typeof CompanyHolidayInput>;

export const CompanyHolidayResponse = z.object({ holiday: CompanyHoliday });
export const OkDeletedResponse = z.object({ deleted: z.boolean() });

/* ------------------------------------------------------------------ sesije */

export const SessionEntry = z.object({
  id: z.string(),
  deviceLabel: z.string(),
  lastSeenAt: IsoDate,
  createdAt: IsoDate,
  expiresAt: IsoDate,
  isCurrent: z.boolean(),
});
export type SessionEntry = z.infer<typeof SessionEntry>;

export const SessionsResponse = z.object({ sessions: z.array(SessionEntry) });
export type SessionsResponse = z.infer<typeof SessionsResponse>;
export const SessionsRevokedResponse = z.object({ revoked: z.number() });
export type SessionsRevokedResponse = z.infer<typeof SessionsRevokedResponse>;

/* --------------------------------------------------------------------- 2FA */

export const TwoFactorStatusResponse = z.object({
  enabled: z.boolean(),
  /** Postoji tajna, ali nije potvrđena prvim kodom. */
  pendingEnrollment: z.boolean(),
  recoveryCodesLeft: z.number(),
  /** Rola zahtijeva 2FA — isključivanje nije dozvoljeno (spec 01 §1.5.21). */
  required: z.boolean(),
  /** Sesija je izdata samo radi uparivanja: poslovni ekrani su zaključani dok se ne potvrdi. */
  enrollmentPending: z.boolean(),
});

export const TwoFactorEnrollResponse = z.object({
  /** `otpauth://` URI za QR; postoji samo u ovom odgovoru. */
  uri: z.string(),
  secret: z.string(),
});

export const TwoFactorCodeInput = z.object({
  code: z.string().regex(/^\d{6}$/, "Kod ima 6 cifara."),
});
export type TwoFactorCodeInput = z.infer<typeof TwoFactorCodeInput>;

export const TwoFactorConfirmResponse = z.object({
  /** Recovery kodovi se prikazuju TAČNO JEDNOM (spec 01 §1.5.22). */
  recoveryCodes: z.array(z.string()),
});

export const TwoFactorDisableInput = z.object({
  password: SafeText.min(1),
  code: z.string().regex(/^\d{6}$/, "Kod ima 6 cifara."),
});
export type TwoFactorDisableInput = z.infer<typeof TwoFactorDisableInput>;

export const TwoFactorResetInput = z.object({
  reason: SafeText.min(10).max(500),
});
export type TwoFactorResetInput = z.infer<typeof TwoFactorResetInput>;

/** Drugi korak prijave: pre-auth token ide u zaglavlju, ovdje je samo kod. */
export const TwoFactorVerifyInput = z.object({
  code: SafeText.min(6).max(12),
});
export type TwoFactorVerifyInput = z.infer<typeof TwoFactorVerifyInput>;

/* -------------------------------------------------------------- platforma */

export const PlatformCompanyRow = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  isActive: z.boolean(),
  userCount: z.number(),
  lastActivityAt: IsoDate.nullable(),
  createdAt: IsoDate,
});
export type PlatformCompanyRow = z.infer<typeof PlatformCompanyRow>;

export const PlatformCompaniesResponse = z.object({ companies: z.array(PlatformCompanyRow) });

export const PlatformCompanyCreateInput = z.object({
  name: SafeText.min(2).max(200),
  /** Bez sluga se izvodi iz naziva; provjera zauzetosti je na serveru. */
  slug: SafeText.regex(/^[a-z0-9][a-z0-9-]{1,62}$/, "Slug: mala slova, brojevi i crtice.").optional(),
  taxId: SafeText.max(30).nullable().optional(),
  city: SafeText.max(100).nullable().optional(),
  address: SafeText.max(200).nullable().optional(),
  currency: z.string().length(3).default("BAM"),
  timezone: SafeText.max(64).default("Europe/Sarajevo"),
  weekStart: z.enum(["MON", "SUN"]).default("MON"),
  /** Email vlasnika: ako korisnik postoji, dobija članstvo; ako ne, dobija pozivnicu. */
  ownerEmail: z.string().email("Email vlasnika nije ispravan."),
  ownerFirstName: SafeText.min(1).max(100),
  ownerLastName: SafeText.min(1).max(100),
});
export type PlatformCompanyCreateInput = z.infer<typeof PlatformCompanyCreateInput>;

export const PlatformCompanyCreateResponse = z.object({
  company: PlatformCompanyRow,
  /** Sirovi link pozivnice, ako je vlasnik nov — postoji samo u ovom odgovoru. */
  invitationLink: z.string().nullable(),
});

export const PlatformSupportAccessInput = z.object({
  reason: SafeText.min(10).max(500),
  minutes: z.number().int().min(5).max(60),
});
export type PlatformSupportAccessInput = z.infer<typeof PlatformSupportAccessInput>;

export const PlatformSupportAccessResponse = z.object({
  expiresAt: IsoDate,
});

// ---------------------------------------------------------------------------
// F2 — zahtjevi, nedostajuće obaveze, potvrda dokumenta
// ---------------------------------------------------------------------------

export const ObligationRequirement = z.object({
  id: z.string(),
  entityKind: ObligationEntityKind,
  typeId: z.string(),
  /** `ALL` = svaki entitet roda; ostali opsezi nose `appliesValue`. */
  appliesScope: z.enum(["ALL", "ENGAGEMENT", "MACHINE_CATEGORY", "PROJECT"]),
  appliesValue: z.string().nullable(),
  isRequired: z.boolean(),
  isActive: z.boolean(),
  typeLabel: z.string(),
  typeCode: z.string(),
});
export type ObligationRequirement = z.infer<typeof ObligationRequirement>;

export const ObligationRequirementsResponse = z.object({
  requirements: z.array(ObligationRequirement),
});

export const MissingObligation = z.object({
  entityKind: ObligationEntityKind,
  entityId: z.string(),
  typeId: z.string(),
  requirementId: z.string(),
  /** Uvijek `missing` — polje postoji da red stane u istu listu kao ostale obaveze. */
  state: z.literal("missing"),
  typeLabel: z.string(),
  typeCode: z.string(),
  entityName: z.string(),
  entityCode: z.string().nullable(),
  /** Tip traži prilog — „kreiraj sve“ bez priloga ostavlja dokument za kasnije. */
  requiresAttachment: z.boolean(),
});
export type MissingObligation = z.infer<typeof MissingObligation>;

export const MissingObligationsResponse = z.object({
  items: z.array(MissingObligation),
  groups: z.array(
    z.object({
      typeId: z.string(),
      entityKind: ObligationEntityKind,
      count: z.number(),
      ids: z.array(z.string()),
    }),
  ),
  counts: z.object({
    total: z.number(),
    workers: z.number(),
    machines: z.number(),
    projects: z.number(),
  }),
  today: z.string(),
});

export const ObligationReviewInput = z.object({
  decision: z.enum(["approve", "reject"]),
  /** Obavezan kod odbijanja (≥3 znaka) — odbijanje bez razloga se ne može ispraviti. */
  reason: SafeText.max(1000).optional(),
});

export const ObligationReviewAtInput = z.object({
  /** `YYYY-MM-DD`; ne smije biti u prošlosti. */
  reviewAt: SafeText,
});

export const ObligationBulkRenewInput = z.object({
  obligationIds: z.array(SafeText).min(1).max(200),
  /** `null` = trajne obaveze; tada je `reviewAt` obavezan. */
  expiresAt: SafeText.nullable(),
  reviewAt: SafeText.nullable().optional(),
  issuedAt: SafeText.nullable().optional(),
  number: SafeText.nullable().optional(),
  issuer: SafeText.nullable().optional(),
});

export const ObligationBulkRenewResponse = z.object({
  renewed: z.number(),
  failed: z.array(z.object({ obligationId: z.string(), reason: z.string() })),
});

// ---------------------------------------------------------------------------
// Faza 3 — radno vrijeme (Modul 3)
// ---------------------------------------------------------------------------

/** Vrste dana; iste vrijednosti kao CHECK u bazi i `DAY_KINDS` u domeni. */
export const DayKindEnum = z.enum([
  "WORK",
  "VACATION",
  "SICK",
  "PAID_LEAVE",
  "UNPAID_LEAVE",
  "HOLIDAY",
  "NO_SHOW",
]);

export const RoundingModeEnum = z.enum(["NEAREST", "UP", "DOWN"]);

/** Timer „Moj dan": jedna velika akcija mijenja stanje (spec 03 §1.1). */
export const WorkdayTimerAction = z.enum(["start", "pause", "resume", "finish"]);

/**
 * Ulaz timera. `localId` je idempotentni ključ sa telefona: mreža može poslati isti događaj
 * dvaput (retry), a dvostruki `start` ne smije otvoriti dva segmenta.
 */
export const WorkdayTimerInput = z.object({
  localId: SafeText.max(120).optional(),
  action: WorkdayTimerAction,
  /** Obavezno kad radnik ima više dodjela; kad ima jednu, server je izvodi sam. */
  projectId: SafeText.nullable().optional(),
  machineId: SafeText.nullable().optional(),
  /** Klijentski UTC; server provjerava plausibilnost (±5 min) i to je postojeće pravilo. */
  at: SafeText.optional(),
  tzOffsetMinutes: z.number().int().min(-840).max(840).optional(),
  note: SafeText.max(1000).nullable().optional(),
});

export const WorkdaySegment = z.object({
  id: z.string(),
  kind: z.enum(["WORK", "BREAK"]),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  endState: z.enum(["OPEN", "KNOWN_END", "UNKNOWN_END"]),
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  machineId: z.string().nullable(),
  machineName: z.string().nullable(),
  segmentSource: z.enum(["TIMER", "MANUAL", "SYNC"]),
});

export const WorkdayDay = z.object({
  id: z.string(),
  workerId: z.string(),
  workDate: z.string(),
  status: z.enum(["DRAFT", "SUBMITTED"]),
  approvalStatus: z.string(),
  dayKind: DayKindEnum,
  absenceNote: z.string().nullable(),
  assignmentWarning: z.boolean(),
  segments: z.array(WorkdaySegment),
  /** Zbir po ZAOKRUŽENIM segmentima (spec 03 §1.4) — ovo vidi radnik. */
  minutes: z.number(),
  /** Zbir bez zaokruživanja — za dokaz i za obračun. */
  rawMinutes: z.number(),
  openSegments: z.number(),
  /** „ZA PROVJERU" u uredu: zaboravljen dan ili `UNKNOWN_END`. */
  reviewState: z.enum(["OK", "FORGOTTEN", "UNKNOWN_END", "OPEN_TODAY"]),
});

export const WorkdayTimerResponse = z.object({
  day: WorkdayDay,
  /** Crvena traka iz `canUseEntity`; NIKAD blokada prijave dana (spec 03 §1.6.28). */
  blockers: z.array(
    z.object({
      typeId: z.string(),
      typeLabel: z.string(),
      state: z.string(),
      message: z.string(),
    }),
  ),
});

/** Zatvaranje zaboravljenog dana (spec 03 §1.2.8): tri izbora, nijedno automatsko. */
export const WorkdayCloseForgottenInput = z.object({
  kind: z.enum(["TIME", "LAST_PING", "UNKNOWN"]),
  /** Obavezno za `TIME`. */
  endedAt: SafeText.optional(),
  /** Vrijeme zadnjeg otpucaja sa telefona; koristi se za `LAST_PING`. */
  lastPingAt: SafeText.optional(),
  note: SafeText.max(1000).nullable().optional(),
});

export const WorkdayKindInput = z.object({
  dayKind: DayKindEnum,
  /** Obavezna uz izostanak: zašto radnik nije radio. */
  absenceNote: SafeText.max(500).optional(),
  /** Obavezan za ispravku već postojećeg dana (≥10 znakova, kao svaka revizija). */
  reason: SafeText.max(1000).optional(),
});

export const WorkdayWeekRow = z.object({
  workerId: z.string(),
  workerName: z.string(),
  /** `YYYY-MM-DD` → sati (zaokruženo), vrsta dana, stanje. */
  days: z.record(
    z.string(),
    z.object({
      workdayId: z.string().nullable(),
      minutes: z.number(),
      dayKind: DayKindEnum,
      approvalStatus: z.string(),
      reviewState: z.enum(["OK", "FORGOTTEN", "UNKNOWN_END", "OPEN_TODAY"]),
    }),
  ),
  totalMinutes: z.number(),
});

export const WorkdayWeekResponse = z.object({
  weekStart: z.string(),
  weekEnd: z.string(),
  rows: z.array(WorkdayWeekRow),
  totals: z.object({
    minutes: z.number(),
    /** Po vrsti dana: `{ WORK: 2400, SICK: 480, … }` — izostanci ne ulaze u `minutes`. */
    byDayKind: z.record(z.string(), z.number()),
  }),
  /** Nerazriješeni sukobi u sedmici — vlasnik vidi da li teren ima problem sa mrežom. */
  openConflicts: z.number(),
});

export const WorkdayBulkConfirmInput = z.object({
  projectId: SafeText,
  workDate: SafeText,
  /** Prazno = svi na projektu za taj datum (spec 03 §1.5.21). */
  workerIds: z.array(SafeText).max(200).optional(),
});

export const WorkdayBulkConfirmResponse = z.object({
  confirmed: z.number(),
  skipped: z.array(z.object({ workerId: z.string(), workerName: z.string(), reason: z.string() })),
});

// ---------------------------------------------------------------------------
// Faza 3 — radnici (Modul 4)
// ---------------------------------------------------------------------------

/**
 * Osjetljiva polja radnika. U odgovoru ih ima SAMO uz `workers.sensitive.view`, a svako
 * čitanje upisuje ACCESS audit (spec 04 §1.1.4).
 */
export const WorkerSensitive = z.object({
  birthDate: z.string().nullable(),
  address: z.string().nullable(),
  bloodType: z.string().nullable(),
  emergencyContactName: z.string().nullable(),
  emergencyContactPhone: z.string().nullable(),
});

export const WorkerProfile = Worker.extend({
  middleName: z.string().nullable(),
  educationLevel: z.string().nullable(),
  profession: z.string().nullable(),
  drivingCategories: z.array(z.string()),
  shoeSize: z.number().nullable(),
  clothingSize: z.string().nullable(),
  photoObjectKey: z.string().nullable(),
  notes: z.string().nullable(),
  /** `null` = korisnik NEMA pravo da ih vidi; nije isto kao „prazno". */
  sensitive: WorkerSensitive.nullable(),
});

/** Polja koja se mijenjaju kroz karticu radnika (bez `firstName/lastName` — to je `WorkerInput`). */
export const WorkerProfilePatch = z.object({
  middleName: SafeText.max(100).nullable().optional(),
  birthDate: SafeText.nullable().optional(),
  address: SafeText.max(300).nullable().optional(),
  educationLevel: z.enum(["NK", "KV", "SSS", "VŠS", "VSS"]).nullable().optional(),
  profession: SafeText.max(150).nullable().optional(),
  drivingCategories: z.array(SafeText.max(10)).max(12).optional(),
  bloodType: SafeText.max(10).nullable().optional(),
  shoeSize: z.number().int().min(20).max(55).nullable().optional(),
  clothingSize: SafeText.max(20).nullable().optional(),
  emergencyContactName: SafeText.max(150).nullable().optional(),
  emergencyContactPhone: SafeText.max(40).nullable().optional(),
  photoObjectKey: SafeText.max(300).nullable().optional(),
  notes: SafeText.max(2000).nullable().optional(),
  /** Obavezan kad se mijenja osjetljivo polje — bez razloga izmjena nije objašnjiva. */
  reason: SafeText.max(500).optional(),
});

export const WorkerRateKindEnum = z.enum(["HOURLY", "MONTHLY", "DAILY", "COEFFICIENT"]);

export const WorkerRate = z.object({
  id: z.string(),
  kind: WorkerRateKindEnum,
  amountCents: z.string().nullable(),
  currencyCode: z.string().nullable(),
  coefficient: z.string().nullable(),
  validFrom: z.string(),
  validTo: z.string().nullable(),
  note: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
});

export const WorkerRatesResponse = z.object({
  rates: z.array(WorkerRate),
  /** Stopa koja VAŽI danas; `null` ako je nema (nikad se ne izmišlja). */
  current: WorkerRate.nullable(),
});

export const WorkerRateInput = z.object({
  kind: WorkerRateKindEnum,
  /** Za `COEFFICIENT` se ne šalje. */
  amountCents: z.number().int().positive().nullable().optional(),
  currencyCode: SafeText.length(3).nullable().optional(),
  coefficient: z.number().positive().nullable().optional(),
  validFrom: SafeText,
  note: SafeText.max(500).nullable().optional(),
});

export const WorkerRateCloseInput = z.object({
  /** Zadnji dan važenja; mora biti ≥ `validFrom`. */
  validTo: SafeText,
});

export const WorkerLeaveRow = z.object({
  year: z.number(),
  daysEntitled: z.string(),
  daysCarryover: z.string(),
  daysUsed: z.number(),
  balance: z.number(),
  /** Datumi korištenja — saldo bez liste datuma se ne može provjeriti. */
  usedDates: z.array(z.string()),
  note: z.string().nullable(),
});

export const WorkerLeaveResponse = z.object({
  workerId: z.string(),
  years: z.array(WorkerLeaveRow),
});

export const WorkerLeaveEntitlementInput = z.object({
  year: z.number().int().min(2000).max(2100),
  daysEntitled: z.number().min(0).max(366),
  daysCarryover: z.number().min(-366).max(366).optional(),
  note: SafeText.max(500).nullable().optional(),
});

export const WorkerIssuanceKindEnum = z.enum(["PPE", "TOOL", "DEVICE", "OTHER"]);
export const WorkerIssuanceConditionEnum = z.enum(["NEW", "USED", "DAMAGED"]);

export const WorkerIssuance = z.object({
  id: z.string(),
  itemKind: WorkerIssuanceKindEnum,
  itemName: z.string(),
  size: z.string().nullable(),
  serialNo: z.string().nullable(),
  quantity: z.string(),
  issuedAt: z.string(),
  returnedAt: z.string().nullable(),
  condition: WorkerIssuanceConditionEnum,
  note: z.string().nullable(),
  issuedBy: z.string().nullable(),
  returnedTo: z.string().nullable(),
  stockItemId: z.string().nullable(),
});

export const WorkerIssuancesResponse = z.object({
  issuances: z.array(WorkerIssuance),
  /** „Ko šta ima kod sebe" = `returned_at IS NULL`. */
  activeCount: z.number(),
});

export const WorkerIssuanceInput = z.object({
  itemKind: WorkerIssuanceKindEnum,
  itemName: SafeText.min(1).max(200),
  size: SafeText.max(20).nullable().optional(),
  serialNo: SafeText.max(100).nullable().optional(),
  quantity: z.number().positive().max(9999).optional(),
  issuedAt: SafeText,
  condition: WorkerIssuanceConditionEnum.optional(),
  note: SafeText.max(500).nullable().optional(),
  /** Ako je zadat, izdaje cijeli OZO set iz šablona radnog mjesta. */
  templateId: SafeText.nullable().optional(),
});

export const WorkerIssuanceReturnInput = z.object({
  returnedAt: SafeText,
  condition: WorkerIssuanceConditionEnum.optional(),
  note: SafeText.max(500).nullable().optional(),
});

export const PpeTemplateItem = z.object({
  name: SafeText.min(1).max(120),
  quantity: z.number().positive().max(99).optional(),
  sizeRequired: z.boolean().optional(),
});

export const PpeTemplate = z.object({
  id: z.string(),
  jobTitle: z.string(),
  items: z.array(PpeTemplateItem),
});

export const PpeTemplatesResponse = z.object({ templates: z.array(PpeTemplate) });

export const PpeTemplateInput = z.object({
  jobTitle: SafeText.min(1).max(120),
  items: z.array(PpeTemplateItem).max(50),
});

export const WorkerHistoryEntry = z.object({
  id: z.string(),
  field: z.string(),
  oldValue: z.string().nullable(),
  newValue: z.string().nullable(),
  changedAt: z.string(),
  changedBy: z.string().nullable(),
  changedByName: z.string().nullable(),
  reason: z.string().nullable(),
});

export const WorkerHistoryResponse = z.object({ entries: z.array(WorkerHistoryEntry) });

/** „Radnik odlazi" — jedan dijalog, jedna transakcija (spec 04 §1.6.24). */
export const WorkerOffboardInput = z.object({
  endedAt: SafeText,
  reason: SafeText.min(10).max(1000),
  /**
   * Zaduženja koja se otpisuju umjesto vraćanja. Svako mora imati razlog; bez toga dijalog
   * ne prolazi (spec 04 §1.6.24c).
   */
  writtenOff: z
    .array(z.object({ issuanceId: SafeText, reason: SafeText.min(3).max(500) }))
    .max(200)
    .optional(),
  /** Radnik odlazi, a nalog ostaje aktivan (npr. prelazi na drugu firmu u sistemu). */
  keepUserAccount: z.boolean().optional(),
});

export const WorkerOffboardResponse = z.object({
  workerId: z.string(),
  deactivatedAssignments: z.number(),
  revokedSessions: z.number(),
  returnedIssuances: z.number(),
  writtenOffIssuances: z.number(),
  /** Obaveze koje su ugašene jer više nemaju smisla (servis vezan na radnika). */
  closedObligations: z.number(),
  retentionStartedFor: z.number(),
});

/** Masovne izmjene (spec 04 §1.8): jedna transakcija, izvještaj preskočenih. */
export const WorkerBulkInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("changeTeam"),
    workerIds: z.array(SafeText).min(1).max(200),
    team: SafeText.max(120).nullable(),
  }),
  z.object({
    action: z.literal("changeSupervisor"),
    workerIds: z.array(SafeText).min(1).max(200),
    supervisorId: SafeText.nullable(),
  }),
  z.object({
    action: z.literal("newRate"),
    workerIds: z.array(SafeText).min(1).max(200),
    rate: WorkerRateInput,
  }),
]);

export const WorkerBulkResponse = z.object({
  updated: z.number(),
  skipped: z.array(z.object({ workerId: z.string(), workerName: z.string(), reason: z.string() })),
});

/** „Moj dan" za mobilni: danas + jutros otvoreni (mogući zaboravljen) dan. */
export const MyDayResponse = z.object({
  today: WorkdayDay.nullable(),
  /** Zaboravljen ili `UNKNOWN_END` dan koji traži odgovor radnika. */
  forgotten: WorkdayDay.nullable(),
  /** Radnikove dodjele koje timer može da ponudi — bez njih bi `Počni rad` pitao u prazno. */
  assignments: z.array(
    z.object({
      projectId: z.string(),
      projectName: z.string(),
      machineId: z.string().nullable(),
      machineName: z.string().nullable(),
    }),
  ),
  forgottenThresholdHours: z.number(),
  roundingMinutes: z.number(),
  roundingMode: RoundingModeEnum,
});

/* ==========================================================================
 * Faza 4 — Modul 5: mehanizacija (razložen trošak, gorivo, stacionaža, šabloni, najam)
 * ==========================================================================
 *
 * Oblik odgovora je isti kao u servisu — polja su `snake_case` jer idu direktno iz baze i
 * web ekran ih ne prepisuje. Novac je UVIJEK string (`"123.45"`), nikad `number`: centi u
 * `number` su klasična greška zaokruživanja na 2^53.
 */

export const CostComponentEnum = z.enum([
  "DEPRECIATION",
  "FUEL",
  "SERVICE",
  "OPERATOR",
  "INSURANCE",
  "OTHER",
  "RENTAL",
]);
export const CostBasisEnum = z.enum(["PER_HOUR", "PER_MONTH", "PER_KM"]);

/** Money string: dvije decimale, bez razmaka i valute. */
const MoneyText = z.string().regex(/^\d+\.\d{2}$/, "Iznos je decimalni broj sa dvije decimale.");

export const MachineCostComponent = z.object({
  id: z.string(),
  machine_id: z.string(),
  component: CostComponentEnum,
  basis: CostBasisEnum,
  amount: MoneyText,
  currency_code: z.string().length(3),
  valid_from: CalendarDateText,
  valid_to: CalendarDateText.nullable(),
  note: z.string().nullable(),
  created_at: IsoDate,
});
export type MachineCostComponent = z.infer<typeof MachineCostComponent>;

export const MachineCostComponentsResponse = z.object({
  components: z.array(MachineCostComponent),
});
export type MachineCostComponentsResponse = z.infer<typeof MachineCostComponentsResponse>;

export const MachineCostComponentInput = z
  .object({
    /** Kad je poslan, mijenja se POSTOJEĆI red — ali samo dok mu je `valid_to` NULL. */
    id: SafeText.min(1).max(128).optional(),
    machineId: SafeText.min(1).max(128),
    component: CostComponentEnum,
    basis: CostBasisEnum,
    amount: MoneyText,
    currencyCode: SafeText.length(3).optional(),
    validFrom: CalendarDateText,
    validTo: CalendarDateText.nullable().optional(),
    note: SafeText.max(500).nullable().optional(),
  })
  .strict();
export type MachineCostComponentInput = z.infer<typeof MachineCostComponentInput>;

/**
 * Izračunata stopa + razlaganje.
 *
 * `manualRate` je popunjen kad postoji ručna stopa — ekran tada pokazuje OBA broja i nudi
 * „vrati na izračunato". Bez toga bi ručna stopa bila nevidljiva odluka u prošlosti.
 */
export const MachineCostRate = z.object({
  machine_id: z.string(),
  machine_code: z.string(),
  machine_name: z.string(),
  calculated_rate: MoneyText,
  manual_rate: MoneyText.nullable(),
  manual_reason: z.string().nullable(),
  effective_rate: MoneyText,
  is_manual: z.boolean(),
  currency_code: z.string().length(3),
  planned_hours_per_month: z.number().int().positive(),
  breakdown: z.array(
    z.object({
      component: CostComponentEnum,
      basis: CostBasisEnum,
      amount: MoneyText,
      cents_per_hour: MoneyText,
    }),
  ),
});
export type MachineCostRate = z.infer<typeof MachineCostRate>;

export const MachineCostRateResponse = z.object({ rate: MachineCostRate });

export const MachineCostRateManualInput = z
  .object({
    machineId: SafeText.min(1).max(128),
    /** `null` = vrati na izračunato (zatvara ručnu stopu, ne briše red). */
    amount: MoneyText.nullable(),
    reason: SafeText.max(500).nullable().optional(),
    validFrom: CalendarDateText,
  })
  .strict();
export type MachineCostRateManualInput = z.infer<typeof MachineCostRateManualInput>;

export const UtilizationResponse = z.object({
  machine_id: z.string(),
  from: CalendarDateText,
  to: CalendarDateText,
  utilization_pct: z.number().nullable(),
  calendar_utilization_pct: z.number().nullable(),
  work_hours: z.number(),
  idle_hours: z.number(),
  breakdown_hours: z.number(),
  calendar_hours: z.number(),
  /** Kvarovi u periodu — ulaz u MTBF/MTTR (spec 05 §1.6.26). */
  fault_count: z.number().int(),
  downtime_minutes: z.number().int(),
  mtbf_hours: z.number().nullable(),
  mttr_hours: z.number().nullable(),
});
export type UtilizationResponse = z.infer<typeof UtilizationResponse>;

/* ------------------------------------------------------------------ gorivo */

export const FuelKindEnum = z.enum(["DIESEL", "PETROL", "ADBLUE", "LPG", "OTHER"]);

export const FuelPrice = z.object({
  id: z.string(),
  fuel_kind: FuelKindEnum,
  supplier_partner_id: z.string().nullable(),
  supplier_name: z.string().nullable(),
  price: MoneyText,
  currency_code: z.string().length(3),
  valid_from: CalendarDateText,
  note: z.string().nullable(),
  created_at: IsoDate,
});
export type FuelPrice = z.infer<typeof FuelPrice>;

export const FuelPricesResponse = z.object({ prices: z.array(FuelPrice) });

export const FuelPriceInput = z
  .object({
    fuelKind: FuelKindEnum,
    supplierPartnerId: SafeText.min(1).max(128).nullable().optional(),
    price: MoneyText,
    currencyCode: SafeText.length(3).optional(),
    validFrom: CalendarDateText,
    note: SafeText.max(500).nullable().optional(),
  })
  .strict();
export type FuelPriceInput = z.infer<typeof FuelPriceInput>;

export const FuelTank = z.object({
  id: z.string(),
  name: z.string(),
  capacity_l: z.number(),
  current_l: z.number(),
  last_count_at: IsoDate.nullable(),
  is_active: z.boolean(),
});
export type FuelTank = z.infer<typeof FuelTank>;

export const FuelTanksResponse = z.object({ tanks: z.array(FuelTank) });

export const FuelTankInput = z
  .object({
    name: SafeText.min(1).max(120),
    capacityL: z.number().positive().max(1_000_000),
    currentL: z.number().min(0),
    isActive: z.boolean().optional(),
  })
  .strict();
export type FuelTankInput = z.infer<typeof FuelTankInput>;

export const FuelTankCountInput = z
  .object({
    /** Očitano stanje na popisu; razlika prema izvedenom je ono što se vidi. */
    currentL: z.number().min(0),
    note: SafeText.max(500).nullable().optional(),
  })
  .strict();
export type FuelTankCountInput = z.infer<typeof FuelTankCountInput>;

/** Odstupanje potrošnje sa OBAVEZNIM statusom (spec 05 §1.3.13). */
export const FuelDeviationRow = z.object({
  id: z.string(),
  entry_id: z.string(),
  machine_id: z.string(),
  machine_code: z.string(),
  machine_name: z.string(),
  filled_at: IsoDate,
  liters: z.number(),
  consumption: z.number().nullable(),
  consumption_unit: z.enum(["l/h", "l/100km"]).nullable(),
  baseline: z.number().nullable(),
  deviation_pct: z.number().nullable(),
  threshold_pct: z.number().int(),
  status: z.enum(["OPEN", "EXPLAINED", "DISMISSED"]),
  reason: z.enum(["BREAKDOWN", "THEFT", "MISREAD", "OTHER"]).nullable(),
  note: z.string().nullable(),
  reviewed_at: IsoDate.nullable(),
});
export type FuelDeviationRow = z.infer<typeof FuelDeviationRow>;

export const FuelDeviationsResponse = z.object({
  deviations: z.array(FuelDeviationRow),
  open_count: z.number().int(),
});
export type FuelDeviationsResponse = z.infer<typeof FuelDeviationsResponse>;

export const FuelDeviationExplainInput = z
  .object({
    status: z.enum(["EXPLAINED", "DISMISSED"]),
    reason: z.enum(["BREAKDOWN", "THEFT", "MISREAD", "OTHER"]),
    note: SafeText.min(10).max(500),
  })
  .strict();
export type FuelDeviationExplainInput = z.infer<typeof FuelDeviationExplainInput>;

/* ------------------------------------------------------------------ stacionaža */

export const RouteSegment = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  project_id: z.string().nullable(),
  project_code: z.string().nullable(),
  project_name: z.string().nullable(),
  from_station: z.string().nullable(),
  to_station: z.string().nullable(),
  from_km: z.number().int().nullable(),
  from_m: z.number().int().nullable(),
  to_km: z.number().int().nullable(),
  to_m: z.number().int().nullable(),
  /** Dužina u metrima — izvedena, nikad unesena; `null` kad stacionaža nije upisana. */
  length_m: z.number().int().nullable(),
  haul_count: z.number().int(),
  quantity_sum: z.number().nullable(),
  quantity_unit: z.string().nullable(),
});
export type RouteSegment = z.infer<typeof RouteSegment>;

export const RouteSegmentsResponse = z.object({ segments: z.array(RouteSegment) });

export const RouteSegmentInput = z
  .object({
    id: SafeText.min(1).max(128).optional(),
    code: SafeText.min(1).max(20),
    name: SafeText.min(1).max(120),
    projectId: SafeText.min(1).max(128).nullable().optional(),
    fromStation: SafeText.max(120).nullable().optional(),
    toStation: SafeText.max(120).nullable().optional(),
    /** Ili su oba para popunjena, ili nijedan: pola kilometraže je gore od nikakve. */
    fromKm: z.number().int().min(0).nullable().optional(),
    fromM: z.number().int().min(0).max(999).nullable().optional(),
    toKm: z.number().int().min(0).nullable().optional(),
    toM: z.number().int().min(0).max(999).nullable().optional(),
  })
  .strict();
export type RouteSegmentInput = z.infer<typeof RouteSegmentInput>;

/* ------------------------------------------------------------------ šabloni pregleda */

export const CheckTemplateItem = z
  .object({
    key: SafeText.min(1).max(40),
    label: SafeText.min(1).max(160),
    required: z.boolean(),
    critical: z.boolean(),
  })
  .strict();
export type CheckTemplateItem = z.infer<typeof CheckTemplateItem>;

export const CheckTemplate = z.object({
  id: z.string(),
  category_id: z.string().nullable(),
  category_name: z.string().nullable(),
  name: z.string(),
  items: z.array(CheckTemplateItem),
  is_active: z.boolean(),
  created_at: IsoDate,
});
export type CheckTemplate = z.infer<typeof CheckTemplate>;

export const CheckTemplatesResponse = z.object({ templates: z.array(CheckTemplate) });

export const CheckTemplateInput = z
  .object({
    id: SafeText.min(1).max(128).optional(),
    categoryId: SafeText.min(1).max(128).nullable().optional(),
    name: SafeText.min(1).max(120),
    items: z.array(CheckTemplateItem).min(1).max(60),
    isActive: z.boolean().optional(),
  })
  .strict();
export type CheckTemplateInput = z.infer<typeof CheckTemplateInput>;

/* ------------------------------------------------------------------ zauzetost i najam */

export const MachineAvailabilitySlot = z.object({
  project_id: z.string().nullable(),
  project_code: z.string().nullable(),
  project_name: z.string().nullable(),
  from_date: CalendarDateText,
  to_date: CalendarDateText.nullable(),
  /** `true` kad preklapanje pokriva odobrena iznimka (Modul 2) — kalendar to boji drugačije. */
  override_id: z.string().nullable(),
});
export type MachineAvailabilitySlot = z.infer<typeof MachineAvailabilitySlot>;

export const MachineAvailabilityResponse = z.object({
  machine_id: z.string(),
  from: CalendarDateText,
  to: CalendarDateText,
  slots: z.array(MachineAvailabilitySlot),
});
export type MachineAvailabilityResponse = z.infer<typeof MachineAvailabilityResponse>;

export const MachineRentalInput = z
  .object({
    partnerId: SafeText.min(1).max(128),
    rate: MoneyText,
    basis: z.enum(["PER_HOUR", "PER_DAY", "PER_MONTH"]),
    from: CalendarDateText,
    to: CalendarDateText.nullable().optional(),
    /** Kad je `true`, otvara se i komponenta `RENTAL` u stopi sa istim periodom. */
    createCostComponent: z.boolean().optional(),
  })
  .strict();
export type MachineRentalInput = z.infer<typeof MachineRentalInput>;

export const RentalBasisEnum = z.enum(["PER_HOUR", "PER_DAY", "PER_MONTH"]);
export const CompanyMachineSettings = z.object({
  plannedHoursPerMonth: z.number().int().min(40).max(744),
  fuelDeviationThresholdPct: z.number().int().min(1).max(200),
  fuelTankEnabled: z.boolean(),
  faultApprovalThreshold: MoneyText,
});
export type CompanyMachineSettings = z.infer<typeof CompanyMachineSettings>;

/** Zauzetost svih mašina za kalendar (mjesec × mašina). */
export const CalendarAvailabilityResponse = z.object({
  machines: z.array(
    z.object({
      machine_id: z.string(),
      machine_code: z.string(),
      machine_name: z.string(),
      slots: z.array(MachineAvailabilitySlot.extend({ machine_id: z.string() })),
    }),
  ),
  from: CalendarDateText,
  to: CalendarDateText,
});
export type CalendarAvailabilityResponse = z.infer<typeof CalendarAvailabilityResponse>;

/* ==========================================================================
 * Faza 5 — Modul 6: faze, budžet, jedinstveni ledger, predmjer, aneksi, zadaci
 * ========================================================================== */

/** Faza projekta. `weight` je obavezan u praksi — `null` je samo za redove prije F5. */
export const ProjectPhase = z.object({
  id: SafeText,
  project_id: SafeText,
  code: SafeText,
  name: SafeText,
  sort_order: z.number().int(),
  weight: z.number().int(),
  planned_start: CalendarDateText.nullable(),
  planned_end: CalendarDateText.nullable(),
  actual_start: CalendarDateText.nullable(),
  actual_end: CalendarDateText.nullable(),
  progress_pct: z.number(),
  status: z.enum(["PLANNED", "ACTIVE", "DONE", "CANCELLED"]),
  /** % cijelog projekta nakon što se ova faza uračuna (Σ×weight / Σweight). */
  weighted_share: z.number(),
  /** Zavisnosti koje još nijesu završene — upozorenje, ne blokada (§1.1.4). */
  dependency_warnings: z.array(SafeText),
});
export type ProjectPhase = z.infer<typeof ProjectPhase>;

export const ProjectPhasesResponse = z.object({
  phases: z.array(ProjectPhase),
  /** Ukupni napredak; `null` kad projekat nema nijednu fazu. */
  progress_pct: z.number().nullable(),
  progress_source: z.enum(["MANUAL", "BOQ"]),
});
export type ProjectPhasesResponse = z.infer<typeof ProjectPhasesResponse>;

export const ProjectPhaseInput = z
  .object({
    id: SafeText.optional(),
    code: SafeText.min(1).max(20),
    name: SafeText.min(1).max(120),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    weight: z.number().int().min(1).max(1000),
    plannedStart: CalendarDateText.nullable().optional(),
    plannedEnd: CalendarDateText.nullable().optional(),
    status: z.enum(["PLANNED", "ACTIVE", "DONE", "CANCELLED"]).optional(),
    progressPct: z.number().min(0).max(100).optional(),
  })
  .strict();
export type ProjectPhaseInput = z.infer<typeof ProjectPhaseInput>;

export const ProjectPhasePatch = ProjectPhaseInput.partial().extend({ id: SafeText }).strict();
export type ProjectPhasePatch = z.infer<typeof ProjectPhasePatch>;

export const PhaseDependencyInput = z
  .object({
    phaseId: SafeText,
    dependsOnPhaseId: SafeText,
    kind: z.literal("START_AFTER_FINISH").optional(),
  })
  .strict();
export type PhaseDependencyInput = z.infer<typeof PhaseDependencyInput>;

export const PhaseProgressInput = z
  .object({
    phases: z
      .array(z.object({ id: SafeText, progressPct: z.number().min(0).max(100) }).strict())
      .min(1)
      .max(200),
  })
  .strict();
export type PhaseProgressInput = z.infer<typeof PhaseProgressInput>;

/** Šifarnik kategorija troška firme. `default_for_source_type` je mapiranje izvora (§1.3.14). */
export const CostCategory = z.object({
  id: SafeText,
  code: SafeText,
  name: SafeText,
  sort_order: z.number().int(),
  default_for_source_type: z
    .enum([
      "WORKDAY", "MACHINE_WORK_LOG", "FUEL_ENTRY", "HAUL",
      "SERVICE_ORDER", "PURCHASE", "SUBCONTRACTOR", "MANUAL",
    ])
    .nullable(),
  is_active: z.boolean(),
  /** Broj budžetskih linija koje koriste ovu kategoriju — brisanje nije dozvoljeno, deaktivacija jeste. */
  usage_count: z.number().int(),
});
export type CostCategory = z.infer<typeof CostCategory>;

export const CostCategoriesResponse = z.object({
  categories: z.array(CostCategory),
  /** Izvori bez mapiranja; njihov trošak ide na `OSTALO`. */
  unmapped_sources: z.array(SafeText),
});
export type CostCategoriesResponse = z.infer<typeof CostCategoriesResponse>;

export const CostCategoryInput = z
  .object({
    id: SafeText.optional(),
    code: SafeText.min(1).max(30),
    name: SafeText.min(1).max(80),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    defaultForSourceType: z
      .enum([
        "WORKDAY", "MACHINE_WORK_LOG", "FUEL_ENTRY", "HAUL",
        "SERVICE_ORDER", "PURCHASE", "SUBCONTRACTOR", "MANUAL",
      ])
      .nullable()
      .optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
export type CostCategoryInput = z.infer<typeof CostCategoryInput>;

/** Budžetska linija jedne revizije (§1.2.7). Nikad se ne prepisuje — nova revizija je novi red. */
export const ProjectBudgetLine = z.object({
  id: SafeText,
  project_id: SafeText,
  phase_id: SafeText.nullable(),
  phase_name: SafeText.nullable(),
  category_id: SafeText,
  category_code: SafeText,
  category_name: SafeText,
  amount: MoneyText,
  currency_code: SafeText,
  revision: z.number().int(),
  valid_from: CalendarDateText,
  note: SafeText.nullable(),
});
export type ProjectBudgetLine = z.infer<typeof ProjectBudgetLine>;

export const ProjectBudgetResponse = z.object({
  /** Revizija koja je prikazana (zadata = aktivna na današnji dan). */
  revision: z.number().int(),
  revisions: z.array(z.object({ revision: z.number().int(), valid_from: CalendarDateText })),
  lines: z.array(ProjectBudgetLine),
  totals: z.object({
    budget: MoneyText,
    currency_code: SafeText,
    /** `POSTED` trošak do danas. */
    spent: MoneyText,
    /** Broj i iznos zapisa bez cijene — odvojeno, jer nije nula (§1.3.15). */
    pending_count: z.number().int(),
    pending_amount: MoneyText.nullable(),
    /** Po kategoriji: budžet i stvarno, za traku napretka. */
    by_category: z.array(
      z.object({
        category_id: SafeText,
        category_code: SafeText,
        category_name: SafeText,
        budget: MoneyText,
        spent: MoneyText,
        used_pct: z.number().nullable(),
        threshold_crossed: z.enum(["80", "100"]).nullable(),
      }),
    ),
  }),
});
export type ProjectBudgetResponse = z.infer<typeof ProjectBudgetResponse>;

export const ProjectBudgetInput = z
  .object({
    /** Nova revizija; `null` = predlog iz aneksa (§1.5.22). */
    revision: z.number().int().min(1).max(1000).optional(),
    validFrom: CalendarDateText.optional(),
    lines: z
      .array(
        z
          .object({
            phaseId: SafeText.nullable().optional(),
            categoryId: SafeText,
            amount: MoneyText,
          })
          .strict(),
      )
      .min(1)
      .max(500),
    note: SafeText.max(500).nullable().optional(),
  })
  .strict();
export type ProjectBudgetInput = z.infer<typeof ProjectBudgetInput>;

/** Red u jedinstvenom ledgeru (§1.3). `PENDING` nema iznos i ne ulazi u zbroj. */
export const CostEntry = z.object({
  id: SafeText,
  project_id: SafeText,
  project_code: SafeText,
  project_name: SafeText,
  phase_id: SafeText.nullable(),
  phase_name: SafeText.nullable(),
  category_id: SafeText,
  category_code: SafeText,
  category_name: SafeText,
  source_type: z.enum([
    "WORKDAY", "MACHINE_WORK_LOG", "FUEL_ENTRY", "HAUL",
    "SERVICE_ORDER", "PURCHASE", "SUBCONTRACTOR", "MANUAL",
  ]),
  source_id: SafeText,
  /** Za drill-down do izvornog zapisa; `null` za ručni unos. */
  source_href: SafeText.nullable(),
  machine_id: SafeText.nullable(),
  machine_code: SafeText.nullable(),
  occurred_on: CalendarDateText,
  /** `null` kad je `PENDING` (§1.3.15) — nikad 0. */
  amount: MoneyText.nullable(),
  currency_code: SafeText,
  quantity: SafeText.nullable(),
  unit: SafeText.nullable(),
  status: z.enum(["POSTED", "PENDING", "REVERSED"]),
  reversed_by: SafeText.nullable(),
  reverses_id: SafeText.nullable(),
  note: SafeText.nullable(),
  booked_at: IsoDate,
});
export type CostEntry = z.infer<typeof CostEntry>;

export const CostEntriesResponse = z.object({
  entries: z.array(CostEntry),
  totals: z.object({
    posted: MoneyText,
    currency_code: SafeText,
    pending_count: z.number().int(),
    pending_quantity_by_unit: z.array(z.object({ unit: SafeText, quantity: SafeText })),
  }),
});
export type CostEntriesResponse = z.infer<typeof CostEntriesResponse>;

export const CostEntryQuery = z.object({
  projectId: SafeText.optional(),
  from: CalendarDateText.optional(),
  to: CalendarDateText.optional(),
  categoryId: SafeText.optional(),
  phaseId: SafeText.optional(),
  status: z.enum(["POSTED", "PENDING", "REVERSED"]).optional(),
});
export type CostEntryQuery = z.infer<typeof CostEntryQuery>;

export const ManualCostInput = z
  .object({
    clientGeneratedId: z.uuid().optional(),
    projectId: SafeText,
    phaseId: SafeText.nullable().optional(),
    categoryId: SafeText,
    occurredOn: CalendarDateText,
    amount: MoneyText,
    currencyCode: z.enum(["BAM", "EUR", "USD"]).optional(),
    quantity: z.number().positive().max(1_000_000).optional(),
    unit: SafeText.max(10).nullable().optional(),
    note: SafeText.max(1000).nullable().optional(),
    /** Fotografija računa sa gradilišta (mobilni brzi unos) — mora biti `ready`. */
    attachmentId: SafeText.nullable().optional(),
  })
  .strict();
export type ManualCostInput = z.infer<typeof ManualCostInput>;

export const CostReversalInput = z
  .object({
    reason: SafeText.min(10).max(1000),
    /** Novi iznos, ako se korekcija knjiži odmah (inace samo storno). */
    replacement: z
      .object({
        amount: MoneyText.optional(),
        occurredOn: CalendarDateText.optional(),
        categoryId: SafeText.optional(),
        phaseId: SafeText.nullable().optional(),
        note: SafeText.max(1000).nullable().optional(),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();
export type CostReversalInput = z.infer<typeof CostReversalInput>;

export const CostMutationOutcome = z.object({
  approvalRequired: z.boolean().optional(),
  approvalStatus: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
  outcome: z.enum(["OK", "VALIDATION_FAILED", "FORBIDDEN", "CONFLICT"]),
  id: SafeText.optional(),
  replaced_by: SafeText.optional(),
  code: SafeText.optional(),
  message: SafeText.optional(),
});
export type CostMutationOutcome = z.infer<typeof CostMutationOutcome>;

/** Predmjer (§1.4.18). */
export const BoqItem = z.object({
  id: SafeText,
  project_id: SafeText,
  phase_id: SafeText.nullable(),
  phase_name: SafeText.nullable(),
  code: SafeText,
  description: SafeText,
  unit: SafeText,
  quantity_planned: z.number(),
  quantity_executed: z.number(),
  unit_price: MoneyText,
  total_planned: MoneyText,
  total_executed: MoneyText,
  sort_order: z.number().int(),
});
export type BoqItem = z.infer<typeof BoqItem>;

export const BoqResponse = z.object({
  items: z.array(BoqItem),
  progress_source: z.enum(["MANUAL", "BOQ"]),
  /** % iz predmjera; `null` kad predmjer nema vrijednost. */
  progress_pct: z.number().nullable(),
  totals: z.object({ planned: MoneyText, executed: MoneyText, currency_code: SafeText }),
});
export type BoqResponse = z.infer<typeof BoqResponse>;

export const BoqItemInput = z
  .object({
    id: SafeText.optional(),
    phaseId: SafeText.nullable().optional(),
    code: SafeText.min(1).max(30),
    description: SafeText.min(1).max(500),
    unit: SafeText.min(1).max(10),
    quantityPlanned: z.number().min(0).max(1_000_000),
    unitPrice: MoneyText,
    quantityExecuted: z.number().min(0).max(1_000_000).optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
  })
  .strict();
export type BoqItemInput = z.infer<typeof BoqItemInput>;

export const ProgressSourceInput = z
  .object({ progressSource: z.enum(["MANUAL", "BOQ"]) })
  .strict();
export type ProgressSourceInput = z.infer<typeof ProgressSourceInput>;

/** Aneks ugovora (§1.5). Samo `APPROVED` mijenja vrijednost i rok. */
export const ProjectAmendment = z.object({
  id: SafeText,
  project_id: SafeText,
  code: SafeText,
  title: SafeText,
  kind: z.enum(["SCOPE", "TIME", "PRICE", "OTHER"]),
  amount: MoneyText.nullable(),
  currency_code: SafeText.nullable(),
  extension_days: z.number().int().nullable(),
  status: z.enum(["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"]),
  approved_at: IsoDate.nullable(),
  approved_by_name: SafeText.nullable(),
  document_id: SafeText.nullable(),
  note: SafeText.nullable(),
});
export type ProjectAmendment = z.infer<typeof ProjectAmendment>;

export const ProjectAmendmentsResponse = z.object({
  amendments: z.array(ProjectAmendment),
  approved_amount: MoneyText,
  approved_extension_days: z.number().int(),
  currency_code: SafeText,
});
export type ProjectAmendmentsResponse = z.infer<typeof ProjectAmendmentsResponse>;

export const ProjectAmendmentInput = z
  .object({
    id: SafeText.optional(),
    code: SafeText.min(1).max(30),
    title: SafeText.min(1).max(200),
    kind: z.enum(["SCOPE", "TIME", "PRICE", "OTHER"]),
    amount: MoneyText.nullable().optional(),
    extensionDays: z.number().int().min(0).max(3650).nullable().optional(),
    note: SafeText.max(2000).nullable().optional(),
    documentId: SafeText.nullable().optional(),
  })
  .strict();
export type ProjectAmendmentInput = z.infer<typeof ProjectAmendmentInput>;

export const AmendmentDecisionInput = z
  .object({
    action: z.enum(["SUBMIT", "APPROVE", "REJECT"]),
    reason: SafeText.max(500).nullable().optional(),
  })
  .strict();
export type AmendmentDecisionInput = z.infer<typeof AmendmentDecisionInput>;

/** Zadatak (§1.6). Jedan izvršilac — radnik ILI nalog, nikad tim. */
export const ProjectTask = z.object({
  id: SafeText,
  project_id: SafeText.nullable(),
  project_code: SafeText.nullable(),
  project_name: SafeText.nullable(),
  phase_id: SafeText.nullable(),
  phase_name: SafeText.nullable(),
  title: SafeText,
  description: SafeText.nullable(),
  assignee_worker_id: SafeText.nullable(),
  assignee_worker_name: SafeText.nullable(),
  assignee_user_id: SafeText.nullable(),
  assignee_user_name: SafeText.nullable(),
  due_on: CalendarDateText.nullable(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]),
  status: z.enum(["OPEN", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED"]),
  completed_at: IsoDate.nullable(),
  /** `true` kad je rok prošao i zadatak nije završen — računa server, ne ekran. */
  overdue: z.boolean(),
  comment_count: z.number().int(),
});
export type ProjectTask = z.infer<typeof ProjectTask>;

export const TasksResponse = z.object({
  tasks: z.array(ProjectTask),
  counts: z.object({
    mine_today: z.number().int(),
    overdue: z.number().int(),
    open: z.number().int(),
  }),
});
export type TasksResponse = z.infer<typeof TasksResponse>;

export const ProjectTaskInput = z
  .object({
    id: SafeText.optional(),
    projectId: SafeText.nullable().optional(),
    phaseId: SafeText.nullable().optional(),
    title: SafeText.min(1).max(200),
    description: SafeText.max(2000).nullable().optional(),
    assigneeWorkerId: SafeText.nullable().optional(),
    assigneeUserId: SafeText.nullable().optional(),
    dueOn: CalendarDateText.nullable().optional(),
    priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
    status: z.enum(["OPEN", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED"]).optional(),
  })
  .strict();
export type ProjectTaskInput = z.infer<typeof ProjectTaskInput>;

/**
 * Djelimična izmjena zadatka (`PATCH /api/tasks/{id}`).
 *
 * Zašto odvojeno od `ProjectTaskInput`: prelazak stanja je izmjena JEDNOG polja, a „označi
 * završenim“ sa forme koja nosi cijeli zadatak traži da klijent pošalje i naslov — i da ga,
 * ako ga je neko u međuvremenu promijenio, prepiše starim. `id` dolazi iz putanje, pa ga ovdje
 * nema; `title`, ako je poslan, mora ostati neprazan.
 */
export const ProjectTaskPatch = ProjectTaskInput.partial()
  .extend({ title: SafeText.min(1).max(200).optional() })
  .strict();
export type ProjectTaskPatch = z.infer<typeof ProjectTaskPatch>;

export const TaskComment = z.object({
  id: SafeText,
  task_id: SafeText,
  author_id: SafeText,
  author_name: SafeText,
  body: SafeText,
  created_at: IsoDate,
});
export type TaskComment = z.infer<typeof TaskComment>;

export const TaskCommentsResponse = z.object({ comments: z.array(TaskComment) });
export type TaskCommentsResponse = z.infer<typeof TaskCommentsResponse>;

export const TaskCommentInput = z
  .object({ body: SafeText.min(1).max(2000), attachmentId: SafeText.nullable().optional() })
  .strict();
export type TaskCommentInput = z.infer<typeof TaskCommentInput>;

export const TaskQuery = z.object({
  projectId: SafeText.optional(),
  status: z.enum(["OPEN", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED"]).optional(),
  assignee: z.enum(["ME", "ALL"]).optional(),
  due: z.enum(["TODAY", "OVERDUE"]).optional(),
});
export type TaskQuery = z.infer<typeof TaskQuery>;

/** Profitabilnost: marža + EAC. EAC je UVIJEK označen kao procjena (§1.8.30). */
export const ProjectProfitability = z.object({
  project_id: SafeText,
  currency_code: SafeText,
  /** Ugovorena vrijednost; `null` = nije unesena (marža tada nije poznata). */
  contract_value: MoneyText.nullable(),
  approved_amendments: MoneyText,
  contract_with_amendments: MoneyText.nullable(),
  posted_cost: MoneyText,
  margin: MoneyText.nullable(),
  margin_pct: z.number().nullable(),
  /** Rizik koji NIJE u marži — zapisi bez cijene. */
  pending_cost_count: z.number().int(),
  /** `kind` je dio ugovora: klijent ne smije prikazati EAC kao knjižen iznos. */
  eac: z.object({
    kind: z.literal("EAC_ESTIMATE"),
    amount: MoneyText.nullable(),
    progress_pct: z.number().nullable(),
    reason: z.enum(["NO_PROGRESS"]).nullable(),
  }),
  by_category: z.array(
    z.object({
      category_id: SafeText,
      category_code: SafeText,
      category_name: SafeText,
      budget: MoneyText.nullable(),
      posted: MoneyText,
    }),
  ),
});
export type ProjectProfitability = z.infer<typeof ProjectProfitability>;

export const ProjectCloseChecklist = z.object({
  project_id: SafeText,
  complete: z.boolean(),
  items: z.array(
    z.object({
      key: z.enum(["ASSIGNMENTS", "FAULTS", "OBLIGATIONS", "PENDING_COSTS", "PHASES"]),
      label: SafeText,
      ok: z.boolean(),
      count: z.number().int(),
      acceptable: z.boolean().optional(),
    }),
  ),
  blockers: z.array(SafeText),
});
export type ProjectCloseChecklist = z.infer<typeof ProjectCloseChecklist>;

export const ProjectCloseInput = z
  .object({
    /** Obavezan kad ima `PENDING` troškova — svjesno prihvatanje (§1.8.31). */
    pendingCostsReason: SafeText.max(500).nullable().optional(),
  })
  .strict();
export type ProjectCloseInput = z.infer<typeof ProjectCloseInput>;

export const ProjectReopenInput = z
  .object({ reason: SafeText.min(10).max(500) })
  .strict();
export type ProjectReopenInput = z.infer<typeof ProjectReopenInput>;

export const ProjectCloseSnapshot = z.object({
  id: SafeText,
  project_id: SafeText,
  closed_at: IsoDate,
  closed_by_name: SafeText.nullable(),
  payload: z.object({
    posted_cost: MoneyText,
    budget: MoneyText.nullable(),
    margin: MoneyText.nullable(),
    progress_pct: z.number().nullable(),
    by_category: z.array(
      z.object({ category_code: SafeText, posted: MoneyText, budget: MoneyText.nullable() }),
    ),
    pending_cost_count: z.number().int(),
  }),
});
export type ProjectCloseSnapshot = z.infer<typeof ProjectCloseSnapshot>;

/** Top 5 rizičnih projekata za `/pregled` (§1.7.28). */
export const RiskyProjectsResponse = z.object({
  projects: z.array(
    z.object({
      id: SafeText,
      code: SafeText,
      name: SafeText,
      status: ProjectStatus,
      margin: MoneyText.nullable(),
      margin_pct: z.number().nullable(),
      budget_used_pct: z.number().nullable(),
      progress_pct: z.number().nullable(),
      /** Zbog čega je na listi — ekran ne izmišljava objašnjenje. */
      risks: z.array(z.enum(["NEGATIVE_MARGIN", "OVER_BUDGET", "PENDING_COSTS"])),
      pending_cost_count: z.number().int(),
    }),
  ),
  pending_cost_count: z.number().int(),
});
export type RiskyProjectsResponse = z.infer<typeof RiskyProjectsResponse>;

/* ============================================================ F6 — obračun (Modul 7) */

/**
 * Dozvoljene komponente su ŠIFARNIK firme, ali ključ je stroga oznaka — servis provjerava da
 * komponenta postoji i da je aktivna. Ugovor ne nabraja kodove, jer bi dodavanje komponente
 * tražilo izdanje klijenta.
 */
export const PayrollCode = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{1,39}$/, "Šifra je velika slova, cifre i donja crta.")
  .describe("Šifra komponente ili parametra (velika slova).");

export const PayPeriodStatus = z.enum(["OPEN", "CALCULATED", "APPROVED", "LOCKED"]);
export type PayPeriodStatus = z.infer<typeof PayPeriodStatus>;

export const PayrollLineStatus = z.enum(["OK", "RATE_MISSING", "PARAMETER_MISSING"]);
export type PayrollLineStatus = z.infer<typeof PayrollLineStatus>;

export const PayPeriod = z.object({
  id: SafeText,
  year: z.number().int(),
  month: z.number().int(),
  status: PayPeriodStatus,
  calculated_at: IsoDate.nullable(),
  approved_at: IsoDate.nullable(),
  locked_at: IsoDate.nullable(),
  /** Koliko radnika ima liniju u posljednoj reviziji — period bez obračuna ima 0. */
  worker_count: z.number().int(),
  /** Bruto osnova posljednje revizije; `null` dok period nije izračunat (nije nula). */
  gross_total: MoneyText.nullable(),
  revision: z.number().int().nullable(),
  /** Zašto period NIJE spreman za odobrenje (§1.8/30). Prazno = spreman. */
  blockers: z.array(
    z.object({
      code: z.enum([
        "RATE_MISSING",
        "PARAMETER_MISSING",
        "OPEN_CONFLICT",
        "SUBMITTED_DAY",
        "NO_RUN",
      ]),
      count: z.number().int(),
      message: SafeText,
    }),
  ),
});
export type PayPeriod = z.infer<typeof PayPeriod>;

export const PayPeriodsResponse = z.object({
  periods: z.array(PayPeriod),
  /** Periodi se ne prave sami: računovodstvo bira mjesec koji obračunava. */
  can_create: z.boolean(),
});
export type PayPeriodsResponse = z.infer<typeof PayPeriodsResponse>;

export const PayPeriodInput = z
  .object({
    year: z.number().int().min(2000).max(2100),
    month: z.number().int().min(1).max(12),
  })
  .strict();
export type PayPeriodInput = z.infer<typeof PayPeriodInput>;

export const PayrollLineSource = z.object({
  id: SafeText,
  source_type: z.enum(["WORK_ENTRY", "WORKDAY", "ADJUSTMENT", "ADVANCE", "CORRECTION"]),
  source_id: SafeText,
  work_date: SafeText.nullable().describe("YYYY-MM-DD, poslovni dan"),
  hours: z.number(),
  days: z.number(),
  amount_cents: z.number().int().nullable(),
  /** Parametri koji su ušli u ovaj dio iznosa — sa VRIJEDNOŠĆU I DATUMOM važenja. */
  applied_parameters: z.record(z.string(), z.unknown()),
  note: SafeText.nullable(),
});
export type PayrollLineSource = z.infer<typeof PayrollLineSource>;

export const PayrollLine = z.object({
  id: SafeText,
  run_id: SafeText,
  worker_id: SafeText,
  worker_name: SafeText,
  component_code: SafeText,
  component_name: SafeText,
  /** `EARNING` uvećava, `DEDUCTION` umanjuje — ekran ne određuje predznak sam. */
  kind: z.enum(["EARNING", "DEDUCTION"]),
  hours: z.number(),
  days: z.number(),
  rate_cents: z.number().int().nullable(),
  amount_cents: z.number().int().nullable(),
  currency_code: SafeText.nullable(),
  status: PayrollLineStatus,
  calc_note: SafeText.nullable(),
});
export type PayrollLine = z.infer<typeof PayrollLine>;

export const PayrollLinesResponse = z.object({
  run_id: SafeText.nullable(),
  revision: z.number().int().nullable(),
  lines: z.array(PayrollLine),
  totals: z.object({
    /** Zarade bez odbitaka — bruto osnova za budući bruto→neto (Faza 2). */
    earnings_cents: z.number().int().nullable(),
    deductions_cents: z.number().int().nullable(),
    /** Bruto OSIČNICA je `null` kad nedostaje satnica ili parametar — nikad djelimičan zbir. */
    missing_workers: z.number().int(),
    currency_code: SafeText.nullable(),
  }),
});
export type PayrollLinesResponse = z.infer<typeof PayrollLinesResponse>;

export const PayrollLineSourcesResponse = z.object({
  line: PayrollLine,
  sources: z.array(PayrollLineSource),
  /** Zbir sati iz raspisa mora biti jednak satima linije — servis to i provjerava. */
  source_hours: z.number(),
});
export type PayrollLineSourcesResponse = z.infer<typeof PayrollLineSourcesResponse>;

export const PayrollComponent = z.object({
  id: SafeText,
  code: SafeText,
  name: SafeText,
  kind: z.enum(["EARNING", "DEDUCTION"]),
  basis: z.enum(["HOURS", "DAYS", "FIXED", "PERCENT_OF_EARNINGS"]),
  category: z.enum([
    "REGULAR",
    "OVERTIME",
    "NIGHT",
    "SUNDAY",
    "HOLIDAY",
    "ABSENCE",
    "FIELD_ALLOWANCE",
    "ADVANCE",
    "LOAN",
    "OTHER",
  ]),
  is_taxable: z.boolean(),
  sort_order: z.number().int(),
  is_active: z.boolean(),
});
export type PayrollComponent = z.infer<typeof PayrollComponent>;

export const PayrollComponentsResponse = z.object({
  components: z.array(PayrollComponent),
});
export type PayrollComponentsResponse = z.infer<typeof PayrollComponentsResponse>;

export const PayrollComponentInput = z
  .object({
    code: PayrollCode,
    name: SafeText.min(1).max(80),
    kind: z.enum(["EARNING", "DEDUCTION"]),
    basis: z.enum(["HOURS", "DAYS", "FIXED", "PERCENT_OF_EARNINGS"]),
    category: PayrollComponent.shape.category,
    is_taxable: z.boolean().optional(),
    sort_order: z.number().int().min(0).max(999).optional(),
    is_active: z.boolean().optional(),
  })
  .strict();
export type PayrollComponentInput = z.infer<typeof PayrollComponentInput>;

export const PayrollComponentPatch = PayrollComponentInput.partial().strict();
export type PayrollComponentPatch = z.infer<typeof PayrollComponentPatch>;

export const PayrollParameter = z.object({
  id: SafeText,
  code: SafeText,
  value: z.string().describe("Decimalni string; `unit` kaže kako se tumači"),
  unit: z.enum(["MULTIPLIER", "PERCENT", "CENTS"]),
  valid_from: SafeText,
  valid_to: SafeText.nullable(),
  confirmed_by_name: SafeText.nullable(),
  confirmed_at: IsoDate,
  note: SafeText.nullable(),
});
export type PayrollParameter = z.infer<typeof PayrollParameter>;

export const PayrollParametersResponse = z.object({
  parameters: z.array(PayrollParameter),
  /** Koji kodovi su POTREBNI za obračun — ekran upozorava prije izračuna, ne poslije. */
  required_codes: z.array(SafeText),
});
export type PayrollParametersResponse = z.infer<typeof PayrollParametersResponse>;

export const PayrollParameterInput = z
  .object({
    code: PayrollCode,
    value: z.string().regex(/^\d{1,8}(\.\d{1,4})?$/, "Vrijednost je nenegativan decimalni broj."),
    unit: z.enum(["MULTIPLIER", "PERCENT", "CENTS"]),
    valid_from: SafeText.describe("YYYY-MM-DD"),
    valid_to: SafeText.nullable().optional(),
    note: SafeText.max(500).optional(),
  })
  .strict();
export type PayrollParameterInput = z.infer<typeof PayrollParameterInput>;

export const WorkerAdvance = z.object({
  id: SafeText,
  worker_id: SafeText,
  kind: z.enum(["ADVANCE", "LOAN"]),
  amount_cents: z.number().int(),
  currency_code: SafeText,
  issued_on: SafeText,
  installment_cents: z.number().int().nullable(),
  remaining_cents: z.number().int(),
  note: SafeText.nullable(),
});
export type WorkerAdvance = z.infer<typeof WorkerAdvance>;

export const WorkerAdvancesResponse = z.object({
  advances: z.array(WorkerAdvance),
});
export type WorkerAdvancesResponse = z.infer<typeof WorkerAdvancesResponse>;

export const WorkerAdvanceInput = z
  .object({
    worker_id: SafeText,
    kind: z.enum(["ADVANCE", "LOAN"]),
    amount: MoneyText,
    issued_on: SafeText.describe("YYYY-MM-DD"),
    installment: MoneyText.nullable().optional(),
    note: SafeText.max(500).optional(),
  })
  .strict();
export type WorkerAdvanceInput = z.infer<typeof WorkerAdvanceInput>;

export const PayCorrection = z.object({
  id: SafeText,
  period_id: SafeText,
  target_period_id: SafeText,
  workday_id: SafeText.nullable(),
  payroll_line_id: SafeText.nullable(),
  delta_hours: z.number(),
  delta_amount_cents: z.number().int().nullable(),
  reason: SafeText,
  status: z.enum(["OPEN", "APPLIED"]),
  created_at: IsoDate,
});
export type PayCorrection = z.infer<typeof PayCorrection>;

export const PayCorrectionsResponse = z.object({
  corrections: z.array(PayCorrection),
});
export type PayCorrectionsResponse = z.infer<typeof PayCorrectionsResponse>;

/** `Moj obračun` (mobilno, `payroll.own.view`). */
export const MyPayrollResponse = z.object({
  period: z.object({
    year: z.number().int(),
    month: z.number().int(),
    status: PayPeriodStatus,
  }),
  worker: z.object({ id: SafeText, name: SafeText }),
  /** Dani mjeseca: sati po kategoriji + vrsta dana. Radnik ne vidi iznose. */
  days: z.array(
    z.object({
      work_date: SafeText,
      day_kind: SafeText,
      status: z.enum(["DRAFT", "SUBMITTED", "FOREMAN_CONFIRMED", "LOCKED"]),
      total_hours: z.number(),
      categories: z.object({
        REGULAR: z.number(),
        OVERTIME: z.number(),
        NIGHT: z.number(),
        SUNDAY: z.number(),
        HOLIDAY: z.number(),
      }),
    }),
  ),
  totals: z.object({
    total_hours: z.number(),
    categories: z.object({
      REGULAR: z.number(),
      OVERTIME: z.number(),
      NIGHT: z.number(),
      SUNDAY: z.number(),
      HOLIDAY: z.number(),
    }),
  }),
  /** Linije obračuna se prikazuju SAMO kad je period `APPROVED`/`LOCKED` (§1.8/28). */
  lines: z.array(PayrollLine).nullable(),
  lines_available_reason: SafeText.nullable(),
});
export type MyPayrollResponse = z.infer<typeof MyPayrollResponse>;

/* ============================================================== F8: servis i održavanje */

/**
 * Polja koja se mijenjaju kroz akcije (`start`, `finish`, `wait-parts`) nijesu u `Patch` unosu:
 * status se NE postavlja ručno. Kad bi `status` bio obično polje, ekran bi mogao poslati
 * `DONE` bez `finished_at`, pa bi MTTR i naplata zavisili od toga ko je šta poslao.
 */
export const ServiceOrderStatus = z.enum([
  "PLANNED",
  "APPROVED",
  "IN_PROGRESS",
  "WAITING_PARTS",
  "DONE",
  "CANCELLED",
]);
export type ServiceOrderStatus = z.infer<typeof ServiceOrderStatus>;

export const ServiceOrderOrigin = z.enum(["FAULT", "PREVENTIVE", "MANUAL", "INSPECTION"]);
export const ServiceOrderKind = z.enum(["INTERNAL", "EXTERNAL"]);
export const ServiceOrderPriority = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

export const ServiceOrderRow = z.object({
  id: z.string(),
  machineId: z.string(),
  machineCode: z.string(),
  machineName: z.string(),
  faultId: z.string().nullable(),
  faultTitle: z.string().nullable(),
  projectId: z.string().nullable(),
  projectCode: z.string().nullable(),
  partnerId: z.string().nullable(),
  partnerName: z.string().nullable(),
  origin: ServiceOrderOrigin,
  kind: ServiceOrderKind,
  priority: ServiceOrderPriority,
  status: ServiceOrderStatus,
  description: SafeText.nullable(),
  plannedFor: z.string().nullable(),
  openedAt: IsoDate,
  startedAt: IsoDate.nullable(),
  finishedAt: IsoDate.nullable(),
  /** `finished_at − started_at`; `null` dok rad nije završen. */
  downtimeMinutes: z.number().int().nullable(),
  assignedMechanicWorkerId: z.string().nullable(),
  assignedMechanicName: z.string().nullable(),
  laborHours: z.string(),
  laborCostAmount: z.string(),
  partsCostAmount: z.string(),
  externalCostAmount: z.string(),
  totalCostAmount: z.string(),
  currencyCode: z.string().length(3),
  plannedCostAmount: z.string().nullable(),
  externalQuoteAmount: z.string().nullable(),
  externalInvoiceRef: z.string().nullable(),
  maintenancePlanId: z.string().nullable(),
  warrantyUntil: z.string().nullable(),
  warrantyClaim: z.boolean(),
  warrantySourceOrderId: z.string().nullable(),
  cancelReason: z.string().nullable(),
  /** Red čekanja: koliko dana nalog stoji otvoren (0 za završene). */
  openDays: z.number().int(),
  approvalStatus: z.enum(["OPEN", "APPROVED", "REJECTED"]).nullable(),
  approvalRequestId: z.string().nullable(),
  version: z.number().int(),
});
export type ServiceOrderRow = z.infer<typeof ServiceOrderRow>;

export const ServiceOrdersResponse = z.object({ orders: z.array(ServiceOrderRow) });
export type ServiceOrdersResponse = z.infer<typeof ServiceOrdersResponse>;

export const ServiceOrderEvent = z.object({
  id: z.string(),
  kind: z.enum([
    "OPENED",
    "APPROVED",
    "STARTED",
    "PARTS_REQUESTED",
    "WAITING",
    "FINISHED",
    "REOPENED",
    "CANCELLED",
  ]),
  at: IsoDate,
  actorName: z.string().nullable(),
  note: z.string().nullable(),
});
export type ServiceOrderEvent = z.infer<typeof ServiceOrderEvent>;

export const ServiceOrderPartRow = z.object({
  id: z.string(),
  itemId: z.string(),
  itemCode: z.string(),
  itemName: z.string(),
  unit: z.string(),
  quantity: z.string(),
  unitCostAmount: z.string(),
  totalCostAmount: z.string(),
  stockMovementId: z.string().nullable(),
  note: z.string().nullable(),
});
export type ServiceOrderPartRow = z.infer<typeof ServiceOrderPartRow>;

export const ServiceOrderDetail = z.object({
  order: ServiceOrderRow,
  events: z.array(ServiceOrderEvent),
  parts: z.array(ServiceOrderPartRow),
  /** Trošak iz ledžera, kad je proknjižen — `null` dok nije. */
  costEntry: z
    .object({
      id: z.string(),
      amountAmount: z.string().nullable(),
      status: z.enum(["POSTED", "PENDING", "REVERSED"]),
      projectId: z.string().nullable(),
    })
    .nullable(),
  nextStatuses: z.array(ServiceOrderStatus),
});
export type ServiceOrderDetail = z.infer<typeof ServiceOrderDetail>;

export const ServiceOrderCreateInput = z
  .object({
    machineId: z.string().min(1),
    faultId: z.string().min(1).nullable().optional(),
    projectId: z.string().min(1).nullable().optional(),
    partnerId: z.string().min(1).nullable().optional(),
    maintenancePlanId: z.string().min(1).nullable().optional(),
    origin: ServiceOrderOrigin,
    kind: ServiceOrderKind,
    priority: ServiceOrderPriority,
    description: SafeText.min(3).max(2000),
    plannedFor: IsoDate.nullable().optional(),
    assignedMechanicWorkerId: z.string().min(1).nullable().optional(),
    plannedCostAmount: z.string().regex(/^\d+\.\d{2}$/).nullable().optional(),
    externalQuoteAmount: z.string().regex(/^\d+\.\d{2}$/).nullable().optional(),
  })
  .strict();
export type ServiceOrderCreateInput = z.infer<typeof ServiceOrderCreateInput>;

export const ServiceOrderPatchInput = z
  .object({
    priority: ServiceOrderPriority.optional(),
    description: SafeText.min(3).max(2000).optional(),
    plannedFor: IsoDate.nullable().optional(),
    assignedMechanicWorkerId: z.string().min(1).nullable().optional(),
    projectId: z.string().min(1).nullable().optional(),
    partnerId: z.string().min(1).nullable().optional(),
    plannedCostAmount: z.string().regex(/^\d+\.\d{2}$/).nullable().optional(),
    externalQuoteAmount: z.string().regex(/^\d+\.\d{2}$/).nullable().optional(),
    externalInvoiceRef: SafeText.max(120).nullable().optional(),
  })
  .strict();
export type ServiceOrderPatchInput = z.infer<typeof ServiceOrderPatchInput>;

export const ServiceOrderServiceInput = z
  .object({
    /** Sati mehaničara; satnica se čita iz `worker_rates` na dan rada. */
    laborHours: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
    externalCostAmount: z.string().regex(/^\d+\.\d{2}$/).nullable().optional(),
    externalInvoiceRef: SafeText.max(120).nullable().optional(),
    /** Garancija na izvedeni rad (datum do kojeg važi). */
    warrantyUntil: IsoDate.nullable().optional(),
    /** Ručna ispravka zastoja — traži razlog i ide u audit. */
    downtimeMinutes: z.number().int().nonnegative().nullable().optional(),
    downtimeReason: SafeText.min(10).max(500).nullable().optional(),
  })
  .strict();
export type ServiceOrderServiceInput = z.infer<typeof ServiceOrderServiceInput>;

export const ServiceOrderRejectInput = z
  .object({ reason: SafeText.min(10).max(500) })
  .strict();
export type ServiceOrderRejectInput = z.infer<typeof ServiceOrderRejectInput>;

export const ServiceOrderPartInput = z
  .object({
    itemId: z.string().min(1),
    quantity: z.string().regex(/^\d+(\.\d{1,3})?$/),
    /** Kad nije unesen, koristi se zadnja nabavna cijena iz kretnji (`IN`). */
    unitCostAmount: z.string().regex(/^\d+\.\d{2}$/).nullable().optional(),
    note: SafeText.max(500).nullable().optional(),
  })
  .strict();
export type ServiceOrderPartInput = z.infer<typeof ServiceOrderPartInput>;

export const ServiceMutationOutcome = z.object({
  outcome: z.enum(["OK", "VALIDATION_FAILED", "FORBIDDEN", "CONFLICT", "NOT_FOUND"]),
  id: z.string().optional(),
  code: z.string().optional(),
  message: z.string().optional(),
  /** Nakon `finish`: proknjižen trošak (ili `skipped` kad knjiženje nije prošlo). */
  cost: z
    .object({ posted: z.number(), pending: z.number(), skipped: z.number() })
    .optional(),
});
export type ServiceMutationOutcome = z.infer<typeof ServiceMutationOutcome>;

/* --- preventivno održavanje --- */

export const MaintenanceBasis = z.enum(["HOURS", "KM", "DAYS"]);
export const MaintenanceStatus = z.enum(["OK", "DUE_SOON", "OVERDUE", "NO_DATA"]);

export const MaintenanceTemplateRow = z.object({
  id: z.string(),
  categoryId: z.string().nullable(),
  categoryName: z.string().nullable(),
  code: z.string(),
  name: z.string(),
  basis: MaintenanceBasis,
  intervalValue: z.string(),
  tolerancePct: z.string(),
  items: z.array(z.string()),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
});
export type MaintenanceTemplateRow = z.infer<typeof MaintenanceTemplateRow>;

export const MaintenanceTemplatesResponse = z.object({
  templates: z.array(MaintenanceTemplateRow),
});
export type MaintenanceTemplatesResponse = z.infer<typeof MaintenanceTemplatesResponse>;

export const MaintenanceTemplateInput = z
  .object({
    categoryId: z.string().min(1).nullable().optional(),
    code: SafeText.min(2).max(40),
    name: SafeText.min(3).max(200),
    basis: MaintenanceBasis,
    intervalValue: z.string().regex(/^\d+(\.\d{1,2})?$/),
    tolerancePct: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
    items: z.array(SafeText.min(1).max(200)).max(50).optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
export type MaintenanceTemplateInput = z.infer<typeof MaintenanceTemplateInput>;

export const MaintenancePlanRow = z.object({
  id: z.string(),
  machineId: z.string(),
  templateId: z.string().nullable(),
  name: z.string(),
  basis: MaintenanceBasis,
  intervalValue: z.string(),
  tolerancePct: z.string(),
  lastDoneAt: z.string().nullable(),
  lastDoneMeter: z.string().nullable(),
  nextDueAt: z.string().nullable(),
  nextDueMeter: z.string().nullable(),
  isActive: z.boolean(),
  status: MaintenanceStatus,
  currentMeter: z.string().nullable(),
  dueSoonAt: z.string().nullable(),
  remaining: z.string().nullable(),
  /** Nalog koji je okidač već otvorio za ovaj ciklus, ako postoji. */
  openOrderId: z.string().nullable(),
});
export type MaintenancePlanRow = z.infer<typeof MaintenancePlanRow>;

export const MaintenancePlansResponse = z.object({ plans: z.array(MaintenancePlanRow) });
export type MaintenancePlansResponse = z.infer<typeof MaintenancePlansResponse>;

export const MaintenancePlanInput = z
  .object({
    templateId: z.string().min(1).nullable().optional(),
    name: SafeText.min(3).max(200),
    basis: MaintenanceBasis,
    intervalValue: z.string().regex(/^\d+(\.\d{1,2})?$/),
    tolerancePct: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
    lastDoneAt: IsoDate.nullable().optional(),
    lastDoneMeter: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable().optional(),
    nextDueAt: IsoDate.nullable().optional(),
    nextDueMeter: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
export type MaintenancePlanInput = z.infer<typeof MaintenancePlanInput>;

export const MachineMaintenanceResponse = z.object({
  plans: z.array(MaintenancePlanRow),
  reliability: z.object({
    from: z.string(),
    to: z.string(),
    faultCount: z.number().int(),
    finishedCount: z.number().int(),
    mttrMinutes: z.number().int().nullable(),
    mtbfHours: z.string().nullable(),
    workHours: z.string(),
    maintenanceCostAmount: z.string(),
    maintenanceCostPerHourAmount: z.string().nullable(),
    currencyCode: z.string().length(3),
  }),
  orders: z.array(ServiceOrderRow),
});
export type MachineMaintenanceResponse = z.infer<typeof MachineMaintenanceResponse>;

export const MachineReliabilityResponse = MachineMaintenanceResponse.pick({ reliability: true });
export type MachineReliabilityResponse = z.infer<typeof MachineReliabilityResponse>;

/* --- zalihe --- */

export const StockItemRow = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  unit: z.string(),
  categoryId: z.string().nullable(),
  minQuantity: z.string(),
  /** Isključivo `SUM(stock_movements)` — nigdje se ne čuva na artiklu. */
  onHand: z.string(),
  belowMinimum: z.boolean(),
  lastUnitCostAmount: z.string().nullable(),
  isActive: z.boolean(),
  note: z.string().nullable(),
});
export type StockItemRow = z.infer<typeof StockItemRow>;

export const StockItemsResponse = z.object({ items: z.array(StockItemRow) });
export type StockItemsResponse = z.infer<typeof StockItemsResponse>;

export const StockItemInput = z
  .object({
    code: SafeText.min(1).max(64),
    name: SafeText.min(2).max(200),
    unit: SafeText.min(1).max(16),
    categoryId: z.string().min(1).nullable().optional(),
    minQuantity: z.string().regex(/^\d+(\.\d{1,3})?$/).optional(),
    isActive: z.boolean().optional(),
    note: SafeText.max(1000).nullable().optional(),
  })
  .strict();
export type StockItemInput = z.infer<typeof StockItemInput>;

export const StockMovementRow = z.object({
  id: z.string(),
  itemId: z.string(),
  itemCode: z.string(),
  itemName: z.string(),
  kind: z.enum(["IN", "OUT", "TRANSFER", "COUNT"]),
  quantity: z.string(),
  unitCostAmount: z.string().nullable(),
  occurredOn: z.string(),
  sourceType: z.string().nullable(),
  sourceId: z.string().nullable(),
  note: z.string().nullable(),
  createdByName: z.string().nullable(),
});
export type StockMovementRow = z.infer<typeof StockMovementRow>;

export const StockMovementsResponse = z.object({ movements: z.array(StockMovementRow) });
export type StockMovementsResponse = z.infer<typeof StockMovementsResponse>;

export const StockMovementInput = z
  .object({
    itemId: SafeText.min(1),
    warehouseId: SafeText.min(1).optional(),
    kind: z.enum(["IN", "OUT", "COUNT"]),
    quantity: z.string().regex(/^\d{1,11}(\.\d{1,3})?$/),
    unitCostAmount: z.string().regex(/^\d{1,14}\.\d{2}$/).nullable().optional(),
    occurredOn: z.iso.date().optional(),
    note: SafeText.max(1000).nullable().optional(),
  })
  .strict();
export type StockMovementInput = z.infer<typeof StockMovementInput>;

/* ------------------------------------------------------------------ F9: dnevnik i HSE */

/** Zaglavlje dana (§1.1). Status govori gdje je dokument: nacrt, potpisan ili zaključan. */
export const SiteDiaryListItem = z.object({
  id: z.string(),
  projectId: z.string(),
  projectCode: z.string(),
  projectName: z.string(),
  diaryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(["DRAFT", "SIGNED", "LOCKED"]),
  weather: z.string().nullable(),
  workedHours: z.string().nullable(),
  signedName: z.string().nullable(),
  version: z.number().int().positive(),
  workersCount: z.number().int().nonnegative(),
  machinesCount: z.number().int().nonnegative(),
  delaysHours: z.string(),
});
export type SiteDiaryListItem = z.infer<typeof SiteDiaryListItem>;

export const SiteDiariesResponse = z.object({ diaries: z.array(SiteDiaryListItem) });
export type SiteDiariesResponse = z.infer<typeof SiteDiariesResponse>;

export const SiteDiaryItemRow = z.object({
  id: z.string(),
  boqItemId: z.string().nullable(),
  description: z.string(),
  unit: z.string(),
  quantity: z.string(),
  /** `BOQ` stavka uvećava `project_boq_items.quantity_executed` — jedan izvor završenosti. */
  source: z.enum(["MANUAL", "HAUL", "BOQ"]),
  boqCode: z.string().nullable(),
  boqQuantityExecuted: z.string().nullable(),
  boqQuantityPlanned: z.string().nullable(),
});
export type SiteDiaryItemRow = z.infer<typeof SiteDiaryItemRow>;

export const SiteDiaryDelayRow = z.object({
  id: z.string(),
  kind: z.enum(["RAIN", "SNOW", "WIND", "FROST", "SUBCONTRACTOR", "MATERIAL", "PERMIT", "OTHER"]),
  fromAt: z.string(),
  toAt: z.string(),
  hours: z.string(),
  note: z.string().nullable(),
  amendmentId: z.string().nullable(),
  /** Veza na `TIME` aneks iz Modula 6 — zastoji dokazuju produženje roka. */
  extensionDays: z.number().int().nullable(),
});
export type SiteDiaryDelayRow = z.infer<typeof SiteDiaryDelayRow>;

export const SiteDiaryDetail = z.object({
  diary: z.object({
    id: z.string(),
    projectId: z.string(),
    projectCode: z.string(),
    projectName: z.string(),
    diaryDate: z.string(),
    status: z.enum(["DRAFT", "SIGNED", "LOCKED"]),
    weather: z.string().nullable(),
    temperatureC: z.string().nullable(),
    workedHours: z.string().nullable(),
    description: z.string().nullable(),
    visitors: z.string().nullable(),
    events: z.string().nullable(),
    signedName: z.string().nullable(),
    signedAt: z.string().nullable(),
    signedByWorkerId: z.string().nullable(),
    lockedAt: z.string().nullable(),
    version: z.number().int().positive(),
  }),
  /** Automatski izvučeno iz Modula 3/5; `frozen` znači zamrznuto u trenutku potpisa. */
  auto: z.object({
    workers: z.array(z.object({ workerId: z.string(), workerName: z.string(), minutes: z.number(), hours: z.string() })),
    machines: z.array(z.object({
      machineId: z.string(), machineCode: z.string(), machineName: z.string(),
      hours: z.string(), meterFrom: z.string().nullable(), meterTo: z.string().nullable(),
    })),
    hauls: z.array(z.object({
      haulId: z.string(), machineName: z.string(), material: z.string().nullable(),
      quantity: z.string(), quantityUnit: z.string(), phaseId: z.string().nullable(),
    })),
    faults: z.array(z.object({
      faultId: z.string(), machineName: z.string(), title: z.string(),
      downtimeMinutes: z.number().nullable(), priority: z.string(),
    })),
    workedHours: z.string(),
    generatedAt: z.string(),
  }),
  frozen: z.boolean(),
  items: z.array(SiteDiaryItemRow),
  delays: z.array(SiteDiaryDelayRow),
  delayHoursTotal: z.string(),
  attachments: z.array(z.object({
    id: z.string(), file_name: z.string(), content_type: z.string(), status: z.string(), created_at: z.string(),
  })),
  revisions: z.array(z.object({ id: z.string(), reason: z.string(), authorName: z.string(), createdAt: z.string() })),
});
export type SiteDiaryDetail = z.infer<typeof SiteDiaryDetail>;

export const SiteDiaryCreateInput = z.object({
  projectId: z.string().min(1).max(128),
  diaryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weather: z.enum(["CLEAR", "CLOUDY", "RAIN", "SNOW", "WIND", "FROST", "HEAT"]).nullable().optional(),
  /* Brojevi su i tekstualna polja: `SafeText` odbija kontrolne znakove PRIJE nego regex vidi
     string, pa NUL ne može proći kao „broj“ u zaglavlju dnevnika. */
  temperatureC: SafeText.regex(/^-?\d{1,3}(?:\.\d)?$/).nullable().optional(),
  workedHours: SafeText.regex(/^\d{1,5}(?:\.\d{1,2})?$/).nullable().optional(),
  description: SafeText.max(4000).nullable().optional(),
  visitors: SafeText.max(2000).nullable().optional(),
  events: SafeText.max(4000).nullable().optional(),
});
export type SiteDiaryCreateInput = z.infer<typeof SiteDiaryCreateInput>;

export const SiteDiaryPatchInput = SiteDiaryCreateInput.omit({ projectId: true, diaryDate: true });
export type SiteDiaryPatchInput = z.infer<typeof SiteDiaryPatchInput>;

export const SiteDiaryItemInput = z.object({
  boqItemId: SafeText.max(128).nullable().optional(),
  description: SafeText.min(1).max(500),
  unit: SafeText.min(1).max(20),
  quantity: z.string().regex(/^\d{1,14}(?:\.\d{1,3})?$/),
  source: z.enum(["MANUAL", "HAUL", "BOQ"]).optional(),
});
export type SiteDiaryItemInput = z.infer<typeof SiteDiaryItemInput>;

export const SiteDiaryDelayInput = z.object({
  kind: z.enum(["RAIN", "SNOW", "WIND", "FROST", "SUBCONTRACTOR", "MATERIAL", "PERMIT", "OTHER"]),
  fromAt: z.string(),
  toAt: z.string(),
  /* Gornja granica 24 h je u domeni/bazi (`site_diary_delays_hours_check`); ovdje je samo oblik. */
  hours: SafeText.regex(/^\d{1,2}(?:\.\d{1,2})?$/),
  note: SafeText.max(1000).nullable().optional(),
  amendmentId: SafeText.max(128).nullable().optional(),
});
export type SiteDiaryDelayInput = z.infer<typeof SiteDiaryDelayInput>;

export const SiteDiarySignInput = z.object({
  signedName: SafeText.min(2).max(200),
  workerId: SafeText.max(128).nullable().optional(),
});
export type SiteDiarySignInput = z.infer<typeof SiteDiarySignInput>;

export const SiteDiaryReviseInput = SiteDiaryPatchInput.extend({
  /** Razlog ≥10 znakova — revizija bez razloga je samo trag da se nešto mijenjalo. */
  reason: SafeText.min(10).max(500),
});
export type SiteDiaryReviseInput = z.infer<typeof SiteDiaryReviseInput>;

export const SiteDiaryTemplate = z.object({
  id: z.string(),
  name: z.string(),
  header: z.object({
    companyLine: z.string().nullable(),
    projectLine: z.string().nullable(),
    legalNote: z.string().nullable(),
  }),
  sections: z.array(z.object({
    key: z.enum(["HEADER", "WEATHER", "WORKERS", "MACHINES", "QUANTITIES", "HAULS", "EVENTS", "DELAYS", "ATTACHMENTS", "SIGNATURES"]),
    label: z.string(),
    enabled: z.boolean(),
  })),
  isDefault: z.boolean(),
  formatConfirmedAt: z.string().nullable(),
  /** `true` dok vlasnik/pravnik nije potvrdio obrazac — svaki izvoz tada nosi `DRAFT_FORMAT`. */
  draftFormat: z.boolean(),
});
export type SiteDiaryTemplate = z.infer<typeof SiteDiaryTemplate>;

/**
 * PATCH tijelo šablona. Namjerno NE prima cijeli `SiteDiaryTemplate`: `formatConfirmedAt` i
 * `draftFormat` su IZVEDENI (iz baze), pa bi ih klijent mogao „vratiti“ na staro. Potvrda obrasca
 * ide samo kroz `confirmFormat: true`.
 */
export const SiteDiaryTemplatePatchInput = z.object({
  id: SafeText.min(1).max(128),
  name: SafeText.min(1).max(200).optional(),
  header: z.object({
    companyLine: SafeText.max(500).nullable().optional(),
    projectLine: SafeText.max(500).nullable().optional(),
    legalNote: SafeText.max(2000).nullable().optional(),
  }).strict().optional(),
  sections: z.array(z.object({
    key: z.enum(["HEADER", "WEATHER", "WORKERS", "MACHINES", "QUANTITIES", "HAULS", "EVENTS", "DELAYS", "ATTACHMENTS", "SIGNATURES"]),
    label: SafeText.min(1).max(100),
    enabled: z.boolean(),
  }).strict()).max(20).optional(),
  confirmFormat: z.boolean().optional(),
}).strict();
export type SiteDiaryTemplatePatchInput = z.infer<typeof SiteDiaryTemplatePatchInput>;

export const SiteDiaryTemplatesResponse = z.object({ templates: z.array(SiteDiaryTemplate) });
export type SiteDiaryTemplatesResponse = z.infer<typeof SiteDiaryTemplatesResponse>;

export const HseIncidentKind = z.enum(["ACCIDENT", "NEAR_MISS", "PROPERTY_DAMAGE", "ENVIRONMENTAL", "OCCUPATIONAL_ILLNESS"]);
export const HseIncidentSeverity = z.enum(["MINOR", "MODERATE", "SEVERE", "FATAL"]);
export const HseIncidentStatus = z.enum(["REPORTED", "INVESTIGATING", "ACTIONS_OPEN", "CLOSED"]);

export const HseIncidentListItem = z.object({
  id: z.string(),
  kind: HseIncidentKind,
  severity: HseIncidentSeverity,
  status: HseIncidentStatus,
  occurredAt: z.string(),
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  description: z.string(),
  lostDays: z.number().int().nonnegative(),
  reportableToAuthority: z.boolean(),
  /** Obaveza `HSE_REPORT` iz Modula 2 — zakonski rok, ne podsjetnik. */
  reportObligationId: z.string().nullable(),
  openActions: z.number().int().nonnegative(),
  overdueActions: z.number().int().nonnegative(),
});
export type HseIncidentListItem = z.infer<typeof HseIncidentListItem>;

export const HseIncidentsResponse = z.object({ incidents: z.array(HseIncidentListItem) });
export type HseIncidentsResponse = z.infer<typeof HseIncidentsResponse>;

export const HseIncidentInput = z.object({
  kind: HseIncidentKind,
  severity: HseIncidentSeverity,
  occurredAt: SafeText.min(1).max(40),
  projectId: SafeText.max(128).nullable().optional(),
  locationText: SafeText.max(300).nullable().optional(),
  lat: SafeText.regex(/^-?\d{1,3}(?:\.\d{1,6})?$/).nullable().optional(),
  lng: SafeText.regex(/^-?\d{1,3}(?:\.\d{1,6})?$/).nullable().optional(),
  description: SafeText.min(5).max(4000),
  immediateAction: SafeText.max(2000).nullable().optional(),
  reporterWorkerId: SafeText.max(128).nullable().optional(),
  injuredWorkerId: SafeText.max(128).nullable().optional(),
  involvedWorkers: z.array(z.object({ workerId: SafeText.min(1).max(128), injured: z.boolean() }).strict()).max(100).optional(),
  lostDays: z.number().int().min(0).max(3650).optional(),
  reportableToAuthority: z.boolean().optional(),
  clientLocalId: SafeText.max(128).nullable().optional(),
});
export type HseIncidentInput = z.infer<typeof HseIncidentInput>;

export const HseIncidentUpdateInput = z.object({
  body: SafeText.min(1).max(4000),
  authorWorkerId: SafeText.max(128).nullable().optional(),
});
export type HseIncidentUpdateInput = z.infer<typeof HseIncidentUpdateInput>;

export const HseInvestigationInput = z.object({
  rootCause: SafeText.min(5).max(4000),
  method: z.enum(["FIVE_WHY", "FISHBONE", "OTHER"]).optional(),
  findings: SafeText.max(4000).nullable().optional(),
  completed: z.boolean().optional(),
});
export type HseInvestigationInput = z.infer<typeof HseInvestigationInput>;

export const HseActionRowSchema = z.object({
  id: z.string(),
  description: z.string(),
  dueOn: z.string(),
  status: z.enum(["OPEN", "DONE", "CANCELLED"]),
  doneOn: z.string().nullable(),
  incidentId: z.string().nullable(),
  inspectionId: z.string().nullable(),
  responsibleName: z.string().nullable(),
  /** Izračunato pri čitanju (`due_on < danas AND status='OPEN'`), nikad upisano. */
  overdue: z.boolean(),
});
export type HseActionRowSchema = z.infer<typeof HseActionRowSchema>;

export const HseActionsResponse = z.object({
  today: z.string(),
  actions: z.array(HseActionRowSchema),
});
export type HseActionsResponse = z.infer<typeof HseActionsResponse>;

export const HseActionInput = z.object({
  incidentId: SafeText.max(128).nullable().optional(),
  inspectionId: SafeText.max(128).nullable().optional(),
  description: SafeText.min(5).max(1000),
  responsibleWorkerId: SafeText.min(1).max(128),
  dueOn: SafeText.regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type HseActionInput = z.infer<typeof HseActionInput>;

export const HseActionPatchInput = z.object({
  id: SafeText.min(1).max(128),
  kind: z.enum(["DONE", "CANCEL"]),
  note: SafeText.max(2000).nullable().optional(),
  reason: SafeText.max(500).optional(),
});
export type HseActionPatchInput = z.infer<typeof HseActionPatchInput>;

export const HseTrainingInput = z.object({
  kind: z.enum(["INDUCTION", "TOOLBOX", "TASK_INSTRUCTION", "CERTIFICATION", "DRILL"]),
  title: SafeText.min(2).max(200),
  topic: SafeText.max(1000).nullable().optional(),
  heldAt: SafeText.min(1).max(40),
  projectId: SafeText.max(128).nullable().optional(),
  location: SafeText.max(200).nullable().optional(),
  durationMinutes: z.number().int().min(1).max(600).nullable().optional(),
  heldByWorkerId: SafeText.max(128).nullable().optional(),
  /** Prisustvo je POTPIS, ne checkbox (§1.4/19). */
  attendees: z.array(z.object({
    workerId: SafeText.min(1).max(128),
    signatureName: SafeText.min(2).max(200),
    signedAt: SafeText.min(1).max(40),
  })).min(1).max(100),
  /** Certifikacijska obuka jednim pozivom obnavlja obavezu iz Modula 2. */
  renewObligationId: SafeText.max(128).nullable().optional(),
});
export type HseTrainingInput = z.infer<typeof HseTrainingInput>;

export const HseTrainingRow = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  topic: z.string().nullable(),
  heldAt: z.string(),
  durationMinutes: z.number().int().nullable(),
  location: z.string().nullable(),
  projectName: z.string().nullable(),
  attendees: z.number().int().nonnegative(),
});
export type HseTrainingRow = z.infer<typeof HseTrainingRow>;

export const HseTrainingsResponse = z.object({ trainings: z.array(HseTrainingRow) });
export type HseTrainingsResponse = z.infer<typeof HseTrainingsResponse>;

export const HseTrainingAttendeesResponse = z.object({
  training: z.object({ id: z.string(), title: z.string(), kind: z.string(), held_at: z.string() }),
  attendees: z.array(z.object({
    workerId: z.string(), workerName: z.string(), signatureName: z.string(), signedAt: z.string(),
  })),
});
export type HseTrainingAttendeesResponse = z.infer<typeof HseTrainingAttendeesResponse>;

export const HseInspectionRow = z.object({
  id: z.string(),
  kind: z.enum(["INTERNAL", "EXTERNAL", "AUTHORITY"]),
  authorityName: z.string().nullable(),
  inspectedAt: z.string(),
  inspectorName: z.string().nullable(),
  summary: z.string().nullable(),
  result: z.enum(["PASS", "MINOR_FINDINGS", "MAJOR_FINDINGS", "PROHIBITION"]),
  /** `null` znači zabrana još traje — nalaz je tada istaknut na Pregledu. */
  prohibitionLiftedAt: z.string().nullable(),
  projectName: z.string().nullable(),
  openActions: z.number().int().nonnegative(),
});
export type HseInspectionRow = z.infer<typeof HseInspectionRow>;

export const HseInspectionsResponse = z.object({ inspections: z.array(HseInspectionRow) });
export type HseInspectionsResponse = z.infer<typeof HseInspectionsResponse>;

export const HseInspectionInput = z.object({
  kind: z.enum(["INTERNAL", "EXTERNAL", "AUTHORITY"]),
  authorityName: SafeText.max(200).nullable().optional(),
  inspectedAt: SafeText.min(1).max(40),
  inspectorName: SafeText.max(200).nullable().optional(),
  summary: SafeText.max(4000).nullable().optional(),
  result: z.enum(["PASS", "MINOR_FINDINGS", "MAJOR_FINDINGS", "PROHIBITION"]),
  projectId: SafeText.max(128).nullable().optional(),
});

/** Podizanje zabrane rada: razlog je obavezan, jer zabrana nestaje samo sa tragom ko i zašto. */
export const HseInspectionLiftInput = z.object({
  id: SafeText.min(1).max(128),
  note: SafeText.min(5).max(1000),
});
export type HseInspectionInput = z.infer<typeof HseInspectionInput>;

export const HseStats = z.object({
  from: z.string(),
  to: z.string(),
  workedHours: z.number(),
  incidents: z.number().int().nonnegative(),
  bySeverity: z.record(z.string(), z.number()),
  byKind: z.record(z.string(), z.number()),
  nearMisses: z.number().int().nonnegative(),
  lostDays: z.number().int().nonnegative(),
  /** `(ozljede sa izgubljenim danima × 1 000 000) / sati`; `null` kad sati nema. */
  ltifr: z.number().nullable(),
  actions: z.object({ open: z.number(), overdue: z.number(), onTimeRate: z.number().nullable() }),
  trainings: z.object({ count: z.number(), toolbox: z.number(), attendees: z.number() }),
  activeProhibition: z.object({
    id: z.string(), inspectedAt: z.string(), authorityName: z.string().nullable(),
  }).nullable(),
});
export type HseStats = z.infer<typeof HseStats>;

export const HseIncidentDetail = z.object({
  incident: z.object({
    id: z.string(),
    projectId: z.string().nullable(),
    projectName: z.string().nullable(),
    kind: HseIncidentKind,
    severity: HseIncidentSeverity,
    status: HseIncidentStatus,
    occurredAt: z.string(),
    locationText: z.string().nullable(),
    lat: z.string().nullable(),
    lng: z.string().nullable(),
    description: z.string(),
    immediateAction: z.string().nullable(),
    reporterWorkerId: z.string().nullable(),
    reporterName: z.string().nullable(),
    injuredWorkerId: z.string().nullable(),
    injuredName: z.string().nullable(),
    lostDays: z.number().int().nonnegative(),
    reportableToAuthority: z.boolean(),
    reportObligationId: z.string().nullable(),
    authorityReportedAt: z.string().nullable(),
    closedAt: z.string().nullable(),
    createdAt: z.string(),
  }),
  involvedWorkers: z.array(z.object({ workerId: z.string(), name: z.string(), injured: z.boolean() })),
  updates: z.array(z.object({ id: z.string(), body: z.string(), authorName: z.string(), createdAt: z.string() })),
  investigation: z.object({
    id: z.string(), rootCause: z.string(), method: z.string(),
    findings: z.string().nullable(), completedAt: z.string().nullable(),
  }).nullable(),
  actions: z.array(z.object({
    id: z.string(), description: z.string(), dueOn: z.string(), status: z.enum(["OPEN", "DONE", "CANCELLED"]),
    doneOn: z.string().nullable(), responsibleName: z.string().nullable(), overdue: z.boolean(),
  })),
  attachments: z.array(z.object({ id: z.string(), file_name: z.string(), content_type: z.string(), status: z.string(), sha256: z.string() })),
  /** `true` kad prijava tvrdi obavezu prijave, a veza na obavezu još ne postoji. */
  needsReportObligation: z.boolean(),
});
export type HseIncidentDetail = z.infer<typeof HseIncidentDetail>;

/* F10A-1: skladišta i popis. Količine su decimalni stringovi, ne float. */
const StockQuantity = z.string().regex(/^\d{1,11}(?:\.\d{1,3})?$/);
export const WarehouseCreateInput = z.object({
  code: SafeText.min(1).max(64), name: SafeText.min(1).max(200), kind: z.literal('SITE'),
  projectId: SafeText.min(1), address: SafeText.max(500).nullable().optional(),
}).strict();
export const WarehousePatchInput = z.object({
  name: SafeText.min(1).max(200).optional(), address: SafeText.max(500).nullable().optional(), isActive: z.boolean().optional(),
}).strict();
export const WarehousesResponse = z.object({ warehouses: z.array(z.object({
  id: z.string(), code: z.string(), name: z.string(), kind: z.enum(['CENTRAL','SITE','TANK']),
  project_id: z.string().nullable(), address: z.string().nullable(), is_active: z.boolean(),
})) });
export const WarehouseIdResponse = z.object({ id: z.string() });
export const StockLevelInput = z.object({ warehouseId: SafeText.min(1), minQuantity: StockQuantity, maxQuantity: StockQuantity.nullable().optional() }).strict();
export const StockBalanceResponse = z.object({ balances: z.array(z.object({
  warehouse_id: z.string(), warehouse_name: z.string(), item_id: z.string(), code: z.string(), name: z.string(), unit: z.string(),
  min_quantity: z.string(), max_quantity: z.string().nullable(), on_hand: z.string(), below_minimum: z.boolean(),
})) });
export const StockTransferInput = z.object({
  fromWarehouseId: SafeText.min(1), toWarehouseId: SafeText.min(1), itemId: SafeText.min(1),
  quantity: StockQuantity, occurredOn: z.iso.date(),
}).strict();
export const StockTransferResponse = z.object({ transferId: z.string(), belowMinimum: z.boolean() });
export const StockCountCreateInput = z.object({
  warehouseId: SafeText.min(1), reason: SafeText.min(3).max(1000).nullable().optional(),
  items: z.array(z.object({ itemId: SafeText.min(1), countedQuantity: StockQuantity }).strict()).min(1).max(500),
}).strict();
export const StockCountApplyInput = z.object({ reason: SafeText.min(3).max(1000).nullable().optional() }).strict();
export const StockCountsResponse = z.object({ counts: z.array(z.object({
  id: z.string(), warehouse_id: z.string(), status: z.enum(['DRAFT','APPLIED']), reason: z.string().nullable(),
  created_at: z.string(), applied_at: z.string().nullable(),
})) });
export const StockCountApplyResponse = z.object({ id: z.string(), alreadyApplied: z.boolean() });
export const StockCountDetailResponse = z.object({
  count: StockCountsResponse.shape.counts.element,
  items: z.array(z.object({ item_id: z.string(), counted_quantity: z.string(), system_quantity: z.string().nullable(), difference: z.string().nullable() })),
});

/* F10A-2: iznosi putuju kao cijeli feningi, količine kao decimalni stringovi. */
const PurchaseCents = z.string().regex(/^\d{1,15}$/);
const PurchaseItem = z.object({
  itemId: SafeText.min(1).max(128).nullable().optional(), description: SafeText.min(1).max(500),
  unit: SafeText.min(1).max(16), quantity: StockQuantity,
  estimatedUnitPriceCents: PurchaseCents,
}).strict();
export const PurchaseRequestInput = z.object({
  clientGeneratedId:z.uuid(), projectId: SafeText.min(1).max(128).nullable().optional(), phaseId: SafeText.min(1).max(128).nullable().optional(),
  requestedByWorkerId: SafeText.min(1).max(128).nullable().optional(), neededBy: z.iso.date().nullable().optional(),
  justification: SafeText.min(1).max(2000), currencyCode: z.enum(["BAM", "EUR", "USD"]),
  items: z.array(PurchaseItem).min(1).max(200),
}).strict();
export type PurchaseRequestInput = z.infer<typeof PurchaseRequestInput>;
export const PurchaseRequestPatchInput = z.object({
  neededBy: z.iso.date().nullable().optional(), justification: SafeText.min(1).max(2000).optional(),
}).strict();
export type PurchaseRequestPatchInput = z.infer<typeof PurchaseRequestPatchInput>;
export const PurchaseRejectInput = z.object({ reason: SafeText.min(10).max(500) }).strict();
export const PurchaseEmptyInput = z.object({}).strict();
export const PurchaseRequestRow = z.object({
  id: z.string(), project_id: z.string().nullable(), phase_id: z.string().nullable(), requested_by_worker_id: z.string().nullable(),
  needed_by: z.string().nullable(), justification: z.string(), status: z.enum(["DRAFT","SUBMITTED","APPROVED","REJECTED","ORDERED","CLOSED","CANCELLED"]),
  total_estimated_cents: z.string(), currency_code: z.string(), approval_threshold_cents: z.string().nullable(), created_by: z.string(), created_at: z.string(),
});
export const PurchaseRequestsResponse = z.object({ requests: z.array(PurchaseRequestRow) });
export const PurchaseRequestDetail = z.object({ request: PurchaseRequestRow, items: z.array(z.object({
  id:z.string(), item_id:z.string().nullable(), description:z.string(), unit:z.string(), quantity:z.string(), estimated_unit_price_cents:z.string(),
})) });
export const PurchaseMutationResponse = z.object({ id:z.string(), status:z.string().optional(), approvalRequired:z.boolean().optional() });
export const PurchaseOrderInput = z.object({
  clientGeneratedId:z.uuid(), requestId: SafeText.min(1).max(128).nullable().optional(), partnerId: SafeText.min(1).max(128),
  expectedAt: z.iso.date().nullable().optional(), currencyCode: z.enum(["BAM","EUR","USD"]),
  items: z.array(z.object({
    requestItemId: SafeText.min(1).max(128).nullable().optional(), itemId: SafeText.min(1).max(128),
    description: SafeText.min(1).max(500), unit: SafeText.min(1).max(16), quantity: StockQuantity, unitPriceCents: PurchaseCents,
  }).strict()).min(1).max(200),
}).strict();
export type PurchaseOrderInput=z.infer<typeof PurchaseOrderInput>;
export const PurchaseOrderPatchInput = z.object({expectedAt:z.iso.date().nullable().optional()}).strict();
export type PurchaseOrderPatchInput=z.infer<typeof PurchaseOrderPatchInput>;
export const PurchaseOrderRow = z.object({
  id:z.string(),request_id:z.string().nullable(),partner_id:z.string(),ordered_at:z.string().nullable(),expected_at:z.string().nullable(),
  status:z.enum(["DRAFT","SENT","PARTIALLY_RECEIVED","RECEIVED","CANCELLED"]),total_cents:z.string(),currency_code:z.string(),created_at:z.string(),
});
export const PurchaseOrdersResponse=z.object({orders:z.array(PurchaseOrderRow)});
export const PurchaseOrderDetail=z.object({order:PurchaseOrderRow,items:z.array(z.object({
  id:z.string(),request_item_id:z.string().nullable(),item_id:z.string(),description:z.string(),unit:z.string(),quantity:z.string(),unit_price_cents:z.string(),received_quantity:z.string(),
}))});
export const GoodsReceiptInput=z.object({
  clientGeneratedId:z.uuid(), orderId:SafeText.min(1).max(128).nullable().optional(),partnerId:SafeText.min(1).max(128),warehouseId:SafeText.min(1).max(128),
  receivedAt:z.iso.datetime({offset:true}),currencyCode:z.enum(["BAM","EUR","USD"]),note:SafeText.min(3).max(1000).nullable().optional(),
  items:z.array(z.object({orderItemId:SafeText.min(1).max(128).nullable().optional(),itemId:SafeText.min(1).max(128),quantity:StockQuantity,unitPriceCents:PurchaseCents}).strict()).min(1).max(200),
}).strict();
export type GoodsReceiptInput=z.infer<typeof GoodsReceiptInput>;
export const GoodsReceiptsResponse=z.object({receipts:z.array(z.object({id:z.string(),order_id:z.string().nullable(),partner_id:z.string(),warehouse_id:z.string(),received_at:z.string(),currency_code:z.string(),note:z.string().nullable(),item_id:z.string(),stock_item_id:z.string(),item_name:z.string(),unit:z.string(),quantity:z.string(),amount_cents:z.string()}))});
export const GoodsReceiptResponse=z.object({id:z.string(),warnings:z.array(z.string()),orderStatus:z.string().nullable()});
export const PurchaseInvoiceInput=z.object({
  partnerId:SafeText.min(1).max(128),invoiceNumber:SafeText.min(1).max(120),invoiceDate:z.iso.date(),dueDate:z.iso.date().nullable().optional(),
  amountCents:PurchaseCents,currencyCode:z.enum(["BAM","EUR","USD"]),orderId:SafeText.min(1).max(128).nullable().optional(),
  projectId:SafeText.min(1).max(128).nullable().optional(),phaseId:SafeText.min(1).max(128).nullable().optional(),attachmentId:SafeText.min(1).max(128).nullable().optional(),
  items:z.array(z.object({receiptItemId:SafeText.min(1).max(128),quantity:StockQuantity,amountCents:PurchaseCents}).strict()).max(200).default([]),
}).strict();
export type PurchaseInvoiceInput=z.infer<typeof PurchaseInvoiceInput>;
export const PurchaseInvoicePatchInput=z.object({dueDate:z.iso.date().nullable().optional()}).strict();
export type PurchaseInvoicePatchInput=z.infer<typeof PurchaseInvoicePatchInput>;
export const PurchaseInvoiceRow=z.object({
  id:z.string(),partner_id:z.string(),invoice_number:z.string(),invoice_date:z.string(),due_date:z.string().nullable(),
  amount_cents:z.string(),currency_code:z.string(),order_id:z.string().nullable(),project_id:z.string().nullable(),phase_id:z.string().nullable(),
  attachment_id:z.string().nullable(),status:z.enum(["PENDING","APPROVED","PAID","DISPUTED"]),created_at:z.string(),
  warnings:z.array(z.string()),
});
export const PurchaseInvoicesResponse=z.object({invoices:z.array(PurchaseInvoiceRow)});
export const PurchaseInvoiceDetail=z.object({invoice:PurchaseInvoiceRow,items:z.array(z.object({id:z.string(),receipt_item_id:z.string(),quantity:z.string(),amount_cents:z.string()}))});
export const PurchaseInvoiceMutationResponse=z.object({id:z.string(),warnings:z.array(z.string()),alreadyApproved:z.boolean().optional()});
export const MaterialIssueInput=z.object({
  clientGeneratedId:z.uuid(), warehouseId:SafeText.min(1).max(128),projectId:SafeText.min(1).max(128).nullable().optional(),phaseId:SafeText.min(1).max(128).nullable().optional(),
  issuedToWorkerId:SafeText.min(1).max(128).nullable().optional(),issuedAt:z.iso.datetime({offset:true}),note:SafeText.min(1).max(1000).nullable().optional(),
  items:z.array(z.object({itemId:SafeText.min(1).max(128),quantity:StockQuantity}).strict()).min(1).max(200),
}).strict();
export type MaterialIssueInput=z.infer<typeof MaterialIssueInput>;
export const MaterialIssuesResponse=z.object({issues:z.array(z.object({
  id:z.string(),warehouse_id:z.string(),warehouse_name:z.string(),project_id:z.string().nullable(),phase_id:z.string().nullable(),
  issued_at:z.string(),currency_code:z.string(),note:z.string().nullable(),below_minimum:z.boolean(),amount_cents:z.string(),
}))});
export const ManualCostListQuery=z.object({projectId:SafeText.min(1).max(128).optional()}).strict();
export const PendingManualCostsResponse=z.object({requests:z.array(z.object({
  id:z.string(),project_id:z.string(),phase_id:z.string().nullable(),category_id:z.string(),category_name:z.string(),
  occurred_on:z.string(),amount_cents:z.string(),currency_code:z.string(),note:z.string().nullable(),attachment_id:z.string().nullable(),created_at:z.string(),
}))});
export const MaterialIssueResponse=z.object({id:z.string(),amountCents:z.string(),offsetCents:z.string(),belowMinimum:z.boolean()});
const SubcontractPct=z.string().regex(/^(?:\d{1,2}(?:\.\d{1,2})?|100(?:\.0{1,2})?)$/);
export const SubcontractContractInput=z.object({
  clientGeneratedId:z.uuid(),projectId:SafeText.min(1).max(128),partnerId:SafeText.min(1).max(128),code:SafeText.min(1).max(100),
  title:SafeText.min(1).max(300),scope:SafeText.max(2000).nullable().optional(),contractValueCents:PurchaseCents,
  currencyCode:z.enum(["BAM","EUR","USD"]),retentionPct:SubcontractPct,warrantyPct:SubcontractPct,
  validFrom:z.iso.date().nullable().optional(),validTo:z.iso.date().nullable().optional(),documentAttachmentId:SafeText.min(1).max(128).nullable().optional(),
}).strict();
export type SubcontractContractInput=z.infer<typeof SubcontractContractInput>;
export const SubcontractContractPatch=z.object({status:z.enum(["ACTIVE","COMPLETED","TERMINATED"])}).strict();
export type SubcontractContractPatch=z.infer<typeof SubcontractContractPatch>;
export const SubcontractAmendInput=z.object({clientGeneratedId:z.uuid(),valueAmendmentCents:PurchaseCents,reason:SafeText.min(10).max(1000)}).strict();
export type SubcontractAmendInput=z.infer<typeof SubcontractAmendInput>;
export const SubcontractStatementInput=z.object({
  clientGeneratedId:z.uuid(),contractId:SafeText.min(1).max(128),phaseId:SafeText.min(1).max(128).nullable().optional(),
  statementNo:SafeText.min(1).max(100),periodFrom:z.iso.date(),periodTo:z.iso.date(),
  items:z.array(z.object({description:SafeText.min(1).max(500),amountCents:PurchaseCents}).strict()).min(1).max(200),
}).strict();
export type SubcontractStatementInput=z.infer<typeof SubcontractStatementInput>;
export const SubcontractContractRow=z.object({id:z.string(),project_id:z.string(),partner_id:z.string(),code:z.string(),title:z.string(),scope:z.string().nullable(),contract_value_cents:z.string(),amendment_cents:z.string(),currency_code:z.string(),retention_pct:z.string(),warranty_pct:z.string(),valid_from:z.string().nullable(),valid_to:z.string().nullable(),status:z.string(),document_attachment_id:z.string().nullable(),created_at:z.string()});
export const SubcontractStatementRow=z.object({id:z.string(),contract_id:z.string(),phase_id:z.string().nullable(),period_from:z.string(),period_to:z.string(),statement_no:z.string(),status:z.string(),gross_cents:z.string(),retention_pct:z.string(),warranty_pct:z.string(),retention_cents:z.string(),warranty_cents:z.string(),net_cents:z.string(),currency_code:z.string(),exceeded_at_approval:z.boolean(),created_at:z.string()});
export const SubcontractContractsResponse=z.object({contracts:z.array(SubcontractContractRow)});
export const SubcontractContractDetail=z.object({contract:SubcontractContractRow});
export const SubcontractStatementsResponse=z.object({statements:z.array(SubcontractStatementRow)});
export const SubcontractStatementDetail=z.object({statement:SubcontractStatementRow,items:z.array(z.object({id:z.string(),description:z.string(),amount_cents:z.string()}))});
export const SubcontractMutationResponse=z.object({id:z.string(),status:z.string().optional(),warnings:z.array(z.literal("SUBCONTRACTOR_CONTRACT_EXCEEDED")).optional(),alreadyApproved:z.boolean().optional()});

export const ManualCostDecisionResponse=z.object({id:z.string(),status:z.string(),costEntryId:z.string().nullable()});
