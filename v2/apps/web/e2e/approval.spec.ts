/**
 * R4b E2E: šef potvrđuje dan bez OPEN sukoba, ured odobrava i zaključava, računovođa samo čita.
 */
import { expect } from "@playwright/test";
import { test } from "./helpers/annotate";
import { loginUi, requireE2ePassword } from "./helpers/auth";



test.beforeAll(() => {
  requireE2ePassword();
});

test("šef potvrđuje dan, ured odobrava i zaključava; računovođa samo čita", { tag: ["@deep", "@deep-rad"] }, async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "R4b multi-context approval: desktop only (Pixel 5 drawer/layout)");
  await loginUi(page, "sef@demo.test");
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
