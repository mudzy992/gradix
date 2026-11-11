/**
 * E2E smoke svih ruta (Dio 3a): rute se čitaju iz ISTE definicije kao test dosegljivosti
 * (NAV_ENTRIES u src/components/nav.ts), ne ručno. Za svaku seed rolu: svaka dozvoljena
 * stranica se renderuje (bez 5xx, bez grešaka u konzoli), svaka zabranjena daje 403 stranicu.
 */
import { expect, test, type Page } from "@playwright/test";
import { NAV_ENTRIES, navEntriesForRoles } from "../src/components/nav";

const PASSWORD = process.env.E2E_PASSWORD ?? "";

const USERS: { email: string; roles: string[] }[] = [
  { email: "vlasnik@demo.ba", roles: ["OWNER"] },
  { email: "ured@demo.ba", roles: ["ADMIN"] },
  { email: "sef@demo.ba", roles: ["SITE_SUPERVISOR"] },
  { email: "radnik@demo.ba", roles: ["WORKER"] },
];

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

for (const user of USERS) {
  test(`smoke ${user.roles[0]}: dozvoljene rute se renderuju, zabranjene daju 403`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      // Zabranjene rute namjerno vraćaju 403 — preglednik to sam upiše u konzolu kao
      // grešku resursa; to nije JS greška stranice i ne smije rušiti smoke.
      if (/Failed to load resource.*\b403\b/.test(msg.text())) return;
      errors.push(`console: ${msg.text()}`);
    });

    await login(page, user.email);

    const allowed = navEntriesForRoles(user.roles).map((entry) => entry.href);
    const forbidden = NAV_ENTRIES.map((entry) => entry.href).filter((href) => !allowed.includes(href));

    for (const href of allowed) {
      const response = await page.goto(href);
      expect(response?.status() ?? 0, `${href} status`).toBeLessThan(500);
      expect(page.url(), `${href} ne smije završiti na prijavi`).not.toContain("/login");
    }

    for (const href of forbidden) {
      await page.goto(href);
      await expect(
        page.getByRole("heading", { name: "Nemate pristup ovoj stranici" }),
        `${href} mora dati 403 stranicu`,
      ).toBeVisible();
    }

    expect(errors, "bez grešaka u konzoli").toEqual([]);
  });
}
