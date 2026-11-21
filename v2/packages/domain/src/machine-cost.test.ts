import { describe, expect, it } from "vitest";
import { MoneyError, toAmountString } from "./money";
import { computeCostAmount, computeHoursFromInterval } from "./machine-cost";

describe("computeHoursFromInterval", () => {
  it("računa sate na 3 decimale", () => {
    const start = new Date("2026-11-19T08:00:00.000Z");
    const end = new Date("2026-11-19T10:30:00.000Z");
    expect(computeHoursFromInterval(start, end)).toBe(2.5);
  });

  it("odbija prazan ili obrnut interval", () => {
    const t = new Date("2026-11-19T08:00:00.000Z");
    expect(() => computeHoursFromInterval(t, t)).toThrow(MoneyError);
  });
});

describe("computeCostAmount", () => {
  it("množi sate stopom preko Money", () => {
    const amount = computeCostAmount(2.5, 10000n, "BAM");
    expect(toAmountString(amount)).toBe("250.00");
    expect(amount.cents).toBe(25000n);
  });

  it("zaokružuje pola naviše", () => {
    const amount = computeCostAmount(1.001, 1n, "EUR");
    expect(amount.cents).toBe(1n);
  });

  it("odbija nulte sate", () => {
    expect(() => computeCostAmount(0, 100n, "BAM")).toThrow(MoneyError);
  });
});
