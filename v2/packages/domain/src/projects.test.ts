import { describe, expect, it } from "vitest";
import { MoneyError } from "./money";
import {
  boqProgress,
  budgetAlertDedupeKey,
  closeChecklist,
  crossedBudgetThreshold,
  estimateAtCompletion,
  projectMargin,
  projectProgress,
} from "./projects";

describe("projectProgress — Σ(progress × weight) / Σweight", () => {
  it("računa težinski prosjek, ne običnu sredinu", () => {
    // (100×3 + 0×1) / 4 = 75. Obična sredina bi dala 50 i bila bi pogrešna.
    expect(
      projectProgress([
        { weight: 3, progressPct: 100 },
        { weight: 1, progressPct: 0 },
      ]),
    ).toBe(75);
  });

  it("promjena težine mijenja ukupni procenat", () => {
    const phases = [
      { weight: 1, progressPct: 100 },
      { weight: 1, progressPct: 0 },
    ];
    expect(projectProgress(phases)).toBe(50);
    expect(projectProgress([{ weight: 1, progressPct: 100 }, { weight: 9, progressPct: 0 }])).toBe(10);
  });

  it("otkazana faza ne ulazi u zbir (nije 0 % urađeno — nije posao)", () => {
    expect(
      projectProgress([
        { weight: 1, progressPct: 100 },
        { weight: 1, progressPct: 0, status: "CANCELLED" },
      ]),
    ).toBe(100);
  });

  it("bez faza vraća null, a ne 0", () => {
    expect(projectProgress([])).toBeNull();
    expect(projectProgress([{ weight: 1, progressPct: 50, status: "CANCELLED" }])).toBeNull();
  });

  it("faza bez težine je greška, ne tiha nula", () => {
    expect(() => projectProgress([{ weight: null, progressPct: 50 }])).toThrow(MoneyError);
    expect(() => projectProgress([{ weight: 0, progressPct: 50 }])).toThrow(MoneyError);
  });

  it("odbija napredak izvan 0–100", () => {
    expect(() => projectProgress([{ weight: 1, progressPct: 120 }])).toThrow(MoneyError);
    expect(() => projectProgress([{ weight: 1, progressPct: -1 }])).toThrow(MoneyError);
  });

  it("zaokružuje na dvije decimale", () => {
    // (33.333×1 + 66.666×1) / 2 = 49.9995 → 50
    expect(
      projectProgress([
        { weight: 1, progressPct: 33.33 },
        { weight: 1, progressPct: 66.66 },
      ]),
    ).toBe(50);
  });
});

describe("boqProgress — vrijednosno, ne količinski", () => {
  it("100 m³ betona i 1000 m² oplate nisu jednaki dio posla", () => {
    // Planirano: 100×1000 + 1000×10 = 110000 centi. Izvedeno: 0 + 1000×10 = 10000 → 9.09 %
    expect(
      boqProgress([
        { quantityPlanned: 100, quantityExecuted: 0, unitPriceCents: 1000n },
        { quantityPlanned: 1000, quantityExecuted: 1000, unitPriceCents: 10n },
      ]),
    ).toBe(9.09);
  });

  it("preskače stavke bez planirane količine", () => {
    expect(
      boqProgress([
        { quantityPlanned: 0, quantityExecuted: 5, unitPriceCents: 100n },
        { quantityPlanned: 10, quantityExecuted: 5, unitPriceCents: 100n },
      ]),
    ).toBe(50);
  });

  it("izvedeno preko plana se reže na 100", () => {
    expect(
      boqProgress([{ quantityPlanned: 10, quantityExecuted: 12, unitPriceCents: 100n }]),
    ).toBe(100);
  });

  it("prazan predmjer vraća null", () => {
    expect(boqProgress([])).toBeNull();
  });
});

describe("projectMargin — marža ne uključuje PENDING", () => {
  it("oduzima samo POSTED trošak", () => {
    const result = projectMargin({
      contractValueCents: 100_000n,
      approvedAmendmentCents: 20_000n,
      postedCostCents: 90_000n,
      currency: "BAM",
    });
    expect(result.contractWithAmendments?.cents).toBe(120_000n);
    expect(result.margin?.cents).toBe(30_000n);
    expect(result.marginPct).toBe(25);
  });

  it("negativna marža ostaje negativna, bez rezanja na nulu", () => {
    const result = projectMargin({
      contractValueCents: 10_000n,
      approvedAmendmentCents: 0n,
      postedCostCents: 15_000n,
      currency: "BAM",
    });
    expect(result.margin?.cents).toBe(-5_000n);
    expect(result.marginPct).toBe(-50);
  });

  it("bez ugovorene vrijednosti marža je null, ne 100 %", () => {
    const result = projectMargin({
      contractValueCents: null,
      approvedAmendmentCents: 5_000n,
      postedCostCents: 1_000n,
      currency: "BAM",
    });
    expect(result.margin).toBeNull();
    expect(result.marginPct).toBeNull();
    expect(result.contractWithAmendments).toBeNull();
  });
});

describe("estimateAtCompletion — uvijek označen kao procjena", () => {
  it("dijeli POSTED trošak ostvarenim procentom", () => {
    const result = estimateAtCompletion({ postedCostCents: 40_000n, progressPct: 25, currency: "BAM" });
    expect(result.kind).toBe("EAC_ESTIMATE");
    expect(result.amount?.cents).toBe(160_000n);
  });

  it("pri progress_pct = 0 nema EAC-a i to je imenovan razlog", () => {
    const result = estimateAtCompletion({ postedCostCents: 40_000n, progressPct: 0, currency: "BAM" });
    expect(result.amount).toBeNull();
    expect(result.reason).toBe("NO_PROGRESS");
  });

  it("bez faza (null) takođe nema EAC-a", () => {
    expect(estimateAtCompletion({ postedCostCents: 1n, progressPct: null, currency: "EUR" }).amount).toBeNull();
  });

  it("zaokružuje pola naviše u cent", () => {
    // 100 / 33 % = 303.03…
    const result = estimateAtCompletion({ postedCostCents: 100n, progressPct: 33, currency: "BAM" });
    expect(result.amount?.cents).toBe(303n);
  });

  it("100 % vraća isti iznos, ne udvostručuje", () => {
    expect(
      estimateAtCompletion({ postedCostCents: 12_345n, progressPct: 100, currency: "BAM" }).amount?.cents,
    ).toBe(12_345n);
  });
});

describe("crossedBudgetThreshold — 80 i 100, po reviziji", () => {
  it("ispod 80 nema praga", () => {
    expect(crossedBudgetThreshold({ budgetCents: 100_000n, spentCents: 79_999n, revision: 1 })).toBeNull();
  });

  it("tačno 80 prelazi prag 80", () => {
    expect(
      crossedBudgetThreshold({ budgetCents: 100_000n, spentCents: 80_000n, revision: 1 })?.thresholdPct,
    ).toBe(80);
  });

  it("95 % vraća najviši pređeni prag (80), ne dva obavještenja", () => {
    const crossing = crossedBudgetThreshold({ budgetCents: 100_000n, spentCents: 95_000n, revision: 1 });
    expect(crossing?.thresholdPct).toBe(80);
    expect(crossing?.usedPct).toBe(95);
  });

  it("tačno 100 je prag 100 (budžet potrošen, ne „skoro“)", () => {
    expect(
      crossedBudgetThreshold({ budgetCents: 100_000n, spentCents: 100_000n, revision: 1 })?.thresholdPct,
    ).toBe(100);
  });

  it("bez budžeta nema praga", () => {
    expect(crossedBudgetThreshold({ budgetCents: 0n, spentCents: 10n, revision: 1 })).toBeNull();
  });

  it("dedupe_key nosi projekat, reviziju, opseg i prag", () => {
    expect(
      budgetAlertDedupeKey({ projectId: "prj_1", revision: 2, scope: "TOTAL", thresholdPct: 80 }),
    ).toBe("prj_1:2:TOTAL:80");
    expect(
      budgetAlertDedupeKey({ projectId: "prj_1", revision: 2, scope: "GORIVO", thresholdPct: 80 }),
    ).toBe("prj_1:2:GORIVO:80");
  });
});

describe("closeChecklist — zatvaranje traži zelene stavke", () => {
  it("sve prazno = kompletno", () => {
    const list = closeChecklist({ openAssignments: 0, openFaults: 0, openObligations: 0, pendingCosts: 0 });
    expect(list.complete).toBe(true);
    expect(list.blockers).toEqual([]);
  });

  it("otvorena dodjela blokira i imenuje se", () => {
    const list = closeChecklist({ openAssignments: 2, openFaults: 0, openObligations: 0, pendingCosts: 0 });
    expect(list.complete).toBe(false);
    expect(list.blockers).toEqual(["ASSIGNMENTS"]);
  });

  it("PENDING trošak se može prihvatiti razlogom", () => {
    const blocked = closeChecklist({ openAssignments: 0, openFaults: 0, openObligations: 0, pendingCosts: 1 });
    expect(blocked.complete).toBe(false);
    const accepted = closeChecklist({
      openAssignments: 0,
      openFaults: 0,
      openObligations: 0,
      pendingCosts: 1,
      pendingAcceptedReason: "Račun dobavljača neće stići prije zatvaranja.",
    });
    expect(accepted.complete).toBe(true);
  });

  it("prekratak razlog ne prihvata PENDING", () => {
    const list = closeChecklist({
      openAssignments: 0,
      openFaults: 0,
      openObligations: 0,
      pendingCosts: 1,
      pendingAcceptedReason: "ok",
    });
    expect(list.complete).toBe(false);
  });

  it("otvorene faze se provjeravaju samo kad se traže", () => {
    const withoutPhases = closeChecklist({
      openAssignments: 0, openFaults: 0, openObligations: 0, pendingCosts: 0,
    });
    expect(withoutPhases.items.map((item) => item.key)).not.toContain("PHASES");
    const withPhases = closeChecklist({
      openAssignments: 0, openFaults: 0, openObligations: 0, pendingCosts: 0, openPhases: 1,
    });
    expect(withPhases.blockers).toEqual(["PHASES"]);
  });
});
