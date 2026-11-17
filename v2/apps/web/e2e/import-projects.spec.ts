/**
 * E2E 2c: uvoz projekata — sretan prolaz i miješane greške (ništa se ne upisuje).
 * Fixturei sintetički; domene .test nisu potrebne (šifre E2E-*).
 */
import { expect, test, type Page } from "@playwright/test";
import ExcelJS from "exceljs";

const PASSWORD = process.env.E2E_PASSWORD ?? "";
const ADMIN = process.env.DATABASE_ADMIN_URL ?? "";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("ured@demo.test");
  await page.getByLabel("Lozinka").fill(PASSWORD);
  await page.getByRole("button", { name: "Prijavi se" }).click();
  await page.waitForURL("**/pregled");
}

async function xlsxBuffer(rows: (string | null)[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Projekti");
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function countProjects(codePrefix: string): Promise<number> {
  if (!ADMIN) return -1;
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: ADMIN });
  const result = await pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM projects WHERE code LIKE $1",
    [`${codePrefix}%`],
  );
  await pool.end();
  return result.rows[0]?.n ?? 0;
}

const mapping = {
  code: "Šifra",
  name: "Naziv",
  status: "Status",
  siteAddress: null,
  sitePlace: "Mjesto",
  startsOn: null,
  endsOn: null,
  manager: null,
  note: null,
};

test.beforeAll(() => {
  if (!PASSWORD) throw new Error("E2E_PASSWORD nije postavljen.");
});

test("uvoz projekata: sretan prolaz upisuje jedan projekat", async ({ page }) => {
  const stamp = `E2E-OK-${Date.now()}`;
  const bytes = await xlsxBuffer([
    ["Šifra", "Naziv", "Status", "Mjesto"],
    [stamp, "E2E projekat test", "ACTIVE", "Zenica"],
  ]);

  await login(page);
  await page.goto("/ured/uvoz");
  await page.getByRole("button", { name: "Projekti" }).click();
  await page.locator("#import-file").setInputFiles({
    name: "projekti-ok.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: bytes,
  });
  await page.getByRole("button", { name: "Pregledaj fajl" }).click();
  await expect(page.getByText(stamp, { exact: false })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Dalje na odluke" }).click();
  await page.getByRole("button", { name: /Uvezi 1 red/i }).click();
  await expect(page.getByText(/uvezen|Rezultat|1/i).first()).toBeVisible({ timeout: 20_000 });

  if (ADMIN) {
    expect(await countProjects(stamp)).toBe(1);
  }
});

test("uvoz projekata: miješane greške — potvrda s greškom ne upisuje ništa", async ({ page }) => {
  const stamp = `E2E-BAD-${Date.now()}`;
  const bytes = await xlsxBuffer([
    ["Šifra", "Naziv", "Status", "Mjesto"],
    [`${stamp}-A`, "Dobar red", "ACTIVE", "Zenica"],
    [`${stamp}-B`, "Loš status", "XYZ", "Zenica"],
  ]);
  const before = ADMIN ? await countProjects(stamp) : 0;

  await login(page);
  await page.goto("/ured/uvoz");
  await page.getByRole("button", { name: "Projekti" }).click();
  await page.locator("#import-file").setInputFiles({
    name: "projekti-bad.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: bytes,
  });
  await page.getByRole("button", { name: "Pregledaj fajl" }).click();
  await expect(page.getByText(/nije prepoznat/i).first()).toBeVisible({ timeout: 15_000 });

  // Pokušaj potvrde koja uključuje grešku (API) — UI greške ne nudi; server mora odbiti sve.
  const response = await page.request.post("/api/imports/apply", {
    multipart: {
      kind: "projects",
      file: {
        name: "projekti-bad.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: bytes,
      },
      mapping: JSON.stringify(mapping),
      decisions: JSON.stringify([
        { rowNumber: 2, action: "import" },
        { rowNumber: 3, action: "import" },
      ]),
    },
  });
  expect(response.ok()).toBeFalsy();

  if (ADMIN) {
    expect(await countProjects(stamp)).toBe(before);
  }
});
