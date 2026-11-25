/**
 * F6 — podsjetnik „period nije zaključan“ (spec 07 §4, `/pregled`).
 *
 * Pravilo koje test čuva: podsjetnik se pali TEK poslije 5. u mjesecu. Da se palio 1., bio bi
 * šum koji računovodstvo nauči ignorisati — a upozorenje koje se ignoriše ne postoji.
 */
import { describe, expect, it } from "vitest";
import { previousMonth, reminderDue } from "./payroll-reminder";

describe("F6 podsjetnik — koji mjesec i kad", () => {
  it("prethodni mjesec prelazi godinu bez računanja sa Date", () => {
    expect(previousMonth("2026-01-15")).toEqual({ year: 2025, month: 12 });
    expect(previousMonth("2026-03-01")).toEqual({ year: 2026, month: 2 });
    expect(previousMonth("2026-12-31")).toEqual({ year: 2026, month: 11 });
  });

  it("5. je još ROK, ne propust — podsjetnik počinje 6.", () => {
    expect(reminderDue("2026-04-05")).toBe(false);
    expect(reminderDue("2026-04-06")).toBe(true);
    expect(reminderDue("2026-04-01")).toBe(false);
    expect(reminderDue("2026-04-30")).toBe(true);
  });
});
