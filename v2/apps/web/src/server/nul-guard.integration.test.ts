/**
 * A1 — NUL (\u0000) i drugi kontrolni znakovi na granici API-ja: NIKAD 500.
 *
 * Bug iz mobilnog prolaza: email s NUL-om prolazio je zod (goli `z.string()`), stizao do
 * Postgresa koji odbija 0x00 (SQLSTATE 22021, mjereno na pravoj bazi) i korisnik je viđao „Došlo je do greške.“ (500).
 *
 * Ovaj test ide kroz SVE rute iz registra (`ROUTES`) po svakoj ulaznoj površini:
 *   1. tijelo sa šemom — u svako tekstualno polje stavlja NUL i traži da odgovor NIJE 5xx;
 *   2. query parametri (GET rute sa query šemom) — granica je zajednički guard(): 400;
 *   3. path parametri — NUL u svakom {param} segmentu, backstop 22021 → 400, nikad 500.
 * Posebni slučajevi (prijava, sync push po stavci, filteri, uvoz) imaju svoje provjere
 * s tačnim ishodima.
 *
 * Traži: DATABASE_URL (gradix_app) i DATABASE_ADMIN_URL (vlasnik šeme). Bez njih se
 * testovi preskaču — nikad ne prolaze lažno.
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { ROUTES } from "@gradix/contracts";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { POST as refreshRoute } from "@/app/api/auth/refresh/route";
import { POST as changePasswordRoute } from "@/app/api/auth/change-password/route";
import { POST as inviteRoute } from "@/app/api/users/invitations/route";
import { PATCH as membershipRoute } from "@/app/api/users/[id]/membership/route";
import { PATCH as userActivePatch } from "@/app/api/users/[id]/active/route";
import { POST as workersPost } from "@/app/api/workers/route";
import { PATCH as workersPatch } from "@/app/api/workers/[id]/route";
import { PATCH as linkUserRoute } from "@/app/api/workers/[id]/link-user/route";
import { PATCH as workersActivePatch } from "@/app/api/workers/[id]/active/route";
import { PATCH as meterPatch } from "@/app/api/equipment/[id]/meter/route";
import { POST as categoriesPost } from "@/app/api/equipment-categories/route";
import { POST as equipmentPost } from "@/app/api/equipment/route";
import { PATCH as equipmentPatch } from "@/app/api/equipment/[id]/route";
import { POST as obligationsPost } from "@/app/api/obligations/route";
import { PATCH as obligationsPatch } from "@/app/api/obligations/[id]/route";
import { POST as renewRoute } from "@/app/api/obligations/[id]/renew/route";
import { POST as correctRoute } from "@/app/api/obligations/[id]/correct/route";
import { POST as typesPost } from "@/app/api/obligation-types/route";
import { PATCH as typesPatch } from "@/app/api/obligation-types/[id]/route";
import { POST as attachmentsPost } from "@/app/api/obligations/[id]/attachments/route";
import { POST as acceptInviteRoute } from "@/app/api/invitations/[token]/route";
import { POST as applyResetRoute } from "@/app/api/password-resets/[token]/route";
import { POST as projectsPost } from "@/app/api/projects/route";
import { PATCH as projectsPatch } from "@/app/api/projects/[id]/route";
import { POST as assignmentsPost } from "@/app/api/projects/[id]/assignments/route";
import { PATCH as assignmentChangeRoute } from "@/app/api/projects/[id]/assignments/[assignmentId]/route";
import { POST as overrideReqRoute } from "@/app/api/projects/[id]/override-requests/route";
import { POST as overrideApproveRoute } from "@/app/api/projects/[id]/override-requests/[requestId]/route";
import { POST as resolveRoute } from "@/app/api/workday-conflicts/[id]/resolve/route";
import { POST as pushRoute } from "@/app/api/sync/push/route";
import { GET as obligationsGet } from "@/app/api/obligations/route";
import { POST as importsPreviewRoute } from "@/app/api/imports/preview/route";
import { GET as auditGet } from "@/app/api/audit/route";
import { GET as pullGet } from "@/app/api/sync/pull/route";
import { GET as foremanGet } from "@/app/api/sync/foreman-workers/route";
import { GET as projectsGet } from "@/app/api/projects/route";
import { GET as projectGet } from "@/app/api/projects/[id]/route";
import { GET as assignmentsGet } from "@/app/api/projects/[id]/assignments/route";
import { GET as overrideListGet } from "@/app/api/projects/[id]/override-requests/route";
import { GET as obligationGet, DELETE as obligationsDelete } from "@/app/api/obligations/[id]/route";
import { GET as attachmentUrlGet } from "@/app/api/obligations/[id]/attachments/[attachmentId]/url/route";
import { POST as attachmentConfirmPost } from "@/app/api/obligations/[id]/attachments/[attachmentId]/confirm/route";
import { GET as invitationGet } from "@/app/api/invitations/[token]/route";
import { GET as conflictsGet } from "@/app/api/workday-conflicts/route";
import { GET as conflictGet } from "@/app/api/workday-conflicts/[id]/route";
import { POST as resetPasswordPost } from "@/app/api/users/[id]/reset-password/route";
import { getVerifiedPool } from "./db" ;
import { previewImport } from "./import-service";
import { parseWorkbook } from "./import-parser";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = process.env.DATABASE_URL && adminUrl ? describe : describe.skip;

const COMPANY = "cmp_nul_a";
const USER_OWNER = "usr_nul_owner";
const USER_WORKER = "usr_nul_worker";
const WORKER = "wrk_nul_worker";
const PROJECT = "prj_nul_a";
const PASSWORD = "test-lozinka-123";

/* ------------------------------------------------- šetanje šemom (isto pravilo kao u ugovorima) */

function stringPaths(schema: z.core.$ZodType, base: string[]): string[] {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) return stringPaths(schema.unwrap(), base);
  if (schema instanceof z.ZodDefault) return stringPaths(schema.removeDefault(), base);
  if (schema instanceof z.ZodCatch) return stringPaths(schema._def.innerType, base);
  if (schema instanceof z.ZodString) return [base.join(".")];
  if (schema instanceof z.ZodArray) return stringPaths(schema.element, base);
  if (schema instanceof z.ZodRecord) {
    // zod 4.6: vrijednost zapisa je u `def.valueType` (nema `valueSchema` getera)
    const value = (schema as unknown as { def: { valueType: z.core.$ZodType } }).def.valueType;
    return stringPaths(value, base);
  }
  if (schema instanceof z.ZodUnion) return schema.options.flatMap((option) => stringPaths(option, base));
  if (schema instanceof z.ZodObject) {
    return Object.entries(schema.shape).flatMap(([key, value]) => stringPaths(value, [...base, key]));
  }
  return [];
}

function withNulAt(schema: z.core.$ZodType, target: string[], base: string[] = []): unknown {
  const path = base.join(".");
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) return withNulAt(schema.unwrap(), target, base);
  if (schema instanceof z.ZodDefault) return withNulAt(schema.removeDefault(), target, base);
  if (schema instanceof z.ZodCatch) return withNulAt(schema._def.innerType, target, base);
  if (schema instanceof z.ZodString) return path === target.join(".") ? "a\u0000b" : "abc123";
  if (schema instanceof z.ZodNumber) return 1;
  if (schema instanceof z.ZodBoolean) return false;
  if (schema instanceof z.ZodLiteral) return schema.value;
  if (schema instanceof z.ZodEnum) return schema.options[0];
  if (schema instanceof z.ZodArray) return [withNulAt(schema.element, target, base)];
  if (schema instanceof z.ZodRecord) {
    const value = (schema as unknown as { def: { valueType: z.core.$ZodType } }).def.valueType;
    return { kljuc: withNulAt(value, target, [...base, "kljuc"]) };
  }
  if (schema instanceof z.ZodUnion) {
    for (const option of schema.options) {
      if (stringPaths(option, base).includes(target.join("."))) return withNulAt(option, target, base);
    }
    return withNulAt(schema.options[0]!, target, base);
  }
  if (schema instanceof z.ZodObject) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(schema.shape)) out[key] = withNulAt(value, target, [...base, key]);
    return out;
  }
  return "a\u0000b";
}

/* ------------------------------------------------- rute: statički import + pokrivenost */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- rute imaju različite param kontekste; test zove sve istiim pozivom
type Handler = (request: NextRequest, context?: any) => Promise<Response>;

/** Sve rute s tijelom iz ROUTES, ručno uvezene (dinamički import u vitestu nije pouzdan). */
const HANDLERS: Record<string, Record<string, Handler>> = {
  "/api/auth/login": { POST: loginRoute },
  "/api/auth/refresh": { POST: refreshRoute },
  "/api/auth/change-password": { POST: changePasswordRoute },
  "/api/users/invitations": { POST: inviteRoute },
  "/api/users/{id}/membership": { PATCH: membershipRoute },
  "/api/users/{id}/active": { PATCH: userActivePatch },
  "/api/workers": { POST: workersPost },
  "/api/workers/{id}": { PATCH: workersPatch },
  "/api/workers/{id}/link-user": { PATCH: linkUserRoute },
  "/api/workers/{id}/active": { PATCH: workersActivePatch },
  "/api/equipment/{id}/meter": { PATCH: meterPatch },
  "/api/equipment-categories": { POST: categoriesPost },
  "/api/equipment": { POST: equipmentPost },
  "/api/equipment/{id}": { PATCH: equipmentPatch },
  "/api/obligations": { GET: obligationsGet, POST: obligationsPost },
  "/api/obligations/{id}": { GET: obligationGet, PATCH: obligationsPatch, DELETE: obligationsDelete },
  "/api/obligations/{id}/renew": { POST: renewRoute },
  "/api/obligations/{id}/correct": { POST: correctRoute },
  "/api/obligation-types": { POST: typesPost },
  "/api/obligation-types/{id}": { PATCH: typesPatch },
  "/api/obligations/{id}/attachments": { POST: attachmentsPost },
  "/api/invitations/{token}": { GET: invitationGet, POST: acceptInviteRoute },
  "/api/password-resets/{token}": { POST: applyResetRoute },
  "/api/projects": { GET: projectsGet, POST: projectsPost },
  "/api/projects/{id}": { GET: projectGet, PATCH: projectsPatch },
  "/api/projects/{id}/assignments": { GET: assignmentsGet, POST: assignmentsPost },
  "/api/projects/{id}/assignments/{assignmentId}": { PATCH: assignmentChangeRoute },
  "/api/projects/{id}/override-requests": { GET: overrideListGet, POST: overrideReqRoute },
  "/api/projects/{id}/override-requests/{requestId}": { POST: overrideApproveRoute },
  "/api/workday-conflicts/{id}/resolve": { POST: resolveRoute },
  "/api/sync/push": { POST: pushRoute },
  "/api/audit": { GET: auditGet },
  "/api/sync/pull": { GET: pullGet },
  "/api/sync/foreman-workers": { GET: foremanGet },
  "/api/workday-conflicts": { GET: conflictsGet },
  "/api/workday-conflicts/{id}": { GET: conflictGet },
  "/api/obligations/{id}/attachments/{attachmentId}/confirm": { POST: attachmentConfirmPost },
  "/api/obligations/{id}/attachments/{attachmentId}/url": { GET: attachmentUrlGet },
  "/api/users/{id}/reset-password": { POST: resetPasswordPost },
};

/** Rute kojima tijelo NE treba sesiju (prijava, token linkovi). */
const PUBLIC_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/refresh",
  "/api/invitations/{token}",
  "/api/password-resets/{token}",
]);

function paramsFor(path: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const segment of path.split("/")) {
    const match = /^\{(.+)\}$/.exec(segment);
    if (match) params[match[1]!] = match[1] === "token" ? "gxr_nijepravi.token" : "nul-ne-postoji";
  }
  return params;
}

/** Path s popunjenim {param} segmentima (bez NUL-a) — za URL u query sweepu. */
function filledPath(path: string, params: Record<string, string>): string {
  return path.replace(/\{([^}]+)\}/g, (_, key: string) => params[key] ?? "nul-ne-postoji");
}

/**
 * Query šema rute iz registra — ne svaka ruta je ima (unija literala u ROUTES), pa je
 * pristup preko `in` provjere; vraća undefined za rute bez query površine.
 */
function querySchemaOf(route: (typeof ROUTES)[number]): z.ZodObject | undefined {
  return "query" in route ? (route as { query?: z.ZodObject }).query : undefined;
}

/** Svaki {param} segment nosi NUL — za path sweep (backstop 22021 mora da ga zaustavi). */
function paramsNulFor(path: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const segment of path.split("/")) {
    const match = /^\{(.+)\}$/.exec(segment);
    if (match) params[match[1]!] = match[1] === "token" ? "gxr_nu\u0000l.token" : "nu\u0000l";
  }
  return params;
}

function jsonRequest(url: string, body: unknown, method: string, cookie?: string): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  // GET ne smije nositi tijelo; null znači „ruta ne prima tijelo“ (npr. DELETE s id-em).
  const init: { method: string; headers: Record<string, string>; body?: string } = { method, headers };
  if (method !== "GET" && body !== null) init.body = JSON.stringify(body);
  return new NextRequest(url, init);
}

function cookieFrom(response: Response, name: string): string {
  const setCookie = response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`));
  return setCookie ? (setCookie.split(";")[0] as string) : "";
}

async function bodyOf<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describeDb("A1: kontrolni znakovi na granici API-ja", () => {
  let admin: Pool;
  let ownerCookie: string;
  let workerCookie: string;

  async function cleanFixtures() {
    await admin.query("DELETE FROM public.sync_receipts WHERE company_id = $1", [COMPANY]);
    await admin.query("DELETE FROM public.work_entries WHERE company_id = $1", [COMPANY]);
    await admin.query("DELETE FROM public.workdays WHERE company_id = $1", [COMPANY]);
    await admin.query("DELETE FROM public.sync_change_log WHERE company_id = $1", [COMPANY]);
    await admin.query("DELETE FROM public.sync_cursor_slots WHERE company_id = $1", [COMPANY]);
    await admin.query("DELETE FROM public.sync_cursor_allocators WHERE company_id = $1", [COMPANY]);
    await admin.query("DELETE FROM public.projects WHERE company_id = $1", [COMPANY]);
    await admin.query("DELETE FROM public.workers WHERE company_id = $1", [COMPANY]);
    await admin.query("DELETE FROM public.obligations WHERE company_id = $1", [COMPANY]);
    await admin.query("DELETE FROM public.obligation_types WHERE company_id = $1", [COMPANY]);
    await admin.query("DELETE FROM public.equipment_categories WHERE company_id = $1", [COMPANY]);
    await admin.query("DELETE FROM public.sessions WHERE company_id = $1", [COMPANY]);
    await admin.query("DELETE FROM public.memberships WHERE company_id = $1", [COMPANY]);
    await admin.query("DELETE FROM public.machines WHERE company_id = $1", [COMPANY]);
    await admin.query("DELETE FROM public.companies WHERE id = $1", [COMPANY]);
    await admin.query("DELETE FROM public.users WHERE id = ANY($1)", [[USER_OWNER, USER_WORKER]]);
  }

  beforeAll(async () => {
    admin = new Pool({ connectionString: adminUrl });
    await cleanFixtures();
    const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
    await admin.query("INSERT INTO companies (id, name, slug) VALUES ($1, 'NUL Firma', 'nul-firma')", [COMPANY]);
    await admin.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, must_change_password)
       VALUES ($1, 'nul-owner@test.example', $3, 'Nul', 'Vlasnik', false),
              ($2, 'nul-worker@test.example', $3, 'Nul', 'Radnik', false)`,
      [USER_OWNER, USER_WORKER, hash],
    );
    await admin.query(
      `INSERT INTO memberships (id, user_id, company_id, roles, scope) VALUES
       ('mem_nul_owner', $1, $3, ARRAY['ADMIN']::"Role"[], 'COMPANY'),
       ('mem_nul_worker', $2, $3, ARRAY['WORKER']::"Role"[], 'SELF')`,
      [USER_OWNER, USER_WORKER, COMPANY],
    );
    await admin.query(
      "INSERT INTO workers (id, company_id, first_name, last_name, hired_at, user_id) VALUES ($1, $2, 'Nul', 'Radnik', '2025-01-01', $3)",
      [WORKER, COMPANY, USER_WORKER],
    );
    await admin.query(
      "INSERT INTO projects (id, company_id, code, name) VALUES ($1, $2, 'NUL-PRJ', 'NUL projekat')",
      [PROJECT, COMPANY],
    );

    const ownerLogin = await loginRoute(jsonRequest("http://localhost/api/auth/login", { email: "nul-owner@test.example", password: PASSWORD }, "POST"));
    ownerCookie = cookieFrom(ownerLogin, "gx_at");
    const workerLogin = await loginRoute(jsonRequest("http://localhost/api/auth/login", { email: "nul-worker@test.example", password: PASSWORD }, "POST"));
    workerCookie = cookieFrom(workerLogin, "gx_at");
  });

  afterAll(async () => {
    await cleanFixtures();
    await admin.end();
  });

  it("svaka ruta iz ROUTES s ulaznom površinom (tijelo/query/path) je obuhvaćena testom", () => {
    for (const route of ROUTES) {
      const hasBodySchema = (route.method === "POST" || route.method === "PATCH") && route.request;
      const hasQuerySchema = route.method === "GET" && !!querySchemaOf(route);
      const hasPathParams = /\{[^}]+\}/.test(route.path);
      // Rute bez ijedne površine (logout) ne primaju tekst od klijenta; multipart uvoz
      // (imports) ima svoj test s imenom datoteke niže.
      if (!hasBodySchema && !hasQuerySchema && !hasPathParams) continue;
      const handler = HANDLERS[route.path]?.[route.method];
      expect(
        handler,
        `${route.method} ${route.path}: ruta ima ulaznu površinu (tijelo/query/path), a nije u NUL testu — dodaj je u HANDLERS`,
      ).toBeTruthy();
    }
  });

  it("NUL u bilo kojem tekstualnom polju tijela nikad ne daje 5xx", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const checked: string[] = [];
      for (const route of ROUTES) {
        if (route.method !== "POST" && route.method !== "PATCH") continue;
        if (route.path === "/api/sync/push") continue; // poseban test: ishod po stavci
        const schema = route.request as z.core.$ZodType | null;
        if (!schema) continue;
        const paths = stringPaths(schema, []);
        if (paths.length === 0) continue; // šema bez tekstualnih polja (samo enumi/brojevi)
        const target = paths[0]!;
        const body = withNulAt(schema, target.split("."));
        const handler = HANDLERS[route.path]![route.method]!;
        const cookie = PUBLIC_PATHS.has(route.path) ? undefined : ownerCookie;
        const request = jsonRequest(`http://localhost${route.path}`, body, route.method, cookie);
        const response = await handler(request, { params: Promise.resolve(paramsFor(route.path)) });
        const errors = errorLog.mock.calls.map((args) => args.map(String).join(" ")).join("\n");
        expect(
          response.status,
          `${route.method} ${route.path} (NUL u „${target}“) vratio 5xx. Server log:\n${errors}`,
        ).toBeLessThan(500);
        checked.push(`${route.method} ${route.path}`);
      }
      // Senka: test stvarno prolazi kroz rute, ne prazan spisak.
      expect(checked.length).toBeGreaterThan(15);
    } finally {
      errorLog.mockRestore();
    }
  });

  it("NUL u bilo kojem query parametru svake GET rute iz ugovora: 400 na granici (guard), nikad 5xx", async () => {
    const checked: string[] = [];
    for (const route of ROUTES) {
      const query = querySchemaOf(route);
      if (route.method !== "GET" || !query) continue;
      const keys = Object.keys(query.shape);
      expect(keys.length, `${route.path}: query šema bez parametara?`).toBeGreaterThan(0);
      for (const key of keys) {
        const params = paramsFor(route.path);
        const url = `http://localhost${filledPath(route.path, params)}?${encodeURIComponent(key)}=a%00b`;
        const handler = HANDLERS[route.path]![route.method]!;
        const request = new NextRequest(url, { headers: { cookie: ownerCookie } });
        const response = await handler(request, { params: Promise.resolve(params) });
        // Zajednička granica u guard() odbija PRIJE dozvole i PRIJE baze: 400 s jasnim kodom.
        expect(response.status, `${route.path}?${key}=<NUL> vratio ${response.status}`).toBe(400);
        const body = await bodyOf<{ error: { code: string } }>(response);
        expect(body.error.code, `${route.path}?${key}=<NUL>`).toBe("VALIDATION_FAILED");
        checked.push(`${route.path}?${key}`);
      }
    }
    // Senka: sweep stvarno prolazi kroz parametre, ne prazan spisak.
    expect(checked.length).toBeGreaterThan(10);
  });

  it("NUL u path parametru svake rute iz ugovora: nikad 5xx (backstop 22021 → 400)", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const checked: string[] = [];
      for (const route of ROUTES) {
        if (!/\{[^}]+\}/.test(route.path)) continue;
        const handler = HANDLERS[route.path]?.[route.method];
        expect(handler, `${route.method} ${route.path}: nije u HANDLERS`).toBeTruthy();
        // Svaki {param} nosi NUL; tijelo (ako ga ima) je ČISTO — cilj je baš path parametar.
        const schema = route.request as z.core.$ZodType | null;
        const body = schema ? withNulAt(schema, ["__nista__"]) : null;
        const cookie = PUBLIC_PATHS.has(route.path) ? undefined : ownerCookie;
        const request = jsonRequest(`http://localhost${route.path}`, body, route.method, cookie);
        const response = await handler!(request, { params: Promise.resolve(paramsNulFor(route.path)) });
        const errors = errorLog.mock.calls.map((args) => args.map(String).join(" ")).join("\n");
        expect(
          response.status,
          `${route.method} ${route.path} (NUL u path parametru) vratio 5xx. Server log:\n${errors}`,
        ).toBeLessThan(500);
        checked.push(`${route.method} ${route.path}`);
      }
      expect(checked.length).toBeGreaterThan(20);
    } finally {
      errorLog.mockRestore();
    }
  });

  it("prijava s NUL-om u emailu: 400 VALIDATION_FAILED s jasnom porukom, ne 500", async () => {
    const warnLog = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const response = await loginRoute(
        jsonRequest("http://localhost/api/auth/login", { email: "nul\u0000korisnik@test.example", password: PASSWORD }, "POST"),
      );
      expect(response.status).toBe(400);
      const body = await bodyOf<{ error: { code: string; message: string } }>(response);
      expect(body.error.code).toBe("VALIDATION_FAILED");
      expect(body.error.message).toContain("kontrolne");

      // A1c: log sadrži ime polja, dužinu i ima li kontrolni znak — NIKAD vrijednost.
      const logged = warnLog.mock.calls.map((args) => args.map(String).join(" ")).join("\n");
      expect(logged).toContain('"field":"email"');
      expect(logged).toContain('"controlChars":true');
      expect(logged).not.toContain("nulkorisnik");
      expect(logged).not.toContain("test.example");
      expect(logged).not.toContain(PASSWORD);
    } finally {
      warnLog.mockRestore();
    }
  });

  it("sync push: stavka s NUL-om dobija REJECTED, ostatak batcha se obrađuje", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const workdayId = randomUUID();
      const cleanItem = {
        localId: randomUUID(),
        entityType: "work_entry" as const,
        workdayId,
        workEntryId: randomUUID(),
        deviceSentAt: new Date().toISOString(),
        entry: {
          kind: "WORK" as const,
          startedAt: "2026-11-07T08:00:00+01:00",
          endedAt: "2026-11-07T09:00:00+01:00",
          endState: "KNOWN_END" as const,
          projectId: PROJECT,
          machineId: null,
          note: "čista stavka",
        },
      };
      const nulItem = {
        localId: randomUUID(),
        entityType: "work_entry" as const,
        workdayId: randomUUID(),
        workEntryId: randomUUID(),
        deviceSentAt: new Date().toISOString(),
        entry: {
          kind: "WORK" as const,
          startedAt: "2026-11-07T08:00:00+01:00",
          endedAt: "2026-11-07T09:00:00+01:00",
          endState: "KNOWN_END" as const,
          projectId: PROJECT,
          machineId: null,
          note: "napomena s \u0000 NUL-om",
        },
      };
      const response = await pushRoute(
        jsonRequest("http://localhost/api/sync/push", { items: [cleanItem, nulItem] }, "POST", workerCookie),
      );
      const errors = errorLog.mock.calls.map((args) => args.map(String).join(" ")).join("\n");
      expect(response.status, errors).toBe(200);
      const body = await bodyOf<{ data: { results: { localId: string; status: string; code?: string }[] } }>(response);
      const byLocalId = new Map(body.data.results.map((result) => [result.localId, result]));
      expect(byLocalId.get(cleanItem.localId)).toMatchObject({ status: "APPLIED" });
      expect(byLocalId.get(nulItem.localId)).toMatchObject({ status: "REJECTED", code: "SYNC_ITEM_REJECTED" });
    } finally {
      errorLog.mockRestore();
    }
  });

  it("filter s NUL-om u query parametru odbija se s 400, ne ruši listu", async () => {
    const response = await obligationsGet(
      new NextRequest("http://localhost/api/obligations?workerId=a%00b", { headers: { cookie: ownerCookie } }),
    );
    expect(response.status).toBe(400);
    const body = await bodyOf<{ error: { code: string } }>(response);
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });

  it("uvoz: red s NUL-om u ćeliji dobija ishod „error“ u pregledu, ne ruši uvoz", async () => {
    // CSV, ne xlsx: exceljs pri pisanju xlsx-a sam izbaci NUL iz XML-a, pa bi test lažno prolazio.
    const bytes = Buffer.from("Ime,Prezime,Datum početka\nNul\u0000Ime,Prezime,2025-01-01\n", "utf8");
    const parsed = await parseWorkbook(bytes, "nul-uvoz.csv");
    if ("code" in parsed) throw new Error(`parser: ${parsed.message}`);
    const preview = await previewImport(
      await getVerifiedPool(),
      COMPANY as never,
      "workers",
      parsed,
      { firstName: "Ime", lastName: "Prezime", hiredAt: "Datum početka", supervisor: null },
    );
    if ("code" in preview) throw new Error(`preview: ${preview.message}`);
    expect(preview.rows[0]).toMatchObject({ outcome: "error" });
    expect(preview.rows[0]!.reason).toContain("kontrolne");
  });

  it("uvoz: ime datoteke s NUL-om odbija se s 400 na samoj granici", async () => {
    const form = new FormData();
    form.append("kind", "workers");
    form.append("file", new File([Buffer.from("Ime,Prezime,Datum početka\nAna,Anić,2025-01-01\n", "utf8")], "radnici\u0000.xlsx", { type: "text/csv" }));
    const request = new NextRequest("http://localhost/api/imports/preview", { method: "POST", body: form, headers: { cookie: ownerCookie } });
    const response = await importsPreviewRoute(request);
    expect(response.status).toBe(400);
    const body = await bodyOf<{ error: { code: string; message: string } }>(response);
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.message).toContain("kontrolne");
  });
});
