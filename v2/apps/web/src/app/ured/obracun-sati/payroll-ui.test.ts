/**
 * F6 — pravila PRIKAZA obračuna, bez baze.
 *
 * Testira se ono što korisnik vidi i o čemu odlučuje: da linija bez iznosa NIJE nula, da se
 * zbir po radniku ne prikazuje kad ijedna linija nema iznos, da se dvije linije iste komponente
 * sabiraju (ne dupliraju) i da spremnost perioda ima tekst, a ne samo boju.
 *
 * Zašto odvojeno od integracionih testova: ove tvrdnje padaju i bez PostgreSQL-a, pa CI mora
 * pasti i kad baza nije dostupna — greška u prikazu novca ne smije zavisiti od okruženja.
 */
import { describe, expect, it } from "vitest";
import { groupByWorker, hours, money, statusTone } from "./payroll-view-model";
import { readinessText } from "./periods-client";

type Line = Parameters<typeof groupByWorker>[0][number];

const line = (over: Partial<Line>): Line => ({
  id: "l1",
  run_id: "r1",
  worker_id: "w1",
  worker_name: "Radnik",
  component_code: "REDOVNI",
  component_name: "Redovni sati",
  kind: "EARNING",
  hours: 8,
  days: 0,
  rate_cents: 1000,
  amount_cents: 8000,
  currency_code: "BAM",
  status: "OK",
  calc_note: null,
  ...over,
});

const period = (over: Partial<Parameters<typeof readinessText>[0]> = {}) => ({
  id: "p1",
  year: 2026,
  month: 3,
  status: "CALCULATED" as const,
  calculated_at: null,
  approved_at: null,
  locked_at: null,
  worker_count: 1,
  gross_total: "8000",
  revision: 2,
  blockers: [] as { code: string; count: number; message: string }[],
  ...over,
});

describe("F6 prikaz — novac i sati", () => {
  it("nedostajući iznos je crtica, NIKAD nula", () => {
    // Nula bi izgledala kao obračunata nula i tiho otišla u isplatu.
    expect(money(null)).toBe("—");
    expect(money(0)).toBe("0,00");
    expect(money(8000)).toBe("80,00");
    expect(money(-8000)).toBe("−80,00");
    expect(money(5)).toBe("0,05");
  });

  it("sati nose do 3 decimale i zarez, bez lažne preciznosti", () => {
    expect(hours(8)).toBe("8");
    expect(hours(7.5)).toBe("7,5");
    expect(hours(1.983)).toBe("1,983");
    expect(hours(0)).toBe("0");
  });
});

describe("F6 prikaz — zbir po radniku", () => {
  it("dvije linije iste komponente se SABIRAJU, ne dupliraju", () => {
    const [row] = groupByWorker([
      line({ id: "a", hours: 4, amount_cents: 4000 }),
      line({ id: "b", hours: 4, amount_cents: 4000 }),
    ]);
    expect(row!.components.get("REDOVNI")?.hours).toBe(8);
    expect(row!.components.get("REDOVNI")?.amount).toBe(8000);
  });

  it("radnik sa ijednom linijom bez iznosa nema zbir — djelimičan zbir je laž", () => {
    const [row] = groupByWorker([
      line({ id: "a", amount_cents: 8000 }),
      line({ id: "b", component_code: "NOCNI", amount_cents: null, status: "PARAMETER_MISSING" }),
    ]);
    expect(row!.earnings).toBeNull();
    expect(row!.missing).toBe(true);
    // Sama linija zadržava razlog — ekran ga ispisuje uz crticu.
    expect(row!.components.get("NOCNI")?.status).toBe("PARAMETER_MISSING");
  });

  it("odbici ulaze kao odbici, ne kao negativna zarada", () => {
    const [row] = groupByWorker([
      line({ id: "a", amount_cents: 8000 }),
      line({
        id: "b",
        component_code: "AKONTACIJA",
        component_name: "Akontacija",
        kind: "DEDUCTION",
        hours: 0,
        amount_cents: -5000,
        rate_cents: null,
      }),
    ]);
    expect(row!.earnings).toBe(8000);
    expect(row!.deductions).toBe(-5000);
  });

  it("dva radnika ostaju dva reda (ključ je radnik, ne komponenta)", () => {
    const rows = groupByWorker([
      line({ id: "a", worker_id: "w1" }),
      line({ id: "b", worker_id: "w2", worker_name: "Drugi" }),
    ]);
    expect(rows.map((row) => row.workerId).sort()).toEqual(["w1", "w2"]);
  });
});

describe("F6 prikaz — spremnost perioda", () => {
  it("blokade se imenuju, ne skrivaju iza crvene tačke", () => {
    const text = readinessText(
      period({
        blockers: [{ code: "RATE_MISSING", count: 2, message: "Nedostaje satnica." }],
      }),
    );
    expect(text).toContain("Nedostaje satnica.");
    expect(text).toContain("2");
  });

  it("otvoren period bez obračuna kaže da nije izračunat, ne „spremno“", () => {
    expect(readinessText(period({ status: "OPEN", revision: null, gross_total: null }))).toBe(
      "Nije izračunat.",
    );
  });

  it("zaključan period upućuje na korekcije", () => {
    expect(readinessText(period({ status: "LOCKED" }))).toContain("korekcije");
  });

  it("spremnost nosi i broj revizije — revizija je zapis, ne pogled", () => {
    expect(readinessText(period({ revision: 3 }))).toContain("Revizija 3");
  });

  it("boja nikad nije jedini nosilac značenja (status ide uz tekst)", () => {
    expect(statusTone("OPEN")).toBe("muted");
    expect(statusTone("CALCULATED")).toBe("warn");
    expect(statusTone("APPROVED")).toBe("ok");
    expect(statusTone("LOCKED")).toBe("ok");
  });
});
