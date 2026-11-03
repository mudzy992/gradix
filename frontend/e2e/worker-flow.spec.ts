import { expect, type Page, test } from '@playwright/test'

/**
 * FE-06 — tok radnika (`worker@gradix.local`, rola `WORKER`).
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

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.locator('#identifier').fill(email)
  await page.locator('#password').fill(password)
  await page.getByRole('button', { name: /prijavi|sign in/i }).click()
  await expect(page).toHaveURL(/dashboard/, { timeout: 20_000 })
}

test.describe('FE-06 — radnik', () => {
  test.skip(!WORKER.email || !WORKER.password, 'E2E worker kredencijali nisu postavljeni')

  test.beforeEach(async ({ page }) => {
    await login(page, WORKER.email, WORKER.password)
  })

  test('dashboard prikazuje kartice svoje role i objašnjava odsustvo prisustva', async ({ page }) => {
    await expect(page.getByText('Moji zadaci')).toBeVisible({ timeout: 15_000 })
    // Prisustvo je rola-based: radnik ga ne dobija → eksplicitna poruka, ne prazna kartica.
    await expect(page.getByText('Prisustvo nije dostupno za vašu rolu.')).toBeVisible()
  })

  test('prečice nude samo ekrane za koje radnik ima pravo', async ({ page }) => {
    const quick = page.getByRole('region', { name: /brze akcije/i })
    await expect(quick.getByRole('link', { name: 'Zadaci' })).toBeVisible({ timeout: 15_000 })

    // `WORKER` ima `tasks.read`, ali nema `projects.read` ni `fleet.read`.
    await expect(quick.getByRole('link', { name: 'Projekti' })).toHaveCount(0)
    await expect(quick.getByRole('link', { name: 'Flota' })).toHaveCount(0)
    // Napomena (F-FE-06-01): radnik ima `hse.write` ali **ne** `hse.read`, pa mu se HSE ekran
    // namjerno ne nudi — promjena tog pravila je BE odluka, ne stvar ovog testa.
    await expect(quick.getByRole('link', { name: 'HSE' })).toHaveCount(0)
  })

  test('timer: start → pauza → stop na dodijeljenom zadatku', async ({ page }) => {
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
