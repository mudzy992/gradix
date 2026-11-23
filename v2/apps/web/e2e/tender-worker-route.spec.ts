import { expect, test, type Page } from "@playwright/test";
import { E2E_USERS, loginUi, requireE2ePassword } from "./helpers/auth";

/** Isti cookie jar kao stranica. page.request ne šalje Secure gx_at na http://127.0.0.1. */
const apiStatus = (page: Page, method: "GET" | "POST", path: string, data?: Record<string, unknown>): Promise<number> =>
  page.evaluate(async ({ method: m, path: p, data: d }) => {
    const response = await fetch(p, {
      method: m,
      credentials: "include",
      headers: d ? { "Content-Type": "application/json", Accept: "application/json" } : { Accept: "application/json" },
      body: d ? JSON.stringify(d) : undefined,
    });
    return response.status;
  }, { method, path, data });

test.describe("worker tender route", { tag: ["@deep-auth"] }, () => {
  test.beforeAll(() => {
    requireE2ePassword();
  });

  test("radnik: direktan /ured/tenderi ne otvara listu i API je 403", async ({ page }) => {
    await loginUi(page, E2E_USERS.worker);
    expect(await apiStatus(page, "GET", "/api/tenders")).toBe(403);
    expect(await apiStatus(page, "POST", "/api/tenders", {
      title: "Nedozvoljeno",
      partnerId: "ptr_x",
      submittedValueAmount: "1.00",
      currencyCode: "BAM",
    })).toBe(403);
    await page.goto("/ured/tenderi");
    await expect(page).toHaveURL(/nemate-pristup/);
    await expect(page.getByRole("heading", { name: "Tenderi" })).toHaveCount(0);
  });

  test("vlasnik: direktan /ured/tenderi ostaje na listi", async ({ page }) => {
    await loginUi(page, E2E_USERS.owner);
    expect(await apiStatus(page, "GET", "/api/tenders")).toBe(200);
    await page.goto("/ured/tenderi");
    await expect(page.getByRole("heading", { name: "Tenderi" })).toBeVisible();
  });
});
