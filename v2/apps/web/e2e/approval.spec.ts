/**
 * R4b E2E: šef potvrđuje dan bez OPEN sukoba, ured odobrava i zaključava, računovođa samo čita.
 */
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = process.env.E2E_PASSWORD ?? "";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Lozinka").fill(PASSWORD);
  await page.getByRole("button", { name: "Prijavi se" }).click();
  await page.waitForURL("**/pregled");
}

test.beforeAll(() => {
  if (!PASSWORD) throw new Error("E2E_PASSWORD nije postavljen (demo seed lozinka).");
});

test("šef potvrđuje dan, ured odobrava i zaključava; računovođa samo čita", { tag: ["@deep", "@deep-rad"] }, async ({ page, browser }) => {
  await login(page, "sef@demo.test");
  await page.goto("/ured/radni-dani");
  await expect(page.getByRole("heading", { name: "Radni dani" })).toBeVisible();
  const confirm = page.getByRole("button", { name: "Potvrdi dan", disabled: false }).first();
  await expect(confirm).toBeVisible({ timeout: 15_000 });
  await confirm.click();
  await expect(page.getByText("Potvrđeno").first()).toBeVisible({ timeout: 15_000 });

  const officeCtx = await browser.newContext();
  const office = await officeCtx.newPage();
  await login(office, "ured@demo.test");
  await office.goto("/ured/radni-dani");
  await expect(office.getByRole("heading", { name: "Radni dani" })).toBeVisible();
  const approve = office.getByRole("button", { name: "Odobri sedmicu" });
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect(office.getByRole("button", { name: "Zaključaj" })).toBeEnabled({ timeout: 15_000 });
  await office.getByRole("button", { name: "Zaključaj" }).click();
  await expect(office.getByText("Sedmica zaključana").first()).toBeVisible({ timeout: 15_000 });
  await officeCtx.close();

  const acctCtx = await browser.newContext();
  const acct = await acctCtx.newPage();
  await login(acct, "racunovodja@demo.test");
  await acct.goto("/ured/radni-dani");
  await expect(acct.getByRole("heading", { name: "Radni dani" })).toBeVisible();
  await expect(acct.getByRole("button", { name: "Potvrdi dan" })).toHaveCount(0);
  await expect(acct.getByRole("button", { name: "Odobri sedmicu" })).toHaveCount(0);
  await expect(acct.getByRole("button", { name: "Zaključaj" })).toHaveCount(0);
  const nav = acct.getByRole("navigation", { name: "Glavna navigacija" });
  await expect(nav.getByRole("link", { name: "Radni dani" })).toBeVisible();
  await acctCtx.close();
});
