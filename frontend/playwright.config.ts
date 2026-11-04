import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  // FE-06: u CI-ju jedan retry — flake u mreži ne smije oboriti zeleni kod, a pravi pad se
  // i dalje vidi (drugi pokušaj padne isto). Trace se snima **na pad**, ne na retry
  // (ranije `on-first-retry` nije snimio ništa jer retries nije bilo).
  retries: process.env.CI ? 1 : 0,
  // FE-13 (D-053): `admin` i `worker` projekti dijele **isti seed** (zadatak `Iskop kanala` i njegov
  // timer). Kad se izvršavaju paralelno, radnik pokrene timer dok admin čita tablu — testovi su tada
  // zavisili od rasporeda (run 41792084133: „tabla zadataka“ i „timer“ pali su naizmjence). U CI-ju se
  // zato izvršavaju serijski; lokalno (bez CI) ostaje paralelno.
  workers: process.env.CI ? 1 : undefined,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  // FE-06: svaki spec fajl otvara **jednu** sesiju (`e2e/session.ts`) — backend rotira refresh
  // token i reuse tretira kao krađu, pa `storageState` po testu odjavljuje sve sesije (F-FE-06-06).
  // `guest` projekat nema sesiju: prijava, a11y i guardovi se provjeravaju bez prijave.
  projects: [
    {
      name: 'guest',
      testMatch: [/login\.spec\.ts/, /a11y\.spec\.ts/, /guards\.spec\.ts/, /auth-pages\.spec\.ts/],
      use: { ...devices['Desktop Chrome'] },
    },
    { name: 'admin', testMatch: /flows\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    { name: 'worker', testMatch: /worker-flow\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
  ],
})
