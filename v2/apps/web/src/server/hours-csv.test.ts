import { describe, expect, it } from "vitest";
import { buildHoursCsv, escapeCsvCell, type HoursCsvRow } from "./hours-csv";

describe("escapeCsvCell", () => {
  it("ostavlja običan tekst", () => {
    expect(escapeCsvCell("Amar Hadžić")).toBe("Amar Hadžić");
  });

  it("citira zarez, navodnike i novi red", () => {
    expect(escapeCsvCell("a,b")).toBe('"a,b"');
    expect(escapeCsvCell('kaže "da"')).toBe('"kaže ""da"""');
    expect(escapeCsvCell("a\nb")).toBe('"a\nb"');
  });
});

describe("buildHoursCsv", () => {
  it("prazna lista daje samo header s BOM", () => {
    const csv = buildHoursCsv([]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("radnik,datum,sati,projekat,status\r\n");
  });

  it("serijalizuje redove i escapuje polja", () => {
    const rows: HoursCsvRow[] = [
      {
        worker: 'Hadžić, Amar',
        date: "2026-11-10",
        hours: "8.000",
        project: 'PRJ-01 "Most"',
        status: "LOCKED",
      },
      {
        worker: "Ana Anić",
        date: "2026-11-11",
        hours: "7.500",
        project: "PRJ-02",
        status: "CONFIRMED",
      },
    ];
    const csv = buildHoursCsv(rows);
    expect(csv).toContain('"Hadžić, Amar",2026-11-10,8.000,"PRJ-01 ""Most""",LOCKED');
    expect(csv).toContain("Ana Anić,2026-11-11,7.500,PRJ-02,CONFIRMED");
  });
});
