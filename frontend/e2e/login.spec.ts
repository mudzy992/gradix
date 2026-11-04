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

test('remembered refresh is serialized across tabs without adopting an unknown session', async ({ page, context }) => {
  const email = process.env.E2E_LOGIN_EMAIL
  const password = process.env.E2E_LOGIN_PASSWORD
  test.skip(!email || !password, 'E2E login credentials not set')
  await page.goto('/login')
  await page.locator('#identifier').fill(email!)
  await page.locator('#password').fill(password!)
  await page.getByRole('checkbox', { name: /zapamti|remember/i }).check()
  await page.getByRole('button', { name: /prijavi|sign in/i }).click()
  await expect(page).toHaveURL(/dashboard/, { timeout: 15_000 })

  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  let refreshCount = 0
  await context.route('**/api/auth/refresh', async (route) => {
    refreshCount += 1
    if (refreshCount === 1) await gate
    await route.continue()
  })
  const first = await context.newPage()
  const second = await context.newPage()
  try {
    await first.goto('/dashboard')
    await expect.poll(() => refreshCount).toBe(1)
    await second.goto('/dashboard')
    await expect.poll(async () => first.evaluate(async () => {
      const snapshot = await navigator.locks.query()
      return snapshot.pending?.filter((lock) => lock.name === 'gradix:remembered-refresh').length ?? 0
    })).toBe(1)
    release()
    await expect(first.getByRole('navigation').first()).toBeVisible()
    await expect(second).toHaveURL(/\/login$/)
    expect(refreshCount).toBe(1)
    // A deliberate reload starts a fresh bootstrap against the now-current
    // shared token, rather than silently switching an existing session.
    await second.goto('/dashboard')
    await expect(second.getByRole('navigation').first()).toBeVisible()
  } finally {
    release()
    await context.unroute('**/api/auth/refresh')
  }
})
