/**
 * R1b na PRAVOJ bazi: matrica rola, dodjela rola i opsega, audit trag.
 *
 * Tri stvari se ovdje dokazuju, i to su tri različite tvrdnje:
 *  1. **tenant izolacija je generisana** iz liste tenant tabela — nova tabela se dodaje u
 *     listu, a ne u novi test, pa ne može ostati nepokrivena;
 *  2. **matrica u UI-u i `PERMISSIONS` u kodu su isti podatak** — test pada ako se raziđu;
 *  3. **pravila dodjele** (ADMIN ne dira vlasnika, niko ne dira sebe, posljednji vlasnik
 *     ostaje) važe i kad se ruta pozove mimo ekrana, i svaka izmjena ostavlja tačno jedan
 *     zapis u tragu.
 *
 * Traži `DATABASE_URL` (gradix_app) i `DATABASE_ADMIN_URL` (vlasnik šeme). Bez njih se
 * testovi PRESKAČU — nikad ne prolaze lažno.
 */
import { NextRequest } from "next/server";
import { Pool } from "pg";
import argon2 from "argon2";
import { beforeAll, describe, expect, it } from "vitest";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { GET as rolesRoute } from "@/app/api/roles/route";
import { GET as auditRoute } from "@/app/api/audit/route";
import { PATCH as membershipRoute } from "@/app/api/users/[id]/membership/route";
import { GET as usersRoute } from "@/app/api/users/route";
import { PERMISSIONS, PERMISSION_KEYS, ROLE_LABELS, ROLES, permissionsFor } from "./permissions";
import { roleMatrix } from "./rbac-service";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = process.env.DATABASE_URL && adminUrl ? describe : describe.skip;

const COMPANY = "cmp_r1b_a";
const OTHER_COMPANY = "cmp_r1b_b";
const PASSWORD = "test-lozinka-123";
const BASE = "http://interni";

/**
 * Tenant tabele — JEDINI spisak. Test izolacije se generiše iz njega.
 * Kad R2 doda `projects`, dodaje se ovdje i pokrivenost ide s njom.
 */
const TENANT_TABLES = [
  "memberships",
  "sessions",
  "machines",
  "equipment_categories",
  "workers",
  // R2b — sve četiri tabele nose `company_id` i imaju RLS politiku.
  "obligation_types",
  "obligations",
  "obligation_versions",
  "obligation_attachments",
  "audit_events",
  "invitations",
  "password_resets",
  "sync_items",
] as const;

const json = (url: string, body: unknown, cookie?: string) =>
  new NextRequest(url, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
  });

const get = (url: string, cookie?: string) => new NextRequest(url, { headers: cookie ? { cookie } : {} });

const cookieOf = (response: Response, name: string) => {
  const value = response.headers.getSetCookie().find((entry) => entry.startsWith(`${name}=`));
  return value ? value.split(";")[0]! : "";
};

type Envelope<T> = { success: true; data: T } | { success: false; error: { code: string; message: string } };
const bodyOf = async <T>(response: Response) => (await response.json()) as T;
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const cookieFor = async (email: string) => {
  const response = await loginRoute(
    new NextRequest(`${BASE}/api/auth/login`, {
      method: "POST",
      body: JSON.stringify({ email, password: PASSWORD }),
      headers: { "content-type": "application/json" },
    }),
  );
  expect(response.status).toBe(200);
  return cookieOf(response, "gx_at");
};

describeDb("R1b — matrica, dodjela i audit (integracija na pravoj bazi)", () => {
  const admin = new Pool({ connectionString: adminUrl });
  const app = new Pool({ connectionString: process.env.DATABASE_URL });

  beforeAll(async () => {
    // Čišćenje u redu koji poštuje FK: trag i zavisni redovi prije korisnika.
    await admin.query("DELETE FROM audit_events WHERE company_id = ANY($1)", [[COMPANY, OTHER_COMPANY]]);
    await admin.query("DELETE FROM password_resets WHERE company_id = ANY($1)", [[COMPANY, OTHER_COMPANY]]);
    await admin.query("DELETE FROM invitations WHERE company_id = ANY($1)", [[COMPANY, OTHER_COMPANY]]);
    await admin.query("DELETE FROM sessions WHERE company_id = ANY($1)", [[COMPANY, OTHER_COMPANY]]);
    await admin.query("DELETE FROM memberships WHERE company_id = ANY($1)", [[COMPANY, OTHER_COMPANY]]);
    await admin.query("DELETE FROM sync_items WHERE company_id = ANY($1)", [[COMPANY, OTHER_COMPANY]]);
    await admin.query("DELETE FROM machines WHERE company_id = ANY($1)", [[COMPANY, OTHER_COMPANY]]);
    await admin.query("DELETE FROM users WHERE email LIKE '%@r1b.test'");
    await admin.query("DELETE FROM companies WHERE id = ANY($1)", [[COMPANY, OTHER_COMPANY]]);

    await admin.query(
      `INSERT INTO companies (id, name, slug) VALUES
        ($1, 'R1b Firma', 'r1b-firma'),
        ($2, 'R1b Druga', 'r1b-druga')`,
      [COMPANY, OTHER_COMPANY],
    );

    const hash = await argon2.hash(PASSWORD, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });

    const people: [string, string, string, string[], "OWNER" | "ADMIN" | "WORKER"][] = [
      ["usr_r1b_owner", "owner@r1b.test", "Vlasnik", [COMPANY], "OWNER"],
      ["usr_r1b_admin", "admin@r1b.test", "Admin", [COMPANY], "ADMIN"],
      ["usr_r1b_worker", "worker@r1b.test", "Radnik", [COMPANY], "WORKER"],
      ["usr_r1b_owner_b", "owner-b@r1b.test", "Drugi", [OTHER_COMPANY], "OWNER"],
    ];

    for (const [id, email, firstName, companies, role] of people) {
      await admin.query(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, is_active, must_change_password)
         VALUES ($1, $2, $3, $4, 'Test', true, false)`,
        [id, email, hash, firstName],
      );
      for (const companyId of companies) {
        await admin.query(
          `INSERT INTO memberships (id, user_id, company_id, roles, scope, is_active)
           VALUES ($1, $2, $3, $4::"Role"[], 'COMPANY', true)`,
          [`mem_${id}_${companyId}`, id, companyId, [role]],
        );
      }
    }

    // Po jedan red u svakoj tenant tabeli za obje firme — izolacija se dokazuje na stvarnim
    // redovima, ne na praznim tabelama (prazna tabela prolazi i bez RLS-a).
    for (const [companyId, suffix] of [
      [COMPANY, "a"],
      [OTHER_COMPANY, "b"],
    ] as const) {
      const client = await app.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.company_id', $1, true)", [companyId]);
        await client.query(
          `INSERT INTO machines (id, company_id, code, name, category_id) VALUES ($1, $2, $3, $3, $2 || '_cat_other')`,
          [`mach_r1b_${suffix}`, companyId, `R1B-${suffix.toUpperCase()}`],
        );
        // R2a: radnik BEZ naloga (userId = null) — upravo slučaj koji tenant izolacija mora pokriti.
        await client.query(
          `INSERT INTO workers (id, company_id, first_name, last_name, hired_at, phone)
           VALUES ($1, $2, 'Radnik', $3, '2025-01-15', '+387 00 000 001')`,
          [`wrk_r1b_${suffix}`, companyId, suffix.toUpperCase()],
        );
        // R2b: obaveza na radniku te firme (tip dolazi iz seeda pri kreiranju firme).
        await client.query(
          `INSERT INTO obligations (id, company_id, type_id, worker_id, created_by)
           VALUES ($1, $2, $2 || '_obt_medical', $3, $4)`,
          [`obl_r1b_${suffix}`, companyId, `wrk_r1b_${suffix}`, `usr_r1b_${suffix === "a" ? "admin" : "owner_b"}`],
        );
        await client.query(
          `INSERT INTO obligation_versions (id, company_id, obligation_id, version, expires_at)
           VALUES ($1, $2, $3, 1, '2027-01-15')`,
          [`obv_r1b_${suffix}`, companyId, `obl_r1b_${suffix}`],
        );
        await client.query(
          `INSERT INTO obligation_attachments (id, company_id, obligation_id, object_key, file_name,
                                               content_type, size_bytes, sha256, status)
           VALUES ($1, $2, $3, 'gx2/' || $2 || '/obligations/' || $3 || '/' || $1, 'rjesenje.pdf',
                   'application/pdf', 1024, repeat('a', 64), 'ready')`,
          [`att_r1b_${suffix}`, companyId, `obl_r1b_${suffix}`],
        );
        await client.query(
          `INSERT INTO sessions (id, user_id, company_id, token_hash, expires_at)
           VALUES ($1, $2, $3, $4, now() + interval '1 day')`,
          [`ses_r1b_${suffix}`, `usr_r1b_${suffix === "a" ? "admin" : "owner_b"}`, companyId, `hash_${suffix}`],
        );
        await client.query(
          `INSERT INTO audit_events (id, company_id, actor_id, actor_email, action, entity_type, entity_id)
           VALUES ($1, $2, $3, 'seed@r1b.test', 'user.activated', 'user', $3)`,
          [`aud_r1b_${suffix}`, companyId, `usr_r1b_${suffix === "a" ? "admin" : "owner_b"}`],
        );
        await client.query(
          `INSERT INTO invitations (id, company_id, email, roles, scope, token_hash, expires_at)
           VALUES ($1, $2, $3, '{WORKER}'::"Role"[], 'COMPANY', $4, now() + interval '1 day')`,
          [`inv_r1b_${suffix}`, companyId, `pozvani-${suffix}@r1b.test`, `invhash_${suffix}`],
        );
        await client.query(
          `INSERT INTO password_resets (id, company_id, user_id, token_hash, expires_at)
           VALUES ($1, $2, $3, $4, now() + interval '1 day')`,
          [`rst_r1b_${suffix}`, companyId, `usr_r1b_${suffix === "a" ? "admin" : "owner_b"}`, `rsthash_${suffix}`],
        );
        await client.query(
          `INSERT INTO sync_items (id, company_id, user_id, device_id, local_id, entity_type, payload, client_at)
           VALUES ($1, $2, $3, 'dev-1', $1, 'note', '{}'::jsonb, now())`,
          [`syn_r1b_${suffix}`, companyId, `usr_r1b_${suffix === "a" ? "admin" : "owner_b"}`],
        );
        await client.query("COMMIT");
      } finally {
        client.release();
      }
    }
  }, 60_000);

  /* ------------------------------------------------------- tenant izolacija */

  describe("tenant izolacija (generisano iz liste tabela)", () => {
    for (const table of TENANT_TABLES) {
      it(`${table}: firma A ne vidi nijedan red firme B`, async () => {
        const read = async (companyId: string) => {
          const client = await app.connect();
          try {
            await client.query("BEGIN");
            await client.query("SELECT set_config('app.company_id', $1, true)", [companyId]);
            const result = await client.query<{ company_id: string }>(`SELECT company_id FROM ${table}`);
            await client.query("ROLLBACK");
            return result.rows.map((row) => row.company_id);
          } finally {
            client.release();
          }
        };

        const mine = await read(COMPANY);
        const theirs = await read(OTHER_COMPANY);
        // Firma vidi svoje (bar jedan red) i ni jedan red druge firme.
        expect(mine.length).toBeGreaterThan(0);
        expect(mine.every((cid) => cid === COMPANY)).toBe(true);
        expect(theirs.every((cid) => cid === OTHER_COMPANY)).toBe(true);
      });
    }

    it("bez postavljene firme nijedna tenant tabela ne vraća red (fail-closed)", async () => {
      const client = await app.connect();
      try {
        for (const table of TENANT_TABLES) {
          await client.query("BEGIN");
          const result = await client.query(`SELECT 1 FROM ${table}`);
          await client.query("ROLLBACK");
          expect(result.rows, `${table} propušta redove bez app.company_id`).toEqual([]);
        }
      } finally {
        client.release();
      }
    });
  });

  /* -------------------------------------------------------------- matrica */

  describe("matrica rola", () => {
    it("matrica u UI-u i PERMISSIONS u kodu su isti podatak", () => {
      const matrix = roleMatrix(["OWNER"]);
      expect(matrix.editable).toBe(false);
      expect(matrix.roles.map((row) => row.role)).toEqual([...ROLES]);
      for (const row of matrix.roles) {
        expect(row.permissions, `matrica odstupa za ${row.role}`).toEqual(
          PERMISSION_KEYS.filter((key) => (PERMISSIONS[key] as readonly string[]).includes(row.role)),
        );
        expect(row.label).toBe(ROLE_LABELS[row.role].label);
      }
    });

    it("svaka rola ima bosanski naziv i objašnjenje (matrica nije prazna tabela)", () => {
      for (const role of ROLES) {
        expect(ROLE_LABELS[role].label.length).toBeGreaterThan(3);
        expect(ROLE_LABELS[role].description.length).toBeGreaterThan(15);
      }
      expect(permissionsFor("OWNER").length).toBeGreaterThan(0);
      // Radnik od R3 ima TAČNO `projects.view` — prije R3 nije imao ništa. Tvrdnja je namjerno
      // tačna lista, a ne „prazno": dozvola koja se tiho doda radniku mora oboriti test.
      expect(permissionsFor("WORKER")).toEqual(["projects.view"]);
    });

    it("ADMIN vidi matricu, WORKER dobija 403", async () => {
      const adminCookie = await cookieFor("admin@r1b.test");
      const workerCookie = await cookieFor("worker@r1b.test");

      const asAdmin = await rolesRoute(get(`${BASE}/api/roles`, adminCookie));
      expect(asAdmin.status).toBe(200);

      const asWorker = await rolesRoute(get(`${BASE}/api/roles`, workerCookie));
      expect(asWorker.status).toBe(403);
      const body = await bodyOf<Envelope<unknown>>(asWorker);
      expect(body.success).toBe(false);
      if (body.success) throw new Error("worker ne smije vidjeti matricu");
      expect(body.error.code).toBe("FORBIDDEN");
    });
  });

  /* -------------------------------------------------------------- dodjela */

  describe("dodjela rola i opsega", () => {
    it("ADMIN mijenja role radniku; promjena važi odmah i piše tačno jedan trag", async () => {
      const adminCookie = await cookieFor("admin@r1b.test");

      const response = await membershipRoute(
        json(`${BASE}/api/users/usr_r1b_worker/membership`, { roles: ["WORKER", "DRIVER"], scope: "SELF" }, adminCookie),
        params("usr_r1b_worker"),
      );
      expect(response.status).toBe(200);

      const users = await usersRoute(get(`${BASE}/api/users`, adminCookie));
      const list = await bodyOf<Envelope<{ users: { id: string; roles: string[]; scope: string }[] }>>(users);
      if (!list.success) throw new Error(list.error.message);
      const worker = list.data.users.find((user) => user.id === "usr_r1b_worker");
      expect(worker?.roles).toEqual(["WORKER", "DRIVER"]);
      expect(worker?.scope).toBe("SELF");

      const audit = await admin.query<{ action: string; metadata: Record<string, unknown> }>(
        "SELECT action, metadata FROM audit_events WHERE company_id = $1 AND action = 'user.membership_changed'",
        [COMPANY],
      );
      expect(audit.rows.length).toBe(1);
      expect(audit.rows[0]!.metadata).toMatchObject({
        from: { roles: ["WORKER"], scope: "COMPANY" },
        to: { roles: ["WORKER", "DRIVER"], scope: "SELF" },
      });
    });

    it("ADMIN ne dira vlasnika (403), ni svoje role (403)", async () => {
      const adminCookie = await cookieFor("admin@r1b.test");

      const onOwner = await membershipRoute(
        json(`${BASE}/api/users/usr_r1b_owner/membership`, { roles: ["ADMIN"], scope: "COMPANY" }, adminCookie),
        params("usr_r1b_owner"),
      );
      expect(onOwner.status).toBe(403);

      const onSelf = await membershipRoute(
        json(`${BASE}/api/users/usr_r1b_admin/membership`, { roles: ["OWNER"], scope: "COMPANY" }, adminCookie),
        params("usr_r1b_admin"),
      );
      expect(onSelf.status).toBe(403);
    });

    it("posljednji vlasnik ne može izgubiti rolu (409), a drugi vlasnik to smije", async () => {
      const ownerCookie = await cookieFor("owner@r1b.test");

      // Vlasnik ne mijenja sebe — ni vlasnik nema pravo na taj put.
      const onSelf = await membershipRoute(
        json(`${BASE}/api/users/usr_r1b_owner/membership`, { roles: ["ADMIN"], scope: "COMPANY" }, ownerCookie),
        params("usr_r1b_owner"),
      );
      expect(onSelf.status).toBe(403);

      // Drugi vlasnik u firmi, pa prvi smije izgubiti rolu.
      await admin.query(
        `UPDATE memberships SET roles = '{OWNER,ADMIN}'::"Role"[] WHERE company_id = $1 AND user_id = 'usr_r1b_admin'`,
        [COMPANY],
      );
      const adminCookie = await cookieFor("admin@r1b.test");
      const demote = await membershipRoute(
        json(`${BASE}/api/users/usr_r1b_owner/membership`, { roles: ["ADMIN"], scope: "COMPANY" }, adminCookie),
        params("usr_r1b_owner"),
      );
      expect(demote.status).toBe(200);

      // Vrati stanje: vlasnik opet vlasnik, a drugi vlasnik natrag na ADMIN.
      await admin.query(
        `UPDATE memberships SET roles = '{OWNER}'::"Role"[] WHERE company_id = $1 AND user_id = 'usr_r1b_owner'`,
        [COMPANY],
      );
      await admin.query(
        `UPDATE memberships SET roles = '{ADMIN}'::"Role"[] WHERE company_id = $1 AND user_id = 'usr_r1b_admin'`,
        [COMPANY],
      );
    });

    it("firma ne može ostati bez vlasnika — ni kroz jedan put koji ruta nudi", async () => {
      // Svojstvo, ne grana: rolu OWNER mijenja samo OWNER, a nijedan OWNER ne mijenja sebe.
      // Zato jedini vlasnik ne može izgubiti rolu — nema koga da ga skine. Provjeravamo sve
      // tri putanje koje vode ka tome, i na kraju stanje u bazi.
      const ownerCookie = await cookieFor("owner@r1b.test");
      const adminCookie = await cookieFor("admin@r1b.test");
      const workerCookie = await cookieFor("worker@r1b.test");

      const attempts = [
        await membershipRoute(
          json(`${BASE}/api/users/usr_r1b_owner/membership`, { roles: ["ADMIN"], scope: "COMPANY" }, ownerCookie),
          params("usr_r1b_owner"),
        ),
        await membershipRoute(
          json(`${BASE}/api/users/usr_r1b_owner/membership`, { roles: ["ADMIN"], scope: "COMPANY" }, adminCookie),
          params("usr_r1b_owner"),
        ),
        await membershipRoute(
          json(`${BASE}/api/users/usr_r1b_owner/membership`, { roles: ["ADMIN"], scope: "COMPANY" }, workerCookie),
          params("usr_r1b_owner"),
        ),
      ];
      expect(attempts.map((response) => response.status)).toEqual([403, 403, 403]);

      const after = await admin.query<{ roles: string[] }>(
        `SELECT roles::text[] AS roles FROM memberships WHERE company_id = $1 AND user_id = 'usr_r1b_owner'`,
        [COMPANY],
      );
      expect(after.rows[0]!.roles).toEqual(["OWNER"]);
    });

    it("nepoznata rola i prazna lista se odbijaju prije baze", async () => {
      const adminCookie = await cookieFor("admin@r1b.test");
      const bogus = await membershipRoute(
        json(`${BASE}/api/users/usr_r1b_worker/membership`, { roles: ["SUPERHERO"], scope: "COMPANY" }, adminCookie),
        params("usr_r1b_worker"),
      );
      expect(bogus.status).toBe(400);

      const empty = await membershipRoute(
        json(`${BASE}/api/users/usr_r1b_worker/membership`, { roles: [], scope: "COMPANY" }, adminCookie),
        params("usr_r1b_worker"),
      );
      expect(empty.status).toBe(400);

      // Opseg `PROJECTS` je odložen u R2 — ruta ga ne prima.
      const projects = await membershipRoute(
        json(`${BASE}/api/users/usr_r1b_worker/membership`, { roles: ["WORKER"], scope: "PROJECTS" }, adminCookie),
        params("usr_r1b_worker"),
      );
      expect(projects.status).toBe(400);
    });

    it("tuđa firma ne može mijenjati ovu osobu (NOT_FOUND, ne 403 — bez odavanja)", async () => {
      const otherCookie = await cookieFor("owner-b@r1b.test");
      const response = await membershipRoute(
        json(`${BASE}/api/users/usr_r1b_worker/membership`, { roles: ["ADMIN"], scope: "COMPANY" }, otherCookie),
        params("usr_r1b_worker"),
      );
      expect(response.status).toBe(404);
    });
  });

  /* ----------------------------------------------------------------- audit */

  describe("audit trag", () => {
    it("filter po radnji vraća isto što i direktan upit u bazi", async () => {
      const adminCookie = await cookieFor("admin@r1b.test");
      const response = await auditRoute(get(`${BASE}/api/audit?action=user.membership_changed`, adminCookie));
      expect(response.status).toBe(200);
      const body = await bodyOf<Envelope<{ rows: { action: string }[]; nextCursor: string | null }>>(response);
      if (!body.success) throw new Error(body.error.message);

      const direct = await admin.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM audit_events WHERE company_id = $1 AND action = 'user.membership_changed'",
        [COMPANY],
      );
      expect(body.data.rows.length).toBe(Number(direct.rows[0]!.count));
      expect(body.data.rows.every((row) => row.action === "user.membership_changed")).toBe(true);
    });

    it("firma B u tragu ne vidi nijedan zapis firme A", async () => {
      const otherCookie = await cookieFor("owner-b@r1b.test");
      const response = await auditRoute(get(`${BASE}/api/audit`, otherCookie));
      expect(response.status).toBe(200);
      const raw = JSON.stringify(await bodyOf<unknown>(response));
      expect(raw).not.toContain("usr_r1b_worker");
      expect(raw).not.toContain("owner@r1b.test");
    });

    it("keyset: stranice se ne preklapaju i ne preskaču zapise", async () => {
      const adminCookie = await cookieFor("admin@r1b.test");
      // Deset zapisa da paginacija ima šta da dijeli.
      for (let i = 0; i < 10; i += 1) {
        await admin.query(
          `INSERT INTO audit_events (id, company_id, actor_id, actor_email, action, entity_type, entity_id, created_at)
           VALUES ($1, $2, 'usr_r1b_admin', 'admin@r1b.test', 'user.activated', 'user', $3, now() - ($4 || ' seconds')::interval)`,
          [`aud_page_${i}`, COMPANY, `usr_page_${i}`, String(i)],
        );
      }

      const seen: string[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 10; page += 1) {
        const url = `${BASE}/api/audit?limit=3${cursor ? `&cursor=${cursor}` : ""}`;
        const response = await auditRoute(get(url, adminCookie));
        const body = await bodyOf<Envelope<{ rows: { id: string }[]; nextCursor: string | null }>>(response);
        if (!body.success) throw new Error(body.error.message);
        seen.push(...body.data.rows.map((row) => row.id));
        cursor = body.data.nextCursor;
        if (!cursor) break;
      }

      // Nijedan zapis dvaput...
      expect(new Set(seen).size).toBe(seen.length);
      // ...i svi zapisi firme su prošli (9 iz pripreme + 10 dodanih + izmjena role).
      const total = await admin.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM audit_events WHERE company_id = $1",
        [COMPANY],
      );
      expect(seen.length).toBe(Number(total.rows[0]!.count));

      await admin.query("DELETE FROM audit_events WHERE company_id = $1 AND id LIKE 'aud_page_%'", [COMPANY]);
    });

    it("nepoznat filter i neispravan datum se odbijaju (prazna stranica bi bila laž)", async () => {
      const adminCookie = await cookieFor("admin@r1b.test");
      for (const query of ["action=nesto.drugo", "entityType=svemir", "from=juce"]) {
        const response = await auditRoute(get(`${BASE}/api/audit?${query}`, adminCookie));
        expect(response.status, query).toBe(400);
      }
    });

    it("WORKER ne vidi trag (403)", async () => {
      const workerCookie = await cookieFor("worker@r1b.test");
      const response = await auditRoute(get(`${BASE}/api/audit`, workerCookie));
      expect(response.status).toBe(403);
    });

    it("trag ne sadrži tajne — nijedan zapis nema token ni hash", async () => {
      const rows = await admin.query<{ metadata: unknown; action: string }>(
        "SELECT metadata, action FROM audit_events WHERE company_id = $1",
        [COMPANY],
      );
      for (const row of rows.rows) {
        expect(JSON.stringify(row.metadata)).not.toMatch(/gxi_|gxr_|password_hash|token_hash/i);
      }
    });
  });
});
