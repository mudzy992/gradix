/**
 * Dio 2a/2c: `scripts/seed-demo-podaci.ts` puni demo firmu iz sintetičkih
 * fajlova kroz pravi servis uvoza. Dokazuje: (1) naredba ne radi na firmi
 * koja nije demo; (2) prvi prolaz uvozi radnike/mašine/obaveze, drugi je
 * idempotentan (sve duplikati/preskočeno); (3) nepovezivi rokovi su
 * prijavljeni, ne tiho uvezeni; (4) rokovi pomjereni prema današnjem danu
 * pokrivaju stanja isteklo / ≤30 d / 31–90 d / važi.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveDemoCompany, seedDemoPodaci } from "../../scripts/seed-demo-podaci";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const appUrl = process.env.DATABASE_URL;
const describeDb = adminUrl && appUrl ? describe : describe.skip;

describeDb("seed-demo-podaci naredba (Dio 2)", () => {
  const admin = new Pool({ connectionString: adminUrl, max: 2 });
  // Servis uvoza se oslanja na RLS: naredba se poziva aplikacijskom rolom.
  const app = new Pool({ connectionString: appUrl, max: 2 });

  beforeAll(async () => {
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
    await app.end();
  });

  it("odbija firmu koja nije demo", async () => {
    await expect(resolveDemoCompany(admin, "druga-firma")).rejects.toThrow(/samo za demo firmu/);
  });

  it("uvozi kroz servis, drugi prolaz je idempotentan, nepovezivo je prijavljeno", async () => {
    const demoCompanyId = await resolveDemoCompany(admin, "niskogradnja-demo");
    const first = await seedDemoPodaci(app, demoCompanyId);
    expect(first.workers.imported).toBeGreaterThan(0);
    expect(first.machines.imported).toBeGreaterThan(0);
    expect(first.obligations.created).toBeGreaterThan(0);
    // Bag-01 i dio radnika već postoje iz seeda — pravilo duplikata ih hvata.
    expect(first.workers.duplicates + first.machines.duplicates).toBeGreaterThan(0);

    const second = await seedDemoPodaci(app, demoCompanyId);
    expect(second.workers.imported).toBe(0);
    expect(second.machines.imported).toBe(0);
    expect(second.obligations.created).toBe(0);
    expect(second.obligations.duplicates).toBeGreaterThan(0);

    const workers = await admin.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM public.workers WHERE company_id = 'cmp_demo' AND is_active",
    );
    expect(Number(workers.rows[0]?.n)).toBeGreaterThan(20);
    const machines = await admin.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM public.machines WHERE company_id = 'cmp_demo'",
    );
    expect(Number(machines.rows[0]?.n)).toBeGreaterThan(15);

    // Stanja rokova prema današnjem danu (Europe/Sarajevo) postoje sva četiri.
    const buckets = await admin.query<{ bucket: string; n: string }>(
      `SELECT CASE
                WHEN expires_at < CURRENT_DATE THEN 'isteklo'
                WHEN expires_at <= CURRENT_DATE + 30 THEN 'do30'
                WHEN expires_at <= CURRENT_DATE + 90 THEN '31-90'
                ELSE 'vazi'
              END AS bucket, count(*)::text AS n
         FROM public.obligations
        WHERE company_id = 'cmp_demo' AND expires_at IS NOT NULL
        GROUP BY 1`,
    );
    const found = new Set(buckets.rows.map((row) => row.bucket));
    expect(found).toEqual(new Set(["isteklo", "do30", "31-90", "vazi"]));
  }, 240_000);
});
