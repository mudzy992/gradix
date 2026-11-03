import { expect, test } from '@playwright/test'
import type { BrowserContext, Page } from '@playwright/test'
import { openSession } from './session'

/**
 * FE-06 — admin tok na **stvarnom** backendu (seed `SEED_DEMO=true`).
 *
 * Jedna prijava po fajlu (`e2e/session.ts`) — backend rotira refresh token i reuse tretira kao krađu,
 * pa bi `storageState` po testu odjavio sve sesije (F-FE-06-06).
 * Unit testovi (FE-05) drže logiku; ovdje se provjerava da se ekrani zaista povezuju: dashboard →
 * prečica → lista → detalj, da navigacija označava aktivnu stranicu i da reflow radi na 320 px.
 * Podaci su iz `prisma/seed-demo-ops.ts` (`Sarajevo obilaznica`, faze `Zemljani radovi`/`Asfalt`,
 * zadatak `Iskop kanala`).
 */
const ADMIN = {
  email: process.env.E2E_LOGIN_EMAIL ?? '',
  password: process.env.E2E_LOGIN_PASSWORD ?? '',
}

let context: BrowserContext
let page: Page

test.describe('FE-06 — admin tok', () => {
  test.beforeAll(async ({ browser }) => {
    if (!ADMIN.email || !ADMIN.password) {
      test.skip(true, 'E2E login kredencijali nisu postavljeni')
      return
    }
    ;({ context, page } = await openSession(browser, ADMIN.email, ADMIN.password))
  })

  test.afterAll(async () => {
    await context?.close()
  })

  test.beforeEach(async () => {
    await page.goto('/dashboard')
    // Ako sesija padne, test mora reći „nismo prijavljeni“, ne „nema kartica“.
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 })
  })

  test('dashboard je prvi ekran poslije prijave i ima prevedene kartice', async () => {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/dashboard/i)
    await expect(page.getByRole('heading', { name: /ključni pokazatelji/i })).toHaveCount(1)

    // Kartice po roli (SUPER_ADMIN → admin bucket): barem jedna poznata labela.
    await expect(page.getByText('Aktivni projekti')).toBeVisible({ timeout: 15_000 })

    // Regresija (FE-04/FE-05): nijedan sirovi `dash.` ključ ne smije doći do ekrana.
    await expect(page.getByText(/dash\./)).toHaveCount(0)
  })

  test('prečica vodi na projekte, red otvara detalj sa fazama', async () => {
    // Prečica (zona B), ne sidebar — ista prava, drugi put do ekrana.
    const quick = page.getByRole('region', { name: /brze akcije/i })
    await quick.getByRole('link', { name: 'Projekti' }).click()
    await expect(page).toHaveURL(/\/projects$/)

    const project = page.getByRole('link', { name: 'Sarajevo obilaznica' })
    await expect(project).toBeVisible({ timeout: 15_000 })
    await project.click()

    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{8,}/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/sarajevo obilaznica/i)

    // Faze iz seed-a su na tabu „Faze".
    await page.getByRole('tab', { name: 'Faze' }).click()
    await expect(page.getByText('Zemljani radovi')).toBeVisible({ timeout: 15_000 })
  })

  test('zadatak iz seed-a se otvara sa svojim naslovom', async () => {
    await page.goto('/tasks')
    const task = page.getByRole('link', { name: /Iskop kanala/ })
    await expect(task).toBeVisible({ timeout: 15_000 })
    await task.click()

    await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{8,}/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/iskop kanala/i)
  })

  test('navigacija označava aktivnu stranicu (aria-current)', async () => {
    await page.goto('/projects')
    // Na desktopu je samo jedan `<nav>` u DOM-u (mobilni je u `Sheet`-u koji se ne montira).
    const active = page.locator('a[aria-current="page"]').first()
    await expect(active).toBeVisible()
    await expect(active).toHaveText(/projekti/i)
  })

  test('dashboard nema horizontalnog skrola na 320 px i ima jedno h1', async () => {
    await page.setViewportSize({ width: 320, height: 640 })
    await page.goto('/dashboard')
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)
  })
})
