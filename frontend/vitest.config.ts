import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * FE-05 (D-044) — unit/component testovi frontenda.
 *
 * Zašto Vitest a ne Jest: frontend je ESM + Vite (TS, alias `@`, Tailwind), pa Vitest koristi
 * isti pipeline i isti `vite.config.ts`-ov alias bez druge konfiguracije transformacije.
 * jsdom je dovoljan za komponente — pravi browser pokriva Playwright u CI jobu „Web E2E“.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    // Playwright živi u `e2e/` — Vitest ga ne smije pokupiti.
    include: ['src/**/*.spec.{ts,tsx}', 'test/**/*.spec.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      // Ratchet po segmentu (P5): mjeri se **samo** ono što je FE-05 pokrio. Svaki sljedeći
      // segment (FE-15/FE-16…) dodaje svoj fajl u listu i prag ostaje visok — globalni procenat
      // preko 500+ još netestiranih fajlova ne bi ništa garantovao.
      include: [
        'src/lib/dash.ts',
        'src/lib/payroll-access.ts',
        'src/components/layout/navigation.ts',
        'src/pages/dashboard-page.tsx',
        // FE-07 — auth ekrani i njihovi dijelovi
        'src/pages/login-page.tsx',
        'src/pages/forgot-page.tsx',
        'src/pages/reset-page.tsx',
        'src/pages/change-password-page.tsx',
        'src/components/auth/auth-card.tsx',
        'src/components/auth/password-input.tsx',
        // FE-08 — operacije (projekti, zadaci) i mape enuma
        'src/lib/labels.ts',
        'src/pages/projects-page.tsx',
        'src/pages/tasks-page.tsx',
        'src/pages/task-detail-page.tsx',
        // FE-09 — flota i logistika
        'src/pages/fleet-page.tsx',
        'src/pages/fleet-map-page.tsx',
        'src/pages/logistics-page.tsx',
        // FE-10 — dnevnik, HSE, dokumenti
        'src/pages/diary-page.tsx',
        'src/pages/hse-page.tsx',
        'src/pages/documents-page.tsx',
        'src/components/ops/diary-conflict-sheet.tsx',
        // FE-11 — ured: tenderi, servis, izvještaji
        'src/pages/tenders-page.tsx',
        'src/pages/services-page.tsx',
        'src/pages/reports-page.tsx',
        // FE-12 — obračun i ERP-lite
        'src/pages/payroll-page.tsx',
        'src/pages/erp-page.tsx',
        'src/components/erp/erp-partners-tab.tsx',
        'src/components/erp/erp-costs-tab.tsx',
        'src/components/erp/erp-stock-tab.tsx',
        // FE-13 — administracija
        'src/pages/settings-page.tsx',
        'src/pages/users-page.tsx',
        'src/pages/companies-page.tsx',
        'src/components/settings/company-fields.tsx',
        'src/components/settings/registry-fields.tsx',
        'src/components/users/user-sheet.tsx',
        'src/components/users/temp-password-dialog.tsx',
        'src/components/companies/company-sheet.tsx',
        'src/components/layout/company-switcher.tsx',
        'src/lib/settings-keys.ts',
        // FE-14 — javni sajt i njegov tok (bez prijave)
        'src/pages/public-site-page.tsx',
        'src/lib/api-public.ts',
        'src/hooks/use-public-settings.ts',
        'src/components/settings/public-brand-fields.tsx',
        // FE-15 — jezgro: mrežni sloj, pohrana, keš, helperi i bootstrap
        'src/lib/api-client.ts',
        'src/lib/storage.ts',
        'src/lib/csv.ts',
        'src/lib/format-date.ts',
        'src/lib/query-client.ts',
        'src/lib/roles.ts',
        'src/lib/error-message.ts',
        'src/hooks/use-auth-bootstrap.ts',
        'src/hooks/use-me.ts',
        'src/hooks/use-tenant-ready.ts',
        'src/hooks/use-logout-sync.ts',
      ],
      thresholds: { lines: 85, functions: 85, statements: 85, branches: 85 },
    },
  },
})
