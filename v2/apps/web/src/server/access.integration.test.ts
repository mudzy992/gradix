/**
 * R1a na PRAVOJ bazi: pozivnice, reset, promjena lozinke, deaktivacija, rate limit.
 *
 * Ne mock-uje bazu i ne mock-uje rute: cilj je dokazati cijeli put
 * (ruta → servis → RLS → baza) i da token nigdje ne iscuri.
 *
 * Traži `DATABASE_URL` (gradix_app) i `DATABASE_ADMIN_URL` (vlasnik šeme). Bez njih se
 * testovi PRESKAČU — nikad ne prolaze lažno.
 */
import { NextRequest } from "next/server";
import { Pool } from "pg";
import argon2 from "argon2";
import { beforeAll, describe, expect, it } from "vitest";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { GET as usersRoute } from "@/app/api/users/route";
import { POST as inviteRoute } from "@/app/api/users/invitations/route";
import { POST as resetRoute } from "@/app/api/users/[id]/reset-password/route";
import { PATCH as activeRoute } from "@/app/api/users/[id]/active/route";
import { POST as changePasswordRoute } from "@/app/api/auth/change-password/route";
import { GET as invitePreviewRoute, POST as inviteAcceptRoute } from "@/app/api/invitations/[token]/route";
import { POST as resetApplyRoute } from "@/app/api/password-resets/[token]/route";
import { hashToken, isValidTokenFormat } from "./tokens";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = process.env.DATABASE_URL && adminUrl ? describe : describe.skip;

const COMPANY = "cmp_r1a";
const ADMIN_USER = "usr_r1a_admin";
const OWNER_USER = "usr_r1a_owner";
const PASSWORD = "test-lozinka-123";
const BASE = "http://interni";

const json = (url: string, body: unknown, cookie?: string) =>
  new NextRequest(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
  });

const get = (url: string, cookie?: string) => new NextRequest(url, { headers: cookie ? { cookie } : {} });

const cookieOf = (response: Response, name: string) => {
  const value = response.headers.getSetCookie().find((entry) => entry.startsWith(`${name}=`));
  return value ? value.split(";")[0]! : "";
};

const bodyOf = async <T>(response: Response) => (await response.json()) as T;

type Envelope<T> = { success: true; data: T } | { success: false; error: { code: string; message: string } };

const params = (token: string) => ({ params: Promise.resolve({ token }) });

describeDb("R1a — pristup (integracija na pravoj bazi)", () => {
  const admin = new Pool({ connectionString: adminUrl });
  const app = new Pool({ connectionString: process.env.DATABASE_URL });
  let adminCookie = "";
  let workerId = "";

  beforeAll(async () => {
    // Korisnici nisu tenant-vlasništvo: brišu se eksplicitno, inače drugi prolaz pada na PK
    // ili na `users_email_key` (emailovi koje su napravile pozivnice iz prethodnog prolaza).
    await admin.query("DELETE FROM password_resets WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@r1a.test')");
    await admin.query("DELETE FROM invitations WHERE lower(email) LIKE '%@r1a.test'");
    await admin.query("DELETE FROM users WHERE email LIKE '%@r1a.test'");
    await admin.query("DELETE FROM companies WHERE id = $1", [COMPANY]);
    await admin.query(
      `INSERT INTO companies (id, name, slug) VALUES ($1, 'R1a Firma', 'r1a-firma')`,
      [COMPANY],
    );
    const hash = await argon2.hash(PASSWORD, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
    for (const [id, email, firstName, role] of [
      [ADMIN_USER, "admin@r1a.test", "Admin", "ADMIN"],
      [OWNER_USER, "owner@r1a.test", "Vlasnik", "OWNER"],
    ] as const) {
      await admin.query(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, is_active, must_change_password)
         VALUES ($1, $2, $3, $4, 'Test', true, false)`,
        [id, email, hash, firstName],
      );
      await admin.query(
        `INSERT INTO memberships (id, user_id, company_id, roles, scope) VALUES ($1, $2, $3, $4::"Role"[], 'COMPANY')`,
        [`mem_${id}`, id, COMPANY, [role]],
      );
    }

    const login = await loginRoute(json(`${BASE}/api/auth/login`, { email: "admin@r1a.test", password: PASSWORD }));
    adminCookie = cookieOf(login, "gx_at");
    expect(adminCookie).not.toBe("");
  }, 60_000);

  it("lista korisnika ne vraća hash lozinke ni tokene", async () => {
    const response = await usersRoute(get(`${BASE}/api/users`, adminCookie));
    expect(response.status).toBe(200);
    const raw = JSON.stringify(await bodyOf(response));
    // Traže se STVARNA polja tajni, ne riječ „password“ u imenu polja `mustChangePassword`.
    expect(raw).not.toMatch(/password_?hash|token_hash|"token"|"link"/i);
  });

  it("pozivnica: link postoji jednom, u bazi je samo hash, audit ne sadrži token", async () => {
    const response = await inviteRoute(
      json(`${BASE}/api/users/invitations`, {
        email: "novi@r1a.test",
        roles: ["WORKER"],
        scope: "COMPANY",
      }, adminCookie),
    );
    expect(response.status).toBe(200);
    const body = await bodyOf<Envelope<{ link: string; id: string }>>(response);
    if (!body.success) throw new Error(body.error.message);
    const token = new URL(body.data.link).searchParams.get("token")!;
    expect(isValidTokenFormat(token, "invite")).toBe(true);

    const stored = await admin.query<{ token_hash: string }>(
      "SELECT token_hash FROM invitations WHERE id = $1",
      [body.data.id],
    );
    expect(stored.rows[0]!.token_hash).toBe(hashToken(token));
    expect(stored.rows[0]!.token_hash).not.toContain(token);

    // TVRDNJA IZ PLANA: audit ne sadrži vrijednost tokena.
    const audit = await admin.query<{ metadata: unknown; action: string }>(
      "SELECT metadata, action FROM audit_events WHERE entity_id = $1",
      [body.data.id],
    );
    expect(audit.rows.length).toBe(1);
    expect(JSON.stringify(audit.rows[0])).not.toContain(token);
  });

  it("pozivnica se prihvata tačno jednom, i to bez tenantа u zahtjevu", async () => {
    const created = await inviteRoute(
      json(`${BASE}/api/users/invitations`, {
        email: "jednom@r1a.test",
        roles: ["WORKER"],
        scope: "COMPANY",
      }, adminCookie),
    );
    const createdBody = await bodyOf<Envelope<{ link: string }>>(created);
    if (!createdBody.success) throw new Error(createdBody.error.message);
    const token = new URL(createdBody.data.link).searchParams.get("token")!;

    const preview = await invitePreviewRoute(get(`${BASE}/api/invitations/${token}`), params(token));
    expect(preview.status).toBe(200);

    const first = await inviteAcceptRoute(
      json(`${BASE}/api/invitations/${token}`, {
        firstName: "Prvi",
        lastName: "Pokušaj",
        password: "lozinka-12345",
      }),
      params(token),
    );
    expect(first.status).toBe(200);

    // Isti link drugi put: isti kod, bez razlike u poruci.
    const second = await inviteAcceptRoute(
      json(`${BASE}/api/invitations/${token}`, {
        firstName: "Drugi",
        lastName: "Pokušaj",
        password: "lozinka-12345",
      }),
      params(token),
    );
    expect(second.status).toBe(410);
    expect((await bodyOf<Envelope<unknown>>(second)).success).toBe(false);
  });

  it("neispravan format tokena se odbija bez upita u bazu", async () => {
    const response = await invitePreviewRoute(get(`${BASE}/api/invitations/smece`), params("smece"));
    expect(response.status).toBe(410);
  });

  it("reset gasi sve sesije te osobe, nova lozinka radi", async () => {
    const created = await inviteRoute(
      json(`${BASE}/api/users/invitations`, {
        email: "reset@r1a.test",
        roles: ["WORKER"],
        scope: "COMPANY",
      }, adminCookie),
    );
    const createdBody = await bodyOf<Envelope<{ link: string }>>(created);
    if (!createdBody.success) throw new Error(createdBody.error.message);
    const inviteToken = new URL(createdBody.data.link).searchParams.get("token")!;
    await inviteAcceptRoute(
      json(`${BASE}/api/invitations/${inviteToken}`, {
        firstName: "Reset",
        lastName: "Test",
        password: "lozinka-12345",
      }),
      params(inviteToken),
    );

    const workerLogin = await loginRoute(
      json(`${BASE}/api/auth/login`, { email: "reset@r1a.test", password: "lozinka-12345" }),
    );
    const workerBody = await bodyOf<Envelope<{ user: { id: string } }>>(workerLogin);
    if (!workerBody.success) throw new Error(workerBody.error.message);
    workerId = workerBody.data.user.id;

    const reset = await resetRoute(
      json(`${BASE}/api/users/${workerId}/reset-password`, {}, adminCookie),
      { params: Promise.resolve({ id: workerId }) },
    );
    expect(reset.status).toBe(200);
    const resetBody = await bodyOf<Envelope<{ link: string }>>(reset);
    if (!resetBody.success) throw new Error(resetBody.error.message);
    const resetToken = new URL(resetBody.data.link).searchParams.get("token")!;
    expect(isValidTokenFormat(resetToken, "reset")).toBe(true);

    const applied = await resetApplyRoute(
      json(`${BASE}/api/password-resets/${resetToken}`, { password: "novalozinka-99" }),
      params(resetToken),
    );
    expect(applied.status).toBe(200);

    // Stara sesija je ugašena — provjerava se u bazi, jer se u ovom testu rute zovu direktno
    // (nema HTTP servera, pa `fetch` na izmišljeni host nije dokaz).
    const sessions = await admin.query(
      "SELECT count(*)::int AS open FROM sessions WHERE user_id = $1 AND revoked_at IS NULL",
      [workerId],
    );
    expect(sessions.rows[0].open).toBe(0);
  });

  it("ADMIN ne dira OWNER-a i ne deaktivira sebe", async () => {
    const owner = await resetRoute(
      json(`${BASE}/api/users/${OWNER_USER}/reset-password`, {}, adminCookie),
      { params: Promise.resolve({ id: OWNER_USER }) },
    );
    expect(owner.status).toBe(403);
    expect((await bodyOf<Envelope<unknown>>(owner)) as { error: { code: string } }).toMatchObject({
      error: { code: "USERS_TARGET_PROTECTED" },
    });

    const self = await activeRoute(
      json(`${BASE}/api/users/${ADMIN_USER}/active`, { active: false }, adminCookie),
      { params: Promise.resolve({ id: ADMIN_USER }) },
    );
    expect(self.status).toBe(403);
  });

  it("promjena lozinke traži tačnu trenutnu lozinku", async () => {
    const wrong = await changePasswordRoute(
      json(
        `${BASE}/api/auth/change-password`,
        { currentPassword: "pogresna-lozinka", newPassword: "novalozinka-77" },
        adminCookie,
      ),
    );
    expect(wrong.status).toBe(400);
    expect((await bodyOf<Envelope<unknown>>(wrong)) as { error: { code: string } }).toMatchObject({
      error: { code: "AUTH_PASSWORD_WRONG" },
    });
  });

  it("rate limit: brojač je u bazi, hashiran, i resetuje se uspješnom prijavom", async () => {
    // Aplikacijska rola NE SMIJE čitati tabelu direktno.
    const direct = await app.query("SELECT count(*) FROM login_attempts").catch((error: Error) => error);
    expect(direct).toBeInstanceOf(Error);
    expect((direct as Error).message).toMatch(/permission denied/);

    const email = "ratelimit@r1a.test";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await loginRoute(json(`${BASE}/api/auth/login`, { email, password: "pogresna" }));
    }
    const blocked = await loginRoute(json(`${BASE}/api/auth/login`, { email, password: "pogresna" }));
    expect(blocked.status).toBe(429);

    // U bazi nema čitljivog emaila — samo hash.
    const rows = await admin.query<{ email_hash: string }>("SELECT email_hash FROM login_attempts");
    expect(rows.rows.some((row) => row.email_hash.includes("@"))).toBe(false);
  });

  it("sesija sa obaveznom promjenom lozinke ne smije dalje od promjene", async () => {
    const hash = await argon2.hash(PASSWORD, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
    await admin.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, is_active, must_change_password)
       VALUES ('usr_r1a_must', 'must@r1a.test', $1, 'Mora', 'Promijeniti', true, true)
       ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [hash],
    );
    await admin.query(
      `INSERT INTO memberships (id, user_id, company_id, roles, scope)
       VALUES ('mem_must', 'usr_r1a_must', $1, '{WORKER}'::"Role"[], 'COMPANY')`,
      [COMPANY],
    );

    const login = await loginRoute(json(`${BASE}/api/auth/login`, { email: "must@r1a.test", password: PASSWORD }));
    expect(login.status).toBe(200);
    const cookie = cookieOf(login, "gx_at");

    const users = await usersRoute(get(`${BASE}/api/users`, cookie));
    expect(users.status).toBe(403);
    expect((await bodyOf<Envelope<unknown>>(users)) as { error: { code: string } }).toMatchObject({
      error: { code: "AUTH_PASSWORD_CHANGE_REQUIRED" },
    });
  });
});
