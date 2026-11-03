import { expect, test } from '@playwright/test'

/**
 * FE-03 — provjere pristupačnosti koje se mogu izvršiti bez prijave.
 * Namjerno **bez** axe-a: tri tvrdnje koje pokrivaju najčešće regresije (naslov, vidljiv fokus,
 * reflow na 320 px) i ne uvode novu zavisnost u CI.
 */
test.describe('a11y (FE-03)', () => {
  test('prijava: jedno h1, labele povezane sa poljima', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.getByLabel(/email|telefon/i)).toBeVisible()
    await expect(page.getByLabel(/lozinka|password/i)).toBeVisible()
  })

  test('prijava: prazna polja daju poruku uz polje i aria-invalid', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('button', { name: /prijavi|sign in/i }).click()
    await expect(page.locator('#identifier')).toHaveAttribute('aria-invalid', 'true')
    await expect(page.locator('#identifier-error')).toBeVisible()
    await expect(page.locator('#password')).toHaveAttribute('aria-invalid', 'true')
  })

  test('fokus je vidljiv pri kretanju tastaturom', async ({ page }) => {
    await page.goto('/login')
    await page.keyboard.press('Tab')
    const focused = await page.evaluate(() => {
      const element = document.querySelector<HTMLElement>(':focus-visible')
      if (!element) return { found: false, outlineStyle: '', outlineWidth: '' }
      const style = getComputedStyle(element)
      return {
        found: true,
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
      }
    })
    expect(focused.found).toBe(true)
    expect(focused.outlineStyle).not.toBe('none')
    expect(focused.outlineWidth).not.toBe('0px')
  })

  test('nema horizontalnog skrola na 320 px (WCAG 1.4.10 reflow)', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    await page.goto('/login')
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)
  })
})
