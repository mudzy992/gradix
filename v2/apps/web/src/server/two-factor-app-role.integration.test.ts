/**
 * 2FA pod APLIKACIJSKOM rolom — klasa greške koja se ne vidi u drugim testovima.
 *
 * Zašto zaseban test: ostali integracioni testovi 2FA rade kroz `DATABASE_ADMIN_URL`
 * (vlasnička rola), pa **prolaze i kad `gradix_app` nema pravo** na neku operaciju. U
 * produkciji je to pad koji se vidi tek na ekranu: uparivanje 2FA je vraćalo
 * `permission denied for table user_recovery_codes`, jer je kod brisao stare kodove
 * (`DELETE`), a matrica dozvola to pravo namjerno ne daje.
 *
 * Ovaj test zato radi sve pod `DATABASE_URL` (aplikacijska rola) i pokriva cijeli tok:
 * enroll → verify → status → potrošnja recovery koda → isključivanje.
 */
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  beginEnrollment,
  confirmEnrollment,
  consumeRecoveryCode,
  disableTwoFactor,
  resetTwoFactor,
  twoFactorStatus,
} from "./two-factor";

const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = appUrl && adminUrl ? describe : describe.skip;

const RUN = randomUUID().replace(/-/g, "").slice(0, 10);
const CO = `cmp_2fa_${RUN}`;
const USER = `usr_2fa_${RUN}`;

describeDb("2FA — aplikacijska rola (grantovi iz matrice)", () => {
  const admin = new Pool({ connectionString: adminUrl, max: 2 });
  const app = new Pool({ connectionString: appUrl, max: 2 });

  beforeAll(async () => {
    await admin.query("INSERT INTO public.companies (id, name, slug) VALUES ($1, '2FA', $2)", [
      CO,
      `tfa-${RUN}`,
    ]);
    await admin.query(
      `INSERT INTO public.users (id, email, password_hash, first_name, last_name)
       VALUES ($1, $2, 'argon2id-placeholder', 'Dva', 'Faktora')`,
      [USER, `twofa-${RUN}@f1.test`],
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
    await admin.query("DELETE FROM public.memberships WHERE user_id = $1", [USER]);
    await admin.query("DELETE FROM public.users WHERE id = $1", [USER]);
    await admin.query("DELETE FROM public.companies WHERE id = $1", [CO]);
    await admin.end();
    await app.end();
  });

  it("uparivanje prolazi do kraja, sa recovery kodovima, bez ijednog `permission denied`", async () => {
    const enrollment = await beginEnrollment(app, {
      userId: USER,
      companyId: CO as never,
      email: `twofa-${RUN}@f1.test`,
    });
    expect("code" in enrollment).toBe(false);
    const secret = (enrollment as { secret: string }).secret;

    const { totpCode, totpStep } = await import("@gradix/domain/server");
    const confirmed = await confirmEnrollment(app, { userId: USER, companyId: CO as never }, totpCode(secret, totpStep(Date.now())));
    expect("code" in confirmed).toBe(false);
    expect((confirmed as { recoveryCodes: string[] }).recoveryCodes).toHaveLength(10);

    const status = await twoFactorStatus(app, CO as never, USER);
    expect(status.enabled).toBe(true);
  });

  it("reset pa ponovno uparivanje: stari kodovi su potrošeni, ne obrisani", async () => {
    // Ovo je tačan scenario iz produkcije: i reset i ponovno uparivanje moraju raditi bez
    // DELETE prava. Stari kodovi ostaju kao dokaz (used_at), a tajna se neutrališe.
    const reset = await resetTwoFactor(
      app,
      { userId: USER, companyId: CO as never, actorEmail: null },
      USER,
      "Test reset prije ponovnog uparivanja",
    );
    expect("code" in reset).toBe(false);

    const again = await beginEnrollment(app, {
      userId: USER,
      companyId: CO as never,
      email: `twofa-${RUN}@f1.test`,
    });
    expect("code" in again).toBe(false);
    const secret = (again as { secret: string }).secret;
    const { totpCode, totpStep } = await import("@gradix/domain/server");
    const confirmed = await confirmEnrollment(app, { userId: USER, companyId: CO as never }, totpCode(secret, totpStep(Date.now())));
    expect("code" in confirmed).toBe(false);

    // Stari kodovi su potrošeni, ne obrisani — i dalje ih je 20 (10 + 10), aktivnih 10.
    const rows = await admin.query<{ n: string; aktivni: string }>(
      `SELECT count(*)::text AS n, count(*) FILTER (WHERE used_at IS NULL)::text AS aktivni
         FROM public.user_recovery_codes WHERE user_id = $1`,
      [USER],
    );
    expect(Number(rows.rows[0]!.n)).toBe(20);
    expect(Number(rows.rows[0]!.aktivni)).toBe(10);
  });

  it("potrošnja recovery koda i isključivanje rade pod aplikacijskom rolom", async () => {
    const kodovi = await admin.query<{ id: string }>(
      "SELECT id FROM public.user_recovery_codes WHERE user_id = $1 AND used_at IS NULL LIMIT 1",
      [USER],
    );
    expect(kodovi.rowCount).toBe(1);

    // Rola ACCOUNTANT traži 2FA, pa ga `disableTwoFactor` odbija — ali upit mora proći kroz
    // bazu. Pad bi ovdje bio `permission denied`, a ne `FORBIDDEN`.
    const disabled = await disableTwoFactor(
      app,
      { userId: USER, companyId: CO as never, roles: ["ACCOUNTANT"] },
      { passwordOk: true, code: "000000" },
    );
    expect("code" in disabled && disabled.code === "FORBIDDEN").toBe(true);

    const status = await twoFactorStatus(app, CO as never, USER);
    expect(status.enabled).toBe(true);
  });

  it("consumeRecoveryCode ne baca `permission denied`", async () => {
    const client = await app.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.company_id', $1, true)", [CO]);
      // Kod ne postoji — odgovor je `false`, ali baza mora odgovoriti, ne odbiti upit.
      await expect(consumeRecoveryCode(client, USER, "NEPOSTOJECI", CO as never)).resolves.toBe(false);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });
});
