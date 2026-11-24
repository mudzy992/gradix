/**
 * Sedmična tabela — čisto izračunavanje, bez DOM-a.
 *
 * Provjerava dvije stvari koje se lako tiho pokvare: da sedmica ima tačno 7 dana od ponedjeljka
 * i da se nula minuta NE prikazuje kao „0 h“ (prazna ćelija znači „nema dana“, a izostanak
 * mora ostati vidljiv).
 */
import { describe, expect, it } from "vitest";
import { dayName, minutesLabel, weekDays } from "./week-labels";
import { weekCsv } from "./week-csv";

describe("sedmica — pomoćne funkcije", () => {
  it("sedmica ide od ponedjeljka do nedjelje", () => {
    const days = weekDays("2026-11-16");
    expect(days).toHaveLength(7);
    expect(days[0]).toBe("2026-11-16");
    expect(days[6]).toBe("2026-11-22");
    expect(dayName(days[0]!)).toMatch(/^pon/);
  });

  it("prelaz preko mjeseca ne gubi dan", () => {
    const days = weekDays("2026-12-28");
    expect(days[6]).toBe("2027-01-03");
  });

  it("nula minuta nije sat", () => {
    expect(minutesLabel(0)).toBe("—");
    expect(minutesLabel(60)).toBe("1 h");
    expect(minutesLabel(90)).toBe("1 h 30 min");
  });
});

describe("CSV izvoz", () => {
  it("izostanak nosi naziv, a ne nulu; prazan dan ostaje prazan", () => {
    const week = {
      weekStart: "2026-11-16",
      weekEnd: "2026-11-22",
      rows: [
        {
          workerId: "w1",
          workerName: "Ana Anić",
          totalMinutes: 480,
          days: {
            "2026-11-16": {
              workdayId: "d1",
              minutes: 480,
              dayKind: "WORK",
              approvalStatus: "SUBMITTED",
              reviewState: "OK",
            },
            "2026-11-17": {
              workdayId: "d2",
              minutes: 0,
              dayKind: "SICK",
              approvalStatus: "SUBMITTED",
              reviewState: "OK",
            },
          },
        },
      ],
      totals: { minutes: 480, byDayKind: { WORK: 480 } },
      openConflicts: 0,
    } as unknown as Parameters<typeof weekCsv>[0];

    const lines = weekCsv(week).split("\r\n");
    expect(lines[0]).toContain("Radnik");
    const row = lines[1]!;
    expect(row).toContain("Ana Anić,480,Bolovanje,,,,");
    // Ukupno je 480 iako je jedan dan izostanak — izostanak ne ulazi u sate.
    expect(row.endsWith(",480")).toBe(true);
    expect(lines[2]).toContain("UKUPNO");
  });
});
