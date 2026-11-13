/**
 * Prikaz vrijednosti: jedan format, isti na svakom pregledniku i u testu.
 *
 * Ovdje je i razlog zašto modul postoji — `Intl` sa `bs-BA` daje različit tekst po pregledniku
 * („2026 M11 7“ u Chromiumu), pa bi isti podatak izgledao drukčije u tabeli i u PDF-u.
 */
import { describe, expect, it } from "vitest";
import {
  engagementLabel,
  formatDate,
  formatDateTime,
  formatDayTime,
  formatLongDate,
  formatNumber,
  initialsOf,
  meterUnit,
  ownershipLabel,
} from "./format";

describe("format", () => {
  it("poslovni datum se ne pomjera kroz zone", () => {
    expect(formatDate("2026-11-07")).toBe("7. 11. 2026.");
    expect(formatDate("2025-01-01")).toBe("1. 1. 2025.");
    expect(formatDate(null)).toBe("—");
  });

  it("trenutak se prikazuje u zoni firme, ne u zoni servera", () => {
    // 12:30 UTC je 13:30 u Sarajevu (zimsko vrijeme, +1).
    expect(formatDateTime("2026-11-07T12:30:00.000Z")).toBe("7. 11. 2026. u 13:30");
    // Neispravna zona iz postavke ne ruši ekran — vraća se na podrazumijevanu.
    expect(formatDateTime("2026-11-07T12:30:00.000Z", "Mars/Olympus")).toBe("7. 11. 2026. u 13:30");
  });

  it("brojilo se čita kao na tabli: zarez za decimale, tačka za hiljade", () => {
    expect(formatNumber(1234.5)).toBe("1.234,5");
    expect(formatNumber(55000)).toBe("55.000");
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(1234567.25)).toBe("1.234.567,3");
    expect(formatNumber(null)).toBe("—");
  });

  it("nazivi se prevode na jezik gradilišta, ne ostaju šifre", () => {
    expect(meterUnit("HOURS")).toBe("sati");
    expect(meterUnit("KM")).toBe("km");
    expect(engagementLabel("FIXED_TERM")).toBe("Određeno");
    expect(ownershipLabel("RENT")).toBe("Najam");
    // Nepoznata vrijednost se ne skriva — bolje šifra nego prazno polje.
    expect(engagementLabel("NEPOZNATO")).toBe("NEPOZNATO");
  });

  it("inicijali za avatar", () => {
    expect(initialsOf("Amina", "Karić")).toBe("AK");
    expect(initialsOf("", "")).toBe("");
  });
});

describe("format — C.1 pregled", () => {
  it("dugi datum nosi dan sedmice i bosanski mjesec (podnaslov pregleda)", () => {
    // 8. 11. 2026. je nedjelja — dan koji dizajn koristi u artboardu.
    expect(formatLongDate("2026-11-08")).toBe("Nedjelja, 8. novembar");
    expect(formatLongDate("2026-11-13")).toBe("Petak, 13. novembar");
    expect(formatLongDate("ne-datuma")).toBe("ne-datuma");
  });

  it("vrijeme sinhronizacije: danas/juče u zoni firme, ne po satu servera", () => {
    // Fiksni trenuci u odnosu na „sada“ — jedini pošteni način da se relativno vrijeme testira.
    const now = Date.now();
    const zone = "Europe/Sarajevo";
    const justNow = new Date(now - 60_000).toISOString();
    const dayAgo = new Date(now - 26 * 3600_000).toISOString();
    const longAgo = new Date(Date.UTC(2026, 10, 3, 15, 5, 0)).toISOString();

    expect(formatDayTime(justNow, zone)).toMatch(/^danas u \d{2}:\d{2}$/);
    // 26 sati unazad je juče samo ako između nije bilo prelaska sati; u Europe/Sarajevo
    // (CET, +1) prelaz je u martu/oktobru — u novembru 26 h sigurno pada u juče.
    expect(formatDayTime(dayAgo, zone)).toMatch(/^juče u \d{2}:\d{2}$/);
    expect(formatDayTime(longAgo, zone)).toMatch(/^3\. 11\. 2026\. u \d{2}:\d{2}$/);
    expect(formatDayTime(null, zone)).toBe("—");
    expect(formatDayTime("cudno", zone)).toBe("cudno");
  });
});
