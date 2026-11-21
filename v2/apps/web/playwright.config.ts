/**
 * Playwright E2E — A3 + B2 (desktop + Pixel 5).
 * Tagovi: @smoke (PR brzo), @deep / @deep-* (shardovi po segmentu).
 * Server diže CI; lokalno uz već pokrenut app + seed.
 */
import { defineConfig, devices } from "@playwright/test";

const grepEnv = process.env.E2E_GREP?.trim();

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  retries: 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  grep: grepEnv ? new RegExp(grepEnv) : undefined,
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], browserName: "chromium" },
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 5"], browserName: "chromium" },
    },
  ],
  reporter: process.env.CI ? "github" : "list",
});
