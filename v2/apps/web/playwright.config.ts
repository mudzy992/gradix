/**
 * Playwright E2E (A4c, 2026-11-07) — najmanji skup koji dokazuje navigaciju i sesiju
 * u pravom pregledniku: prijava po rolama, meni po roli, odjava -> prijava, istek sesije.
 * Server i seed diže CI korak (ili lokalno `pnpm test:e2e` uz već pokrenut `pnpm dev`
 * i poseedovanu bazu); ovdje se server ne starta da lokalni dev ne bi bio ubijen.
 */
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  // Bez automatskog ponavljanja: retry u CI-ju je skrivao povremene padove E2E
  // (tri pada pa prolaz na rerun, R4a-2/A). Stabilnost se mjeri workflowom
  // `e2e-stabilnost.yml` (20+ pokretanja, svako bez retryja).
  retries: 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  // CI: github reporter pretvara padove u anotacije (logovi runa nisu uvijek dostupni).
  reporter: process.env.CI ? "github" : "list",
});
