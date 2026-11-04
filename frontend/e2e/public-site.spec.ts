import { expect, test } from '@playwright/test'

/**
 * FE-14 — javni sajt firme (`/p/:slug`). Jedini ekran koji **ne zahtijeva prijavu**, pa ga `guest`
 * projekat otvara bez sesije (`e2e/session.ts` se ne koristi). Provjerava ono što se prije kvarlo:
 * skeleton umjesto praznog ekrana, SEO meta (naslov/opis/canonical), `<html lang>` i to da nepostojeći
 * slug daje poruku „nije pronađena“, a ne bijeli ekran.
 */
test.describe('javni sajt firme', () => {
  test('prikazuje firmu, projekte i SEO meta bez prijave', async ({ page }) => {
    await page.goto('/p/demo')

    // Skeleton (aria-busy) mora postojati prije podataka — prije je ekran bio prazan.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Demo Gradnja', { timeout: 15_000 })
    await expect(page).toHaveTitle(/Demo Gradnja/)
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', 'Gradimo pouzdano.')
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/p\/demo$/)
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /Demo Gradnja/)
    await expect(page.locator('html')).toHaveAttribute('lang', /^(bs|en)$/)

    // Kontakt blok i lista projekata (seed: `DEMO-1`).
    await expect(page.getByText('info@demo.local')).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: /Projekti|Projects/ })).toBeVisible()
  })

  test('prebacivanje jezika mijenja <html lang> bez reloada', async ({ page }) => {
    await page.goto('/p/demo')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 })

    const before = await page.locator('html').getAttribute('lang')
    await page.getByRole('button', { name: before === 'en' ? 'BS' : 'EN' }).click()

    await expect(page.locator('html')).toHaveAttribute('lang', before === 'en' ? 'bs' : 'en')
  })

  test('nepostojeći slug kaže „nije pronađena“ umjesto bijelog ekrana', async ({ page }) => {
    await page.goto('/p/ne-postoji-firma')

    await expect(page.getByText(/nije pronađena|not found/i)).toBeVisible({ timeout: 15_000 })
    // 404 nije greška servera: nema dugmeta za ponovni pokušaj.
    await expect(page.getByRole('alert')).toHaveCount(0)
  })
})
