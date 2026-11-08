/**
 * Uvoz iz Excela na PRAVOJ bazi: pregled, greške po redu, duplikati, idempotentnost i
 * transakcija „sve ili ništa“.
 *
 * Fajlovi se prave u memoriji (`exceljs`), pa test ne zavisi od priloga u repou. Namjerno se
 * koristi pravi `.xlsx`, a ne CSV: serijski broj datuma i tipovi ćelija su upravo ono što se
 * u praksi pokvari.
 */
import ExcelJS from "exceljs";
import { Pool } from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { getVerifiedPool } from "./db";
import { isServiceError } from "./equipment-service";
import { applyImport, previewImport } from "./import-service";
import { parseWorkbook, type ParsedSheet } from "./import-parser";
import { issueAccessToken } from "./session";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = process.env.DATABASE_URL && adminUrl ? describe : describe.skip;

const COMPANY = "cmp_r2imp_a";
const OTHER = "cmp_r2imp_b";
const USER = "usr_r2imp";

async function makeWorkbook(rows: (string | number | Date | null)[][], extraSheet = false): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Radnici");
  for (const row of rows) sheet.addRow(row);
  if (extraSheet) workbook.addWorksheet("Ostalo").addRow(["ignoriši me"]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function parse(bytes: Buffer, name = "uvoz.xlsx"): Promise<ParsedSheet> {
  const parsed = await parseWorkbook(bytes, name);
  if ("code" in parsed) throw new Error(`parser: ${parsed.message}`);
  return parsed;
}

const WORKER_HEADER = ["Ime", "Prezime", "Telefon", "Email", "Zanimanje", "Angažman", "Datum početka", "Datum prestanka", "Ekipa"];

const workerMapping = {
  firstName: "Ime",
  lastName: "Prezime",
  phone: "Telefon",
  email: "Email",
  jobTitle: "Zanimanje",
  engagement: "Angažman",
  hiredAt: "Datum početka",
  endedAt: "Datum prestanka",
  team: "Ekipa",
  supervisor: null,
};

const EQUIPMENT_HEADER = [
  "Inventarska oznaka",
  "Naziv",
  "Kategorija",
  "Marka",
  "Model",
  "Godina",
  "Registarska oznaka",
  "Vlasništvo",
  "Stanje brojila",
];

const equipmentMapping = {
  code: "Inventarska oznaka",
  name: "Naziv",
  category: "Kategorija",
  make: "Marka",
  model: "Model",
  serialNo: null,
  plate: "Registarska oznaka",
  year: "Godina",
  ownership: "Vlasništvo",
  meterValue: "Stanje brojila",
};

describeDb("uvoz (integracija na pravoj bazi)", () => {
  const admin = new Pool({ connectionString: adminUrl });
  let pool: Awaited<ReturnType<typeof getVerifiedPool>>;
  const actor = { userId: USER, roles: ["ADMIN"] };

  beforeAll(async () => {
    await admin.query("DELETE FROM companies WHERE id = ANY($1)", [[COMPANY, OTHER]]);
    await admin.query("DELETE FROM users WHERE id = ANY($1)", [[USER]]);
    await admin.query("INSERT INTO companies (id, name, slug) VALUES ($1, 'Uvoz Firma', 'uvoz-firma')", [COMPANY]);
    await admin.query(
      "INSERT INTO users (id, email, password_hash, first_name, last_name, must_change_password) VALUES ($1, 'uvoz@test.example', 'x', 'Uvoz', 'Test', false)",
      [USER],
    );
    const { withCompany, companyId } = await import("@gradix/db");
    const seedPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    await withCompany(seedPool, companyId(COMPANY), async (client) => {
      await client.query(
        "INSERT INTO memberships (id, user_id, company_id, roles) VALUES ('mem_imp', $1, $2, ARRAY['ADMIN']::\"Role\"[])",
        [USER, COMPANY],
      );
    });
    await seedPool.end();

    pool = await getVerifiedPool();
    void issueAccessToken;
  });

  it("pregled ne piše ništa u bazu", async () => {
    const parsed = await parse(
      await makeWorkbook([WORKER_HEADER, ["Amina", "Karić", "061 111 222", "amina@demo.ba", "Zidar", "STALNO", "01.03.2025", null, "Ekipa 1"]]),
    );
    const before = await admin.query("SELECT count(*)::int AS n FROM workers WHERE company_id = $1", [COMPANY]);
    const preview = await previewImport(pool, COMPANY as never, "workers", parsed, workerMapping);
    expect(isServiceError(preview)).toBe(false);
    const after = await admin.query("SELECT count(*)::int AS n FROM workers WHERE company_id = $1", [COMPANY]);
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
  }, 30_000);

  it("greške po redu ne blokiraju ostale redove", async () => {
    const parsed = await parse(
      await makeWorkbook([
        WORKER_HEADER,
        ["Ispravan", "Radnik", null, null, null, "STALNO", "01.03.2025", null, null],
        ["Bez", "Prezimena-ok", null, null, null, "STALNO", "31.02.2025", null, null],
        ["Loš", "Angažman", null, null, null, "Povremeno", "01.03.2025", null, null],
        ["Obrnut", "Datum", null, null, null, "STALNO", "01.06.2025", "01.01.2025", null],
        [null, null, null, null, null, null, null, null, null],
      ]),
    );
    const preview = await previewImport(pool, COMPANY as never, "workers", parsed, workerMapping);
    if (isServiceError(preview)) throw new Error(preview.message);

    const byRow = new Map(preview.rows.map((row) => [row.rowNumber, row]));
    expect(byRow.get(2)?.outcome).toBe("import");
    expect(byRow.get(3)?.reason).toContain("nije datum");
    expect(byRow.get(4)?.reason).toContain("Angažman");
    expect(byRow.get(5)?.reason).toContain("prije početka");
    expect(preview.counts.import).toBe(1);
    expect(preview.counts.error).toBe(3);
  }, 30_000);

  it("nepoznata kategorija se prijavljuje, a NE stvara", async () => {
    const parsed = await parse(
      await makeWorkbook([
        EQUIPMENT_HEADER,
        ["TEG-01", "Tegljač", "Tegljač", "MAN", "TGX", 2019, "A12-B-34", "svoje", 1000],
        ["BAG-09", "Bager", "Bager", "CAT", "320", 2020, null, "svoje", 500],
      ]),
    );
    const before = await admin.query("SELECT count(*)::int AS n FROM equipment_categories WHERE company_id = $1", [COMPANY]);
    const preview = await previewImport(pool, COMPANY as never, "equipment", parsed, equipmentMapping);
    if (isServiceError(preview)) throw new Error(preview.message);
    const after = await admin.query("SELECT count(*)::int AS n FROM equipment_categories WHERE company_id = $1", [COMPANY]);

    expect(preview.rows[0]!.reason).toContain("Nepoznata kategorija");
    expect(preview.rows[1]!.outcome).toBe("import");
    // Kategorija se ne stvara tiho — broj kategorija je isti kao prije pregleda.
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
  }, 30_000);

  it("duplikat oznake u istom fajlu je greška drugog reda", async () => {
    const parsed = await parse(
      await makeWorkbook([
        EQUIPMENT_HEADER,
        ["DUP-01", "Prvi", "Bager", null, null, null, null, null, null],
        ["DUP-01", "Drugi", "Bager", null, null, null, null, null, null],
      ]),
    );
    const preview = await previewImport(pool, COMPANY as never, "equipment", parsed, equipmentMapping);
    if (isServiceError(preview)) throw new Error(preview.message);
    expect(preview.rows[0]!.outcome).toBe("import");
    expect(preview.rows[1]!.outcome).toBe("error");
    expect(preview.rows[1]!.reason).toContain("redu 2");
  }, 30_000);

  it("uvoz mašina upisuje jednu po jednu, ponovni uvoz preskače (idempotentno)", async () => {
    const bytes = await makeWorkbook([
      EQUIPMENT_HEADER,
      ["IMP-01", "Bager uvoz", "Bager", "CAT", "320", 2021, "IMP-01-TAB", "svoje", 1234.5],
      ["IMP-02", "Kamion uvoz", "Kamion", "MAN", "TGS", 2018, null, "najam", 55000],
    ]);
    const parsed = await parse(bytes);

    const first = await applyImport(
      pool,
      COMPANY as never,
      actor,
      "equipment",
      parsed,
      equipmentMapping,
      [
        { rowNumber: 2, action: "import" },
        { rowNumber: 3, action: "import" },
      ],
      "mašine.xlsx",
    );
    if (isServiceError(first)) throw new Error(first.message);
    expect(first.imported).toBe(2);
    expect(first.failed).toBe(0);

    // Kamion mjeri kilometre, bager sate — brojilo se nasljeđuje iz kategorije.
    const meters = await admin.query<{ code: string; meter: string; meter_value: string }>(
      "SELECT code, meter, meter_value FROM machines WHERE company_id = $1 AND code IN ('IMP-01','IMP-02') ORDER BY code",
      [COMPANY],
    );
    expect(meters.rows).toEqual([
      { code: "IMP-01", meter: "HOURS", meter_value: "1234.5" },
      { code: "IMP-02", meter: "KM", meter_value: "55000.0" },
    ]);

    // Ponovni uvoz: oba reda su sada „preskoči“ i nijedan se ne udvostručuje.
    const second = await previewImport(pool, COMPANY as never, "equipment", parsed, equipmentMapping);
    if (isServiceError(second)) throw new Error(second.message);
    expect(second.rows.every((row) => row.outcome === "skip")).toBe(true);

    const count = await admin.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM machines WHERE company_id = $1 AND code LIKE 'IMP-%'",
      [COMPANY],
    );
    expect(count.rows[0]!.n).toBe(2);
  }, 30_000);

  it("ažuriranje postojeće mašine je izričit izbor po redu", async () => {
    const parsed = await parse(
      await makeWorkbook([EQUIPMENT_HEADER, ["IMP-01", "Bager preimenovan", "Bager", "CAT", "336", 2021, "IMP-01-TAB", "svoje", 999]]),
    );
    const preview = await previewImport(pool, COMPANY as never, "equipment", parsed, equipmentMapping);
    if (isServiceError(preview)) throw new Error(preview.message);
    expect(preview.rows[0]!.outcome).toBe("skip");

    // Bez izbora „ažuriraj“ red se preskače; sa izborom se mijenja naziv.
    await applyImport(pool, COMPANY as never, actor, "equipment", parsed, equipmentMapping, [{ rowNumber: 2, action: "skip" }], "x.xlsx");
    const untouched = await admin.query<{ name: string }>("SELECT name FROM machines WHERE code = 'IMP-01'");
    expect(untouched.rows[0]!.name).toBe("Bager uvoz");

    await applyImport(pool, COMPANY as never, actor, "equipment", parsed, equipmentMapping, [{ rowNumber: 2, action: "update" }], "x.xlsx");
    const updated = await admin.query<{ name: string; model: string }>("SELECT name, model FROM machines WHERE code = 'IMP-01'");
    expect(updated.rows[0]).toEqual({ name: "Bager preimenovan", model: "336" });
  }, 30_000);

  it("radnici se ne spajaju automatski — mogući duplikat je odluka korisnika", async () => {
    const bytes = await makeWorkbook([WORKER_HEADER, ["Amina", "Karić", "061 111 222", null, null, "STALNO", "01.03.2025", null, null]]);
    const parsed = await parse(bytes);

    const first = await applyImport(pool, COMPANY as never, actor, "workers", parsed, workerMapping, [{ rowNumber: 2, action: "import" }], "radnici.xlsx");
    if (isServiceError(first)) throw new Error(first.message);
    expect(first.imported).toBe(1);

    // Isti fajl ponovo: pregled prijavljuje duplikat, ne uvodi tiho.
    const preview = await previewImport(pool, COMPANY as never, "workers", parsed, workerMapping);
    if (isServiceError(preview)) throw new Error(preview.message);
    expect(preview.rows[0]!.outcome).toBe("duplicate");
    expect(preview.rows[0]!.reason).toContain("Isto ime i prezime");

    // Isti telefon, drugo ime — takođe duplikat (broj se dijeli u porodici, pa je odluka na korisniku).
    const phoneOnly = await parse(
      await makeWorkbook([WORKER_HEADER, ["Emir", "Hadžić", "061/111-222", null, null, "STALNO", "01.03.2025", null, null]]),
    );
    const phonePreview = await previewImport(pool, COMPANY as never, "workers", phoneOnly, workerMapping);
    if (isServiceError(phonePreview)) throw new Error(phonePreview.message);
    expect(phonePreview.rows[0]!.outcome).toBe("duplicate");
    expect(phonePreview.rows[0]!.reason).toContain("Isti telefon");

    const count = await admin.query<{ n: number }>("SELECT count(*)::int AS n FROM workers WHERE company_id = $1", [COMPANY]);
    expect(count.rows[0]!.n).toBe(1);
  }, 30_000);

  it("isti radnik dva puta u istom fajlu je greška, ne dva zapisa", async () => {
    const parsed = await parse(
      await makeWorkbook([
        WORKER_HEADER,
        ["Novi", "Radnik", "063 333 444", null, null, "STALNO", "01.03.2025", null, null],
        ["Novi", "Radnik", "063 333 444", null, null, "STALNO", "01.03.2025", null, null],
      ]),
    );
    const preview = await previewImport(pool, COMPANY as never, "workers", parsed, workerMapping);
    if (isServiceError(preview)) throw new Error(preview.message);
    expect(preview.rows[0]!.outcome).toBe("import");
    expect(preview.rows[1]!.outcome).toBe("error");
    expect(preview.rows[1]!.reason).toContain("redu 2");
  }, 30_000);

  it("greška na bazi ruši CIJELU transakciju — nijedan red ne ostaje", async () => {
    // Dva reda sa istom registarskom oznakom: prvi prolazi, drugi pada na UNIQUE indeksu.
    // Bez transakcije bi prvi ostao uvezen, a korisnik ne bi znao šta je unutra.
    const parsed = await parse(
      await makeWorkbook([
        EQUIPMENT_HEADER,
        ["TRX-01", "Prvi", "Bager", null, null, null, "TRX-TAB", null, null],
        ["TRX-02", "Drugi", "Bager", null, null, null, "TRX-TAB", null, null],
      ]),
    );
    const before = await admin.query<{ n: number }>("SELECT count(*)::int AS n FROM machines WHERE company_id = $1", [COMPANY]);

    const result = await applyImport(
      pool,
      COMPANY as never,
      actor,
      "equipment",
      parsed,
      equipmentMapping,
      [
        { rowNumber: 2, action: "import" },
        { rowNumber: 3, action: "import" },
      ],
      "trx.xlsx",
    );

    const after = await admin.query<{ n: number }>("SELECT count(*)::int AS n FROM machines WHERE company_id = $1", [COMPANY]);
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
    // Rezultat prijavljuje grešku, a ne tiho djelimičan uspjeh.
    if (!isServiceError(result)) {
      expect(result.failed).toBeGreaterThan(0);
      expect(result.errors[0]!.rowNumber).toBe(3);
    }
  }, 30_000);

  it("red koji je u pregledu greška ne može se uvesti ni izborom", async () => {
    const parsed = await parse(await makeWorkbook([WORKER_HEADER, ["X", "Y", null, null, null, "STALNO", "nije datum", null, null]]));
    const result = await applyImport(pool, COMPANY as never, actor, "workers", parsed, workerMapping, [{ rowNumber: 2, action: "import" }], "x.xlsx");
    expect(isServiceError(result)).toBe(true);
    if (isServiceError(result)) expect(result.code).toBe("VALIDATION_FAILED");
  }, 30_000);

  it("drugi list se prijavljuje, ne uvozi", async () => {
    const parsed = await parse(await makeWorkbook([WORKER_HEADER, ["List", "Jedan", null, null, null, "STALNO", "01.03.2025", null, null]], true));
    expect(parsed.ignoredSheets).toBe(1);
  }, 30_000);

  it("licni podaci u koloni se prijavljuju kao nepodržani", async () => {
    const parsed = await parse(
      await makeWorkbook([[...WORKER_HEADER, "JMBG"], ["Amina", "Karić", null, null, null, "STALNO", "01.03.2025", null, null, "0101990151238"]]),
    );
    const preview = await previewImport(pool, COMPANY as never, "workers", parsed, workerMapping);
    if (isServiceError(preview)) throw new Error(preview.message);
    expect(preview.blockers.join(" ")).toContain("lični podaci");
  }, 30_000);
});
