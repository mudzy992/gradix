import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  // FE-06: u CI-ju jedan retry — flake u mreži ne smije oboriti zeleni kod, a pravi pad se
  // i dalje vidi (drugi pokušaj padne isto). Trace se snima **na pad**, ne na retry
  // (ranije `on-first-retry` nije snimio ništa jer retries nije bilo).
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  // FE-06: prijava se radi jednom po roli (`auth.setup.ts`) — backend dozvoljava 5 prijava/min po
  // IP-u, pa 16 testova koji se svaki prijavljuju troše kvotu i padaju bez krivice koda.
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'guest',
      testMatch: [/login\.spec\.ts/, /a11y\.spec\.ts/, /guards\.spec\.ts/],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'admin',
      testMatch: /flows\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/admin.json' },
    },
    {
      name: 'worker',
      testMatch: /worker-flow\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/worker.json' },
    },
  ],
})
