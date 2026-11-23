/**
 * Deep Admin — korisnici / role / audit + forbidden za radnika.
 */
import { expect, test } from "@playwright/test";
import { E2E_USERS, loginUi, requireE2ePassword } from "./helpers/auth";
import { expectForbiddenPage, expectHeading } from "./helpers/assert";

test.beforeAll(() => {
  requireE2ePassword();
});

test.describe("admin deep", { tag: ["@deep", "@deep-admin"] }, () => {
  test("vlasnik: Korisnici, Role, Audit se renderuju", async ({ page }) => {
    await loginUi(page, E2E_USERS.owner);
    await page.goto("/ured/korisnici");
    await expectHeading(page, "Korisnici");
    await page.goto("/ured/role");
    await expectHeading(page, "Pristup i role");
    await page.goto("/ured/audit");
    await expectHeading(page, "Audit trag");
  });

  test("radnik: admin rute daju 403", async ({ page }) => {
    await loginUi(page, E2E_USERS.worker);
    for (const href of ["/ured/korisnici", "/ured/role", "/ured/audit"]) {
      await page.goto(href);
      await expectForbiddenPage(page);
    }
  });

  test("računovođa: trošak mašina + obračun sati dostupni", async ({ page }) => {
    await loginUi(page, E2E_USERS.accountant);
    await page.goto("/ured/trosak-masina");
    await expectHeading(page, "Trošak mašina");
    await page.goto("/ured/obracun-sati");
    await expectHeading(page, "Obračun sati");
    await expect(page.getByRole("button", { name: "Preuzmi CSV" })).toBeVisible();
  });
});
