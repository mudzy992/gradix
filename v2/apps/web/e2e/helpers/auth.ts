/** E2E auth — Izvor obrasca: v2 e2e smoke/navigation (refaktor Faza 3). */
import { expect, type Page } from "@playwright/test";
import { totpCode, totpStep } from "@gradix/domain/server";

/**
 * Sintetička TOTP tajna iz demo seed-a (`scripts/seed.ts`).
 *
 * F1: OWNER/ADMIN/ACCOUNTANT imaju obaveznu 2FA, pa se E2E prijava sastoji iz dva koraka.
 * Tajna je javna NAMJERNO — demo baza je sintetička; u produkciji korisnik tajnu nikad ne
 * dijeli. Test računa kod istim algoritmom kao autentikator aplikacija.
 */
export const E2E_TOTP_SECRET = process.env.SEED_TOTP_SECRET ?? "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

/** Kod za tekući 30-s korak; `offset` pomjera korak (za test isteka). */
export function e2eTotpCode(offset = 0): string {
  return totpCode(E2E_TOTP_SECRET, totpStep(Date.now()) + offset);
}

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

/**
 * UI prijava (cookie u browser kontekstu).
 *
 * Dva koraka od F1: lozinka, pa TOTP kod za role koje ga traže. Korak za kod se prepoznaje
 * po polju, a ne po URL-u — pre-auth nije sesija i ekran ostaje isti.
 */
export async function loginUi(page: Page, email: string): Promise<void> {
  requireE2ePassword();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Lozinka").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Prijavi se" }).click();

  // Drugi korak: polje za kod. `isVisible` odmah poslije prikaza lozinke; bez čekanja bi
  // test prošao i kad 2FA nije ni tražena (lažno zeleno).
  const codeField = page.getByLabel("Kod iz autentikatora ili recovery kod");
  const needsCode = await codeField.isVisible({ timeout: 3_000 }).catch(() => false);
  if (needsCode) {
    await codeField.fill(e2eTotpCode());
    await page.getByRole("button", { name: "Potvrdi kod" }).click();
  }

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
