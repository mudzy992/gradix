import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyId, withCompany } from "./tenant.js";

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
