import { describe, expect, it } from "vitest";
import {
  ServiceError,
  formatThousandths,
  toThousandths,
  addDays,
  assertServiceTransition,
  daysBetween,
  downtimeMinutes,
  evaluateMaintenance,
  formatHundredths,
  isBelowMinimum,
  isWarrantyClaim,
  machineReliability,
  nextMaintenanceDue,
  nextServiceStatuses,
  serviceApprovalCheck,
  serviceCost,
  stockOnHand,
  toHundredths,
} from "./service-maintenance";

describe("Servis — cijena rada, dijelova i vanjskog servisa", () => {
  it("total je zbir tri komponente, sati × satnica se zaokružuju pola-naviše", () => {
    // 2,5 h × 20,00 KM = 50,00 KM; dijelovi 12,34; vanjski 0.
    expect(
      serviceCost({
        laborHours: "2.5",
        hourlyRateCents: 2000n,
        partsCostCents: 1234n,
      }),
    ).toEqual({
      laborCostCents: 5000n,
      partsCostCents: 1234n,
      externalCostCents: 0n,
      totalCostCents: 6234n,
    });

    // 0,5 h × 33,33 KM = 16,665 → 16,67 (pola-naviše; float bi dao 16,66).
    expect(serviceCost({ laborHours: 0.5, hourlyRateCents: 3333n }).laborCostCents).toBe(1667n);

    // 0,01 h × 1 cent = 0,01 centa → 0 (zaokruženo na najbliži cent, ne na 1).
    expect(serviceCost({ laborHours: "0.01", hourlyRateCents: 1n }).laborCostCents).toBe(0n);

    // 1,25 h × 33,33 = 41,6625 → 41,66.
    expect(serviceCost({ laborHours: "1.25", hourlyRateCents: 3333n }).laborCostCents).toBe(4166n);
  });

  it("vanjski servis ulazi u total bez sati mehaničara", () => {
    const cost = serviceCost({ laborHours: "0", hourlyRateCents: 2000n, externalCostCents: 45_000n });
    expect(cost.totalCostCents).toBe(45_000n);
    expect(cost.laborCostCents).toBe(0n);
  });

  it("negativan trošak i neispravan broj sati su greške, ne tihi upis", () => {
    expect(() => serviceCost({ laborHours: "1", hourlyRateCents: 100n, partsCostCents: -1n })).toThrow(ServiceError);
    expect(() => serviceCost({ laborHours: "1.234", hourlyRateCents: 100n })).toThrow(ServiceError);
    expect(() => serviceCost({ laborHours: "-2", hourlyRateCents: 100n })).toThrow(ServiceError);
    expect(() => toHundredths("1 000")).toThrow(ServiceError);
  });
});

describe("Servis — životni ciklus naloga", () => {
  it("PLANNED → APPROVED → IN_PROGRESS → WAITING_PARTS → IN_PROGRESS → DONE prolazi", () => {
    const path = ["PLANNED", "APPROVED", "IN_PROGRESS", "WAITING_PARTS", "IN_PROGRESS", "DONE"] as const;
    for (let index = 1; index < path.length; index += 1) {
      /* `noUncheckedIndexedAccess`: indeksi su `T | undefined` — asertacija ih čini tijesnim. */
      expect(() => assertServiceTransition(path[index - 1]!, path[index]!)).not.toThrow();
    }
  });

  it("završen i otkazan nalog ne mijenjaju stanje", () => {
    expect(() => assertServiceTransition("DONE", "IN_PROGRESS")).toThrow(/ne mijenja se/);
    expect(() => assertServiceTransition("CANCELLED", "APPROVED")).toThrow(/ne mijenja se/);
    expect(nextServiceStatuses("DONE")).toEqual([]);
    // Nalog ne preskače odobrenje u rad, ali PLAN može direktno u rad kad odobrenje nije potrebno.
    expect(() => assertServiceTransition("PLANNED", "IN_PROGRESS")).not.toThrow();
    expect(() => assertServiceTransition("PLANNED", "DONE")).toThrow(/nije dozvoljen/);
  });

  it("zastoj je razlika vremena, negativan raspon nije podatak", () => {
    expect(downtimeMinutes("2026-03-02T08:00:00Z", "2026-03-02T10:45:00Z")).toBe(165);
    expect(downtimeMinutes(null, "2026-03-02T10:45:00Z")).toBeNull();
    expect(downtimeMinutes("2026-03-02T10:45:00Z", "2026-03-02T08:00:00Z")).toBeNull();
  });
});

describe("Servis — MTBF, MTTR i trošak po satu rada", () => {
  const orders = [
    {
      startedAt: "2026-03-01T08:00:00Z",
      finishedAt: "2026-03-01T10:00:00Z",
      status: "DONE" as const,
      totalCostCents: 20_000n,
      warrantyClaim: false,
    },
    {
      startedAt: "2026-03-05T08:00:00Z",
      finishedAt: "2026-03-05T13:00:00Z",
      status: "DONE" as const,
      totalCostCents: 40_000n,
      warrantyClaim: false,
    },
    {
      startedAt: "2026-03-09T08:00:00Z",
      finishedAt: "2026-03-09T08:00:00Z",
      status: "DONE" as const,
      totalCostCents: 99_999n,
      warrantyClaim: true,
    },
  ];

  it("MTTR je prosjek trajanja, trošak po satu koristi samo stvarne troškove", () => {
    const result = machineReliability(orders, ["750.00", "500.50"]);
    // (120 + 300 + 0) / 3 = 140 min
    expect(result.mttrMinutes).toBe(140);
    expect(result.faultCount).toBe(3);
    // 1.250,50 h / 3 kvara = 416,8333… → 416,83
    expect(result.mtbfHours).toBe("416.83");
    // Garancijski nalog ulazi kao nula: 200,00 + 400,00 = 600,00 KM — bez duplog troška.
    expect(result.maintenanceCostCents).toBe(60_000n);
    expect(result.workHours).toBe("1250.50");
    // 600,00 KM / 1.250,50 h = 0,4798 KM/h → 0,48
    expect(result.maintenanceCostPerHour).toBe("0.48");
  });

  it("bez radnih sati nema MTBF-a ni troška po satu (nula bi bila tvrdnja)", () => {
    const result = machineReliability(orders, []);
    expect(result.mtbfHours).toBeNull();
    expect(result.maintenanceCostPerHour).toBeNull();
    expect(result.mttrMinutes).toBe(140);
  });

  it("nalog u toku ne ulazi u MTTR ni u broj kvarova", () => {
    const result = machineReliability(
      [
        {
          startedAt: "2026-03-01T08:00:00Z",
          finishedAt: null,
          status: "IN_PROGRESS",
          totalCostCents: 5_000n,
          warrantyClaim: false,
        },
      ],
      ["100.00"],
    );
    expect(result.faultCount).toBe(0);
    expect(result.mttrMinutes).toBeNull();
    expect(result.mtbfHours).toBeNull();
    expect(result.maintenanceCostCents).toBe(0n);
  });
});

describe("Servis — preventivno održavanje po satima, kilometrima i datumima", () => {
  const hoursPlan = {
    basis: "HOURS" as const,
    intervalValue: "250.00",
    tolerancePct: "10",
    nextDueAt: null,
    nextDueMeter: "1250.00",
    isActive: true,
  };

  it("tolerancija pomjera prag upozorenja, a rok ostaje rok", () => {
    // 10 % od 250 h = 25 h → upozorenje od 1.225 h.
    expect(evaluateMaintenance(hoursPlan, { meter: "1200.00", onDate: "2026-03-01" })).toMatchObject({
      status: "OK",
      dueSoonAt: "1225.00",
      dueAt: "1250.00",
      remaining: "50.00",
    });
    expect(evaluateMaintenance(hoursPlan, { meter: "1225.00", onDate: "2026-03-01" }).status).toBe("DUE_SOON");
    expect(evaluateMaintenance(hoursPlan, { meter: "1249.99", onDate: "2026-03-01" }).status).toBe("DUE_SOON");
    // Pređen rok: -1 h preko → OVERDUE, remaining negativan.
    expect(evaluateMaintenance(hoursPlan, { meter: "1251.00", onDate: "2026-03-01" })).toMatchObject({
      status: "OVERDUE",
      remaining: "-1.00",
    });
  });

  it("kilometri koriste isti račun nad brojilom", () => {
    const kmPlan = { ...hoursPlan, basis: "KM" as const, intervalValue: "10000.00", nextDueMeter: "90000.00" };
    // 10 % od 10.000 km = 1.000 km → upozorenje od 89.000 km.
    expect(evaluateMaintenance(kmPlan, { meter: "88500.00", onDate: "2026-03-01" }).status).toBe("OK");
    expect(evaluateMaintenance(kmPlan, { meter: "89000.00", onDate: "2026-03-01" }).status).toBe("DUE_SOON");
    expect(evaluateMaintenance(kmPlan, { meter: "90001.00", onDate: "2026-03-01" }).status).toBe("OVERDUE");
  });

  it("plan po datumima računa dane, uključujući dan roka", () => {
    const daysPlan = {
      basis: "DAYS" as const,
      intervalValue: "90",
      tolerancePct: "10",
      nextDueAt: "2026-06-01",
      nextDueMeter: null,
      isActive: true,
    };
    // 10 % od 90 dana = 9 dana → upozorenje od 2026-05-23.
    expect(evaluateMaintenance(daysPlan, { meter: null, onDate: "2026-05-22" }).status).toBe("OK");
    expect(evaluateMaintenance(daysPlan, { meter: null, onDate: "2026-05-23" }).status).toBe("DUE_SOON");
    expect(evaluateMaintenance(daysPlan, { meter: null, onDate: "2026-06-01" })).toMatchObject({
      status: "DUE_SOON",
      remaining: "0",
    });
    expect(evaluateMaintenance(daysPlan, { meter: null, onDate: "2026-06-02" })).toMatchObject({
      status: "OVERDUE",
      remaining: "-1",
    });
  });

  it("plan bez brojila ili neaktivan plan ne tvrdi da je servis OK", () => {
    expect(evaluateMaintenance(hoursPlan, { meter: null, onDate: "2026-03-01" }).status).toBe("NO_DATA");
    expect(evaluateMaintenance({ ...hoursPlan, isActive: false }, { meter: "1.00", onDate: "2026-03-01" }).status).toBe(
      "NO_DATA",
    );
  });

  it("sljedeći rok se računa iz stvarnog brojila u trenutku izvršenja", () => {
    // Servis izvršen na 1.260 h (10 h preko roka) → sljedeći rok 1.510 h, ne 1.500 h.
    expect(nextMaintenanceDue(hoursPlan, { meter: "1260.00", onDate: "2026-03-01" })).toEqual({
      nextDueMeter: "1510.00",
      nextDueAt: null,
    });
    expect(
      nextMaintenanceDue({ basis: "DAYS", intervalValue: "90" }, { meter: null, onDate: "2026-03-01" }),
    ).toEqual({ nextDueMeter: null, nextDueAt: "2026-05-30" });
  });

  it("dani i pomak datuma su kalendarski, bez vremenske zone", () => {
    expect(daysBetween("2026-03-01", "2026-03-31")).toBe(30);
    expect(daysBetween("2026-03-31", "2026-03-01")).toBe(-30);
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("Servis — garancija, odobrenje i stanje dijelova", () => {
  it("kvar unutar garancije je reklamacija sa izvornim nalogom", () => {
    const orders = [
      { id: "so_1", machineId: "m_1", warrantyUntil: "2026-05-01" },
      { id: "so_2", machineId: "m_1", warrantyUntil: "2026-04-01" },
      { id: "so_3", machineId: "m_2", warrantyUntil: "2027-01-01" },
    ];
    // Najdalja aktivna garancija je izvor (ne prva po redu).
    expect(isWarrantyClaim("2026-04-15", orders, "m_1")).toEqual({ claim: true, sourceOrderId: "so_1" });
    expect(isWarrantyClaim("2026-05-02", orders, "m_1")).toEqual({ claim: false, sourceOrderId: null });
    // Garancija druge mašine ne važi.
    expect(isWarrantyClaim("2026-04-15", orders, "m_3").claim).toBe(false);
  });

  it("odobrenje ide po predračunu; vanjski servis iznad praga traži i ponudu", () => {
    expect(
      serviceApprovalCheck({
        kind: "EXTERNAL",
        plannedCostCents: 60_000n,
        thresholdCents: 50_000n,
        externalQuoteCents: null,
      }),
    ).toEqual({ needsApproval: true, needsQuote: true });
    expect(
      serviceApprovalCheck({
        kind: "EXTERNAL",
        plannedCostCents: 60_000n,
        thresholdCents: 50_000n,
        externalQuoteCents: 58_000n,
      }),
    ).toEqual({ needsApproval: true, needsQuote: false });
    // Tačno na pragu nije iznad praga (prag je „iznad“, ne „od“).
    expect(
      serviceApprovalCheck({
        kind: "INTERNAL",
        plannedCostCents: 50_000n,
        thresholdCents: 50_000n,
        externalQuoteCents: null,
      }),
    ).toEqual({ needsApproval: false, needsQuote: false });
  });

  it("stanje zaliha je isključivo SUM kretnji", () => {
    expect(
      stockOnHand([
        { kind: "IN", quantity: "10.00" },
        { kind: "OUT", quantity: "3.50" },
        { kind: "IN", quantity: "2.25" },
      ]),
    ).toBe("8.750");
    // Prenos ne mijenja stanje firme, popis sam po sebi nije kretanje.
    expect(stockOnHand([{ kind: "TRANSFER", quantity: "5.00" }, { kind: "COUNT", quantity: "9.00" }])).toBe("0.000");
    // Više izdatih nego primljenih je negativno stanje — vidi se, ne skriva se na nulu.
    expect(stockOnHand([{ kind: "OUT", quantity: "1.00" }])).toBe("-1.000");
    // Količina ide na tri decimale (metar, kilogram, litar) — zato nije isti parser kao novac.
    expect(stockOnHand([{ kind: "IN", quantity: "10.500" }, { kind: "OUT", quantity: "0.250" }])).toBe("10.250");
    expect(isBelowMinimum("1.00", "2.00")).toBe(true);
    expect(isBelowMinimum("2.00", "2.00")).toBe(false);
  });

  it("količina ima tri decimale, novac dvije — parseri su odvojeni", () => {
    expect(toThousandths("10.5")).toBe(10_500n);
    expect(formatThousandths(10_250n)).toBe("10.250");
    expect(formatThousandths(-1n)).toBe("-0.001");
    expect(() => toThousandths("1.2345")).toThrow(ServiceError);
  });

  it("format stotinki čuva znak i dvije decimale", () => {
    expect(formatHundredths(0n)).toBe("0.00");
    expect(formatHundredths(5n)).toBe("0.05");
    expect(formatHundredths(-125n)).toBe("-1.25");
  });
});
