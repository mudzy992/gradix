import { expect, test } from '@playwright/test'
import type { BrowserContext, Page } from '@playwright/test'
import { openSession } from './session'

/**
 * FE-06 — tok radnika (`worker@gradix.local`, rola `WORKER`). Jedna prijava po fajlu (`session.ts`).
 *
 * Ovaj tok dokazuje tri stvari koje admin tok ne može:
 * 1. dashboard se **razlikuje po roli** (`myTasks`, `myTimer`, `unread`; prisustvo nije dostupno),
 * 2. prečice poštuju prava (radnik nema `projects.read` ni `fleet.read`),
 * 3. timer radi od početka do kraja (start → pauza → stop) na stvarnom backendu.
 */
const WORKER = {
  email: process.env.E2E_WORKER_EMAIL ?? '',
  password: process.env.E2E_WORKER_PASSWORD ?? process.env.E2E_LOGIN_PASSWORD ?? '',
}

let context: BrowserContext
let page: Page

test.describe('FE-06 — radnik', () => {
  test.beforeAll(async ({ browser }) => {
    if (!WORKER.email || !WORKER.password) {
      test.skip(true, 'E2E worker kredencijali nisu postavljeni')
      return
    }
    ;({ context, page } = await openSession(browser, WORKER.email, WORKER.password))
  })

  test.afterAll(async () => {
    await context?.close()
  })

  test.beforeEach(async () => {
    await page.goto('/dashboard')
    // Sesija iz `storageState`: ako padne, test mora reći „nismo prijavljeni“, ne „nema kartica“.
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 })
  })

  test('dashboard prikazuje kartice svoje role i objašnjava odsustvo prisustva', async () => {
    await expect(page.getByText('Moji zadaci')).toBeVisible({ timeout: 15_000 })
    // Prisustvo je rola-based: radnik ga ne dobija → eksplicitna poruka, ne prazna kartica.
    await expect(page.getByText('Prisustvo nije dostupno za vašu rolu.')).toBeVisible()
  })

  test('prečice nude samo ekrane za koje radnik ima pravo', async () => {
    const quick = page.getByRole('region', { name: /brze akcije/i })
    await expect(quick.getByRole('link', { name: 'Zadaci' })).toBeVisible({ timeout: 15_000 })

    // `WORKER` ima `tasks.read`, ali nema `projects.read` ni `fleet.read`.
    await expect(quick.getByRole('link', { name: 'Projekti' })).toHaveCount(0)
    await expect(quick.getByRole('link', { name: 'Flota' })).toHaveCount(0)
    // F-FE-06-01 (D-033): radnik ima `hse.write` bez `hse.read`, a backend mu vraća **samo njegove**
    // prijave — ekran mu zato mora biti dostupan (prije je bio skriven i pored prava da prijavi).
    await expect(quick.getByRole('link', { name: 'HSE' })).toBeVisible()
  })

  test('timer: start → pauza → stop na dodijeljenom zadatku', async () => {
    await page.goto('/tasks')
    await page.getByRole('link', { name: /Iskop kanala/ }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/iskop kanala/i)

    const start = page.getByRole('button', { name: 'Start' })
    const pause = page.getByRole('button', { name: 'Pauza' })
    const stop = page.getByRole('button', { name: 'Stop' })

    // Test može naići na timer ostavljen od prethodnog runa — prvo ga zatvori.
    if (await stop.isVisible().catch(() => false)) {
      await stop.click()
      await expect(start).toBeVisible({ timeout: 15_000 })
    }

    await start.click()
    await expect(pause).toBeVisible({ timeout: 15_000 })
    await pause.click()
    await expect(page.getByRole('button', { name: 'Nastavi' })).toBeVisible({ timeout: 15_000 })
    await stop.click()
    await expect(start).toBeVisible({ timeout: 15_000 })
  })
})
