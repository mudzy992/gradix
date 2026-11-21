import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test'

/**
 * FE-06 — jedna sesija po spec fajlu.
 *
 * Zašto ne `storageState` po testu: backend **rotira** refresh token i svaku ponovnu upotrebu
 * starog tokena tretira kao krađu (`revokeAll`) — vidi `auth-tokens.service.ts` i F-FE-06-06.
 * Deljeni `storageState` bi zato radio samo za **prvi** test u fajlu, a ostali bi bili odjavljeni.
 * Zato fajl otvori jedan kontekst, prijavi se jednom i kroz njega prolazi sve testove — kao pravi
 * korisnik koji je otvorio aplikaciju i klika dalje (jedna prijava, nula „krađa tokena“).
 *
 * Bonus: backend dozvoljava 5 prijava/min po IP-u, pa 16 testova sa sopstvenom prijavom troši kvotu.
 */
export type Session = { context: BrowserContext; page: Page }

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4173'

/** Wait for bootstrap and refresh rotation to finish before the next document navigation. */
export async function waitForAuthenticatedShell(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 })
  await expect(page.getByRole('navigation').first()).toBeVisible({ timeout: 20_000 })
}

export async function openSession(browser: Browser, email: string, password: string): Promise<Session> {
  const context = await browser.newContext({ baseURL: BASE_URL })
  const page = await context.newPage()
  await page.goto('/login')
  await page.locator('#identifier').fill(email)
  await page.locator('#password').fill(password)
  await page.getByRole('button', { name: /prijavi|sign in/i }).click()
  await waitForAuthenticatedShell(page)
  return { context, page }
}
