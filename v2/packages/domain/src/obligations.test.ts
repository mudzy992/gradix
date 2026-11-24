/**
 * Stanje obaveze: tabela slučajeva iz kapije R2b (§7), plus ono što se lako previdi.
 *
 * Ovi testovi NE provjeravaju samo TS funkciju — porede je sa `obligation_state()` u bazi u
 * `apps/web/src/server/obligations.integration.test.ts`. Kad bi se dva pravila razišla, ekran bi
 * pokazao „važeće“ za obavezu koju baza vodi kao isteklu. Ovdje je pravilo zapisano čitljivo;
 * tamo je dokazano da baza daje isto.
 */
import { describe, expect, it } from "vitest";
import {
  compareObligationUrgency,
  daysBetween,
  daysLeft,
  effectiveThresholds,
  groupMissingByType,
  missingObligationsForSubject,
  obligationState,
  parseThresholds,
  requirementApplies,
  type ObligationRequirement,
  type RequirementSubject,
} from "./obligations";

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

// ---------------------------------------------------------------------------
// F2 — potvrda dokumenta, trajne obaveze i „nedostaje“
// ---------------------------------------------------------------------------
describe("stanje potvrde (F2)", () => {
  it("odbijen dokument je ODBIJENO i blokira, i kad rok još nije istekao", () => {
    expect(
      obligationState({
        expiresAt: "2027-01-01",
        thresholds: THRESHOLDS,
        today: "2026-11-07",
        reviewState: "rejected",
      }),
    ).toBe("rejected");
  });

  it("dokument koji čeka provjeru je ČEKA PROVJERU — ne blokira", () => {
    expect(
      obligationState({
        expiresAt: "2027-01-01",
        thresholds: THRESHOLDS,
        today: "2026-11-07",
        reviewState: "pending_review",
      }),
    ).toBe("pending_review");
  });

  it("istekao je ISPRED „čeka provjeru“ — rok je činjenica, provjera je korak", () => {
    expect(
      obligationState({
        expiresAt: "2026-11-06",
        thresholds: THRESHOLDS,
        today: "2026-11-07",
        reviewState: "pending_review",
      }),
    ).toBe("expired");
  });

  it("odbijen je ISPRED svega osim zamijenjenog — svježa odluka ureda", () => {
    expect(
      obligationState({
        expiresAt: "2026-11-06",
        thresholds: THRESHOLDS,
        today: "2026-11-07",
        reviewState: "rejected",
      }),
    ).toBe("rejected");
    expect(
      obligationState({
        expiresAt: "2026-11-06",
        thresholds: THRESHOLDS,
        today: "2026-11-07",
        reviewState: "rejected",
        superseded: true,
      }),
    ).toBe("superseded");
  });
});

describe("trajna obaveza koristi datum provjere, ne isteka", () => {
  it("bez roka i sa budućom provjerom je BEZ ROKA", () => {
    expect(
      obligationState({ expiresAt: null, thresholds: THRESHOLDS, today: "2026-11-07", reviewAt: "2027-06-01" }),
    ).toBe("no_expiry");
  });

  it("provjera u zadnjem pragu je PROVJERA DOSPJELA", () => {
    expect(
      obligationState({ expiresAt: null, thresholds: THRESHOLDS, today: "2026-11-07", reviewAt: "2026-11-10" }),
    ).toBe("review_due");
  });

  it("prošla provjera je ISTEKLO — „trajno“ ne znači „zauvijek neprovjereno“", () => {
    expect(
      obligationState({ expiresAt: null, thresholds: THRESHOLDS, today: "2026-11-07", reviewAt: "2026-11-01" }),
    ).toBe("expired");
  });
});

describe("pragovi: vlastiti nadjačavaju tipove", () => {
  it("vlastiti niz pobjeđuje", () => {
    expect(effectiveThresholds([90, 30], [60, 30, 7])).toEqual([90, 30]);
  });

  it("prazan vlastiti niz i NULL padaju na tipove", () => {
    expect(effectiveThresholds([], [60, 7])).toEqual([60, 7]);
    expect(effectiveThresholds(null, [60, 7])).toEqual([60, 7]);
    expect(effectiveThresholds(undefined, [60, 7])).toEqual([60, 7]);
  });
});

const RADNIK: RequirementSubject = { id: "w1", kind: "WORKER", isActive: true, engagementKind: "EMPLOYMENT" };
const MASINA: RequirementSubject = {
  id: "m1",
  kind: "MACHINE",
  isActive: true,
  categoryId: "cat_excavator",
};

const pravilo = (over: Partial<ObligationRequirement> = {}): ObligationRequirement => ({
  id: "r1",
  entityKind: "WORKER",
  typeId: "t_medical",
  appliesScope: "ALL",
  appliesValue: null,
  isRequired: true,
  isActive: true,
  ...over,
});

describe("obaveza koja nedostaje", () => {
  it("bez ijedne obaveze, pravilo ALL daje nedostatak", () => {
    const missing = missingObligationsForSubject({
      subject: RADNIK,
      requirements: [pravilo()],
      existing: [],
    });
    expect(missing).toEqual([
      { entityKind: "WORKER", entityId: "w1", typeId: "t_medical", requirementId: "r1", state: "missing" },
    ]);
  });

  it("postojeća obaveza pokriva zahtjev — nema nedostatka", () => {
    const missing = missingObligationsForSubject({
      subject: RADNIK,
      requirements: [pravilo()],
      existing: [{ typeId: "t_medical", expiresAt: "2027-01-01", superseded: false }],
    });
    expect(missing).toEqual([]);
  });

  it("ISTEKLA obaveza pokriva: „nedostaje“ nije isto što i „treba obnoviti“", () => {
    const missing = missingObligationsForSubject({
      subject: RADNIK,
      requirements: [pravilo()],
      existing: [{ typeId: "t_medical", expiresAt: "2020-01-01", superseded: false }],
    });
    expect(missing).toEqual([]);
  });

  it("ZAMIJENJENA ne pokriva — to je historija", () => {
    const missing = missingObligationsForSubject({
      subject: RADNIK,
      requirements: [pravilo()],
      existing: [{ typeId: "t_medical", expiresAt: null, superseded: true }],
    });
    expect(missing).toHaveLength(1);
  });

  it("dva pravila istog tipa daju JEDAN nedostatak, ne dva", () => {
    const missing = missingObligationsForSubject({
      subject: MASINA,
      requirements: [
        pravilo({ id: "r1", entityKind: "MACHINE", typeId: "t_reg", appliesScope: "ALL", appliesValue: null }),
        pravilo({ id: "r2", entityKind: "MACHINE", typeId: "t_reg", appliesScope: "MACHINE_CATEGORY", appliesValue: "cat_excavator" }),
      ],
      existing: [],
    });
    expect(missing).toHaveLength(1);
    expect(missing[0]!.requirementId).toBe("r1");
  });

  it("deaktiviran entitet izlazi iz liste nedostataka", () => {
    const missing = missingObligationsForSubject({
      subject: { ...RADNIK, isActive: false },
      requirements: [pravilo()],
      existing: [],
    });
    expect(missing).toEqual([]);
  });

  it("deaktivirano ili neobavezno pravilo ne traži ništa", () => {
    for (const over of [{ isActive: false }, { isRequired: false }]) {
      expect(
        missingObligationsForSubject({ subject: RADNIK, requirements: [pravilo(over)], existing: [] }),
      ).toEqual([]);
    }
  });

  it("pogrešan rod entiteta ne važi — ljekarski se ne traži mašini", () => {
    expect(requirementApplies(pravilo(), MASINA)).toBe(false);
  });
});

describe("opseg pravila", () => {
  it("ALL važi za svakoga, ENGAGEMENT samo za svoju vrstu", () => {
    expect(requirementApplies(pravilo(), RADNIK)).toBe(true);
    expect(requirementApplies(pravilo({ appliesScope: "ENGAGEMENT", appliesValue: "EMPLOYMENT" }), RADNIK)).toBe(true);
    expect(requirementApplies(pravilo({ appliesScope: "ENGAGEMENT", appliesValue: "CONTRACT" }), RADNIK)).toBe(false);
  });

  it("MACHINE_CATEGORY važi samo za svoju kategoriju", () => {
    const req = (value: string) =>
      pravilo({ entityKind: "MACHINE", appliesScope: "MACHINE_CATEGORY", appliesValue: value });
    expect(requirementApplies(req("cat_excavator"), MASINA)).toBe(true);
    expect(requirementApplies(req("cat_truck"), MASINA)).toBe(false);
  });

  it("PROJECT važi samo kad je entitet vezan na taj projekat", () => {
    const req = pravilo({ appliesScope: "PROJECT", appliesValue: "p1" });
    expect(requirementApplies(req, { ...RADNIK, projectId: "p1" })).toBe(true);
    expect(requirementApplies(req, { ...RADNIK, projectId: "p2" })).toBe(false);
    expect(requirementApplies(req, RADNIK)).toBe(false);
  });
});

describe("grupisanje i redoslijed", () => {
  it("grupiše po tipu i entitetu, najveća grupa prva", () => {
    const groups = groupMissingByType([
      { entityKind: "WORKER", entityId: "w1", typeId: "t_medical", requirementId: "r1", state: "missing" },
      { entityKind: "WORKER", entityId: "w2", typeId: "t_medical", requirementId: "r1", state: "missing" },
      { entityKind: "MACHINE", entityId: "m1", typeId: "t_reg", requirementId: "r2", state: "missing" },
    ]);
    expect(groups[0]).toMatchObject({ typeId: "t_medical", count: 2, ids: ["w1", "w2"] });
    expect(groups[1]).toMatchObject({ typeId: "t_reg", count: 1 });
  });

  it("hitnost ide `missing > expired > rejected > pending_review > expiring …`", () => {
    const states = ["valid", "expiring", "missing", "superseded", "expired", "rejected", "pending_review"] as const;
    const sorted = [...states]
      .sort((a, b) => compareObligationUrgency({ state: a, expiresAt: null }, { state: b, expiresAt: null }))
      .slice(0, 6);
    expect(sorted).toEqual(["missing", "expired", "rejected", "pending_review", "expiring", "valid"]);
  });

  it("isti prioritet ide po roku, najbliži prvi", () => {
    expect(
      compareObligationUrgency(
        { state: "expiring", expiresAt: "2026-12-01" },
        { state: "expiring", expiresAt: "2026-11-20" },
      ),
    ).toBeGreaterThan(0);
  });
});
