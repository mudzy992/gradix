import { expect, test } from '@playwright/test'

test('login form is visible', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByLabel(/email/i)).toBeVisible()
  await expect(page.locator('#password')).toBeVisible()
  await expect(page.getByRole('button', { name: /prijavi|sign in/i })).toBeVisible()
})

test('seed admin can sign in', async ({ page }) => {
  const email = process.env.E2E_LOGIN_EMAIL
  const password = process.env.E2E_LOGIN_PASSWORD
  test.skip(!email || !password, 'E2E login credentials not set')
  await page.goto('/login')
  await page.locator('#identifier').fill(email)
  await page.locator('#password').fill(password)
  await page.getByRole('button', { name: /prijavi|sign in/i }).click()
  await expect(page).toHaveURL(/dashboard/, { timeout: 15_000 })
})
