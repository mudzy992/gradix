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

  test('fokus je vidljiv i tastatura prolazi kroz polja', async ({ page }) => {
    await page.goto('/login')

    // Tekstualna polja uvijek matchuju `:focus-visible` (spec), pa je provjera deterministička
    // i ne zavisi od toga gdje se nalazi fokus headless browsera prije prvog Tab-a.
    const identifier = page.locator('#identifier')
    await identifier.focus()
    const textField = await identifier.evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        focusVisible: element.matches(':focus-visible'),
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
      }
    })
    expect(textField.focusVisible).toBe(true)
    expect(textField.outlineStyle).not.toBe('none')
    expect(textField.outlineWidth).not.toBe('0px')

    // Redoslijed u DOM-u (FE-07): lozinka → prekidač vidljivosti → „zapamti me“.
    await page.locator('#password').focus()
    await page.keyboard.press('Tab')
    const toggle = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null
      return element
        ? {
            role: element.getAttribute('role') ?? element.tagName.toLowerCase(),
            label: element.getAttribute('aria-label') ?? '',
            outlineStyle: getComputedStyle(element).outlineStyle,
          }
        : { role: '', label: '', outlineStyle: 'none' }
    })
    expect(toggle.label).toMatch(/prikaži lozinku|show password/i)
    expect(toggle.outlineStyle).not.toBe('none')

    await page.keyboard.press('Tab')
    const next = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null
      return element
        ? { id: element.id, outlineStyle: getComputedStyle(element).outlineStyle }
        : { id: '', outlineStyle: 'none' }
    })
    expect(next.id).toBe('remember')
    expect(next.outlineStyle).not.toBe('none')
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
