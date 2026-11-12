/**
 * Dio 1 (izolacija uvoza): servis uvoza NE smije zavisiti od RLS-a.
 * Test pokreće previewImport/applyImport ADMINISTRATORSKOM rolom
 * (DATABASE_ADMIN_URL, koja zaobilazi RLS) za demo firmu i dokazuje:
 *  - pregled ne vidi radnike/mašine druge firme (isti naziv/oznaka u drugoj
 *    firmi nije duplikat ni preskočeno u demo firmi),
 *  - primjena upisuje samo u demo firmu; druga firma ostaje netaknuta.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyId } from "@gradix/db";
import type { ParsedSheet } from "./import-parser";
import { applyImport, previewImport, suggestMapping } from "./import-service";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = adminUrl ? describe : describe.skip;

const STAMP = Date.now().toString(36);
const WORKER_NAME = `Izo${STAMP} Testić`;
const MACHINE_CODE = `IZO-${STAMP}`.toUpperCase().slice(0, 20);

function sheet(headers: string[], cellsList: Record<string, string>[]): ParsedSheet {
  return {
    headers,
    sheetName: "test",
    ignoredSheets: 0,
    rows: cellsList.map((cells, index) => ({ rowNumber: index + 2, cells })),
  };
}

describeDb("uvoz pod admin rolom ne vidi i ne dira drugu firmu (Dio 1)", () => {
  const admin = new Pool({ connectionString: adminUrl, max: 2 });
  const demo = companyId("cmp_demo");

  beforeAll(async () => {
    const run = promisify(execFile);
    const webDir = fileURLToPath(new URL("../..", import.meta.url));
    await run(process.execPath, ["--import", "tsx", "scripts/seed.ts"], {
      cwd: webDir,
      env: { ...process.env, DATABASE_ADMIN_URL: adminUrl, SEED_PASSWORD: "seed-test-lozinka-123" },
      timeout: 120_000,
    });
    // Meta u DRUGOJ firmi: isti naziv radnika i ista oznaka mašine.
    const [first, ...rest] = WORKER_NAME.split(" ");
    await admin.query(
      `INSERT INTO public.workers (id, company_id, first_name, last_name, hired_at)
       VALUES ($1, 'cmp_druga', $2, $3, '2024-01-01') ON CONFLICT DO NOTHING`,
      [`wrk_izo_${STAMP}`, first, rest.join(" ")],
    );
    await admin.query(
      `INSERT INTO public.machines (id, company_id, code, name, category_id)
       VALUES ($1, 'cmp_druga', $2, 'Mašina druge firme', 'cmp_druga_cat_excavator')
       ON CONFLICT DO NOTHING`,
      [`mch_izo_${STAMP}`, MACHINE_CODE],
    );
  }, 180_000);

  afterAll(async () => {
    await admin.query("DELETE FROM public.workers WHERE id = $1", [`wrk_izo_${STAMP}`]);
    await admin.query("DELETE FROM public.machines WHERE id = $1", [`mch_izo_${STAMP}`]);
    await admin.query("DELETE FROM public.workers WHERE company_id = 'cmp_demo' AND first_name = $1", [WORKER_NAME.split(" ")[0]]);
    await admin.query("DELETE FROM public.machines WHERE company_id = 'cmp_demo' AND code = $1", [MACHINE_CODE]);
    await admin.end();
  });

  it("pregled za demo firmu ne vidi drugu firmu (bez lažnih duplikata)", async () => {
    const [first, ...rest] = WORKER_NAME.split(" ");
    const workersSheet = sheet(
      ["Ime", "Prezime", "Datum početka"],
      [{ Ime: first!, Prezime: rest.join(" "), "Datum početka": "2024-01-15" }],
    );
    const workersPreview = await previewImport(
      admin, demo, "workers", workersSheet, suggestMapping("workers", workersSheet.headers),
    );
    if ("code" in workersPreview) throw new Error(workersPreview.message);
    expect(workersPreview.rows[0]?.outcome).toBe("import");

    const equipmentSheet = sheet(
      ["Inventarska oznaka", "Naziv", "Kategorija"],
      [{ "Inventarska oznaka": MACHINE_CODE, Naziv: "Testna mašina", Kategorija: "Bager" }],
    );
    const equipmentPreview = await previewImport(
      admin, demo, "equipment", equipmentSheet, suggestMapping("equipment", equipmentSheet.headers),
    );
    if ("code" in equipmentPreview) throw new Error(equipmentPreview.message);
    expect(equipmentPreview.rows[0]?.outcome).toBe("import");
  });

  it("primjena upisuje samo u demo firmu; druga firma netaknuta", async () => {
    const [first, ...rest] = WORKER_NAME.split(" ");
    const workersSheet = sheet(
      ["Ime", "Prezime", "Datum početka"],
      [{ Ime: first!, Prezime: rest.join(" "), "Datum početka": "2024-01-15" }],
    );
    const appliedWorkers = await applyImport(
      admin, demo, { userId: "usr_vlasnik", roles: ["OWNER"] }, "workers",
      workersSheet, suggestMapping("workers", workersSheet.headers),
      [{ rowNumber: 2, action: "import" }], "izolacija-test.xlsx",
    );
    if ("code" in appliedWorkers) throw new Error(appliedWorkers.message);
    expect(appliedWorkers.imported).toBe(1);

    const equipmentSheet = sheet(
      ["Inventarska oznaka", "Naziv", "Kategorija"],
      [{ "Inventarska oznaka": MACHINE_CODE, Naziv: "Testna mašina", Kategorija: "Bager" }],
    );
    const appliedEquipment = await applyImport(
      admin, demo, { userId: "usr_vlasnik", roles: ["OWNER"] }, "equipment",
      equipmentSheet, suggestMapping("equipment", equipmentSheet.headers),
      [{ rowNumber: 2, action: "import" }], "izolacija-test.xlsx",
    );
    if ("code" in appliedEquipment) throw new Error(appliedEquipment.message);
    expect(appliedEquipment.imported).toBe(1);

    const inDemo = await admin.query(
      "SELECT (SELECT count(*)::int FROM public.workers WHERE company_id = 'cmp_demo' AND first_name = $1) AS w, (SELECT count(*)::int FROM public.machines WHERE company_id = 'cmp_demo' AND code = $2) AS m",
      [first, MACHINE_CODE],
    );
    expect(inDemo.rows[0]?.w).toBe(1);
    expect(inDemo.rows[0]?.m).toBe(1);
    const inDruga = await admin.query(
      "SELECT (SELECT count(*)::int FROM public.workers WHERE company_id = 'cmp_druga' AND first_name = $1) AS w, (SELECT count(*)::int FROM public.machines WHERE company_id = 'cmp_druga' AND code = $2) AS m",
      [first, MACHINE_CODE],
    );
    expect(inDruga.rows[0]?.w).toBe(1);
    expect(inDruga.rows[0]?.m).toBe(1);
  });
});
