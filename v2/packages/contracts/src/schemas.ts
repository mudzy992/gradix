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

export const LoginResponse = z.object({
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
});
export type LoginResponse = z.infer<typeof LoginResponse>;

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

export const ObligationStateEnum = z.enum(["valid", "expiring", "expired", "superseded", "no_expiry"]);
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
export const AttachmentEntityType = z.enum(["OBLIGATION", "TENDER", "MACHINE_DAILY_CHECK"]);
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
    "machine_daily_check", "machine_fault",
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

export const PartnerRow = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  kind: z.enum(["VENDOR", "SERVICE", "OTHER", "CLIENT"]),
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
  kind: z.enum(["VENDOR", "SERVICE", "OTHER", "CLIENT"]),
  note: SafeText.max(2000).nullable().optional(),
}).strict();
export type PartnerCreateInput = z.infer<typeof PartnerCreateInput>;

export const PartnerPatchInput = z.object({
  name: SafeText.min(1).max(200).optional(),
  kind: z.enum(["VENDOR", "SERVICE", "OTHER", "CLIENT"]).optional(),
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

/* ------------------------------------------------------------------ R7 tenderi */

export const TenderStatus = z.enum(["DRAFT", "SUBMITTED", "WON", "LOST", "WITHDRAWN"]);
export type TenderStatus = z.infer<typeof TenderStatus>;

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
}).strict();
export type TenderCreateInput = z.infer<typeof TenderCreateInput>;

export const TenderPatchInput = z.object({
  title: SafeText.min(1).max(300).optional(),
  partnerId: z.string().min(1).optional(),
  submittedValueAmount: z.string().regex(/^\d+\.\d{2}$/).optional(),
  currencyCode: z.string().length(3).optional(),
  status: TenderStatus.optional(),
  note: SafeText.max(4000).nullable().optional(),
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

export const ProjectCostEntryRow = z.object({
  id: z.string(),
  project_id: z.string(),
  project_code: z.string(),
  project_name: z.string(),
  source_type: z.literal("MACHINE_WORK_LOG"),
  source_id: z.string(),
  machine_id: z.string(),
  machine_code: z.string(),
  machine_name: z.string(),
  hours: z.string(),
  rate: z.string(),
  amount: z.string(),
  currency_code: z.string(),
  booked_at: z.string(),
  note: z.string().nullable(),
});
export type ProjectCostEntryRow = z.infer<typeof ProjectCostEntryRow>;

export const ProjectCostEntriesResponse = z.object({
  entries: z.array(ProjectCostEntryRow),
});
export type ProjectCostEntriesResponse = z.infer<typeof ProjectCostEntriesResponse>;

export const ProjectCostBookInput = z.object({
  from: SafeText.min(10).max(40).optional(),
  to: SafeText.min(10).max(40).optional(),
  workLogIds: z.array(SafeText.min(1).max(128)).max(500).optional(),
  note: SafeText.max(2000).nullable().optional(),
}).strict();
export type ProjectCostBookInput = z.infer<typeof ProjectCostBookInput>;

export const ProjectCostBookOutcome = z.object({
  outcome: z.enum(["OK", "VALIDATION_FAILED", "FORBIDDEN", "CONFLICT"]),
  booked: z.number().int().nonnegative().optional(),
  skippedExisting: z.number().int().nonnegative().optional(),
  skippedNoRate: z.number().int().nonnegative().optional(),
  code: z.string().optional(),
  message: z.string().optional(),
});
export type ProjectCostBookOutcome = z.infer<typeof ProjectCostBookOutcome>;

/* ============================================================ R6.2 — obračun sati CSV */

export const HoursExportQuery = z.object({
  from: BusinessDate,
  to: BusinessDate,
});
export type HoursExportQuery = z.infer<typeof HoursExportQuery>;

/** Odgovor je text/csv (raw), ne JSON envelope. */
export const HoursExportCsv = z.string();
export type HoursExportCsv = z.infer<typeof HoursExportCsv>;
