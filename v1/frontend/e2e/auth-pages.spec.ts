import { expect, test } from '@playwright/test'

/**
 * FE-07 — auth ekrani bez sesije. Provjerava ono što unit testovi ne mogu: da svaki ekran ima
 * **jedno `h1`**, da poruka o grešci stvarno stoji uz polje i da nema lažne forme tamo gdje
 * backend ne nudi tok (`/reset` → 501).
 */
test.describe('FE-07 — auth ekrani', () => {
  test('zaboravljena lozinka: h1, poruka uz polje i reflow na 320 px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    await page.goto('/forgot')

    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/zaboravljena lozinka/i)

    await page.locator('#email').fill('nije-email')
    await page.getByRole('button', { name: 'Pošalji' }).click()

    await expect(page.locator('#email')).toHaveAttribute('aria-invalid', 'true')
    await expect(page.locator('#email-error')).toBeVisible()
    await expect(page.locator('#email-error')).toHaveText(/ispravan email/i)

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)
  })

  test('reset lozinke ne nudi formu koja bi glumila uspjeh', async ({ page }) => {
    await page.goto('/reset')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/reset lozinke/i)
    await expect(page.locator('input')).toHaveCount(0)
    await expect(page.getByRole('link', { name: /nazad na prijavu/i })).toBeVisible()
  })

  test('promjena lozinke traži prijavu', async ({ page }) => {
    await page.goto('/change-password')
    await expect(page).toHaveURL(/\/login$/)
  })
})
