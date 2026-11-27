/**
 * Ulaz za `apps/worker`: samo funkcije koje poslovi koriste.
 *
 * Zašto poseban ulaz, a ne glavni barrel: worker se **bundluje** (esbuild) u jedan fajl za
 * `Dockerfile.worker`. Glavni barrel `@gradix/domain` uvozi module sa relativnim putanjama bez
 * `.js` ekstenzija (to traži `moduleResolution: "Bundler"`), a Node ESM ih poslije bundlovanja
 * ne umije razriješiti (`Cannot find module '.../src/money'`). Ulaz koji re-eksportuje SAMO
 * `dates` i `obligations` nema takvih uvoza — to su samostalni moduli — pa i bundle ostaje čist
 * i worker ne mora nositi izvor cijelog paketa u produkcijsku sliku.
 *
 * Ne dodavati ovdje module koji nešto uvoze. Ako posao zatreba novu funkciju, prvo provjeri da
 * njen modul nema uvoza (ili je bezuvjetno bez ekstenzija), pa je tek onda izvezi ovdje.
 */
export {
  DEFAULT_TIMEZONE,
  businessDate,
  formatPgDate,
  isCalendarDate,
  isValidTimezone,
  safeTimezone,
} from "./dates";
export {
  BLOCKING_OBLIGATION_STATES,
  effectiveThresholds,
  obligationState,
  parseThresholds,
  type ObligationState,
} from "./obligations";
/*
 * F8: pragovi preventivnog održavanja u `reminders.scan`. Modul je bez uvoza, pa prolazi kroz
 * esbuild bundle kao i `dates`/`obligations`.
 */
export {
  addDays,
  evaluateMaintenance,
  formatHundredths,
  nextMaintenanceDue,
  type MaintenanceBasis,
  type MaintenanceEvaluation,
  type MaintenancePlanState,
  type MaintenanceStatus,
} from "./service-maintenance";
