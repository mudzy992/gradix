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

test('refresh rate limit keeps the session and offers a deliberate retry', async ({ page }) => {
  const email = process.env.E2E_LOGIN_EMAIL
  const password = process.env.E2E_LOGIN_PASSWORD
  test.skip(!email || !password, 'E2E login credentials not set')
  await page.goto('/login')
  await page.locator('#identifier').fill(email!)
  await page.locator('#password').fill(password!)
  await page.getByRole('button', { name: /prijavi|sign in/i }).click()
  await expect(page).toHaveURL(/dashboard/, { timeout: 15_000 })
  const original = await page.evaluate(() => sessionStorage.getItem('gradix:refresh'))
  expect(original).not.toBeNull()
  let attempts = 0
  await page.route('**/api/auth/refresh', async (route) => {
    attempts += 1
    if (attempts === 1) {
      await route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code: 'RATE_LIMITED', message: 'limited' } }) })
    } else {
      await route.continue()
    }
  })
  try {
    await page.reload()
    await expect(page.getByRole('heading', { name: /obnova sesije nije uspjela|session recovery was unsuccessful/i })).toBeVisible()
    await expect(page.getByRole('alert')).toBeVisible()
    expect(await page.evaluate((token) => sessionStorage.getItem('gradix:refresh') === token, original)).toBe(true)
    expect(attempts).toBe(1)
    await page.getByRole('button', { name: /ponovi obnovu|retry recovery/i }).click()
    await expect(page.getByRole('navigation').first()).toBeVisible()
    expect(attempts).toBe(2)
    expect(await page.evaluate((token) => Boolean(sessionStorage.getItem('gradix:refresh')) && sessionStorage.getItem('gradix:refresh') !== token, original)).toBe(true)
  } finally {
    await page.unroute('**/api/auth/refresh')
  }
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

test('logout-all reaches only the same account and preserves another remembered login', async ({ page, context }) => {
  const adminEmail = process.env.E2E_LOGIN_EMAIL
  const adminPassword = process.env.E2E_LOGIN_PASSWORD
  const workerEmail = process.env.E2E_WORKER_EMAIL
  const workerPassword = process.env.E2E_WORKER_PASSWORD
  test.skip(!adminEmail || !adminPassword || !workerEmail || !workerPassword, 'E2E credentials not set')

  const login = async (tab: typeof page, email: string, password: string, remember = false) => {
    await tab.goto('/login')
    await tab.locator('#identifier').fill(email)
    await tab.locator('#password').fill(password)
    if (remember) await tab.getByRole('checkbox', { name: /zapamti|remember/i }).check()
    await tab.getByRole('button', { name: /prijavi|sign in/i }).click()
    await expect(tab).toHaveURL(/dashboard/, { timeout: 15_000 })
    await expect(tab.getByRole('navigation').first()).toBeVisible()
  }
  await login(page, adminEmail!, adminPassword!)
  const otherAdmin = await context.newPage()
  await login(otherAdmin, adminEmail!, adminPassword!)
  const worker = await context.newPage()
  await login(worker, workerEmail!, workerPassword!, true)

  await page.getByRole('button', { name: 'Demo Admin' }).click()
  await page.getByRole('menuitem', { name: /odjavi sve uređaje/i }).click()
  await expect(page).toHaveURL(/\/login$/)
  await expect(otherAdmin).toHaveURL(/\/login$/)
  await expect(worker.getByRole('navigation').first()).toBeVisible()
  await worker.reload()
  await expect(worker).toHaveURL(/dashboard/)
  await expect(worker.getByRole('navigation').first()).toBeVisible()
})

test('switching companies hides the previous project list during a failed refetch', async ({ page }) => {
  const platformUser = {
    id: 'test-platform', firstName: 'Test', lastName: 'Platform', employeeCode: null,
    email: 'test@example.test', roles: ['PLATFORM_ADMIN'], permissions: ['projects.read'],
    companyId: null, company: null, hourlyRate: null, mustChangePassword: false, locale: 'bs',
  }
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  let companyBRequests = 0
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    const ok = (data: unknown, meta?: object) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data, ...(meta ? { meta } : {}) }),
    })
    if (path === '/api/auth/login' || path === '/api/auth/refresh') {
      return ok({ accessToken: 'test-access', refreshToken: 'test-refresh', user: platformUser })
    }
    if (path === '/api/me') return ok(platformUser)
    if (path === '/api/companies') return ok([
      { id: 'tenant-a', name: 'Firma A', slug: 'firma-a', isActive: true },
      { id: 'tenant-b', name: 'Firma B', slug: 'firma-b', isActive: true },
    ])
    if (path === '/api/projects') {
      if (route.request().headers()['x-company-id'] === 'tenant-b') {
        companyBRequests += 1
        await gate
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code: 'INTERNAL_ERROR', message: 'test failure' } }) })
      }
      return ok([{ id: 'project-a', name: 'Povjerljivi projekat A', status: 'PLANNING', progressPercent: 0, plannedBudget: null, currentSpend: '0' }], { page: 1, limit: 20, total: 1 })
    }
    if (path === '/api/dashboard') return ok({ cards: [], expiring: [], presence: null })
    if (path === '/api/notifications') return ok([], { page: 1, limit: 20, total: 0 })
    return ok({})
  })
  try {
    await page.goto('/login')
    await page.locator('#identifier').fill('test@example.test')
    await page.locator('#password').fill('test-password')
    await page.getByRole('button', { name: /prijavi|sign in/i }).click()
    await expect(page).toHaveURL(/dashboard/)
    const selector = page.getByRole('combobox', { name: /izaberite firmu|select a company/i })
    await expect(selector).toBeEnabled()
    await selector.click()
    await page.getByRole('option', { name: 'Firma A' }).click()
    await page.goto('/projects')
    await expect(page.getByRole('link', { name: 'Povjerljivi projekat A' })).toBeVisible()
    await expect(selector).toBeEnabled()
    await selector.click()
    await page.getByRole('option', { name: 'Firma B' }).click()
    await expect.poll(() => companyBRequests).toBeGreaterThan(0)
    await expect(page.getByText('Povjerljivi projekat A')).toHaveCount(0)
    release()
    await expect(page.getByRole('alert').filter({ hasText: /projekti se nisu učitali/i })).toBeVisible()
    await expect(page.getByText('Povjerljivi projekat A')).toHaveCount(0)
  } finally {
    release()
    await page.unroute('**/api/**')
  }
})

test('password reset keeps its confirmation open until the one-time result arrives', async ({ page }) => {
  const email = process.env.E2E_LOGIN_EMAIL
  const password = process.env.E2E_LOGIN_PASSWORD
  test.skip(!email || !password, 'E2E login credentials not set')
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  let resetCount = 0
  await page.route('**/api/users**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/users/test-user/reset-password') {
      resetCount += 1
      await gate
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { temporaryPassword: 'Temporary-example-123' } }) })
    }
    if (path === '/api/users') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [
        { id: 'test-user', firstName: 'Test', lastName: 'User', employeeCode: null, email: 'user@example.test', phone: null, companyId: 'tenant', hourlyRate: null, isActive: true, mustChangePassword: false, locale: 'bs', roles: ['WORKER'] },
      ], meta: { page: 1, limit: 20, total: 1 } }) })
    }
    return route.abort()
  })
  try {
    await page.goto('/login')
    await page.locator('#identifier').fill(email!)
    await page.locator('#password').fill(password!)
    await page.getByRole('button', { name: /prijavi|sign in/i }).click()
    await expect(page).toHaveURL(/dashboard/, { timeout: 15_000 })
    await page.goto('/users')
    await page.getByRole('button', { name: 'Reset lozinke' }).click()
    const dialog = page.getByRole('alertdialog')
    await dialog.getByRole('button', { name: 'Potvrdi' }).click()
    await expect(dialog.getByRole('status')).toContainText('Reset je u toku')
    await expect(dialog.getByRole('button', { name: 'Potvrdi' })).toBeDisabled()
    await expect(dialog.getByRole('button', { name: 'Otkaži' })).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    expect(resetCount).toBe(1)
    release()
    await expect(page.getByText('Temporary-example-123')).toBeVisible()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Potvrdi' }).click()
    await expect(page.getByText('Temporary-example-123')).toHaveCount(0)
  } finally {
    release()
    await page.unroute('**/api/users**')
  }
})

test('creating a user keeps the form open until the one-time result arrives', async ({ page }) => {
  const email = process.env.E2E_LOGIN_EMAIL
  const password = process.env.E2E_LOGIN_PASSWORD
  test.skip(!email || !password, 'E2E login credentials not set')
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  let createCount = 0
  await page.route('**/api/users**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === '/api/users' && request.method() === 'POST') {
      createCount += 1
      await gate
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { temporaryPassword: 'Temporary-example-456' } }) })
    }
    if (path === '/api/users' && request.method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [], meta: { page: 1, limit: 20, total: 0 } }) })
    }
    return route.abort()
  })
  try {
    await page.goto('/login')
    await page.locator('#identifier').fill(email!)
    await page.locator('#password').fill(password!)
    await page.getByRole('button', { name: /prijavi|sign in/i }).click()
    await expect(page).toHaveURL(/dashboard/, { timeout: 15_000 })
    await page.goto('/users')
    await page.getByRole('button', { name: 'Novi korisnik' }).click()
    const sheet = page.getByRole('dialog')
    await sheet.getByLabel('Ime', { exact: true }).fill('Test')
    await sheet.getByLabel('Prezime', { exact: true }).fill('User')
    await sheet.getByLabel('Email', { exact: true }).fill('user@example.test')
    await sheet.getByRole('checkbox', { name: 'Radnik' }).check()
    await sheet.getByRole('button', { name: 'Sačuvaj' }).click()
    await expect(sheet.getByRole('status')).toContainText('Spremanje je u toku')
    await expect(sheet.getByRole('button', { name: 'Sačuvaj' })).toBeDisabled()
    await expect(sheet.getByLabel('Ime', { exact: true })).toBeDisabled()
    await sheet.getByRole('button', { name: 'Zatvori' }).click()
    await page.keyboard.press('Escape')
    await expect(sheet).toBeVisible()
    await page.evaluate(() => window.history.back())
    await expect(page.getByText('Sačuvajte ili zatvorite obrazac, odnosno potvrdite jednokratnu lozinku prije napuštanja stranice.')).toBeVisible()
    await expect(page).toHaveURL(/\/users$/)
    expect(await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    })).toBe(true)
    expect(createCount).toBe(1)
    release()
    await expect(page.getByText('Temporary-example-456')).toBeVisible()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Potvrdi' }).click()
    await expect(page.getByText('Temporary-example-456')).toHaveCount(0)
  } finally {
    release()
    await page.unroute('**/api/users**')
  }
})
