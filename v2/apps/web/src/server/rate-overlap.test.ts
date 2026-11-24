/**
 * Mapiranje greške preklapanja satnica — jedinični test, BEZ baze.
 *
 * Zašto postoji: `worker_rates` preklapanje ima dva nosioca (vidi migraciju
 * `20261124140000_f3_1_workdays_workers`) — `EXCLUDE USING gist` kad je `btree_gist` dostupan i
 * triger sa savjetodavnom bravom kad nije. Na jednoj bazi je aktivan samo jedan, pa bi drugi put
 * ostao neprovjeren. Tačno tako je i nastao pad u CI-ju: migracija je tražila `btree_gist` bez
 * uslova i pala na bazi bez contrib-a, a servis je znao samo za SQLSTATE `23P01`.
 */
import { describe, expect, it } from "vitest";
import { isRateOverlapError } from "./worker-service";

describe("preklapanje satnica — prepoznavanje greške baze", () => {
  it("triger: naša poruka RATE_OVERLAP", () => {
    expect(isRateOverlapError(new Error("RATE_OVERLAP"))).toBe(true);
  });

  it("EXCLUDE: SQLSTATE 23P01 (exclusion_violation)", () => {
    const error = Object.assign(new Error("conflicting key value violates exclusion constraint"), {
      code: "23P01",
      constraint: "worker_rates_no_overlap",
    });
    expect(isRateOverlapError(error)).toBe(true);
  });

  it("EXCLUDE prepoznat i po imenu constraint-a", () => {
    expect(isRateOverlapError({ constraint: "worker_rates_no_overlap" })).toBe(true);
  });

  it("druge greške baze se NE pretvaraju u RATE_OVERLAP", () => {
    expect(isRateOverlapError(Object.assign(new Error("fk"), { code: "23503" }))).toBe(false);
    expect(isRateOverlapError(new Error("duplicate key value violates unique constraint"))).toBe(false);
    expect(isRateOverlapError(Object.assign(new Error("x"), { constraint: "project_assignments_worker_no_overlap" }))).toBe(false);
    expect(isRateOverlapError(null)).toBe(false);
    expect(isRateOverlapError(undefined)).toBe(false);
  });
});
