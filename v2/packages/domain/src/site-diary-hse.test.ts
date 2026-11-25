import { describe, expect, it } from "vitest";
import {
  boqCompletionPercent,
  boqQuantitiesFromDiaries,
  canCloseIncident,
  diaryTransition,
  hseActionIsOverdue,
  hseActionOnTime,
  hseOnTimeRate,
  isActiveProhibition,
  isLostTimeInjury,
  ltifr,
  nearMissCount,
  needsHseReportObligation,
  suggestedExtensionDays,
  totalDelayHours,
  totalLostDays,
  trainingCanRenewCertificate,
  unsignedDiaryIsOverdue,
  validDiarySignature,
  validToolboxInput,
  type HseActionRow,
  type HseIncidentRow,
} from "./site-diary-hse";

const incident = (overrides: Partial<HseIncidentRow> = {}): HseIncidentRow => ({
  kind: "ACCIDENT",
  severity: "MINOR",
  lostDays: 3,
  occurredAt: "2026-11-10T09:00:00+01:00",
  status: "REPORTED",
  ...overrides,
});

const action = (overrides: Partial<HseActionRow> = {}): HseActionRow => ({
  status: "OPEN",
  dueOn: "2026-11-20",
  doneOn: null,
  ...overrides,
});

describe("Dnevnik — količine i zastoji", () => {
  it("zbir po stavci predmjera uzima BOQ i HAUL, a ručni red ne", () => {
    const totals = boqQuantitiesFromDiaries([
      { boqItemId: "boq_1", quantity: 120.5, source: "BOQ" },
      { boqItemId: "boq_1", quantity: 30, source: "HAUL" },
      /* Ručni opis istog iskopa NE smije ući: sabrao bi se dvaput. */
      { boqItemId: "boq_1", quantity: 500, source: "MANUAL" },
      { boqItemId: null, quantity: 10, source: "BOQ" },
    ]);
    expect(totals.get("boq_1")).toBe(150.5);
    expect(totals.size).toBe(1);
  });

  it("procenat završenosti ne izmišlja broj kad plana nema", () => {
    expect(boqCompletionPercent(150, 200)).toBe(75);
    expect(boqCompletionPercent(1, 3)).toBe(33.3);
    expect(boqCompletionPercent(50, null)).toBeNull();
    expect(boqCompletionPercent(50, 0)).toBeNull();
  });

  it("zastoji se sabiraju na dvije decimale, a produženje roka zaokružuje naviše", () => {
    expect(totalDelayHours([{ hours: 4.25 }, { hours: 3.5 }])).toBe(7.75);
    expect(suggestedExtensionDays(7.75)).toBe(1);
    /* 4 sata zastoja ne smije nestati zaokruživanjem na nulu. */
    expect(suggestedExtensionDays(4)).toBe(1);
    expect(suggestedExtensionDays(0)).toBe(0);
  });
});

describe("Dnevnik — tok i potpis", () => {
  it("DRAFT → SIGNED traži potpis, SIGNED → LOCKED samo zaključava", () => {
    expect(diaryTransition("DRAFT", "SIGNED", false)).toEqual({ ok: false, code: "DIARY_SIGNATURE_REQUIRED" });
    expect(diaryTransition("DRAFT", "SIGNED", true)).toEqual({ ok: true, status: "SIGNED" });
    expect(diaryTransition("SIGNED", "LOCKED", true)).toEqual({ ok: true, status: "LOCKED" });
  });

  it("zaključan dnevnik nema izlaz — ispravka ide kroz reviziju", () => {
    expect(diaryTransition("LOCKED", "DRAFT", true)).toEqual({ ok: false, code: "DIARY_ALREADY_LOCKED" });
    expect(diaryTransition("DRAFT", "LOCKED", true)).toEqual({ ok: false, code: "SERVICE_INVALID_STATUS" });
  });

  it("potpis je ime, ne razmaci", () => {
    expect(validDiarySignature("  Amar Hodžić ")).toBe(true);
    expect(validDiarySignature("   ")).toBe(false);
    expect(validDiarySignature("A")).toBe(false);
    expect(validDiarySignature(null)).toBe(false);
  });

  it("nepotpisan dnevnik stariji od 2 dana je propust na Pregledu", () => {
    expect(unsignedDiaryIsOverdue("2026-11-18", "2026-11-21")).toBe(true);
    expect(unsignedDiaryIsOverdue("2026-11-20", "2026-11-21")).toBe(false);
    expect(unsignedDiaryIsOverdue("2026-11-21", "2026-11-21")).toBe(false);
  });
});

describe("HSE — LTIFR i izgubljeni dani", () => {
  it("LTIFR = ozljede sa izgubljenim danima × 1 000 000 / sati", () => {
    /* 3 ozljede, 250 000 sati → 12,00 */
    const incidents = [
      incident({ lostDays: 5 }),
      incident({ lostDays: 2 }),
      incident({ lostDays: 1 }),
      incident({ kind: "NEAR_MISS", lostDays: 0 }),
      incident({ kind: "PROPERTY_DAMAGE", lostDays: 0 }),
    ];
    expect(ltifr(incidents, 250_000)).toBe(12);
  });

  it("ozljeda bez izgubljenih dana ne ulazi u brojilac", () => {
    expect(isLostTimeInjury(incident({ lostDays: 0 }))).toBe(false);
    expect(isLostTimeInjury(incident({ lostDays: 1 }))).toBe(true);
    /* Profesionalno oboljenje sa izgubljenim danima nije ozljeda — LTIFR mjeri ozljede. */
    expect(isLostTimeInjury(incident({ kind: "OCCUPATIONAL_ILLNESS", lostDays: 10 }))).toBe(false);
  });

  it("bez sati nema stope — ni nula ni beskonačno", () => {
    expect(ltifr([incident()], 0)).toBeNull();
    expect(ltifr([incident()], Number.NaN)).toBeNull();
    expect(ltifr([], 10_000)).toBe(0);
  });

  it("NEAR_MISS se broji odvojeno od ozljeda", () => {
    const incidents = [
      incident({ kind: "NEAR_MISS", lostDays: 0 }),
      incident({ kind: "NEAR_MISS", lostDays: 0 }),
      incident({ lostDays: 2 }),
    ];
    expect(nearMissCount(incidents)).toBe(2);
    expect(ltifr(incidents, 100_000)).toBe(10);
  });

  it("izgubljeni dani su zbir po incidentima", () => {
    expect(totalLostDays([incident({ lostDays: 4 }), incident({ lostDays: 6 }), incident({ kind: "NEAR_MISS", lostDays: 0 })])).toBe(10);
  });
});

describe("HSE — mjere", () => {
  it("overdue se računa iz roka i stanja, ne čuva", () => {
    expect(hseActionIsOverdue(action({ dueOn: "2026-11-19" }), "2026-11-20")).toBe(true);
    expect(hseActionIsOverdue(action({ dueOn: "2026-11-20" }), "2026-11-20")).toBe(false);
    expect(hseActionIsOverdue(action({ status: "DONE", doneOn: "2026-11-19" }), "2026-11-20")).toBe(false);
    /* Otkazana mjera nije obaveza. */
    expect(hseActionIsOverdue(action({ status: "CANCELLED" }), "2026-12-01")).toBe(false);
  });

  it("na vrijeme znači završeno do roka, uključujući sam rok", () => {
    expect(hseActionOnTime(action({ status: "DONE", doneOn: "2026-11-20" }))).toBe(true);
    expect(hseActionOnTime(action({ status: "DONE", doneOn: "2026-11-21" }))).toBe(false);
    expect(hseActionOnTime(action({ status: "OPEN" }))).toBe(false);
  });

  it("stopa mjera na vrijeme dijeli sa ZAVRŠENIM, ne sa svim", () => {
    const actions = [
      action({ status: "DONE", doneOn: "2026-11-19" }),
      action({ status: "DONE", doneOn: "2026-11-20" }),
      action({ status: "DONE", doneOn: "2026-11-25" }),
      /* Otvorene i otkazane ne ulaze u imenilac. */
      action({ status: "OPEN", dueOn: "2026-12-01" }),
      action({ status: "CANCELLED" }),
    ];
    expect(hseOnTimeRate(actions)).toBe(66.7);
    expect(hseOnTimeRate([])).toBeNull();
    expect(hseOnTimeRate([action({ status: "OPEN" })])).toBeNull();
  });

  it("incident se ne zatvara sa otvorenom mjerom ni bez istrage", () => {
    expect(canCloseIncident({ actions: [], investigationCompleted: false })).toEqual({
      ok: false,
      code: "HSE_INVESTIGATION_REQUIRED",
    });
    expect(
      canCloseIncident({ actions: [action({ status: "OPEN" })], investigationCompleted: true }),
    ).toEqual({ ok: false, code: "HSE_ACTION_OPEN" });
    expect(
      canCloseIncident({
        actions: [action({ status: "DONE", doneOn: "2026-11-19" }), action({ status: "CANCELLED" })],
        investigationCompleted: true,
      }),
    ).toEqual({ ok: true });
  });
});

describe("HSE — obaveza prijave i zabrana rada", () => {
  it("obaveza HSE_REPORT nastaje jednom, ne na svaki poziv", () => {
    expect(needsHseReportObligation({ reportableToAuthority: true, reportObligationId: null })).toBe(true);
    expect(needsHseReportObligation({ reportableToAuthority: true, reportObligationId: "obl_1" })).toBe(false);
    expect(needsHseReportObligation({ reportableToAuthority: false, reportObligationId: null })).toBe(false);
  });

  it("zabrana rada traje dok se izričito ne podigne", () => {
    expect(isActiveProhibition({ result: "PROHIBITION", prohibitionLiftedAt: null })).toBe(true);
    expect(isActiveProhibition({ result: "PROHIBITION", prohibitionLiftedAt: "2026-11-22T10:00:00Z" })).toBe(false);
    expect(isActiveProhibition({ result: "MAJOR_FINDINGS", prohibitionLiftedAt: null })).toBe(false);
  });
});

describe("HSE — obuke i toolbox", () => {
  it("toolbox traži temu, bar jednog prisutnog i bez duplikata", () => {
    expect(validToolboxInput({ topic: "Rad na visini", attendees: ["wrk_1", "wrk_2"], durationMinutes: 15 })).toBe(true);
    expect(validToolboxInput({ topic: "Ra", attendees: ["wrk_1"], durationMinutes: 15 })).toBe(false);
    expect(validToolboxInput({ topic: "Rad na visini", attendees: [], durationMinutes: 15 })).toBe(false);
    expect(validToolboxInput({ topic: "Rad na visini", attendees: ["wrk_1", "wrk_1"], durationMinutes: 15 })).toBe(false);
    /* Trajanje je opciono, ali ako postoji mora biti razumno. */
    expect(validToolboxInput({ topic: "Rad na visini", attendees: ["wrk_1"], durationMinutes: null })).toBe(true);
    expect(validToolboxInput({ topic: "Rad na visini", attendees: ["wrk_1"], durationMinutes: 0 })).toBe(false);
    expect(validToolboxInput({ topic: "Rad na visini", attendees: ["wrk_1"], durationMinutes: 601 })).toBe(false);
  });

  it("samo CERTIFICATION sa prisutnima obnavlja certifikat iz Modula 2", () => {
    expect(trainingCanRenewCertificate("CERTIFICATION", 3)).toBe(true);
    expect(trainingCanRenewCertificate("CERTIFICATION", 0)).toBe(false);
    expect(trainingCanRenewCertificate("TOOLBOX", 5)).toBe(false);
    expect(trainingCanRenewCertificate("INDUCTION", 5)).toBe(false);
  });
});
