/**
 * Model „Moj dan“ — pravila timera bez uređaja.
 *
 * Testira ono što se najlakše tiho pokvari: da glavno dugme uvijek ima JEDNO značenje za dato
 * stanje, i da zaboravljen dan ne dozvoljava početak novog dok se ne odgovori.
 */
import { describe, expect, it } from "vitest";
import {
  assignmentPickerNeeded,
  elapsedLabel,
  forgottenPrompt,
  mainAction,
  tzOffsetMinutes,
  type DayView,
  type MyDayView,
} from "./moj-dan-model";

function day(partial: Partial<DayView>): DayView {
  return {
    id: "d1",
    workDate: "2026-11-16",
    dayKind: "WORK",
    assignmentWarning: false,
    segments: [],
    minutes: 0,
    openSegments: 0,
    reviewState: "OK",
    ...partial,
  };
}

const segment = (kind: "WORK" | "BREAK", endState: "OPEN" | "KNOWN_END" | "UNKNOWN_END" = "KNOWN_END") => ({
  id: `${kind}-${endState}`,
  kind,
  startedAt: "2026-11-16T06:00:00.000Z",
  endedAt: endState === "OPEN" ? null : "2026-11-16T14:00:00.000Z",
  endState,
  projectId: "prj_1",
  projectName: "Gradilište",
  machineName: null,
});

describe("glavna akcija", () => {
  it("bez dana je „Počni rad“", () => {
    expect(mainAction(null).next).toBe("start");
  });

  it("otvoren rad daje pauzu, otvorena pauza daje nastavak", () => {
    const working = day({ segments: [segment("WORK", "OPEN")], openSegments: 1 });
    expect(mainAction(working).next).toBe("pause");
    const onBreak = day({ segments: [segment("WORK"), segment("BREAK", "OPEN")], openSegments: 1 });
    expect(mainAction(onBreak).next).toBe("resume");
  });

  it("završen dan nudi novi segment, a ne „kraj“", () => {
    expect(mainAction(day({ segments: [segment("WORK")] })).next).toBe("start");
  });
});

describe("izbor projekta", () => {
  const state = (projects: string[]): MyDayView => ({
    today: null,
    forgotten: null,
    assignments: projects.map((projectId) => ({
      projectId,
      projectName: projectId,
      machineId: null,
      machineName: null,
    })),
    forgottenThresholdHours: 16,
    roundingMinutes: 0,
    roundingMode: "NEAREST",
  });

  it("jedna dodjela ne pita ništa", () => {
    expect(assignmentPickerNeeded(state(["a"]), null)).toBe(false);
  });

  it("dvije dodjele traže izbor", () => {
    expect(assignmentPickerNeeded(state(["a", "b"]), null)).toBe(true);
  });

  it("kad dan već ima projekat, izbor je napravljen", () => {
    const working = day({ segments: [segment("WORK", "OPEN")], openSegments: 1 });
    expect(assignmentPickerNeeded(state(["a", "b"]), working)).toBe(false);
  });
});

describe("zaboravljen dan", () => {
  it("pita samo za OTVOREN segment i imenuje datum", () => {
    const open = day({ workDate: "2026-11-15", segments: [segment("WORK", "OPEN")], openSegments: 1 });
    const prompt = forgottenPrompt(open);
    expect(prompt).toContain("15.11.2026");
    expect(prompt).toContain("Kada si prestao");
  });

  it("zatvoren dan ne pita ništa", () => {
    expect(forgottenPrompt(day({ segments: [segment("WORK")] }))).toBeNull();
    expect(forgottenPrompt(null)).toBeNull();
  });
});

describe("vrijeme", () => {
  it("otvoren segment mjeri od početka do sada", () => {
    const working = day({ segments: [segment("WORK", "OPEN")], openSegments: 1 });
    const label = elapsedLabel(working, new Date("2026-11-16T08:14:00.000Z"));
    expect(label).toBe("Traje 2 h 14 min");
  });

  it("zatvoren dan prikazuje zbir, ne prazninu", () => {
    expect(elapsedLabel(day({ segments: [segment("WORK")], minutes: 480 }), new Date())).toBe("Završeno: 8 h 0 min");
  });

  it("pomak zone je obrnut od `getTimezoneOffset`", () => {
    // 12:00 UTC u zoni +02:00 → pomak je +120 minuta.
    const at = new Date("2026-11-16T12:00:00.000Z");
    const expected = -at.getTimezoneOffset();
    expect(tzOffsetMinutes(at)).toBe(expected);
  });
});
