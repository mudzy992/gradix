/**
 * Mapiranje greške preklapanja — jedinični test, BEZ baze.
 *
 * Zašto postoji pored integracionog: preklapanje u bazi ima dva moguća nosioca (vidi migraciju
 * `20261109160000_r3_preklapanje_gist`), a svaka baza ima samo JEDAN. Bez ovog testa mapiranje
 * jednog od njih nikad nije provjereno na mašini gdje taj mehanizam nije aktivan — a to je tačno
 * greška koja je prošla lokalno i pala u CI-ju.
 */
import { describe, expect, it } from "vitest";
import { isOverlapError, OVERLAP_MESSAGE } from "./project-service";

describe("preklapanje dodjela — prepoznavanje greške baze", () => {
  it("triger: naša poruka ASSIGNMENT_OVERLAP", () => {
    expect(isOverlapError(new Error("ASSIGNMENT_OVERLAP"))).toBe(true);
  });

  it("EXCLUDE: SQLSTATE 23P01 (exclusion_violation)", () => {
    const error = Object.assign(new Error('conflicting key value violates exclusion constraint'), {
      code: "23P01",
      constraint: "project_assignments_worker_no_overlap",
    });
    expect(isOverlapError(error)).toBe(true);
  });

  it("EXCLUDE bez koda, ali sa imenom constraint-a — i to je preklapanje", () => {
    expect(isOverlapError({ constraint: "project_assignments_machine_no_overlap" })).toBe(true);
  });

  it("druge greške NISU preklapanje (inače bi svaka greška baze postala 409)", () => {
    expect(isOverlapError(new Error("duplicate key value violates unique constraint"))).toBe(false);
    expect(isOverlapError(Object.assign(new Error("fk"), { code: "23503" }))).toBe(false);
    expect(isOverlapError(null)).toBe(false);
    expect(isOverlapError(undefined)).toBe(false);
    expect(isOverlapError("ASSIGNMENT_OVERLAP")).toBe(false);
  });

  it("poruka za korisnika je čitljiva i ne otkriva ime constraint-a", () => {
    expect(OVERLAP_MESSAGE).toContain("preklapa");
    expect(OVERLAP_MESSAGE).not.toContain("constraint");
    expect(OVERLAP_MESSAGE).not.toContain("23P01");
  });
});
