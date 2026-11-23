/** Zajedničke E2E asercije. */
import { expect, type Page, type Response } from "@playwright/test";

export async function expectNoServerError(response: Response | null, href: string): Promise<void> {
  expect(response?.status() ?? 0, `${href} status`).toBeLessThan(500);
}

export async function expectForbiddenPage(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "Nemate pristup ovoj stranici" })).toBeVisible();
}

export async function expectHeading(page: Page, name: string | RegExp): Promise<void> {
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

export function attachConsoleGuard(page: Page): { errors: string[] } {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    if (/Failed to load resource.*\b403\b/.test(msg.text())) return;
    errors.push(`console: ${msg.text()}`);
  });
  return { errors };
}
