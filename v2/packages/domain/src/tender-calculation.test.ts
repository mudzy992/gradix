import { describe, expect, it } from "vitest";
import {
  blockingChecklistItems,
  calculateTender,
  directCostFromBoq,
  directCostFromResources,
  formatPercent,
  lineTotalCents,
  marginPct,
  parsePercent,
  parseQuantity,
  priceChangeCheck,
} from "./tender-calculation";

describe("Tender kalkulacija — novac i procenti", () => {
  it("količina sa tri decimale daje tačan iznos stavke", () => {
    // 12,5 m³ × 3,20 KM = 40,00 KM. Float bi dao 39.99999999999999.
    expect(lineTotalCents({ quantity: "12.500", unitCostCents: 320n })).toBe(4000n);
    // 0,333 h × 1000 centi = 333 centi (pola naviše, jedno zaokruživanje).
    expect(lineTotalCents({ quantity: "0.333", unitCostCents: 1000n })).toBe(333n);
    // 1,005 × 100 = 100,5 → 101 (pola naviše, ne bankarsko zaokruživanje).
    expect(lineTotalCents({ quantity: "1.005", unitCostCents: 100n })).toBe(101n);
  });

  it("zbir predmjera i resursa je direct cost", () => {
    const boq = [
      { quantity: "10.000", unitCostCents: 1500n },
      { quantity: "2.500", unitCostCents: 400n },
    ];
    const resources = [
      { quantity: "8.000", unitCostCents: 1200n },
      { quantity: "1.000", unitCostCents: 5000n },
    ];
    expect(directCostFromBoq(boq)).toBe(15_000n + 1_000n);
    expect(directCostFromResources(resources)).toBe(9_600n + 5_000n);
  });

  it("marža i rezerva dižu bazu, popust je spušta", () => {
    // direct = 10.000 centi; 20 % marže + 2 % rezerve = 12.200; −5 % popusta = 11.590.
    const result = calculateTender({
      boq: [{ quantity: "1.000", unitCostCents: 10_000n }],
      resources: [],
      markupPct: "20.00",
      riskReservePct: "2.00",
      discountPct: "5.00",
    });
    expect(result.directCostCents).toBe(10_000n);
    expect(result.baseCents).toBe(12_200n);
    expect(result.offeredValueCents).toBe(11_590n);
    expect(result.marginCents).toBe(1_590n);
  });

  it("marža je nad ponudom, ne nad troškom", () => {
    // direct 8.000, marža 20 % → ponuda 10.000. Marža nad ponudom = 20.00 %.
    const result = calculateTender({
      boq: [{ quantity: "1.000", unitCostCents: 8_000n }],
      resources: [],
      markupPct: "20.00",
      riskReservePct: "0.00",
      discountPct: "0.00",
    });
    expect(result.offeredValueCents).toBe(9_600n);
    expect(marginPct(result)).toBe("16.67");
  });

  it("ponuda nula nema maržu (null, ne 0)", () => {
    const result = calculateTender({
      boq: [], resources: [], markupPct: "0.00", riskReservePct: "0.00", discountPct: "0.00",
    });
    expect(result.offeredValueCents).toBe(0n);
    expect(result.marginPctHundredths).toBeNull();
    expect(marginPct(result)).toBeNull();
  });

  it("negativna marža (gubitak) je moguća i vidi se kao negativna", () => {
    const result = calculateTender({
      boq: [{ quantity: "1.000", unitCostCents: 10_000n }],
      resources: [],
      markupPct: "-10.00",
      riskReservePct: "0.00",
      discountPct: "0.00",
    });
    expect(result.offeredValueCents).toBe(9_000n);
    expect(result.marginCents).toBe(-1_000n);
    expect(marginPct(result)).toBe("-11.11");
  });

  it("parsePercent prihvata cijeli broj i odbija tri decimale", () => {
    expect(parsePercent("12")).toBe(1200n);
    expect(parsePercent("12.5")).toBe(1250n);
    expect(parsePercent("12.50")).toBe(1250n);
    expect(parsePercent("-3.25")).toBe(-325n);
    expect(parsePercent("12.505")).toBeNull();
    expect(parsePercent("12,5")).toBeNull();
    expect(parsePercent("")).toBeNull();
    expect(formatPercent(1250n)).toBe("12.50");
  });

  it("parseQuantity odbija više od tri decimale i negativan unos", () => {
    expect(parseQuantity("12.345")).toBe(12_345n);
    expect(parseQuantity("12.3456")).toBeNull();
    expect(parseQuantity("-1")).toBeNull();
  });

  it("neispravan procenat baca imenovanu grešku", () => {
    expect(() =>
      calculateTender({
        boq: [], resources: [], markupPct: "abc", riskReservePct: "0", discountPct: "0",
      }),
    ).toThrow(/TENDER_PERCENT_INVALID/);
  });
});

describe("Tender kalkulacija — prag odobrenja cijene", () => {
  it("promjena iznad 5 % traži odobrenje", () => {
    const check = priceChangeCheck(10_000n, 10_600n, "20.00", { minMarkupPct: "5.00" });
    expect(check.changePct).toBe("6.00");
    expect(check.needsApproval).toBe(true);
    expect(check.reasons).toContain("ABOVE_CHANGE_THRESHOLD");
  });

  it("promjena tačno 5 % NE traži odobrenje (prag je „iznad“)", () => {
    const check = priceChangeCheck(10_000n, 10_500n, "20.00", { minMarkupPct: "5.00" });
    expect(check.changePct).toBe("5.00");
    expect(check.needsApproval).toBe(false);
  });

  it("pojeftinjenje je odluka kao i poskupljenje", () => {
    const check = priceChangeCheck(10_000n, 9_000n, "20.00", { minMarkupPct: "5.00" });
    expect(check.changePct).toBe("-10.00");
    expect(check.needsApproval).toBe(true);
  });

  it("marža ispod minimalne traži odobrenje i bez promjene cijene", () => {
    const check = priceChangeCheck(10_000n, 10_000n, "2.00", { minMarkupPct: "5.00" });
    expect(check.needsApproval).toBe(true);
    expect(check.reasons).toEqual(["BELOW_MIN_MARKUP"]);
  });

  it("prva revizija nema promjenu, ali marža se provjerava", () => {
    const check = priceChangeCheck(null, 10_000n, "20.00", { minMarkupPct: "5.00" });
    expect(check.changePct).toBeNull();
    expect(check.needsApproval).toBe(false);
  });
});

describe("Tender kalkulacija — kompletnost checkliste", () => {
  const base = { code: "BID", label: "Ponudbena garancija", required: true };

  it("ATTACHED pušta, MISSING blokira", () => {
    expect(blockingChecklistItems([{ ...base, status: "ATTACHED" }])).toEqual([]);
    expect(blockingChecklistItems([{ ...base, status: "MISSING" }])).toHaveLength(1);
  });

  it("NOT_APPLICABLE sa razlogom pušta, bez razloga blokira", () => {
    expect(blockingChecklistItems([{ ...base, status: "NOT_APPLICABLE", note: "nije traženo" }])).toEqual([]);
    expect(blockingChecklistItems([{ ...base, status: "NOT_APPLICABLE", note: "" }])).toHaveLength(1);
  });

  it("neobavezna stavka ne blokira nikad", () => {
    expect(
      blockingChecklistItems([{ ...base, required: false, status: "MISSING" }]),
    ).toEqual([]);
  });
});
