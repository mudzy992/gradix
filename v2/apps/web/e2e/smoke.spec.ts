/**
 * E2E @smoke — rute iz NAV_ENTRIES po seed rolama.
 */
import { expect, test } from "@playwright/test";
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

      const allowed = navEntriesForRoles(user.roles).map((entry) => entry.href);
      const forbidden = NAV_ENTRIES.map((entry) => entry.href).filter((href) => !allowed.includes(href));

      for (const href of allowed) {
        const response = await page.goto(href);
        await expectNoServerError(response, href);
        expect(page.url(), `${href} ne smije završiti na prijavi`).not.toContain("/login");
      }

      for (const href of forbidden) {
        await page.goto(href);
        await expectForbiddenPage(page);
      }

      expect(errors, "bez grešaka u konzoli").toEqual([]);
    },
  );
}
