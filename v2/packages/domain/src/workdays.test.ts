/**
 * Modul 3 — pravila radnog vremena. Testira ono što se u obračunu pokvari tiho i skupo.
 */
import { describe, expect, it } from "vitest";
import {
  consumesLeave,
  forgottenDayOutcome,
  isAbsenceDay,
  isForgottenDay,
  needsOfficeReview,
  overlapMessage,
  roundSegmentMinutes,
  sumSegmentMinutes,
  workdayReviewState,
} from "./workdays";

describe("zaokruživanje — po segmentu, ne po danu", () => {
  it("NEAREST na 15: 7 → 0, 8 → 15, 22 → 15, 23 → 30", () => {
    expect(roundSegmentMinutes(7, 15, "NEAREST")).toBe(0);
    expect(roundSegmentMinutes(8, 15, "NEAREST")).toBe(15);
    expect(roundSegmentMinutes(22, 15, "NEAREST")).toBe(15);
    expect(roundSegmentMinutes(23, 15, "NEAREST")).toBe(30);
  });

  it("UP i DOWN su strogi, bez obzira na blizinu", () => {
    expect(roundSegmentMinutes(1, 15, "UP")).toBe(15);
    expect(roundSegmentMinutes(29, 15, "UP")).toBe(30);
    expect(roundSegmentMinutes(29, 15, "DOWN")).toBe(15);
    expect(roundSegmentMinutes(1, 15, "DOWN")).toBe(0);
  });

  it("korak 0 ne mijenja ništa (default firme)", () => {
    expect(roundSegmentMinutes(7.4, 0, "NEAREST")).toBe(7);
    expect(roundSegmentMinutes(7.6, 0, "NEAREST")).toBe(8);
  });

  it("negativno trajanje se odbija — nula bi izgledala kao legitiman rezultat", () => {
    expect(() => roundSegmentMinutes(-1, 15, "NEAREST")).toThrow(/negativno/);
  });

  // Spec 03 §5.4 traži baš granični slučaj 7,5 min: NEAREST 15 daje 15 (pola ide naviše), a
  // DOWN daje 0. Bitno je da se odluka donosi PO SEGMENTU: tri takva segmenta daju 45 min sa
  // zaokruživanjem, a 22,5 (→ 23) bez njega — nikad 15 (što bi dao zbir pa zaokruživanje zbroja).
  it("7,5 min je granica: NEAREST → 15, DOWN → 0, UP → 15", () => {
    expect(roundSegmentMinutes(7.5, 15, "NEAREST")).toBe(15);
    expect(roundSegmentMinutes(7.5, 15, "DOWN")).toBe(0);
    expect(roundSegmentMinutes(7.5, 15, "UP")).toBe(15);
  });

  it("zaokružuje se SVAKI segment: tri po 7,5 min = 45, a ne 23 ni 15", () => {
    const segments = [
      { startedAt: "2026-11-23T07:00:00.000Z", endedAt: "2026-11-23T07:07:30.000Z" },
      { startedAt: "2026-11-23T08:00:00.000Z", endedAt: "2026-11-23T08:07:30.000Z" },
      { startedAt: "2026-11-23T09:00:00.000Z", endedAt: "2026-11-23T09:07:30.000Z" },
    ];
    expect(sumSegmentMinutes(segments, { step: 15, mode: "NEAREST" }).minutes).toBe(45);
    // Isti segmenti sa DOWN daju 0 — dokaz da se zaokružuje svaki, ne zbir (zbir 22,5 → 15).
    expect(sumSegmentMinutes(segments, { step: 15, mode: "DOWN" }).minutes).toBe(0);
    // Bez zaokruživanja svaki segment (7,5) se zaokružuje na cijelu minutu: 8 + 8 + 8 = 24.
    expect(sumSegmentMinutes(segments, { step: 0 }).minutes).toBe(24);
  });

  it("otvoren segment se preskače — njegovo trajanje još ne postoji", () => {
    const result = sumSegmentMinutes([
      { startedAt: "2026-11-23T07:00:00.000Z", endedAt: "2026-11-23T11:00:00.000Z" },
      { startedAt: "2026-11-23T12:00:00.000Z", endedAt: null },
    ]);
    expect(result.minutes).toBe(240);
    expect(result.open).toBe(1);
    expect(result.counted).toBe(1);
  });

  it("pokvaren red se broji kao `invalid` i ne ruši zbir", () => {
    const result = sumSegmentMinutes([
      { startedAt: "2026-11-23T07:00:00.000Z", endedAt: "2026-11-23T11:00:00.000Z" },
      { startedAt: "2026-11-23T12:00:00.000Z", endedAt: "2026-11-23T11:00:00.000Z" },
    ]);
    expect(result.minutes).toBe(240);
    expect(result.invalid).toBe(1);
  });
});

describe("zaboravljen dan", () => {
  const now = new Date("2026-11-23T18:00:00.000Z");

  it("prag je u satima od POČETKA segmenta (12/16/24)", () => {
    expect(isForgottenDay({ startedAt: "2026-11-23T04:00:00.000Z", endedAt: null }, { now, thresholdHours: 16 })).toBe(false);
    expect(isForgottenDay({ startedAt: "2026-11-23T01:00:00.000Z", endedAt: null }, { now, thresholdHours: 16 })).toBe(true);
    // Isti segment, stroži prag: 14 h star je zaboravljen na 12, ali ne na 16.
    expect(isForgottenDay({ startedAt: "2026-11-23T04:00:00.000Z", endedAt: null }, { now, thresholdHours: 12 })).toBe(true);
  });

  it("zatvoren segment nikad nije zaboravljen", () => {
    expect(
      isForgottenDay({ startedAt: "2026-11-20T04:00:00.000Z", endedAt: "2026-11-20T12:00:00.000Z" }, { now, thresholdHours: 12 }),
    ).toBe(false);
  });

  it("„ne znam“ daje UNKNOWN_END, a ne izmišljeno vrijeme", () => {
    expect(forgottenDayOutcome({ kind: "UNKNOWN", startedAt: "2026-11-22T07:00:00.000Z" })).toEqual({
      endState: "UNKNOWN_END",
      endedAt: null,
    });
  });

  it("„vrijeme zadnjeg otkucaja“ koristi to vrijeme, ne sada", () => {
    const outcome = forgottenDayOutcome({
      kind: "LAST_PING",
      startedAt: "2026-11-22T07:00:00.000Z",
      lastPingAt: "2026-11-22T15:30:00.000Z",
    });
    expect(outcome).toEqual({ endState: "KNOWN_END", endedAt: "2026-11-22T15:30:00.000Z" });
  });

  it("bez vremena zadnjeg otkucaja traži se „ne znam“, ne pogađanje", () => {
    const outcome = forgottenDayOutcome({ kind: "LAST_PING", startedAt: "2026-11-22T07:00:00.000Z", lastPingAt: null });
    expect(outcome).toHaveProperty("error");
  });

  it("kraj prije početka se odbija", () => {
    const outcome = forgottenDayOutcome({
      kind: "TIME",
      startedAt: "2026-11-22T07:00:00.000Z",
      endedAt: "2026-11-22T06:00:00.000Z",
    });
    expect(outcome).toHaveProperty("error");
  });
});

describe("stanje dana za ured", () => {
  const now = new Date("2026-11-23T18:00:00.000Z");

  it("UNKNOWN_END je posao za šefa, ne „ok“", () => {
    const state = workdayReviewState({ openStartedAt: null, hasUnknownEnd: true, now, thresholdHours: 16 });
    expect(state).toBe("UNKNOWN_END");
    expect(needsOfficeReview(state)).toBe(true);
  });

  it("otvoren dan stariji od praga je zaboravljen, svjež nije", () => {
    expect(
      workdayReviewState({ openStartedAt: "2026-11-23T16:00:00.000Z", hasUnknownEnd: false, now, thresholdHours: 16 }),
    ).toBe("OPEN_TODAY");
    expect(
      workdayReviewState({ openStartedAt: "2026-11-22T07:00:00.000Z", hasUnknownEnd: false, now, thresholdHours: 16 }),
    ).toBe("FORGOTTEN");
  });
});

describe("vrste dana", () => {
  it("izostanak je dan bez sati, ali sa značenjem", () => {
    expect(isAbsenceDay("SICK")).toBe(true);
    expect(isAbsenceDay("VACATION")).toBe(true);
    expect(isAbsenceDay("WORK")).toBe(false);
    expect(isAbsenceDay("NO_SHOW")).toBe(false);
  });

  it("godišnji troši samo VACATION (SICK i praznik ne)", () => {
    expect(consumesLeave("VACATION")).toBe(true);
    expect(consumesLeave("SICK")).toBe(false);
    expect(consumesLeave("HOLIDAY")).toBe(false);
    expect(consumesLeave("PAID_LEAVE")).toBe(false);
  });
});

describe("poruka o preklapanju", () => {
  it("je ljudska rečenica, nikad SQLSTATE", () => {
    const message = overlapMessage({
      existingStart: "2026-11-23T07:00:00.000Z",
      existingEnd: "2026-11-23T16:00:00.000Z",
      newStart: "2026-11-23T15:00:00.000Z",
    });
    expect(message).toContain("Imaš zapis 07:00–16:00");
    expect(message).toContain("novi počinje u 15:00");
    expect(message).not.toMatch(/23505|constraint|SQLSTATE/);
  });

  it("za otvoren zapis kaže „još traje“", () => {
    expect(
      overlapMessage({ existingStart: "2026-11-23T07:00:00.000Z", existingEnd: null, newStart: "2026-11-23T15:00:00.000Z" }),
    ).toContain("07:00–još traje");
  });
});
