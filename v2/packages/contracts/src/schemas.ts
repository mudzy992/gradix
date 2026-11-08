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

export const Role = z.enum([
  "OWNER",
  "ADMIN",
  "SITE_MANAGER",
  "WORKER",
  "VIEWER",
]);
export type Role = z.infer<typeof Role>;

export const Scope = z.enum(["COMPANY", "PROJECTS"]);
export type Scope = z.infer<typeof Scope>;

export const IsoDate = z.string().describe("ISO 8601, UTC");
export const Uuid = z.string().min(1);

export const Meta = z.record(z.string(), z.unknown());

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
      name: z.string(),
      slug: z.string(),
      currency: z.string(),
      timezone: z.string(),
    })
    .nullable(),
  machineCount: z.number(),
});
export type MeResponse = z.infer<typeof MeResponse>;

export const LoginRequest = z.object({
  email: z.string().min(3).max(200),
  password: z.string().min(1).max(200),
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

export const RefreshRequest = z.object({ refreshToken: z.string().optional() });
export const RefreshResponse = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});
export type RefreshResponse = z.infer<typeof RefreshResponse>;

export const OkResponse = z.object({ ok: z.literal(true) });
export const LoggedOutResponse = z.object({ loggedOut: z.literal(true) });

export const ChangePasswordRequest = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(10).max(200),
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
  email: z.string().min(3).max(200),
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
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  password: z.string().min(10).max(200),
});
export type AcceptInvitationRequest = z.infer<typeof AcceptInvitationRequest>;

export const ApplyPasswordResetRequest = z.object({
  password: z.string().min(10).max(200),
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
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  phone: z.string().max(40).nullable().optional(),
  email: z.string().max(200).nullable().optional(),
  jobTitle: z.string().max(120).nullable().optional(),
  engagement: Engagement.optional(),
  hiredAt: z.string(),
  endedAt: z.string().nullable().optional(),
  team: z.string().max(120).nullable().optional(),
  supervisorId: z.string().nullable().optional(),
});
export type WorkerInput = z.infer<typeof WorkerInput>;

export const WorkersResponse = z.object({ workers: z.array(Worker) });
export type WorkersResponse = z.infer<typeof WorkersResponse>;
export const WorkerResponse = z.object({ worker: Worker });
export type WorkerResponse = z.infer<typeof WorkerResponse>;

export const WorkerActivePatch = z.object({ active: z.boolean() });
export const WorkerLinkPatch = z.object({ userId: z.string().nullable() });

export const EquipmentCategory = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  meter: Meter,
  isActive: z.boolean(),
  sortOrder: z.number(),
  machineCount: z.number(),
});
export type EquipmentCategory = z.infer<typeof EquipmentCategory>;

export const CategoryInput = z.object({
  code: z.string().min(2).max(40),
  name: z.string().min(1).max(80),
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
  code: z.string().min(2).max(20),
  name: z.string().min(1).max(120),
  categoryId: z.string(),
  make: z.string().max(80).nullable().optional(),
  model: z.string().max(80).nullable().optional(),
  serialNo: z.string().max(80).nullable().optional(),
  plate: z.string().max(20).nullable().optional(),
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

export const ImportKind = z.enum(["workers", "equipment"]);
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

/* ------------------------------------------------------------------ sync */

/** Vrijednosti moraju biti iste kao `SYNC_ENTITY_TYPES` u `@gradix/domain`. */
export const SyncEntityType = z.enum(["note"]);
export type SyncEntityType = z.infer<typeof SyncEntityType>;

export const SyncPushItem = z.object({
  localId: z.string(),
  entityType: SyncEntityType,
  payload: z.record(z.string(), z.unknown()),
  clientAt: IsoDate,
});
export type SyncPushItem = z.infer<typeof SyncPushItem>;

export const SyncPushRequest = z.object({
  deviceId: z.string().min(1).max(100),
  items: z.array(SyncPushItem),
});
export type SyncPushRequest = z.infer<typeof SyncPushRequest>;

export const SyncPushResponse = z.object({
  results: z.array(
    z.object({
      localId: z.string(),
      serverId: z.string(),
      duplicate: z.boolean(),
    }),
  ),
});
export type SyncPushResponse = z.infer<typeof SyncPushResponse>;

export const SyncPullItem = z.object({
  serverId: z.string(),
  localId: z.string(),
  entityType: z.string(),
  payload: z.record(z.string(), z.unknown()),
  clientAt: IsoDate,
});
export type SyncPullItem = z.infer<typeof SyncPullItem>;

export const SyncPullResponse = z.object({ items: z.array(SyncPullItem) });
export type SyncPullResponse = z.infer<typeof SyncPullResponse>;

/** Promjena rola i opsega — vraća stanje prije i poslije (UI prikazuje razliku). */
export const MembershipChange = z.object({
  userId: z.string(),
  email: z.string(),
  before: z.object({ roles: z.array(z.string()), scope: z.string() }),
  after: z.object({ roles: z.array(z.string()), scope: z.string() }),
});
export type MembershipChange = z.infer<typeof MembershipChange>;
