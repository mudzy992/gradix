/**
 * Dio 1a: administratorska naredba `scripts/demo-sukobi.ts` pravi NOVE demo
 * sukobe samo u demo firmi. Na firmi koja nije demo mora odbiti prije
 * ikakvog upisa (dokaz: broj sukoba u drugoj firmi se ne mijenja).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDemoConflicts } from "../../scripts/demo-sukobi";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = adminUrl ? describe : describe.skip;

describeDb("demo-sukobi naredba (Dio 1a)", () => {
  const admin = new Pool({ connectionString: adminUrl, max: 2 });

  beforeAll(async () => {
    // Demo firma i povezani radnici dolaze iz seeda (idempotentan).
    const run = promisify(execFile);
    const webDir = fileURLToPath(new URL("../..", import.meta.url));
    await run(process.execPath, ["--import", "tsx", "scripts/seed.ts"], {
      cwd: webDir,
      env: { ...process.env, DATABASE_ADMIN_URL: adminUrl, SEED_PASSWORD: "seed-test-lozinka-123" },
      timeout: 120_000,
    });
  }, 180_000);

  afterAll(async () => {
    await admin.end();
  });

  it("odbija firmu koja nije demo i ništa ne upisuje", async () => {
    const before = await admin.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM public.sync_conflicts WHERE company_id = 'cmp_druga'",
    );
    await expect(createDemoConflicts(admin, "druga-firma")).rejects.toThrow(/samo za demo firmu/);
    const after = await admin.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM public.sync_conflicts WHERE company_id = 'cmp_druga'",
    );
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });

  it("u demo firmi pravi 3 nova sukoba (preklopljen, sat, stariji od praga)", async () => {
    const { created } = await createDemoConflicts(admin);
    expect(created).toHaveLength(3);
    const rows = await admin.query<{ id: string; payload: Record<string, unknown>; age_days: number }>(
      `SELECT id, received_payload AS payload,
              EXTRACT(EPOCH FROM (clock_timestamp() - created_at)) / 86400 AS age_days
         FROM public.sync_conflicts WHERE id = ANY($1) ORDER BY id`,
      [created],
    );
    expect(rows.rows).toHaveLength(3);
    const skew = rows.rows.filter((row) => typeof row.payload.deviceClockSkewMinutes === "number");
    expect(skew).toHaveLength(1);
    expect(Math.max(...rows.rows.map((row) => Number(row.age_days)))).toBeGreaterThan(3);
    // Postojeći sukobi se ne diraju: ukupan broj je porastao tačno za 3 nove.
    const total = await admin.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM public.sync_conflicts WHERE company_id = 'cmp_demo' AND id = ANY($1)",
      [created],
    );
    expect(total.rows[0]?.n).toBe("3");
  });
});
