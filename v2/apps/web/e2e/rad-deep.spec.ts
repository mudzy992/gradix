/**
 * Deep Rad/obračun — dopuna postojećih approval/revise/resolve:
 * troškovi projekta + obračun CSV dostupnost (self-owned nije potreban za read).
 */
import { expect, test } from "@playwright/test";
import { E2E_USERS, loginUi, requireE2ePassword } from "./helpers/auth";
import { expectForbiddenPage, expectHeading } from "./helpers/assert";

test.beforeAll(() => {
  requireE2ePassword();
});

test.describe("rad/obračun deep", { tag: ["@deep", "@deep-rad"] }, () => {
  test("ured: Radni dani + Sukobi + Troškovi projekta", async ({ page }) => {
    await loginUi(page, E2E_USERS.admin);
    await page.goto("/ured/radni-dani");
    await expectHeading(page, "Radni dani");
    await page.goto("/ured/sukobi");
    await expectHeading(page, /Sukobi/);
    await page.goto("/ured/troskovi-projekta");
    await expectHeading(page, "Troškovi projekta");
  });

  test("radnik: rad/obračun rute zabranjene", async ({ page }) => {
    await loginUi(page, E2E_USERS.worker);
    for (const href of ["/ured/radni-dani", "/ured/sukobi", "/ured/troskovi-projekta", "/ured/obracun-sati"]) {
      await page.goto(href);
      await expectForbiddenPage(page);
    }
  });
});
