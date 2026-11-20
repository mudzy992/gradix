/**
 * R4b ispravka: OWNER/ADMIN kreira reviziju; LOCKED original ostaje;
 * PM / računovođa / šef nemaju dugme.
 * Sidro ok2 (druga sedmica od approval.spec) — vidi demo-r4b-approval.ts.
 */
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = process.env.E2E_PASSWORD ?? "";
const ADMIN = process.env.DATABASE_ADMIN_URL ?? "";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Lozinka").fill(PASSWORD);
  await page.getByRole("button", { name: "Prijavi se" }).click();
  await page.waitForURL("**/pregled");
}

test.beforeAll(() => {
  if (!PASSWORD) throw new Error("E2E_PASSWORD nije postavljen.");
});

test("ispravka kreira reviziju; original LOCKED; PM/računovođa/šef bez dugmeta", { tag: ["@deep", "@deep-rad"] }, async ({ page, browser }) => {
  await login(page, "sef@demo.test");
  await page.goto("/ured/radni-dani");
  const confirm = page.getByRole("button", { name: "Potvrdi dan", disabled: false }).first();
  await expect(confirm).toBeVisible({ timeout: 15_000 });
  await confirm.click();
  await expect(page.getByText("Potvrđeno").first()).toBeVisible({ timeout: 15_000 });

  const officeCtx = await browser.newContext();
  const office = await officeCtx.newPage();
  await login(office, "ured@demo.test");
  await office.goto("/ured/radni-dani");
  await office.getByRole("button", { name: "Odobri sedmicu" }).click();
  await expect(office.getByRole("button", { name: "Zaključaj" })).toBeEnabled({ timeout: 15_000 });
  await office.getByRole("button", { name: "Zaključaj" }).click();
  await expect(office.getByText("Sedmica zaključana").first()).toBeVisible({ timeout: 15_000 });

  let before = 0;
  if (ADMIN) {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: ADMIN });
    before = (await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM workday_revisions")).rows[0]?.n ?? 0;
    await pool.end();
  }

  await expect(office.getByRole("button", { name: "Nova ispravka" }).first()).toBeVisible();
  await office.getByRole("button", { name: "Nova ispravka" }).first().click();
  await expect(office.getByText("Staro stanje")).toBeVisible();
  await office.getByLabel("Napomena ispravke").fill("Korekcija sati nakon kontrole");
  const save = office.getByRole("button", { name: "Sačuvaj ispravku" });
  await expect(save).toBeDisabled();
  await office.getByLabel(/Razlog ispravke/).fill("Ispravka sati nakon kontrole ureda.");
  await expect(save).toBeEnabled();
  await save.click();
  await expect(office.getByText(/Ispravka je sačuvana/)).toBeVisible({ timeout: 15_000 });
  await expect(office.getByText("Zaključano").first()).toBeVisible();

  if (ADMIN) {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: ADMIN });
    const after = (await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM workday_revisions")).rows[0]?.n ?? 0;
    const status = await pool.query<{ approval_status: string }>(
      `SELECT d.approval_status
         FROM workdays d
         JOIN workday_revisions r ON r.workday_id = d.id AND r.company_id = d.company_id
        ORDER BY r.created_at DESC LIMIT 1`,
    );
    await pool.end();
    expect(after).toBe(before + 1);
    expect(status.rows[0]?.approval_status).toBe("LOCKED");
  }
  await officeCtx.close();

  for (const email of ["voditelj@demo.test", "racunovodja@demo.test", "sef@demo.test"] as const) {
    const ctx = await browser.newContext();
    const other = await ctx.newPage();
    await login(other, email);
    await other.goto("/ured/radni-dani");
    await expect(other.getByRole("heading", { name: "Radni dani" })).toBeVisible();
    await expect(other.getByRole("button", { name: "Nova ispravka" })).toHaveCount(0);
    await ctx.close();
  }
});
