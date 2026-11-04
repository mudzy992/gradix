import { expect, test } from '@playwright/test'

/**
 * FE-06 — guardovi **bez** sesije. Namjerno odvojeno od `flows.spec.ts`: taj fajl koristi
 * prijavu u toku testa, a ovdje se provjerava upravo ponašanje bez prijave.
 */
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
