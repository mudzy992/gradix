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
      ],
      thresholds: { lines: 85, functions: 85, statements: 85, branches: 85 },
    },
  },
})
