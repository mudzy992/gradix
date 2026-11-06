import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { emptyDashboardResponse, parseShotsConfig } from './shots-helpers.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const require = createRequire(path.join(root, 'frontend/package.json'))
const { chromium } = require('@playwright/test')
const output = path.join(root, 'docs/design/FE-17-screenshots')
const config = parseShotsConfig(process.env)
const metrics = { note: 'Local single-run observations, not production field metrics. Empty-company data is a browser-only fixture.', baselineRevision: config.baselineRevision, axe: 'not run', measurements: {} }
let baseline, temp, browser

async function freePort() {
  const server = createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const { port } = server.address()
  await new Promise((resolve) => server.close(resolve))
  return port
}
async function startBaseline() {
  temp = await mkdtemp(path.join(tmpdir(), 'gradix-dashboard-baseline-'))
  const archive = execFileSync('git', ['archive', config.baselineRevision, 'frontend'], { cwd: root, maxBuffer: 30 * 1024 * 1024 })
  const extraction = spawnSync('tar', ['-xf', '-', '-C', temp], { input: archive })
  if (extraction.status !== 0) throw new Error('Unable to extract the pinned dashboard baseline')
  const frontend = path.join(temp, 'frontend')
  await symlink(path.join(root, 'frontend/node_modules'), path.join(frontend, 'node_modules'), 'dir')
  const port = await freePort()
  baseline = spawn(process.execPath, [path.join(frontend, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: frontend, env: { ...process.env, VITE_API_TARGET: process.env.DASHBOARD_BASELINE_API_TARGET || 'http://127.0.0.1:3000' }, stdio: 'ignore',
  })
  const url = `http://127.0.0.1:${port}`
  for (let attempt = 0; attempt < 60; attempt++) {
    if (baseline.exitCode !== null) throw new Error('Baseline dev server exited')
    try { if ((await fetch(url)).ok) return url } catch { /* wait for startup */ }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Baseline dev server did not start')
}
async function login(page, url) {
  await page.goto(`${url}/login`, { waitUntil: 'domcontentloaded' })
  await page.locator('#identifier').fill(config.email)
  await page.locator('#password').fill(config.password)
  await page.getByRole('button', { name: /prijavi|sign in/i }).click()
  await page.waitForURL('**/dashboard', { timeout: 30_000 })
  await page.getByRole('heading', { level: 1 }).waitFor({ timeout: 30_000 })
}
async function settleDashboard(page) {
  await page.getByText('Aktivni projekti', { exact: true }).waitFor({ timeout: 30_000 })
  await page.waitForFunction(() => document.querySelectorAll('.dashboard-skeleton').length === 0, null, { timeout: 30_000 })
  // Allow tile errors and theme transitions to settle; no forced animation in captures.
  await page.waitForTimeout(800)
  if (await page.getByRole('alert').count()) throw new Error('Dashboard showed a loading error; no screenshot was accepted')
  await page.evaluate(() => window.scrollTo(0, 0))
}
async function capture(page, name, width, height, recordMetrics = true) {
  await page.setViewportSize({ width, height })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(output, name), fullPage: true, animations: 'disabled' })
  const measurement = await page.evaluate(() => ({
    lcpMs: window.__dashboardMetrics?.lcp ?? null,
    cls: window.__dashboardMetrics?.cls ?? null,
    horizontalOverflowPx: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }))
  if (recordMetrics) metrics.measurements[name] = measurement
  if (measurement.horizontalOverflowPx > 1) throw new Error(`${name}: horizontal overflow`)
}
async function startMeasurements(context) {
  await context.addInitScript(() => {
    window.__dashboardMetrics = { lcp: null, cls: 0 }
    try {
      new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__dashboardMetrics.lcp = entry.startTime }).observe({ type: 'largest-contentful-paint', buffered: true })
      let sessionStart = null, sessionLast = null, sessionValue = 0
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.hadRecentInput) continue
          if (sessionStart === null || entry.startTime - sessionLast > 1000 || entry.startTime - sessionStart > 5000) {
            sessionStart = entry.startTime
            sessionValue = 0
          }
          sessionLast = entry.startTime
          sessionValue += entry.value
          window.__dashboardMetrics.cls = Math.max(window.__dashboardMetrics.cls, sessionValue)
        }
      }).observe({ type: 'layout-shift', buffered: true })
    } catch { /* browser does not support these metrics */ }
  })
}
async function navigateDashboard(page, url, width, height) {
  await page.setViewportSize({ width, height })
  await page.goto(`${url}/dashboard`, { waitUntil: 'domcontentloaded' })
  await settleDashboard(page)
}
async function axeCheck(page, name) {
  if (!process.env.AXE_CORE_PATH) return
  if (!await page.evaluate(() => Boolean(window.axe))) await page.addScriptTag({ path: process.env.AXE_CORE_PATH })
  const issues = await page.evaluate(async () => {
    const results = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })
    return results.violations.filter((item) => ['critical', 'serious'].includes(item.impact)).map((item) => ({ id: item.id, impact: item.impact, count: item.nodes.length }))
  })
  if (metrics.axe === 'not run') metrics.axe = {}
  metrics.axe[name] = issues
  if (issues.length) throw new Error(`${name}: axe found serious or critical violations`)
}
try {
  await mkdir(output, { recursive: true })
  const baselineUrl = await startBaseline()
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}), args: ['--no-sandbox'] })
  const oldContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  await startMeasurements(oldContext)
  const oldPage = await oldContext.newPage()
  await login(oldPage, baselineUrl)
  await oldPage.goto(`${baselineUrl}/dashboard`, { waitUntil: 'domcontentloaded' })
  await oldPage.getByText('Aktivni projekti', { exact: true }).first().waitFor({ timeout: 30_000 })
  await oldPage.waitForTimeout(800)
  await capture(oldPage, 'before-admin-desktop.png', 1440, 900)
  await oldContext.close()

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  await startMeasurements(context)
  const page = await context.newPage()
  await login(page, config.url)
  await navigateDashboard(page, config.url, 1440, 900)
  await capture(page, 'admin-light-desktop.png', 1440, 900)
  await axeCheck(page, 'admin-light-desktop')
  await navigateDashboard(page, config.url, 390, 844)
  await capture(page, 'admin-light-mobile.png', 390, 844)
  await axeCheck(page, 'admin-light-mobile')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('button', { name: 'Tamni prikaz' }).click()
  await page.waitForTimeout(600)
  await navigateDashboard(page, config.url, 1440, 900)
  await capture(page, 'admin-dark-desktop.png', 1440, 900)
  await axeCheck(page, 'admin-dark-desktop')
  await navigateDashboard(page, config.url, 390, 844)
  await capture(page, 'admin-dark-mobile.png', 390, 844)
  await axeCheck(page, 'admin-dark-mobile')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.keyboard.press('Control+k')
  await page.getByRole('dialog', { name: 'Brza navigacija' }).waitFor()
  await page.waitForTimeout(300)
  await capture(page, 'admin-command-desktop.png', 1440, 900, false)
  await axeCheck(page, 'admin-command-desktop')
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'hidden' })

  await context.route('**/api/**', async (route) => {
    const request = route.request()
    const requestUrl = new URL(request.url())
    const fixture = request.method() === 'GET' && requestUrl.origin === config.url ? emptyDashboardResponse(requestUrl.pathname) : null
    if (fixture) await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) })
    else await route.continue()
  })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('button', { name: 'Svijetli prikaz' }).click()
  await navigateDashboard(page, config.url, 1440, 900)
  await page.getByText('Nema aktivnih projekata.', { exact: true }).waitFor()
  await capture(page, 'admin-empty-desktop.png', 1440, 900)
  await axeCheck(page, 'admin-empty-desktop')
  await navigateDashboard(page, config.url, 390, 844)
  await capture(page, 'admin-empty-mobile.png', 390, 844)
  await axeCheck(page, 'admin-empty-mobile')
  await context.close()
  await writeFile(path.join(output, 'measurements.json'), `${JSON.stringify(metrics, null, 2)}\n`)
  process.stdout.write(`Dashboard screenshots saved to ${path.relative(root, output)}\n`)
} finally {
  if (browser) await browser.close()
  if (baseline) { baseline.kill('SIGTERM'); await new Promise((resolve) => { if (baseline.exitCode !== null) resolve(); else baseline.once('exit', resolve) }) }
  if (temp) await rm(temp, { recursive: true, force: true })
}
