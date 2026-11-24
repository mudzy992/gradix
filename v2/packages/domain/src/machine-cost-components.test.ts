/**
 * Zlatni testovi Modula 5 (Faza 4) — pravila iz `docs/specs/05-mehanizacija.md`, §5.
 *
 * Ovo su testovi koje ne smije niko „popraviti" bez odluke vlasnika: dijele se mjesečne rate,
 * definiše se iskorištenost, i postavlja se granica odstupanja goriva. Svaki od njih čuva
 * konkretan broj koji se mijenja kad neko promijeni formulu.
 */
import { describe, expect, it } from "vitest";
import { MoneyError } from "./money";
import {
  computedRatePerHour,
  fuelConsumption,
  fuelDeviation,
  rateWithKm,
  utilization,
  type CostComponentRow,
} from "./machine-cost-components";

const comp = (
  component: CostComponentRow["component"],
  basis: CostComponentRow["basis"],
  amountCents: bigint,
): CostComponentRow => ({ component, basis, amountCents, currencyCode: "BAM" });

describe("izračunata stopa mašine (spec 05 §1.1.2)", () => {
  it("PER_HOUR ide 1:1, PER_MONTH se dijeli sa planiranim satima", () => {
    const rate = computedRatePerHour(
      [comp("FUEL", "PER_HOUR", 1800n), comp("DEPRECIATION", "PER_MONTH", 160_000n)],
      160,
    );
    // 160000 / 160 = 1000 centi/h; + 1800 = 2800 centi/h
    expect(rate.rateCents).toBe(2800n);
    const dep = rate.breakdown.find((row) => row.component === "DEPRECIATION");
    expect(dep?.centsPerHour).toBe(1000n);
  });

  it("isti mjesečni iznos na 320 sati daje DUPLO manje po satu", () => {
    const single = computedRatePerHour([comp("DEPRECIATION", "PER_MONTH", 160_000n)], 160);
    const double = computedRatePerHour([comp("DEPRECIATION", "PER_MONTH", 160_000n)], 320);
    expect(single.rateCents).toBe(1000n);
    expect(double.rateCents).toBe(500n);
    // Ovo je razlog zašto je `planned_hours_per_month` parametar firme, a ne konstanta: ista
    // depresijacija daje dvostruko različit trošak po satu u dvije smjene.
  });

  it("mjesečna rata se zaokružuje naviše na cent (mašina ne smije izgledati jeftinija)", () => {
    const rate = computedRatePerHour([comp("INSURANCE", "PER_MONTH", 50_000n)], 160);
    // 50000/160 = 312.5 → 313
    expect(rate.rateCents).toBe(313n);
  });

  it("zbir razlaganja je TAČNO ukupna stopa (kolone se moraju sabrati)", () => {
    const rate = computedRatePerHour(
      [
        comp("DEPRECIATION", "PER_MONTH", 64_000n),
        comp("SERVICE", "PER_HOUR", 450n),
        comp("OPERATOR", "PER_HOUR", 2200n),
        comp("INSURANCE", "PER_MONTH", 9_600n),
        comp("RENTAL", "PER_MONTH", 160_000n),
      ],
      160,
    );
    const sum = rate.breakdown.reduce((acc, row) => acc + row.centsPerHour, 0n);
    expect(sum).toBe(rate.rateCents);
    expect(rate.rateCents).toBe(400n + 450n + 2200n + 60n + 1000n);
  });

  it("PER_KM ne ulazi u satnu stopu bez kilometraže", () => {
    const rate = computedRatePerHour([comp("SERVICE", "PER_HOUR", 500n), comp("OTHER", "PER_KM", 120n)], 160);
    expect(rate.rateCents).toBe(500n);
    // Kilometraža je odvojen poziv — ista mašina ima istu stopu na sat, a različit trošak po km.
    expect(rateWithKm(rate, [comp("OTHER", "PER_KM", 120n)], 10)).toBe(500n + 1200n);
  });

  it("odbija negativnu komponentu i nula planiranih sati", () => {
    expect(() => computedRatePerHour([comp("FUEL", "PER_HOUR", -1n)])).toThrow(MoneyError);
    expect(() => computedRatePerHour([comp("FUEL", "PER_HOUR", 100n)], 0)).toThrow(MoneyError);
  });
});

describe("iskorištenost (spec 05 §1.2.8)", () => {
  it("primarna kolona je WORK / (WORK + IDLE + BREAKDOWN)", () => {
    const result = utilization(
      [
        { mode: "WORK", hours: 6 },
        { mode: "IDLE", hours: 2 },
        { mode: "BREAKDOWN", hours: 2 },
      ],
      10,
    );
    expect(result.utilizationPct).toBe(60);
    expect(result.workHours).toBe(6);
    expect(result.idleHours).toBe(2);
    expect(result.breakdownHours).toBe(2);
  });

  it("sekundarna kolona dijeli sa kalendarskim radnim satima, ne sa evidentiranim", () => {
    const result = utilization([{ mode: "WORK", hours: 6 }, { mode: "IDLE", hours: 2 }], 8);
    expect(result.utilizationPct).toBe(75); // 6/8 evidentiranih
    expect(result.calendarUtilizationPct).toBe(75); // 6/8 kalendarskih — ovdje se poklapaju
  });

  it("dvije kolone se RAZLIKUJU kad mašina nije evidentirana cijeli dan", () => {
    const result = utilization([{ mode: "WORK", hours: 4 }], 8);
    // Primarna: sve evidentirano je bio rad → 100%. Sekundarna: radila je pola dana → 50%.
    expect(result.utilizationPct).toBe(100);
    expect(result.calendarUtilizationPct).toBe(50);
  });

  it("bez ijednog zapisa vraća null, ne lažnu nulu", () => {
    const result = utilization([], 8);
    expect(result.utilizationPct).toBeNull();
    expect(result.calendarUtilizationPct).toBe(0);
    // Sekundarna je 0 jer je nazivnik poznat (8 h) a rad je nula — to je izmjereno.
    // Primarna je `null` jer nema evidentiranog vremena: o mašini se ne zna ništa.
  });
});

describe("potrošnja goriva (spec 05 §1.3.12)", () => {
  it("l/h za brojilo sati", () => {
    const value = fuelConsumption({ liters: 40, meterStart: 100, meterEnd: 108, meter: "HOURS" });
    expect(value).toEqual({ value: 5, unit: "l/h" });
  });

  it("l/100km za brojilo kilometara", () => {
    const value = fuelConsumption({ liters: 30, meterStart: 1000, meterEnd: 1300, meter: "KM" });
    expect(value).toEqual({ value: 10, unit: "l/100km" });
  });

  it("nepoznata ili nulta razlika brojila daje null (nema lažne nule)", () => {
    expect(fuelConsumption({ liters: 40, meterStart: null, meterEnd: 108, meter: "HOURS" })).toBeNull();
    expect(fuelConsumption({ liters: 40, meterStart: 108, meterEnd: 108, meter: "HOURS" })).toBeNull();
  });
});

describe("odstupanje goriva (spec 05 §1.3.13)", () => {
  it("prelazak praga 20% podiže upozorenje", () => {
    const result = fuelDeviation({ consumption: 12, baseline: 10, thresholdPct: 20 });
    expect(result.deviationPct).toBe(20);
    // Granica: 20,0% JESTE iznad „20% iznad". `>` bi propustio tačno ovaj slučaj.
    expect(result.flagged).toBe(true);
  });

  it("ispod praga ne podiže upozorenje", () => {
    const result = fuelDeviation({ consumption: 11.9, baseline: 10, thresholdPct: 20 });
    expect(result.deviationPct).toBe(19);
    expect(result.flagged).toBe(false);
  });

  it("bez prosjeka nema odstupanja (nema dijeljenja nulom)", () => {
    expect(fuelDeviation({ consumption: 12, baseline: 0, thresholdPct: 20 })).toEqual({
      deviationPct: null,
      flagged: false,
    });
  });

  it("prag je podesiv po firmi", () => {
    expect(fuelDeviation({ consumption: 12, baseline: 10, thresholdPct: 50 }).flagged).toBe(false);
    expect(fuelDeviation({ consumption: 16, baseline: 10, thresholdPct: 50 }).flagged).toBe(true);
  });

  it("odbija neispravan prag", () => {
    expect(() => fuelDeviation({ consumption: 12, baseline: 10, thresholdPct: 0 })).toThrow(MoneyError);
  });
});
