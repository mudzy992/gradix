import { expect, type Page, test } from '@playwright/test'

/**
 * FE-06 — E2E tokovi na **stvarnom** backendu (seed `SEED_DEMO=true`).
 *
 * Unit testovi (FE-05) drže logiku; ovdje se provjerava da se ekrani zaista povezuju: prijava →
 * dashboard → prečica → lista → detalj, da guardovi rade bez prijave i da navigacija označava
 * aktivnu stranicu. Podaci su iz `prisma/seed-demo-ops.ts` (`Sarajevo obilaznica`, `Iskop kanala`).
 */
const ADMIN = {
  email: process.env.E2E_LOGIN_EMAIL ?? '',
  password: process.env.E2E_LOGIN_PASSWORD ?? '',
}

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.locator('#identifier').fill(email)
  await page.locator('#password').fill(password)
  await page.getByRole('button', { name: /prijavi|sign in/i }).click()
  await expect(page).toHaveURL(/dashboard/, { timeout: 20_000 })
}

test.describe('FE-06 — admin tok', () => {
  test.skip(!ADMIN.email || !ADMIN.password, 'E2E login credentials nisu postavljeni')

  test.beforeEach(async ({ page }) => {
    await login(page, ADMIN.email, ADMIN.password)
  })

  test('dashboard je prvi ekran poslije prijave i ima prevedene kartice', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/dashboard/i)
    await expect(page.getByRole('heading', { name: /ključni pokazatelji/i })).toHaveCount(1)

    // Kartice po roli (SUPER_ADMIN → admin bucket): barem jedna poznata labela.
    await expect(page.getByText('Aktivni projekti')).toBeVisible()

    // Regresija (FE-04/FE-05): nijedan sirovi `dash.` ključ ne smije doći do ekrana.
    await expect(page.getByText(/dash\./)).toHaveCount(0)
  })

  test('prečica vodi na projekte, red otvara detalj sa fazama', async ({ page }) => {
    // Prečica (zona B), ne sidebar — ista prava, drugi put do ekrana.
    const quick = page.getByRole('region', { name: /brze akcije/i })
    await quick.getByRole('link', { name: 'Projekti' }).click()
    await expect(page).toHaveURL(/\/projects$/)

    const project = page.getByRole('link', { name: 'Sarajevo obilaznica' })
    await expect(project).toBeVisible({ timeout: 15_000 })
    await project.click()

    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{8,}/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/sarajevo obilaznica/i)

    // Faze iz seed-a (`Zemljani radovi`, `Asfalt`) su na tabu „Faze".
    await page.getByRole('tab', { name: 'Faze' }).click()
    await expect(page.getByText('Zemljani radovi')).toBeVisible({ timeout: 15_000 })
  })

  test('zadatak iz seed-a se otvara sa svojim naslovom', async ({ page }) => {
    await page.goto('/tasks')
    const task = page.getByRole('link', { name: /Iskop kanala/ })
    await expect(task).toBeVisible({ timeout: 15_000 })
    await task.click()

    await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{8,}/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/iskop kanala/i)
  })

  test('navigacija označava aktivnu stranicu (aria-current)', async ({ page }) => {
    await page.goto('/projects')
    // Na desktopu je samo jedan `<nav>` u DOM-u (mobilni je u `Sheet`-u koji se ne montira).
    const active = page.locator('a[aria-current="page"]').first()
    await expect(active).toBeVisible()
    await expect(active).toHaveText(/projekti/i)
  })

  test('dashboard nema horizontalnog skrola na 320 px i ima jedno h1', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    await page.goto('/dashboard')
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)
  })
})

test.describe('FE-06 — guardovi bez prijave', () => {
  test('zaštićena ruta preusmjerava na prijavu', async ({ page }) => {
    await page.goto('/projects')
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.locator('#identifier')).toBeVisible()
  })

  test('detalj zadatka takođe traži prijavu (nema curenja podataka)', async ({ page }) => {
    await page.goto('/tasks/00000000-0000-0000-0000-000000000000')
    await expect(page).toHaveURL(/\/login$/)
  })
})
