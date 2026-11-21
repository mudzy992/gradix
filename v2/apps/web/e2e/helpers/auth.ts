/** E2E auth — Izvor obrasca: v2 e2e smoke/navigation (refaktor Faza 3). */
import { expect, type Page } from "@playwright/test";

export const E2E_PASSWORD = process.env.E2E_PASSWORD ?? "";

export const E2E_USERS = {
  owner: "vlasnik@demo.test",
  admin: "ured@demo.test",
  pm: "voditelj@demo.test",
  supervisor: "sef@demo.test",
  worker: "radnik@demo.test",
  accountant: "racunovodja@demo.test",
} as const;

export function requireE2ePassword(): void {
  if (!E2E_PASSWORD) throw new Error("E2E_PASSWORD nije postavljen (demo seed lozinka).");
}

/** UI prijava (cookie u browser kontekstu). */
export async function loginUi(page: Page, email: string): Promise<void> {
  requireE2ePassword();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Lozinka").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Prijavi se" }).click();
  await page.waitForURL("**/pregled");
}

/**
 * Sesija za API setup: UI login puni browser cookie jar;
 * page.request često ne zadrži cookie nakon čistog API logina u CI.
 */
export async function loginApi(page: Page, email: string): Promise<void> {
  await loginUi(page, email);
}

/**
 * Odjava preko fetch u page kontekstu (cookie jar preglednika).
 * UI meni na Pixel 5 je nestabilan kad je drawer otvoren (sidebar intercept).
 */
export async function logoutUi(page: Page): Promise<void> {
  const status = await page.evaluate(async () => {
    const response = await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    return response.status;
  });
  expect(status, "logout status").toBeLessThan(400);
  await page.goto("/login");
  await page.waitForURL("**/login");
}
