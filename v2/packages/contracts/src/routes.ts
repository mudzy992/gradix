/**
 * Registar ruta — jedini spisak onoga što klijent smije zvati.
 *
 * Namjerno NE čita `app/api`: Next rute se ne mogu uvesti kao podaci bez `next/server`
 * konteksta, a i ne treba — ovdje je ugovor. `src/contract.test.ts` provjerava da svaka
 * `route.ts` u aplikaciji ima svoj ulaz i da nema ulaza bez rute (obje strane).
 */
import { z } from "zod";
import {
  ActivePatch,
  CategoriesResponse,
  CategoryInput,
  ImportPreview,
  ImportResult,
  MachineInput,
  MachineResponse,
  MachinesResponse,
  MeterPatch,
  WorkerActivePatch,
  WorkerInput,
  WorkerLinkPatch,
  WorkerResponse,
  WorkersResponse,
  ApplyPasswordResetRequest,
  AuditResponse,
  ChangePasswordRequest,
  ChangePasswordResponse,
  EquipmentCategory,
  InvitationPreview,
  InviteRequest,
  InviteResponse,
  LoginRequest,
  LoginResponse,
  LoggedOutResponse,
  MeResponse,
  MembershipChange,
  MembershipPatch,
  OkResponse,
  RefreshRequest,
  RefreshResponse,
  ResetPasswordResponse,
  RolesResponse,
  SetActiveResponse,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
  UsersResponse,
  AcceptInvitationRequest,
} from "./schemas";

export type RouteSpec = {
  method: "GET" | "POST" | "PATCH";
  path: string;
  summary: string;
  /** `false` = ruta ne traži sesiju (prijava, linkovi, zdravlje). */
  auth: boolean;
  /** Dozvola koju ruta provjerava (`guard(request, …)`), ako je ima. */
  permission: string | null;
  request: z.ZodType | null;
  response: z.ZodType;
  /** Za rute koje ne primaju JSON (uvoz): `multipart/form-data` umjesto `application/json`. */
  contentType?: "application/json" | "multipart/form-data";
  /** Query parametri koje ruta čita (za OpenAPI; klijent ih dobija kroz `query` opciju). */
  query?: z.ZodObject;
  /** Neke rute vraćaju `meta` u envelope-u (sync pull, sync push). */
  meta?: z.ZodType;
  /** Ravan JSON bez envelope-a — čita orchestrator, ne klijent. */
  raw?: boolean;
};

// Bez anotacije `: readonly RouteSpec[]` — onا bi proširila tip i izbrisala doslovne
// putanje, pa bi `RouteResponse<"GET", "/api/me">` postao `never`.
export const ROUTES = [
  {
    method: "GET",
    path: "/api/health",
    summary: "Liveness; ne dira bazu.",
    auth: false,
    permission: null,
    request: null,
    response: z.object({ status: z.literal("ok"), uptimeSeconds: z.number() }),
    raw: true,
  },
  {
    method: "GET",
    path: "/api/ready",
    summary: "Readiness: baza, migracije, RLS dijagnostika.",
    auth: false,
    permission: null,
    request: null,
    response: z.object({
      status: z.enum(["ok", "error"]),
      checks: z.object({
        postgres: z.record(z.string(), z.unknown()),
        migrations: z.object({ applied: z.number() }),
        databaseRole: z.record(z.string(), z.unknown()).nullable(),
      }),
    }),
    raw: true,
  },
  {
    method: "POST",
    path: "/api/auth/login",
    summary: "Email + lozinka → sesija. Rate limited po emailu.",
    auth: false,
    permission: null,
    request: LoginRequest,
    response: LoginResponse,
  },
  {
    method: "POST",
    path: "/api/auth/refresh",
    summary: "Rotacija refresh tokena.",
    auth: false,
    permission: null,
    request: RefreshRequest,
    response: RefreshResponse,
  },
  {
    method: "POST",
    path: "/api/auth/logout",
    summary: "Opoziva tekuću sesiju.",
    auth: true,
    permission: null,
    request: null,
    response: LoggedOutResponse,
  },
  {
    method: "POST",
    path: "/api/auth/logout-all",
    summary: "Opoziva sve sesije osobe.",
    auth: true,
    permission: null,
    request: null,
    response: z.object({ revoked: z.number() }),
  },
  {
    method: "POST",
    path: "/api/auth/change-password",
    summary: "Promjena vlastite lozinke; opoziva ostale sesije.",
    auth: true,
    permission: null,
    request: ChangePasswordRequest,
    response: ChangePasswordResponse,
  },
  {
    method: "GET",
    path: "/api/me",
    summary: "Identitet iz sesije, firma i broj mašina.",
    auth: true,
    permission: null,
    request: null,
    response: MeResponse,
  },
  {
    method: "GET",
    path: "/api/users",
    summary: "Osobe u firmi.",
    auth: true,
    permission: "users.manage",
    request: null,
    response: UsersResponse,
  },
  {
    method: "POST",
    path: "/api/users/invitations",
    summary: "Izdaje pozivnicu; link se vraća samo ovdje.",
    auth: true,
    permission: "users.manage",
    request: InviteRequest,
    response: InviteResponse,
  },
  {
    method: "POST",
    path: "/api/users/{id}/reset-password",
    summary: "Izdaje link za postavljanje lozinke.",
    auth: true,
    permission: "users.manage",
    request: null,
    response: ResetPasswordResponse,
  },
  {
    method: "PATCH",
    path: "/api/users/{id}/membership",
    summary: "Role i opseg osobe.",
    auth: true,
    permission: "users.manage",
    request: MembershipPatch,
    response: MembershipChange,
  },
  {
    method: "PATCH",
    path: "/api/users/{id}/active",
    summary: "Aktivacija/deaktivacija; deaktivacija opoziva sesije.",
    auth: true,
    permission: "users.manage",
    request: ActivePatch,
    response: SetActiveResponse,
  },
  {
    method: "GET",
    path: "/api/workers",
    summary: "Radnici firme (uključujući neaktivne, sa oznakom).",
    auth: true,
    permission: "workers.view",
    request: null,
    response: WorkersResponse,
  },
  {
    method: "POST",
    path: "/api/workers",
    summary: "Novi radnik — ne pravi nalog.",
    auth: true,
    permission: "workers.manage",
    request: WorkerInput,
    response: WorkerResponse,
  },
  {
    method: "PATCH",
    path: "/api/workers/{id}",
    summary: "Izmjena podataka radnika.",
    auth: true,
    permission: "workers.manage",
    request: WorkerInput,
    response: WorkerResponse,
  },
  {
    method: "PATCH",
    path: "/api/workers/{id}/active",
    summary: "Aktivacija ili deaktivacija radnika (bez brisanja).",
    auth: true,
    permission: "workers.manage",
    request: WorkerActivePatch,
    response: WorkerResponse,
  },
  {
    method: "PATCH",
    path: "/api/workers/{id}/link-user",
    summary: "Veza radnika sa nalogom; veza ne daje dozvole.",
    auth: true,
    permission: "users.manage",
    request: WorkerLinkPatch,
    response: WorkerResponse,
  },
  {
    method: "GET",
    path: "/api/equipment-categories",
    summary: "Kategorije mašina firme (podaci, ne enum).",
    auth: true,
    permission: "equipment.view",
    request: null,
    response: CategoriesResponse,
  },
  {
    method: "POST",
    path: "/api/equipment-categories",
    summary: "Nova kategorija mašina.",
    auth: true,
    permission: "equipment.manage",
    request: CategoryInput,
    response: z.object({ category: EquipmentCategory }),
  },
  {
    method: "GET",
    path: "/api/equipment",
    summary: "Mašine i vozila — jedna tabela.",
    auth: true,
    permission: "equipment.view",
    request: null,
    response: MachinesResponse,
  },
  {
    method: "POST",
    path: "/api/equipment",
    summary: "Nova mašina ili vozilo.",
    auth: true,
    permission: "equipment.manage",
    request: MachineInput,
    response: MachineResponse,
  },
  {
    method: "PATCH",
    path: "/api/equipment/{id}",
    summary: "Izmjena mašine; vrsta brojila samo dok brojilo nema vrijednost.",
    auth: true,
    permission: "equipment.manage",
    request: MachineInput,
    response: MachineResponse,
  },
  {
    method: "PATCH",
    path: "/api/equipment/{id}/meter",
    summary:
      "Trenutna vrijednost brojila; manja vrijednost traži izričitu ispravku.",
    auth: true,
    permission: "equipment.view",
    request: MeterPatch,
    response: MachineResponse,
  },
  {
    method: "POST",
    path: "/api/imports/preview",
    summary: "Uvoz: fajl → pregled redova. Ne piše ništa u bazu.",
    auth: true,
    permission: "workers.manage",
    request: null,
    response: ImportPreview,
    /** Multipart: fajl (5 MB) + `kind` + opciono `mapping`. */
    contentType: "multipart/form-data",
  },
  {
    method: "POST",
    path: "/api/imports/apply",
    summary:
      "Uvoz: potvrda odluka po redu, u jednoj transakciji (sve ili ništa).",
    auth: true,
    permission: "workers.manage",
    request: null,
    response: ImportResult,
    contentType: "multipart/form-data",
  },
  {
    method: "GET",
    path: "/api/roles",
    summary: "Matrica rola (pregled, nije uređivanje).",
    auth: true,
    permission: "roles.view",
    request: null,
    response: RolesResponse,
  },
  {
    method: "GET",
    path: "/api/audit",
    summary: "Trag radnji; keyset paginacija.",
    auth: true,
    permission: "audit.view",
    request: null,
    response: AuditResponse,
  },
  {
    method: "GET",
    path: "/api/invitations/{token}",
    summary: "Pregled pozivnice prije prihvatanja.",
    auth: false,
    permission: null,
    request: null,
    response: InvitationPreview,
  },
  {
    method: "POST",
    path: "/api/invitations/{token}",
    summary: "Prihvatanje pozivnice: nalog + prva lozinka.",
    auth: false,
    permission: null,
    request: AcceptInvitationRequest,
    response: OkResponse,
  },
  {
    method: "POST",
    path: "/api/password-resets/{token}",
    summary: "Postavljanje lozinke preko linka.",
    auth: false,
    permission: null,
    request: ApplyPasswordResetRequest,
    response: OkResponse,
  },
  {
    method: "GET",
    path: "/api/sync/pull",
    summary: "Promjene od `since`; keyset preko `server_at`.",
    auth: true,
    // Sync ne provjerava dozvolu, samo sesiju (offline radnik nema `users.manage`).
    permission: null,
    request: null,
    response: SyncPullResponse,
    query: z.object({ since: z.string().optional() }),
    meta: z.object({
      lastSyncTimestamp: z.string(),
      serverTime: z.string(),
      limit: z.number(),
    }),
  },
  {
    method: "POST",
    path: "/api/sync/push",
    summary: "Idempotentan upis offline izmjena.",
    auth: true,
    permission: null,
    request: SyncPushRequest,
    response: SyncPushResponse,
    meta: z.object({ accepted: z.number() }),
  },
] as const;

/** Putanja sa popunjenim parametrima, npr. `/api/users/{id}/active` + `{id: "u1"}`. */
export function buildPath(
  path: string,
  params: Record<string, string> = {},
): string {
  return path.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = params[key];
    if (value === undefined)
      throw new Error(`Nedostaje parametar putanje: ${key}`);
    return encodeURIComponent(value);
  });
}
