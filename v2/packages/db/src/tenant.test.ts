import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyId, withCompany } from "./tenant";

/**
 * RLS spike (Faza 1, korak 5). Testira PONAŠANJE BAZE, ne aplikacije:
 * ako RLS ne radi, ovi testovi padaju i tada se odluka mijenja (ADR 0003).
 *
 * Traži pravu PostgreSQL bazu sa primijenjenom migracijom `20261107120000_init`.
 * Pokretanje: DATABASE_URL=... pnpm --filter @gradix/db test
 */

const connectionString = process.env.DATABASE_URL;
const describeDb = connectionString ? describe : describe.skip;

const COMPANY_A = "cmp_spike_a";
const COMPANY_B = "cmp_spike_b";

describeDb("tenant izolacija (RLS na pravoj bazi)", () => {
  // Namjerno mali pool: test mora dokazati da scope preživljava PONOVNU UPOTREBU konekcije.
  const pool = new Pool({ connectionString, max: 2 });

  beforeAll(async () => {
    // `companies` nije tenant tabela (nema RLS) — briše se i piše direktno.
    await pool.query("DELETE FROM companies WHERE id = ANY($1)", [[COMPANY_A, COMPANY_B]]);
    await pool.query(
      "INSERT INTO companies (id, name, slug) VALUES ($1, 'Spike A', 'spike-a'), ($2, 'Spike B', 'spike-b')",
      [COMPANY_A, COMPANY_B],
    );

    // Tenant tabele: i priprema ide kroz scope. Ako ovo padne, RLS radi (fail-closed).
    for (const [id, machineId, code, name] of [
      [COMPANY_A, "m_a1", "BAG-01", "Bager A"],
      [COMPANY_B, "m_b1", "BAG-02", "Bager B"],
    ] as const) {
      await withCompany(pool, companyId(id), async (client) => {
        await client.query("DELETE FROM machines WHERE id = $1", [machineId]);
        await client.query(
          "INSERT INTO machines (id, company_id, code, name) VALUES ($1, $2, $3, $4)",
          [machineId, id, code, name],
        );
      });
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it("firma A vidi samo svoje mašine", async () => {
    const rows = await withCompany(pool, companyId(COMPANY_A), async (client) => {
      const result = await client.query<{ id: string }>("SELECT id FROM machines ORDER BY id");
      return result.rows.map((row) => row.id);
    });
    expect(rows).toEqual(["m_a1"]);
  });

  it("firma B vidi samo svoje mašine", async () => {
    const rows = await withCompany(pool, companyId(COMPANY_B), async (client) => {
      const result = await client.query<{ id: string }>("SELECT id FROM machines ORDER BY id");
      return result.rows.map((row) => row.id);
    });
    expect(rows).toEqual(["m_b1"]);
  });

  it("scope preživljava ponovnu upotrebu iste konekcije (pool max=2, 20 uzastopnih poziva)", async () => {
    const seen: string[][] = [];
    for (let i = 0; i < 20; i += 1) {
      const id = i % 2 === 0 ? COMPANY_A : COMPANY_B;
      const rows = await withCompany(pool, companyId(id), async (client) => {
        const result = await client.query<{ company_id: string }>("SELECT company_id FROM machines");
        return result.rows.map((row) => row.company_id);
      });
      seen.push(rows);
    }
    expect(seen.every((rows, i) => rows.every((cid) => cid === (i % 2 === 0 ? COMPANY_A : COMPANY_B)))).toBe(true);
  });

  it("bez postavljene varijable ne vidi se ništa (fail-closed)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query("SELECT id FROM machines");
      await client.query("ROLLBACK");
      expect(result.rows).toEqual([]);
    } finally {
      client.release();
    }
  });

  it("lookup politika: bez ključa ništa, sa ključem samo taj korisnik", async () => {
    // Priprema: dva korisnika u dvije firme. `users` nije tenant tabela.
    await withCompany(pool, companyId(COMPANY_A), async (client) => {
      await client.query("INSERT INTO users (id, email, password_hash, first_name, last_name) VALUES ('u_lk_a', 'lk-a@test.example', 'x', 'A', 'A') ON CONFLICT DO NOTHING");
      await client.query(
        `INSERT INTO memberships (id, user_id, company_id, roles)
         VALUES ('mem_lk_a', 'u_lk_a', $1, ARRAY['ADMIN']::"Role"[]) ON CONFLICT DO NOTHING`,
        [COMPANY_A],
      );
    });
    await withCompany(pool, companyId(COMPANY_B), async (client) => {
      await client.query("INSERT INTO users (id, email, password_hash, first_name, last_name) VALUES ('u_lk_b', 'lk-b@test.example', 'x', 'B', 'B') ON CONFLICT DO NOTHING");
      await client.query(
        `INSERT INTO memberships (id, user_id, company_id, roles)
         VALUES ('mem_lk_b', 'u_lk_b', $1, ARRAY['ADMIN']::"Role"[]) ON CONFLICT DO NOTHING`,
        [COMPANY_B],
      );
    });

    const client = await pool.connect();
    try {
      // 1) Bez ključa: funkcija ne vidi nijedno članstvo (fail-closed).
      await client.query("BEGIN");
      const none = await client.query("SELECT company_id FROM auth_memberships('u_lk_a')");
      await client.query("ROLLBACK");
      expect(none.rows).toEqual([]);

      // 2) Sa ključem za korisnika A: vidi svoje, ne vidi tuđe.
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.auth_lookup_user', 'u_lk_a', true)");
      const mine = await client.query<{ company_id: string }>("SELECT company_id FROM auth_memberships('u_lk_a') ORDER BY 1");
      const others = await client.query<{ company_id: string }>("SELECT company_id FROM auth_memberships('u_lk_b') ORDER BY 1");
      const direct = await client.query<{ id: string }>("SELECT id FROM memberships ORDER BY id");
      await client.query("ROLLBACK");

      expect(mine.rows.map((r) => r.company_id)).toEqual([COMPANY_A]);
      // Ključ za A ne otvara članstva korisnika B...
      expect(others.rows).toEqual([]);
      // ...a direktan upit bez scope-a ne vidi cijelu tabelu.
      expect(direct.rows.map((r) => r.id)).toEqual(["mem_lk_a"]);

      // 3) Ključ se ne lijepi na sljedeću transakciju na istoj konekciji.
      await client.query("BEGIN");
      const after = await client.query("SELECT company_id FROM auth_memberships('u_lk_a')");
      await client.query("ROLLBACK");
      expect(after.rows).toEqual([]);
    } finally {
      client.release();
    }
  });

  it("lookup politika na `sessions`: samo po tačnom hashu tokena", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.auth_lookup_token', 'hash_abc', true)");
      // Sesija sa tim hashom nije upisana kroz tenant scope, pa je ovdje nema — bitno je
      // da politika ne propušta redove po bilo kojem drugom kriteriju.
      const wide = await client.query("SELECT id FROM sessions");
      await client.query("ROLLBACK");
      expect(wide.rows).toEqual([]);
    } finally {
      client.release();
    }
  });

  it("upis u tuđu firmu je odbijen (WITH CHECK)", async () => {
    await expect(
      withCompany(pool, companyId(COMPANY_A), async (client) => {
        await client.query("INSERT INTO machines (id, company_id, code, name) VALUES ('m_x', $1, 'X', 'X')", [
          COMPANY_B,
        ]);
      }),
    ).rejects.toThrow(/row-level security/i);
  });

  it("upit bez WHERE ne procuri tuđe redove ni kroz aggregate", async () => {
    const result = await withCompany(pool, companyId(COMPANY_A), async (client) => {
      const res = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM machines");
      return res.rows[0]?.count;
    });
    expect(result).toBe("1");
  });

  it("paralelni zahtjevi dvije firme ne miješaju podatke", async () => {
    const jobs = Array.from({ length: 10 }, (_, i) =>
      withCompany(pool, companyId(i % 2 === 0 ? COMPANY_A : COMPANY_B), async (client) => {
        const res = await client.query<{ company_id: string }>("SELECT company_id FROM machines");
        // Držimo transakciju otvorenom dok druga strana radi isti upit.
        await new Promise((resolve) => setTimeout(resolve, 5));
        return res.rows.map((row) => row.company_id);
      }),
    );
    const results = await Promise.all(jobs);
    expect(
      results.every((rows, i) => rows.every((cid) => cid === (i % 2 === 0 ? COMPANY_A : COMPANY_B))),
    ).toBe(true);
  });

  it("nakon greške u transakciji stanje se ne lijepi na sljedeći zahtjev", async () => {
    await expect(
      withCompany(pool, companyId(COMPANY_A), async (client) => {
        await client.query("SELECT 1/0");
      }),
    ).rejects.toThrow(/division by zero/i);

    const rows = await withCompany(pool, companyId(COMPANY_A), async (client) => {
      const res = await client.query<{ id: string }>("SELECT id FROM machines");
      return res.rows.map((row) => row.id);
    });
    expect(rows).toEqual(["m_a1"]);

    // Rola vlasnika u ovom spike-u zaobilazi RLS samo van transakcije bez varijable;
    // provjeravamo da je varijabla opet prazna (fail-closed za sljedećeg korisnika).
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      expect(await client.query("SELECT id FROM machines")).toMatchObject({ rows: [] });
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });
});
