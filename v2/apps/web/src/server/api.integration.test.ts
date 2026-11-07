/**
 * Integracijski testovi API-ja na PRAVOJ bazi. Ne mock-uju bazu: cilj je dokazati
 * da tenant izolacija, sesije i sync rade kroz cijeli put (ruta → servis → RLS → baza).
 *
 * Traži: DATABASE_URL (gradix_app) i DATABASE_ADMIN_URL (vlasnik šeme, za seed).
 * Bez njih se testovi preskaču — nikad ne prolaze lažno.
 */
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import argon2 from "argon2";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { POST as refreshRoute } from "@/app/api/auth/refresh/route";
import { GET as meRoute } from "@/app/api/me/route";
import { POST as pushRoute } from "@/app/api/sync/push/route";
import { GET as pullRoute } from "@/app/api/sync/pull/route";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = process.env.DATABASE_URL && adminUrl ? describe : describe.skip;

const COMPANY_A = "cmp_it_a";
const COMPANY_B = "cmp_it_b";
const USER_A = "usr_it_a";
const USER_B = "usr_it_b";
const PASSWORD = "test-lozinka-123";

function jsonRequest(url: string, body: unknown, cookie?: string): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  return new NextRequest(url, { method: "POST", body: JSON.stringify(body), headers });
}

function getRequest(url: string, cookie?: string): NextRequest {
  return new NextRequest(url, { headers: cookie ? { cookie } : {} });
}

function cookieFrom(response: Response, name: string): string {
  const setCookie = response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`));
  return setCookie ? (setCookie.split(";")[0] as string) : "";
}

async function bodyOf<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describeDb("API (integracija na pravoj bazi)", () => {
  const admin = new Pool({ connectionString: adminUrl });

  beforeAll(async () => {
    const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });

    await admin.query("DELETE FROM companies WHERE id = ANY($1)", [[COMPANY_A, COMPANY_B]]);
    await admin.query("DELETE FROM users WHERE id = ANY($1)", [[USER_A, USER_B]]);
    await admin.query(
      "INSERT INTO companies (id, name, slug) VALUES ($1, 'IT Firma A', 'it-firma-a'), ($2, 'IT Firma B', 'it-firma-b')",
      [COMPANY_A, COMPANY_B],
    );
    await admin.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, must_change_password)
       VALUES ($1, 'it-a@test.ba', $3, 'Test', 'A', false), ($2, 'it-b@test.ba', $3, 'Test', 'B', false)`,
      [USER_A, USER_B, hash],
    );
    // `companies` i `users` nisu tenant tabele; `memberships` i `machines` jesu.
    // U modelu B (gradix_app je vlasnik šeme) RLS važi i za admin konekciju, pa seed
    // mora ići kroz tenant scope — inače bi test dokazivao pogrešnu stvar.
    const { withCompany, companyId } = await import("@gradix/db");
    const appPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    for (const [company, machineId, code, name, memberId, userId, role] of [
      [COMPANY_A, "mch_it_a", "IT-BAG", "Bager A", "mem_it_a", USER_A, "ADMIN"],
      [COMPANY_B, "mch_it_b", "IT-KAM", "Kamion B", "mem_it_b", USER_B, "OWNER"],
    ] as const) {
      await withCompany(appPool, companyId(company), async (client) => {
        await client.query("DELETE FROM memberships WHERE id = $1", [memberId]);
        await client.query(
          "INSERT INTO memberships (id, user_id, company_id, roles) VALUES ($1, $2, $3, ARRAY[$4]::\"Role\"[])",
          [memberId, userId, company, role],
        );
        await client.query("DELETE FROM machines WHERE id = $1", [machineId]);
        await client.query(
          "INSERT INTO machines (id, company_id, code, name) VALUES ($1, $2, $3, $4)",
          [machineId, company, code, name],
        );
      });
    }
    await appPool.end();
  });

  it("prijava vraća sesiju i cookie", async () => {
    const response = await loginRoute(jsonRequest("http://localhost/api/auth/login", { email: "it-a@test.ba", password: PASSWORD }));
    expect(response.status).toBe(200);
    const body = await bodyOf<{ success: boolean; data: { companyId: string } }>(response);
    expect(body.data.companyId).toBe(COMPANY_A);
    expect(cookieFrom(response, "gx_at")).not.toBe("");
    expect(cookieFrom(response, "gx_rt")).not.toBe("");
  });

  it("nepoznat email i pogrešna lozinka daju isti kod", async () => {
    const wrongPassword = await loginRoute(
      jsonRequest("http://localhost/api/auth/login", { email: "it-a@test.ba", password: "pogresna-lozinka" }),
    );
    const missingUser = await loginRoute(
      jsonRequest("http://localhost/api/auth/login", { email: "nema@test.ba", password: "pogresna-lozinka" }),
    );
    expect(wrongPassword.status).toBe(401);
    expect(missingUser.status).toBe(401);
    expect((await bodyOf<{ error: { code: string } }>(wrongPassword)).error.code).toBe("AUTH_INVALID_CREDENTIALS");
    expect((await bodyOf<{ error: { code: string } }>(missingUser)).error.code).toBe("AUTH_INVALID_CREDENTIALS");
  });

  it("/api/me bez sesije je 401", async () => {
    expect((await meRoute(getRequest("http://localhost/api/me"))).status).toBe(401);
  });

  it("/api/me vraća samo mašine svoje firme", async () => {
    const login = await loginRoute(jsonRequest("http://localhost/api/auth/login", { email: "it-a@test.ba", password: PASSWORD }));
    const cookie = cookieFrom(login, "gx_at");
    const me = await meRoute(getRequest("http://localhost/api/me", cookie));
    expect(me.status).toBe(200);
    const body = await bodyOf<{ data: { machineCount: number; company: { name: string } } }>(me);
    expect(body.data.company.name).toBe("IT Firma A");
    expect(body.data.machineCount).toBe(1);
  });

  it("refresh rotira token, ponovna upotreba gasi sesije", async () => {
    const login = await loginRoute(jsonRequest("http://localhost/api/auth/login", { email: "it-b@test.ba", password: PASSWORD }));
    const refreshToken = (await bodyOf<{ data: { refreshToken: string } }>(login)).data.refreshToken;

    const first = await refreshRoute(jsonRequest("http://localhost/api/auth/refresh", { refreshToken }));
    expect(first.status).toBe(200);
    const nextToken = (await bodyOf<{ data: { refreshToken: string } }>(first)).data.refreshToken;
    expect(nextToken).not.toBe(refreshToken);

    const replay = await refreshRoute(jsonRequest("http://localhost/api/auth/refresh", { refreshToken }));
    expect((await bodyOf<{ error: { code: string } }>(replay)).error.code).toBe("AUTH_REFRESH_REUSE");

    // Nakon reuse-a sve sesije korisnika su opozvane, uključujući novi token.
    const afterReuse = await refreshRoute(jsonRequest("http://localhost/api/auth/refresh", { refreshToken: nextToken }));
    expect(afterReuse.status).toBe(401);
  });

  it("sync push je idempotentan i izolovan po firmi", async () => {
    const loginA = await loginRoute(jsonRequest("http://localhost/api/auth/login", { email: "it-a@test.ba", password: PASSWORD }));
    const cookieA = cookieFrom(loginA, "gx_at");
    const payload = {
      deviceId: "it-dev-1",
      items: [{ localId: "it-local-1", entityType: "note", payload: { text: "Iskop" }, clientAt: new Date().toISOString() }],
    };

    const first = await pushRoute(jsonRequest("http://localhost/api/sync/push", payload, cookieA));
    const firstBody = await bodyOf<{ data: { results: { serverId: string; duplicate: boolean }[] } }>(first);
    expect(firstBody.data.results[0]?.duplicate).toBe(false);

    const second = await pushRoute(jsonRequest("http://localhost/api/sync/push", payload, cookieA));
    const secondBody = await bodyOf<{ data: { results: { serverId: string; duplicate: boolean }[] } }>(second);
    expect(secondBody.data.results[0]?.duplicate).toBe(true);
    expect(secondBody.data.results[0]?.serverId).toBe(firstBody.data.results[0]?.serverId);

    // Firma B ne vidi zapise firme A.
    const loginB = await loginRoute(jsonRequest("http://localhost/api/auth/login", { email: "it-b@test.ba", password: PASSWORD }));
    const cookieB = cookieFrom(loginB, "gx_at");
    const pullB = await pullRoute(getRequest("http://localhost/api/sync/pull?since=1970-01-01T00:00:00Z", cookieB));
    const pullBody = await bodyOf<{ data: { items: unknown[] } }>(pullB);
    expect(pullBody.data.items.length).toBe(0);
  });

  it("sync push odbija prevelik batch prije ijednog upisa", async () => {
    const login = await loginRoute(jsonRequest("http://localhost/api/auth/login", { email: "it-a@test.ba", password: PASSWORD }));
    const cookie = cookieFrom(login, "gx_at");
    const items = Array.from({ length: 201 }, (_, index) => ({
      localId: `bulk-${index}`,
      entityType: "note",
      payload: { text: "x" },
      clientAt: new Date().toISOString(),
    }));
    const response = await pushRoute(jsonRequest("http://localhost/api/sync/push", { deviceId: "it-dev-2", items }, cookie));
    expect(response.status).toBe(400);
    expect((await bodyOf<{ error: { code: string } }>(response)).error.code).toBe("SYNC_BATCH_TOO_LARGE");
  });

  it("sync pull odbija since u budućnosti", async () => {
    const login = await loginRoute(jsonRequest("http://localhost/api/auth/login", { email: "it-a@test.ba", password: PASSWORD }));
    const cookie = cookieFrom(login, "gx_at");
    const response = await pullRoute(getRequest("http://localhost/api/sync/pull?since=2030-01-01T00:00:00Z", cookie));
    expect(response.status).toBe(400);
    expect((await bodyOf<{ error: { code: string } }>(response)).error.code).toBe("SYNC_SINCE_INVALID");
  });
});
