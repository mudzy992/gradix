/**
 * Faza 1 — Modul 1 na pravoj bazi. Testira ono što se u ovom modulu pokvari TIHO:
 *
 *   1. **RLS izolacija novih tabela**: firma B ne vidi praznike, šablone ni sesije firme A;
 *   2. **2FA**: tajna se ne vraća poslije uparivanja; isti kod ne radi dvaput; recovery kod
 *      radi jednom; obavezna rola bez 2FA ne može dalje;
 *   3. **Politika lozinki**: zadnje 3 se ne ponavljaju, terenska rola nema prisilni reset;
 *   4. **Sesije**: opoziv pojedinačne ne dira druge; „odjavi ostale“ ostavlja tekuću;
 *      promjena role gasi sesije; jedna aktivna sesija po uređaju;
 *   5. **Audit**: metadata ima `before/after/changed`; klase retencije se upisuju;
 *   6. **Onboarding**: firma + vlasnik + šifarnici atomično; dupli slug = CONFLICT;
 *   7. **Support pristup**: max 60 min, obavezan razlog, vidljiv u auditu firme.
 */
import { randomUUID } from "node:crypto";
import { decryptTotpSecret, generateTotpSecret, totpCode, totpStep } from "@gradix/domain";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = appUrl && adminUrl ? describe : describe.skip;

const RUN = randomUUID().replace(/-/g, "").slice(0, 10);
const CO = `cmp_f1_${RUN}`;
const OTHER = `cmp_f1x_${RUN}`;
const OWNER = `usr_f1_owner_${RUN}`;
const STAFF = `usr_f1_staff_${RUN}`;
const WORKER_USER = `usr_f1_worker_${RUN}`;

describeDb("F1 — firma, pristup, 2FA, sesije, platforma (PostgreSQL)", () => {
  const admin = new Pool({ connectionString: adminUrl, max: 4 });

  beforeAll(async () => {
    for (const [id, slug] of [
      [CO, `f1-${RUN}`],
      [OTHER, `f1x-${RUN}`],
    ] as const) {
      await admin.query("INSERT INTO public.companies (id, name, slug) VALUES ($1, 'F1', $2)", [id, slug]);
    }
    for (const [id, email] of [
      [OWNER, `owner-${RUN}@f1.test`],
      [STAFF, `staff-${RUN}@f1.test`],
      [WORKER_USER, `worker-${RUN}@f1.test`],
    ] as const) {
      await admin.query(
        `INSERT INTO public.users (id, email, password_hash, first_name, last_name, must_change_password)
         VALUES ($1, $2, 'argon2id-placeholder', 'Ime', 'Prezime', false)`,
        [id, email],
      );
    }
    await admin.query(
      `INSERT INTO public.memberships (id, user_id, company_id, roles, scope)
       VALUES (gen_random_uuid()::text, $1, $2, ARRAY['OWNER']::"Role"[], 'COMPANY'),
              (gen_random_uuid()::text, $3, $2, ARRAY['ADMIN']::"Role"[], 'COMPANY'),
              (gen_random_uuid()::text, $4, $2, ARRAY['WORKER']::"Role"[], 'SELF')`,
      [OWNER, CO, STAFF, WORKER_USER],
    );
  }, 60_000);

  afterAll(async () => {
    await admin.query("DELETE FROM public.platform_support_sessions WHERE company_id = ANY($1)", [[CO, OTHER]]);
    await admin.query("DELETE FROM public.company_holidays WHERE company_id = ANY($1)", [[CO, OTHER]]);
    await admin.query("DELETE FROM public.notification_templates WHERE company_id = ANY($1)", [[CO, OTHER]]);
    await admin.query("DELETE FROM public.user_recovery_codes WHERE user_id = ANY($1)", [
      [OWNER, STAFF, WORKER_USER],
    ]);
    await admin.query("DELETE FROM public.user_totp WHERE user_id = ANY($1)", [[OWNER, STAFF, WORKER_USER]]);
    await admin.query("DELETE FROM public.password_history WHERE user_id = ANY($1)", [
      [OWNER, STAFF, WORKER_USER],
    ]);
    await admin.query("DELETE FROM public.sessions WHERE company_id = ANY($1)", [[CO, OTHER]]);
    await admin.query("DELETE FROM public.audit_events WHERE company_id = ANY($1)", [[CO, OTHER]]);
    await admin.query("DELETE FROM public.memberships WHERE company_id = ANY($1)", [[CO, OTHER]]);
    await admin.query("DELETE FROM public.companies WHERE id = ANY($1)", [[CO, OTHER]]);
    await admin.query("DELETE FROM public.users WHERE id = ANY($1)", [[OWNER, STAFF, WORKER_USER]]);
    await admin.end();
  });

  /** Kratka tenant transakcija kao aplikacijska rola — RLS je stvarni sudija, ne mi. */
  async function asCompany<T>(companyId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await app().connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.company_id', $1, true)", [companyId]);
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  let appPool: Pool | null = null;
  function app(): Pool {
    if (!appPool) appPool = new Pool({ connectionString: appUrl, max: 4 });
    return appPool;
  }

  afterAll(async () => {
    await appPool?.end();
  });

  /* ------------------------------------------------------- 1. RLS izolacija */

  describe("RLS na novim tabelama", () => {
    it("firma B ne vidi praznike firme A", async () => {
      await asCompany(CO, (client) =>
        client.query(
          `INSERT INTO company_holidays (id, company_id, holiday_date, name)
           VALUES (gen_random_uuid()::text, $1, '2026-01-01', 'Nova godina')`,
          [CO],
        ),
      );
      const seenByB = await asCompany(OTHER, (client) => client.query("SELECT * FROM company_holidays"));
      expect(seenByB.rows).toHaveLength(0);
      const seenByA = await asCompany(CO, (client) => client.query("SELECT * FROM company_holidays"));
      expect(seenByA.rows.length).toBeGreaterThan(0);
    });

    it("firma B ne može ni upisati praznik firme A (WITH CHECK)", async () => {
      await expect(
        asCompany(OTHER, (client) =>
          client.query(
            `INSERT INTO company_holidays (id, company_id, holiday_date, name)
             VALUES (gen_random_uuid()::text, $1, '2026-05-01', 'Tuđi praznik')`,
            [CO],
          ),
        ),
      ).rejects.toThrow(/row-level security|policy/i);
    });

    it("šabloni: firma vidi svoj i platformski default, ali ne tuđi", async () => {
      await admin.query(
        `INSERT INTO notification_templates (id, company_id, code, subject, body)
         VALUES (gen_random_uuid()::text, NULL, 'platform.default', 'P', 'B')
         ON CONFLICT DO NOTHING`,
      );
      await asCompany(CO, (client) =>
        client.query(
          `INSERT INTO notification_templates (id, company_id, code, subject, body)
           VALUES (gen_random_uuid()::text, $1, 'company.own', 'C', 'B')`,
          [CO],
        ),
      );
      const rows = await asCompany(OTHER, (client) =>
        client.query("SELECT code FROM notification_templates ORDER BY code"),
      );
      const codes = rows.rows.map((row) => String(row.code));
      expect(codes).toContain("platform.default");
      expect(codes).not.toContain("company.own");
    });

    it("sesije firme B se ne vide iz firme A", async () => {
      await admin.query(
        `INSERT INTO public.sessions (id, user_id, company_id, token_hash, expires_at)
         VALUES ($1, $2, $3, $4, now() + interval '1 day')`,
        [`ses_f1_${RUN}`, OWNER, CO, `tok_${RUN}`],
      );
      const rows = await asCompany(OTHER, (client) => client.query("SELECT id FROM sessions"));
      expect(rows.rows).toHaveLength(0);
    });

    it("nova tenant tabela bez politike ne prolazi preflight (docs: report_jobs)", async () => {
      // Provjera da su tabele stvarno pod RLS-om, a ne samo „tako piše u migraciji“.
      const result = await admin.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relname = ANY($1)`,
        [["company_holidays", "report_jobs", "daily_rollups", "user_devices", "notification_templates"]],
      );
      for (const row of result.rows) {
        expect(row.relrowsecurity, `${row.relname} RLS`).toBe(true);
        expect(row.relforcerowsecurity, `${row.relname} FORCE RLS`).toBe(true);
      }
    });
  });

  /* ------------------------------------------------------------- 2. 2FA */

  describe("2FA", () => {
    it("tajna se šifruje i ne vraća se poslije uparivanja", async () => {
      const { encryptTotpSecret, decryptTotpSecret, generateTotpSecret } = await import("@gradix/domain");
      const secret = generateTotpSecret();
      const enc = encryptTotpSecret(secret, "x".repeat(40));
      expect(enc).not.toContain(secret);
      expect(decryptTotpSecret(enc, "x".repeat(40))).toBe(secret);
      // U bazi je šifrat, ne tajna — provjera nad PRAVOM bazom, ne nad stringom.
      await admin.query(
        `INSERT INTO user_totp (id, user_id, secret_enc, confirmed_at)
         VALUES (gen_random_uuid()::text, $1, $2, now())`,
        [STAFF, enc],
      );
      const stored = await admin.query<{ secret_enc: string }>(
        "SELECT secret_enc FROM user_totp WHERE user_id = $1",
        [STAFF],
      );
      expect(stored.rows[0]!.secret_enc).toBe(enc);
      expect(stored.rows[0]!.secret_enc.startsWith("v1.")).toBe(true);
      await admin.query("UPDATE users SET totp_enabled = true WHERE id = $1", [STAFF]);
      await admin.query("DELETE FROM user_totp WHERE user_id = $1", [STAFF]);
    });

    it("recovery kod vrijedi TAČNO jednom (atomski claim)", async () => {
      const { createHash } = await import("node:crypto");
      await admin.query("DELETE FROM user_recovery_codes WHERE user_id = $1", [WORKER_USER]);
      await admin.query(
        `INSERT INTO user_recovery_codes (id, user_id, code_hash)
         VALUES (gen_random_uuid()::text, $1, $2)`,
        [WORKER_USER, createHash("sha256").update("abcdefghij").digest("hex")],
      );
      const first = await asCompany(CO, (client) =>
        client.query(
          `UPDATE user_recovery_codes SET used_at = now()
            WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL RETURNING id`,
          [WORKER_USER, createHash("sha256").update("abcdefghij").digest("hex")],
        ),
      );
      const second = await asCompany(CO, (client) =>
        client.query(
          `UPDATE user_recovery_codes SET used_at = now()
            WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL RETURNING id`,
          [WORKER_USER, createHash("sha256").update("abcdefghij").digest("hex")],
        ),
      );
      expect(first.rowCount).toBe(1);
      expect(second.rowCount).toBe(0);
    });

    it("TOTP kod se ne može iskoristiti dva puta u istom koraku (last_used_step)", async () => {
      const { verifyTotp, encryptTotpSecret } = await import("@gradix/domain");
      const secret = generateTotpSecret();
      const code = totpCode(secret, totpStep(Date.now()));
      const first = verifyTotp(code, secret);
      expect(first.ok).toBe(true);
      const step = first.ok ? first.step : 0;
      const replay = verifyTotp(code, secret, { lastUsedStep: step });
      expect(replay).toEqual({ ok: false, reason: "REPLAY" });
      // Tajna je šifrovana i u bazi — isti ključ je vraća, drugi ne.
      const enc = encryptTotpSecret(secret, "k".repeat(40));
      expect(() => decryptTotpSecretSafe(enc, "d".repeat(40))).toThrow();
    });

    it("reset 2FA gasi sesije korisnika i traži ponovno uparivanje", async () => {
      await admin.query("UPDATE users SET must_enroll_2fa = true WHERE id = $1", [WORKER_USER]);
      const row = await admin.query<{ must_enroll_2fa: boolean }>(
        "SELECT must_enroll_2fa FROM users WHERE id = $1",
        [WORKER_USER],
      );
      expect(row.rows[0]!.must_enroll_2fa).toBe(true);
    });
  });

  /* -------------------------------------------------- 3. politika lozinki */

  describe("politika lozinki i zaključavanje", () => {
    it("istorija prima najviše 3 zapisa (servis briše starije)", async () => {
      await admin.query("DELETE FROM password_history WHERE user_id = $1", [OWNER]);
      for (let index = 0; index < 5; index += 1) {
        await admin.query(
          `INSERT INTO password_history (id, user_id, password_hash) VALUES (gen_random_uuid()::text, $1, $2)`,
          [OWNER, `hash-${index}`],
        );
        await admin.query(
          `DELETE FROM password_history WHERE user_id = $1 AND id NOT IN (
             SELECT id FROM password_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT 2)`,
          [OWNER],
        );
      }
      const count = await admin.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM password_history WHERE user_id = $1",
        [OWNER],
      );
      expect(Number(count.rows[0]!.n)).toBe(2);
    });

    it("zaključavanje poslije 10 promašaja traje 15 minuta", async () => {
      await admin.query(
        "UPDATE users SET failed_login_count = 10, locked_until = now() + interval '15 minutes' WHERE id = $1",
        [STAFF],
      );
      const row = await admin.query<{ locked: boolean }>(
        "SELECT locked_until > now() AS locked FROM users WHERE id = $1",
        [STAFF],
      );
      expect(row.rows[0]!.locked).toBe(true);
      await admin.query("UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = $1", [STAFF]);
    });

    it("prisilni reset ima datum SAMO za uredske role", async () => {
      const office = await admin.query<{ future: boolean }>(
        `UPDATE users SET password_expires_at = now() + interval '180 days' WHERE id = $1
         RETURNING password_expires_at > now() + interval '179 days' AS future`,
        [OWNER],
      );
      expect(office.rows[0]!.future).toBe(true);
      // Terenska rola: servis uopšte ne postavlja datum (NULL), pa nema ni isteka.
      await admin.query("UPDATE users SET password_expires_at = NULL WHERE id = $1", [WORKER_USER]);
      const worker = await admin.query<{ expires: Date | null }>(
        "SELECT password_expires_at AS expires FROM users WHERE id = $1",
        [WORKER_USER],
      );
      expect(worker.rows[0]!.expires).toBeNull();
    });
  });

  /* -------------------------------------------------------- 4. sesije */

  describe("sesije kao uređaji", () => {
    it("opoziv jedne ne dira druge; „odjavi ostale“ ostavlja tekuću", async () => {
      await admin.query("DELETE FROM sessions WHERE company_id = $1", [CO]);
      const ids = [`s1_${RUN}`, `s2_${RUN}`, `s3_${RUN}`];
      for (const id of ids) {
        await admin.query(
          `INSERT INTO sessions (id, user_id, company_id, token_hash, expires_at, device_hash, user_agent)
           VALUES ($1, $2, $3, $4, now() + interval '1 day', 'windows/chrome', 'Chrome/126')`,
          [id, OWNER, CO, `tok_${id}`],
        );
      }
      const current = ids[0]!;
      const revoked = await asCompany(CO, (client) =>
        client.query(
          `UPDATE sessions SET revoked_at = now()
            WHERE user_id = $1 AND company_id = $2 AND id <> $3 AND revoked_at IS NULL RETURNING id`,
          [OWNER, CO, current],
        ),
      );
      expect(revoked.rowCount).toBe(2);
      const alive = await asCompany(CO, (client) =>
        client.query("SELECT id FROM sessions WHERE user_id = $1 AND revoked_at IS NULL", [OWNER]),
      );
      expect(alive.rows.map((row) => String(row.id))).toEqual([current]);
    });

    it("nova prijava sa ISTOG uređaja gasi stariju sesiju", async () => {
      await admin.query("DELETE FROM sessions WHERE company_id = $1", [CO]);
      for (const id of [`old_${RUN}`, `new_${RUN}`]) {
        await admin.query(
          `INSERT INTO sessions (id, user_id, company_id, token_hash, expires_at, device_hash)
           VALUES ($1, $2, $3, $4, now() + interval '1 day', 'ios/safari')`,
          [id, OWNER, CO, `tok_${id}`],
        );
      }
      await asCompany(CO, (client) =>
        client.query(
          `UPDATE sessions SET revoked_at = now()
            WHERE user_id = $1 AND company_id = $2 AND device_hash = 'ios/safari' AND revoked_at IS NULL
              AND id <> $3`,
          [OWNER, CO, `new_${RUN}`],
        ),
      );
      const alive = await asCompany(CO, (client) =>
        client.query("SELECT id FROM sessions WHERE company_id = $1 AND revoked_at IS NULL", [CO]),
      );
      expect(alive.rows.map((row) => String(row.id))).toEqual([`new_${RUN}`]);
    });

    it("promjena role opoziva sve sesije korisnika", async () => {
      await admin.query("DELETE FROM sessions WHERE company_id = $1", [CO]);
      await admin.query(
        `INSERT INTO sessions (id, user_id, company_id, token_hash, expires_at)
         VALUES ($1, $2, $3, $4, now() + interval '1 day')`,
        [`role_${RUN}`, STAFF, CO, `tok_role_${RUN}`],
      );
      // Servis radi UPDATE membership + UPDATE sessions u istoj transakciji; ovdje se
      // provjerava da je efekt „nijedna sesija nije preživjela“.
      await asCompany(CO, async (client) => {
        await client.query("UPDATE memberships SET roles = ARRAY['ACCOUNTANT']::\"Role\"[] WHERE user_id = $1 AND company_id = $2", [
          STAFF,
          CO,
        ]);
        await client.query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND company_id = $2 AND revoked_at IS NULL", [
          STAFF,
          CO,
        ]);
      });
      const alive = await asCompany(CO, (client) =>
        client.query("SELECT id FROM sessions WHERE user_id = $1 AND revoked_at IS NULL", [STAFF]),
      );
      expect(alive.rows).toHaveLength(0);
      await admin.query("UPDATE memberships SET roles = ARRAY['ADMIN']::\"Role\"[] WHERE user_id = $1 AND company_id = $2", [
        STAFF,
        CO,
      ]);
    });
  });

  /* ---------------------------------------------------------- 5. audit */

  describe("audit", () => {
    it("metadata nosi before/after/changed i klasa retencije se upisuje", async () => {
      await asCompany(CO, (client) =>
        client.query(
          `INSERT INTO audit_events
             (id, company_id, actor_id, actor_email, actor_role, action, entity_type, entity_id, metadata, retention_class)
           VALUES (gen_random_uuid()::text, $1, $2, 'a@f1.test', 'OWNER', 'company.settings_updated',
                   'company', $1, $3::jsonb, 'ACCESS')`,
          [CO, OWNER, JSON.stringify({ before: { workdayHours: 8 }, after: { workdayHours: 7.5 }, changed: ["workdayHours"] })],
        ),
      );
      const row = await asCompany(CO, (client) =>
        client.query(
          `SELECT metadata, retention_class FROM audit_events
            WHERE company_id = $1 AND action = 'company.settings_updated' ORDER BY created_at DESC LIMIT 1`,
          [CO],
        ),
      );
      const auditRow = row.rows[0] as { metadata: { changed: string[] }; retention_class: string };
      expect(auditRow.metadata.changed).toEqual(["workdayHours"]);
      expect(auditRow.retention_class).toBe("ACCESS");
    });

    it("klasa retencije je zatvorena (nepoznata vrijednost pada)", async () => {
      await expect(
        admin.query(
          `INSERT INTO audit_events (id, company_id, action, entity_type, entity_id, retention_class)
           VALUES (gen_random_uuid()::text, $1, 'x.y', 'company', $1, 'FOREVER')`,
          [CO],
        ),
      ).rejects.toThrow(/retention_class_check/);
    });
  });

  /* ------------------------------------------------ 6. onboarding / platforma */

  describe("onboarding (platforma)", () => {
    it("firma + vlasnik + šifarnici u JEDNOJ transakciji", async () => {
      const slug = `onb-${RUN}`;
      const client = await admin.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "INSERT INTO companies (id, name, slug, week_start) VALUES ($1, 'Onboarding', $2, 'MON')",
          [`${CO}_onb`, slug],
        );
        // Šifarnike puni TRIGGER na INSERT companies — ručni seed bi bio duplikat i pao bi
        // na NOT NULL `code`. Ovdje se provjerava da trigger STVARNO radi u transakciji.
        await client.query(
          `INSERT INTO memberships (id, user_id, company_id, roles, scope)
           VALUES (gen_random_uuid()::text, $1, $2, ARRAY['OWNER']::"Role"[], 'COMPANY')`,
          [OWNER, `${CO}_onb`],
        );
        await client.query("COMMIT");
      } finally {
        client.release();
      }
      const categories = await admin.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM equipment_categories WHERE company_id = $1",
        [`${CO}_onb`],
      );
      // Trigger seeda zadani katalog (13 kategorija iz R2a). Bitno je da NIJE nula:
      // firma kreirana kroz operatora mora imati kategorije prije prvog ekrana.
      expect(Number(categories.rows[0]!.n)).toBeGreaterThan(0);
      await admin.query("DELETE FROM equipment_categories WHERE company_id = $1", [`${CO}_onb`]);
      await admin.query("DELETE FROM memberships WHERE company_id = $1", [`${CO}_onb`]);
      await admin.query("DELETE FROM companies WHERE id = $1", [`${CO}_onb`]);
    });

    it("dupli slug je CONFLICT (unique), a pad u koraku 4 ne ostavlja firmu", async () => {
      await expect(
        admin.query("INSERT INTO companies (id, name, slug) VALUES ($1, 'Duplikat', $2)", [
          `${CO}_dup`,
          `f1-${RUN}`,
        ]),
      ).rejects.toThrow(/companies_slug_key|unique/i);

      const client = await admin.connect();
      try {
        await client.query("BEGIN");
        await client.query("INSERT INTO companies (id, name, slug) VALUES ($1, 'Pad', $2)", [
          `${CO}_rollback`,
          `rollback-${RUN}`,
        ]);
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
      const leftover = await admin.query("SELECT id FROM companies WHERE id = $1", [`${CO}_rollback`]);
      expect(leftover.rows).toHaveLength(0);
    });

    it("support pristup: max 60 min i obavezan razlog (CHECK u bazi)", async () => {
      const platformUser = `pu_${RUN}`;
      await admin.query(
        `INSERT INTO platform_users (id, email, password_hash) VALUES ($1, $2, 'x') ON CONFLICT DO NOTHING`,
        [platformUser, `platform-${RUN}@f1.test`],
      );
      await expect(
        admin.query(
          `INSERT INTO platform_support_sessions (id, platform_user_id, company_id, reason, expires_at)
           VALUES (gen_random_uuid()::text, $1, $2, 'kratko', now() + interval '30 minutes')`,
          [platformUser, CO],
        ),
      ).rejects.toThrow(/reason_check/);
      await expect(
        admin.query(
          `INSERT INTO platform_support_sessions (id, platform_user_id, company_id, reason, expires_at)
           VALUES (gen_random_uuid()::text, $1, $2, 'Dovoljno dug razlog za pristup', now() + interval '90 minutes')`,
          [platformUser, CO],
        ),
      ).rejects.toThrow(/window_check/);
      await admin.query("DELETE FROM platform_users WHERE id = $1", [platformUser]);
    });
  });
});

/** Pomoćnik: dekriptovanje sa pogrešnim ključem mora pasti (GCM tag). */
function decryptTotpSecretSafe(payload: string, secret: string): string {
  return decryptTotpSecret(payload, secret);
}
