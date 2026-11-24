/**
 * E2E 2c: uvoz projekata — sretan prolaz i miješane greške (ništa se ne upisuje).
 * Fixturei sintetički; domene .test nisu potrebne (šifre E2E-*).
 */
import { expect } from "@playwright/test";
import { test } from "./helpers/annotate";
import { E2E_USERS, loginUi, requireE2ePassword } from "./helpers/auth";
import ExcelJS from "exceljs";

const ADMIN = process.env.DATABASE_ADMIN_URL ?? "";


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
  requireE2ePassword();
});

test("uvoz projekata: sretan prolaz upisuje jedan projekat", { tag: ["@deep", "@deep-evidencija"] }, async ({ page }) => {
  const stamp = `E2E-OK-${Date.now()}`;
  const bytes = await xlsxBuffer([
    ["Šifra", "Naziv", "Status", "Mjesto"],
    [stamp, "E2E projekat test", "ACTIVE", "Zenica"],
  ]);

  await loginUi(page, E2E_USERS.admin);
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
  // Samo poruka koraka 4 nakon apply — ne „Uvezi 1 red” / golo „1” / naslov „Rezultat”.
  await expect(page.getByText(/^Uvezeno 1,/)).toBeVisible({ timeout: 20_000 });

  if (ADMIN) {
    expect(await countProjects(stamp)).toBe(1);
  }
});

test("uvoz projekata: miješane greške — potvrda s greškom ne upisuje ništa", { tag: ["@deep", "@deep-evidencija"] }, async ({ page }) => {
  const stamp = `E2E-BAD-${Date.now()}`;
  const bytes = await xlsxBuffer([
    ["Šifra", "Naziv", "Status", "Mjesto"],
    [`${stamp}-A`, "Dobar red", "ACTIVE", "Zenica"],
    [`${stamp}-B`, "Loš status", "XYZ", "Zenica"],
  ]);
  const before = ADMIN ? await countProjects(stamp) : 0;

  await loginUi(page, E2E_USERS.admin);
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
  const cookies = await page.context().cookies();
  const response = await page.request.post("/api/imports/apply", {
    headers: { cookie: cookies.map((item) => `${item.name}=${item.value}`).join("; ") },
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
  expect(response.status(), "prijava mora stići do API-ja").not.toBe(401);
  expect(response.ok()).toBeFalsy();

  if (ADMIN) {
    expect(await countProjects(stamp)).toBe(before);
  }
});
