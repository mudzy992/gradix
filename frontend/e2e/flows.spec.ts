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

    await expect(page).toHaveURL(/\/projects\/[0-9a-z]{20,}$/i) // CUID, ne UUID
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

    await expect(page).toHaveURL(/\/tasks\/[0-9a-z]{20,}$/i) // CUID, ne UUID
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/iskop kanala/i)
  })

  test('lista projekata prikazuje preveden status (FE-08)', async () => {
    await page.goto('/projects')
    const row = page.getByRole('row').filter({ hasText: 'Sarajevo obilaznica' })
    await expect(row).toBeVisible({ timeout: 15_000 })
    // Seedov projekat nema eksplicitan status → šema daje `PLANNING` ⇒ prikaz je „U planu“.
    await expect(row).toContainText('U planu')
    // Nijedan sirov enum se ne smije prikazati korisniku.
    await expect(page.getByText(/^(PLANNING|IN_PROGRESS|ON_HOLD|COMPLETED|CANCELLED)$/)).toHaveCount(0)
  })

  test('tabla zadataka ima prevedene kolone i broj po koloni', async () => {
    await page.goto('/tasks')
    await expect(page.getByText('Iskop kanala')).toBeVisible({ timeout: 15_000 })

    await expect(page.getByRole('region', { name: /^Dodijeljeno/ })).toBeVisible()
    await expect(page.getByRole('region', { name: /^Nedodijeljeno/ })).toBeVisible()
    // Sirovi enum se ne smije prikazati kao naslov kolone.
    await expect(page.getByRole('heading', { name: 'PENDING' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'IN_PROGRESS' })).toHaveCount(0)
  })

  test('flota prikazuje preveden tip i status mašine (FE-09)', async () => {
    await page.goto('/fleet')
    const row = page.getByRole('row').filter({ hasText: 'Kiper 1' })
    await expect(row).toBeVisible({ timeout: 15_000 })
    // Seed: `Kiper 1` je `TRUCK`, status iz šeme je `IDLE` ⇒ „Kamion“ i „Slobodna“.
    await expect(row).toContainText('Kamion')
    await expect(row).toContainText('Slobodna')
    await expect(page.getByText(/^(TRUCK|EXCAVATOR|IDLE|IN_SERVICE|DECOMMISSIONED)$/)).toHaveCount(0)
  })

  test('HSE ekran ima prevedeno prazno stanje, bez sirovih enuma (FE-10)', async () => {
    await page.goto('/hse')
    // U seed-u nema incidenata → prazno stanje mora biti jasno rečeno, ne prazna lista.
    await expect(page.getByText('Nema HSE prijava.')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/Prijavite incident ili opasnost/)).toBeVisible()
    await expect(page.getByText(/^(LOW|MEDIUM|HIGH|OPEN|ACK|CLOSED)$/)).toHaveCount(0)
  })

  test('tenderi imaju prevedene kolone i prazno stanje (FE-11)', async () => {
    await page.goto('/tenders')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/tenderi/i)
    // Kolone su faze tendera; seed nema tendera → svaka kolona to kaže.
    await expect(page.getByRole('region', { name: /^Nacrt/ })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('region', { name: /^Povučen/ })).toBeVisible()
    await expect(page.getByText('Nema tendera u ovoj fazi.').first()).toBeVisible()
    await expect(page.getByText(/^(DRAFT|SUBMITTED|WON|LOST|WITHDRAWN)$/)).toHaveCount(0)
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
