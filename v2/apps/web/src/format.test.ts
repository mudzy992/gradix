/**
 * Prikaz vrijednosti: jedan format, isti na svakom pregledniku i u testu.
 *
 * Ovdje je i razlog zašto modul postoji — `Intl` sa `bs-BA` daje različit tekst po pregledniku
 * („2026 M11 7“ u Chromiumu), pa bi isti podatak izgledao drukčije u tabeli i u PDF-u.
 */
import { describe, expect, it } from "vitest";
import { engagementLabel, formatDate, formatDateTime, formatNumber, initialsOf, meterUnit, ownershipLabel } from "./format";

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
