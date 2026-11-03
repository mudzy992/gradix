import fs from 'node:fs'
import path from 'node:path'
import { expect, type Page, test } from '@playwright/test'

/**
 * FE-06 — priprema sesija (Playwright `setup` projekat).
 *
 * Zašto: backend ograničava prijavu na **5 pokušaja u minuti po IP-u** (`@Throttle` u
 * `auth.controller.ts`, D-042). Kada je svaki test sam pravio prijavu, 16 testova je u sekundi
 * potrošilo kvotu i testovi su padali na `/login` — ne zbog koda, nego zbog rate-limita.
 * Sada se prijave rade **jednom po roli**, stanje se čuva u `storageState` (localStorage sa
 * refresh tokenom), a bootstrap (`useAuthBootstrap`) na svakom učitavanju obnovi sesiju.
 */
const ADMIN = {
  email: process.env.E2E_LOGIN_EMAIL ?? '',
  password: process.env.E2E_LOGIN_PASSWORD ?? '',
}
const WORKER = {
  email: process.env.E2E_WORKER_EMAIL ?? '',
  password: process.env.E2E_WORKER_PASSWORD ?? process.env.E2E_LOGIN_PASSWORD ?? '',
}

const AUTH_DIR = path.join(import.meta.dirname, '.auth')

async function saveState(page: Page, file: string) {
  fs.mkdirSync(AUTH_DIR, { recursive: true })
  await page.context().storageState({ path: path.join(AUTH_DIR, file) })
}

/** Prazno stanje — da zavisni projekti ne padnu lokalno kad kredencijala nema. */
function emptyState(file: string) {
  fs.mkdirSync(AUTH_DIR, { recursive: true })
  const target = path.join(AUTH_DIR, file)
  if (!fs.existsSync(target)) {
    fs.writeFileSync(target, JSON.stringify({ cookies: [], origins: [] }))
  }
}

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.locator('#identifier').fill(email)
  await page.locator('#password').fill(password)
  await page.getByRole('button', { name: /prijavi|sign in/i }).click()
  await expect(page).toHaveURL(/dashboard/, { timeout: 20_000 })
}

test('pripremi sesiju administratora', async ({ page }) => {
  if (!ADMIN.email || !ADMIN.password) {
    emptyState('admin.json')
  }
  test.skip(!ADMIN.email || !ADMIN.password, 'E2E login kredencijali nisu postavljeni')
  await login(page, ADMIN.email, ADMIN.password)
  await saveState(page, 'admin.json')
})

test('pripremi sesiju radnika', async ({ page }) => {
  if (!WORKER.email || !WORKER.password) {
    emptyState('worker.json')
  }
  test.skip(!WORKER.email || !WORKER.password, 'E2E worker kredencijali nisu postavljeni')
  await login(page, WORKER.email, WORKER.password)
  await saveState(page, 'worker.json')
})
