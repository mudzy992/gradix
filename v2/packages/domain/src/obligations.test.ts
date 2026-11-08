/**
 * Stanje obaveze: tabela slučajeva iz kapije R2b (§7), plus ono što se lako previdi.
 *
 * Ovi testovi NE provjeravaju samo TS funkciju — porede je sa `obligation_state()` u bazi u
 * `apps/web/src/server/obligations.integration.test.ts`. Kad bi se dva pravila razišla, ekran bi
 * pokazao „važeće“ za obavezu koju baza vodi kao isteklu. Ovdje je pravilo zapisano čitljivo;
 * tamo je dokazano da baza daje isto.
 */
import { describe, expect, it } from "vitest";
import { daysBetween, daysLeft, obligationState, parseThresholds } from "./obligations";

const THRESHOLDS = [60, 30, 15, 7];

describe("stanje obaveze", () => {
  it("rok za 20 dana je VAŽEĆE — pragovi su podsjetnici, ne „uskoro istječe“", () => {
    expect(obligationState({ expiresAt: "2026-11-27", thresholds: THRESHOLDS, today: "2026-11-07" })).toBe("valid");
  });

  it("rok za 5 dana je USKORO ISTJEČE", () => {
    expect(obligationState({ expiresAt: "2026-11-12", thresholds: THRESHOLDS, today: "2026-11-07" })).toBe("expiring");
  });

  it("rok juče je ISTEKLO", () => {
    expect(obligationState({ expiresAt: "2026-11-06", thresholds: THRESHOLDS, today: "2026-11-07" })).toBe("expired");
  });

  it("rok danas NIJE istekao — dan isteka se računa kao pun dan", () => {
    expect(obligationState({ expiresAt: "2026-11-07", thresholds: THRESHOLDS, today: "2026-11-07" })).toBe("expiring");
  });

  it("prelaz na tačno zadnjem pragu: 7 dana je uskoro, 8 dana je važeće", () => {
    expect(obligationState({ expiresAt: "2026-11-14", thresholds: THRESHOLDS, today: "2026-11-07" })).toBe("expiring");
    expect(obligationState({ expiresAt: "2026-11-15", thresholds: THRESHOLDS, today: "2026-11-07" })).toBe("valid");
  });

  it("bez roka i zamijenjeno imaju svoje stanje, ne „važeće“", () => {
    expect(obligationState({ expiresAt: null, thresholds: THRESHOLDS, today: "2026-11-07" })).toBe("no_expiry");
    expect(
      obligationState({ expiresAt: "2026-11-30", thresholds: THRESHOLDS, today: "2026-11-07", superseded: true }),
    ).toBe("superseded");
  });

  it("tip bez pragova: samo dan isteka je „uskoro“, sve prije toga je „važeće“", () => {
    // Bez pragova nema upozorenja unaprijed (garancija), ali dan isteka se vidi kao hitan slučaj.
    expect(obligationState({ expiresAt: "2026-11-07", thresholds: [], today: "2026-11-07" })).toBe("expiring");
    expect(obligationState({ expiresAt: "2026-11-08", thresholds: [], today: "2026-11-07" })).toBe("valid");
    expect(obligationState({ expiresAt: "2026-11-20", thresholds: [], today: "2026-11-07" })).toBe("valid");
  });

  it("pragovi ne moraju biti sortirani — koristi se najmanji", () => {
    expect(obligationState({ expiresAt: "2026-11-12", thresholds: [7, 60, 15, 30], today: "2026-11-07" })).toBe("expiring");
  });

  it("datum preko nove godine i prelaz ljetnjeg vremena ne pomjeraju brojanje", () => {
    expect(daysBetween("2026-12-28", "2027-01-04")).toBe(7);
    // 29. 3. 2026. je prelaz na ljetnje vrijeme; 28. 3. → 30. 3. mora biti 2 dana, ne 1,98.
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
    expect(obligationState({ expiresAt: "2027-01-04", thresholds: [7], today: "2026-12-28" })).toBe("expiring");
  });

  it("neispravan datum ne baca grešku — tretira se kao „bez roka“", () => {
    expect(obligationState({ expiresAt: "nije datum", thresholds: THRESHOLDS, today: "2026-11-07" })).toBe("no_expiry");
    expect(daysLeft("2026-11-07", "nije datum")).toBeNull();
    expect(daysLeft("2026-11-07", null)).toBeNull();
  });
});

describe("pragovi iz baze", () => {
  it("pg INT[] stiže kao „{60,30,15,7}“", () => {
    expect(parseThresholds("{60,30,15,7}")).toEqual([60, 30, 15, 7]);
  });

  it("prazan niz i stvarni niz rade isto", () => {
    expect(parseThresholds("{}")).toEqual([]);
    expect(parseThresholds([])).toEqual([]);
    expect(parseThresholds([60, 7])).toEqual([60, 7]);
  });

  it("smeće se odbacuje, a ne pretvara u 0 (0 bi značilo „uskoro“ za sve)", () => {
    expect(parseThresholds("{60,x,-5}")).toEqual([60]);
    expect(parseThresholds(null)).toEqual([]);
  });
});
