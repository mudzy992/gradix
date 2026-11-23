/**
 * E2E @smoke — rute iz NAV_ENTRIES po seed rolama.
 * Dozvoljena ruta mora pokazati svoj naslov. Zabranjena mora ostati na stranici
 * zabrane, a njen API mora vratiti 403. HTTP 200 sam nije dokaz dozvole.
 */
import { expect, test, type Page } from "@playwright/test";
import { NAV_ENTRIES, navEntriesForRoles } from "../src/components/nav";
import { attachConsoleGuard, expectForbiddenPage, expectNoServerError } from "./helpers/assert";
import { E2E_USERS, loginUi, requireE2ePassword } from "./helpers/auth";

const USERS: { email: string; roles: string[] }[] = [
  { email: E2E_USERS.owner, roles: ["OWNER"] },
  { email: E2E_USERS.admin, roles: ["ADMIN"] },
  { email: E2E_USERS.pm, roles: ["PROJECT_MANAGER"] },
  { email: E2E_USERS.supervisor, roles: ["SITE_SUPERVISOR"] },
  { email: E2E_USERS.worker, roles: ["WORKER"] },
];

const API_BY_HREF: Record<string, string> = {
  "/ured/projekti": "/api/projects",
  "/ured/radnici": "/api/workers",
  "/ured/masine": "/api/equipment",
  "/ured/partneri": "/api/partners",
  "/ured/tenderi": "/api/tenders",
  "/ured/rokovi": "/api/obligations",
  "/ured/sati-masine": "/api/machine-work-logs",
  "/ured/gorivo": "/api/fuel-entries",
  "/ured/ture": "/api/hauls",
  "/ured/dnevni-pregled": "/api/machine-daily-checks",
  "/ured/kvarovi": "/api/machine-faults",
  "/ured/sukobi": "/api/workday-conflicts",
  "/ured/trosak-masina": "/api/machine-cost-rates",
  "/ured/troskovi-projekta": "/api/project-cost-entries",
  "/ured/korisnici": "/api/users",
  "/ured/role": "/api/roles",
  "/ured/audit": "/api/audit",
};

const HEADING_BY_HREF: Record<string, string | RegExp> = {
  // pregled.view: „Dobro jutro/Dobar dan/Dobro veče“. Ostali: „Dobro došli“. Bez imena: „Pregled“.
  "/pregled": /Dobro došli|Dobro jutro|Dobar dan|Dobro veče|^Pregled$/,
  "/ured/sukobi": "Sukobi radnih dana",
};

const headingFor = (href: string, label: string): string | RegExp => HEADING_BY_HREF[href] ?? label;

const apiStatus = (page: Page, path: string): Promise<number> =>
  page.evaluate(async (target) => (await fetch(target, { cache: "no-store" })).status, path);

test.beforeAll(() => {
  requireE2ePassword();
});

for (const user of USERS) {
  test(
    `smoke ${user.roles[0]}: dozvoljene rute se renderuju, zabranjene daju 403`,
    { tag: ["@smoke"] },
    async ({ page }) => {
      const { errors } = attachConsoleGuard(page);
      await loginUi(page, user.email);
      const allowed = navEntriesForRoles(user.roles);
      const allowedHrefs = new Set(allowed.map((entry) => entry.href));
      const forbidden = NAV_ENTRIES.filter((entry) => !allowedHrefs.has(entry.href));

      for (const entry of allowed) {
        const response = await page.goto(entry.href);
        await expectNoServerError(response, entry.href);
        expect(page.url(), `${entry.href} ne smije završiti na prijavi`).not.toContain("/login");
        await expect(page.getByRole("heading", { name: headingFor(entry.href, entry.label) })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Nemate pristup ovoj stranici" })).toHaveCount(0);
        const api = API_BY_HREF[entry.href];
        if (api) {
          const status = await apiStatus(page, api);
          expect(status, `${api} nije zabranjen ovoj roli`).not.toBe(403);
          expect(status, `${api} traži prijavu`).not.toBe(401);
        }
      }

      for (const entry of forbidden) {
        await page.goto(entry.href);
        await expectForbiddenPage(page);
        await expect(page.getByRole("heading", { name: headingFor(entry.href, entry.label) })).toHaveCount(0);
        const api = API_BY_HREF[entry.href];
        if (api) {
          expect(await apiStatus(page, api), `${api} mora biti 403`).toBe(403);
        }
      }

      expect(errors, "bez grešaka u konzoli").toEqual([]);
    },
  );
}
