/**
 * Životni ciklus 2FA kroz PRAVE rute — regresija za lanac bugova iz produkcije.
 *
 * Testovi ispod zovu `POST` handlere (ne servise), jer se greške iz produkcije nisu vidjele u
 * servisnim testovima: servisi su radili, ali je **sesija ostajala u pogrešnom stanju** i
 * korisnik nije mogao dalje. Pokriveno:
 *
 *   1. promjena lozinke oslobađa sesiju (`pwd` u tokenu, `sessions.pwd_change_required`);
 *   2. potvrda uparivanja izdaje token BEZ `enr` — inače nalog ostaje zaključan na 2FA ekranu;
 *   3. uparivanje i isključivanje ne padaju na grantovima (`permission denied`).
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { totpCode, totpStep } from "@gradix/domain/server";
import { POST as changePassword } from "@/app/api/auth/change-password/route";
import { POST as enroll } from "@/app/api/auth/2fa/enroll/route";
import { POST as verify } from "@/app/api/auth/2fa/verify/route";
import { GET as status } from "@/app/api/auth/2fa/status/route";
import { authenticate } from "./tenant-context";
import { ACCESS_COOKIE, issueAccessToken } from "./session";

const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = appUrl && adminUrl ? describe : describe.skip;

const RUN = randomUUID().replace(/-/g, "").slice(0, 10);
const CO = "cmp_demo";
const USER = `usr_2fa_lc_${RUN}`;
const EMAIL = `2fa-lc-${RUN}@test.example`;
const PRIVREMENA = "PrivremenaLozinka-123";

describeDb("2FA — životni ciklus kroz rute (aplikacijska rola)", () => {
  const admin = new Pool({ connectionString: adminUrl, max: 2 });
  const app = new Pool({ connectionString: appUrl, max: 2 });

  beforeAll(async () => {
    const argon2 = (await import("argon2")).default;
    await admin.query(
      `INSERT INTO public.users (id, email, password_hash, first_name, last_name, must_change_password)
       VALUES ($1, $2, $3, 'Lc', 'Test', true)`,
      [USER, EMAIL, await argon2.hash(PRIVREMENA, { type: argon2.argon2id })],
    );
    await admin.query(
      `INSERT INTO public.memberships (id, user_id, company_id, roles, scope)
       VALUES (gen_random_uuid()::text, $1, $2, ARRAY['ACCOUNTANT']::"Role"[], 'COMPANY')`,
      [USER, CO],
    );
  });

  afterAll(async () => {
    await admin.query("DELETE FROM public.user_recovery_codes WHERE user_id = $1", [USER]);
    await admin.query("DELETE FROM public.user_totp WHERE user_id = $1", [USER]);
    await admin.query("DELETE FROM public.sessions WHERE user_id = $1", [USER]);
    await admin.query("DELETE FROM public.password_history WHERE user_id = $1", [USER]);
    await admin.query("DELETE FROM public.memberships WHERE user_id = $1", [USER]);
    await admin.query("DELETE FROM public.users WHERE id = $1", [USER]);
    await admin.end();
    await app.end();
  });

  /**
   * Sesija kakvu izdaje `POST /api/auth/login` kada nalog mora i lozinku i 2FA.
   * `pwd` se zadaje po testu: prvi test tek treba da promijeni lozinku, ostali su već prošli.
   */
  async function enrollmentSession(pwdChangeRequired = true) {
    const sessionId = randomUUID();
    await admin.query(
      `INSERT INTO public.sessions (id, user_id, company_id, token_hash, expires_at, pwd_change_required)
       VALUES ($1, $2, $3, $4, now() + INTERVAL '1 hour', $5)`,
      [sessionId, USER, CO, randomUUID(), pwdChangeRequired],
    );
    const token = issueAccessToken({ sub: USER, sid: sessionId, companyId: CO, enr: true });
    return { sessionId, token };
  }

  function request(path: string, token: string, body?: unknown): NextRequest {
    return new NextRequest(`http://localhost${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { cookie: `${ACCESS_COOKIE}=${token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  it("promjena lozinke oslobađa sesiju (sva tri sloja `pwd` zastavice)", async () => {
    const { token } = await enrollmentSession();
    const response = await changePassword(
      request("/api/auth/change-password", token, {
        currentPassword: PRIVREMENA,
        newPassword: "NovaLozinka-2026",
        repeatPassword: "NovaLozinka-2026",
      }),
    );
    expect(response.status).toBe(200);

    // Novi token je izdat i u njemu nema `pwd`; baza takođe više ne traži promjenu.
    const novi = response.headers.getSetCookie().find((value) => value.startsWith(`${ACCESS_COOKIE}=`));
    expect(novi).toBeTruthy();
    const noviToken = novi!.split(";")[0]!.split("=").slice(1).join("=");
    const auth = await authenticate(request("/api/me", noviToken));
    expect(auth.ok && auth.ctx.mustChangePassword).toBe(false);

    // Ista sesija sada smije na 2FA status — prije popravke je vraćala 403.
    const st = await status(request("/api/auth/2fa/status", noviToken));
    expect(st.status).toBe(200);
  });

  it("potvrda uparivanja izdaje token bez `enr` (nalog nije zaglavljen na 2FA ekranu)", async () => {
    const { token } = await enrollmentSession(false);
    const enrolled = await (await enroll(request("/api/auth/2fa/enroll", token))).json();
    expect(enrolled.success).toBe(true);

    const verified = await verify(
      request("/api/auth/2fa/verify", token, {
        code: totpCode(enrolled.data.secret, totpStep(Date.now())),
      }),
    );
    expect(verified.status).toBe(200);

    const novi = verified.headers.getSetCookie().find((value) => value.startsWith(`${ACCESS_COOKIE}=`));
    const noviToken = novi!.split(";")[0]!.split("=").slice(1).join("=");
    const auth = await authenticate(request("/api/me", noviToken));
    expect(auth.ok && auth.ctx.enrollmentPending).toBe(false);
  });
});
