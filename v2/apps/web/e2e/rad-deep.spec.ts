/**
 * Deep Rad/obračun — dopuna postojećih approval/revise/resolve:
 * troškovi projekta + obračun CSV dostupnost (self-owned nije potreban za read).
 */
import { test } from "./helpers/annotate";
import { E2E_USERS, loginUi, requireE2ePassword } from "./helpers/auth";
import { expectForbiddenPage, expectHeading } from "./helpers/assert";

test.beforeAll(() => {
  requireE2ePassword();
});

test.describe("rad/obračun deep", { tag: ["@deep", "@deep-rad"] }, () => {
  test("ured: Radni dani + Sukobi + Zadaci", async ({ page }) => {
    await loginUi(page, E2E_USERS.admin);
    await page.goto("/ured/radni-dani");
    await expectHeading(page, "Radni dani");
    await page.goto("/ured/sukobi");
    await expectHeading(page, /Sukobi/);
    // F5: zadaci su samostalan ekran; troškovi su tab unutar projekta.
    await page.goto("/ured/zadaci");
    await expectHeading(page, "Zadaci");
  });

  test("radnik: rad/obračun rute zabranjene", async ({ page }) => {
    await loginUi(page, E2E_USERS.worker);
    for (const href of ["/ured/radni-dani", "/ured/sukobi", "/ured/obracun-sati"]) {
      await page.goto(href);
      await expectForbiddenPage(page);
    }
  });
});
