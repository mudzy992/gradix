// @vitest-environment jsdom
/**
 * C.1 — PregledBoard: prikaz odobrenog dizajna bez baze.
 *
 * Provjerava ono što se lako pokvari a ne vidi se u SQL testovima:
 *  - redoslijed redova po hitnosti i da prazni redovi NE stoje (nema „0“ koje laže);
 *  - prazno stanje „Ništa ne traži pažnju“ bez crvenog i s izlazom na rokove;
 *  - sinhronizacija se NE renderuje kad je `null` (PM), a renderuje kad postoji;
 *  - značka „stariji od praga“ postoji samo kad ima razloga;
 *  - axe: nema serious/critical nalaza (isti prag kao ostali ekrani).
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PregledResponse } from "@gradix/contracts";
import { PregledBoard } from "./pregled-board";
import { expectNoSeriousA11yViolations } from "@/test/axe";

const base: PregledResponse = {
  today: "2026-11-13",
  timezone: "Europe/Sarajevo",
  attention: {
    expired: {
      count: 4,
      oldest: [
        { typeLabel: "Tehnički pregled", target: "KAM-04", expiresAt: "2026-10-28" },
        { typeLabel: "Ljekarski pregled", target: "Dino Salihović", expiresAt: "2026-11-02" },
      ],
    },
    conflicts: {
      count: 6,
      olderThanThreshold: 2,
      thresholdDays: 3,
      oldest: [{ workerName: "Amar Hadžić", createdAt: "2026-11-02T14:00:00.000Z" }],
    },
    expiring30: {
      count: 5,
      nearest: { typeLabel: "Registracija", target: "KAM-02", expiresAt: "2026-11-20" },
    },
    reviewDays: {
      count: 2,
      oldest: [
        { workerName: "Elvir Bešlić", workDate: "2026-11-13", kind: "open" },
        { workerName: "Amar Hadžić", workDate: "2026-11-12", kind: "unknown" },
      ],
    },
    blockedAssignments: {
      count: 1,
      examples: [{ target: "BAG-01", typeLabel: "Registracija (demo)" }],
    },
    expiring3190: {
      count: 6,
      nearest: { typeLabel: "Osiguranje", target: "BUL-01", expiresAt: "2026-12-15" },
    },
  },
  summary: { activeProjects: 12, activeWorkers: 31, activeMachines: 19, entriesThisWeek: 6 },
  sync: [
    { userId: "u1", name: "Amar Hadžić", lastSyncAt: "2026-11-13T06:30:00.000Z", failedItems: 2 },
    { userId: "u2", name: "Mario Perić", lastSyncAt: "2026-11-12T12:30:00.000Z", failedItems: 0 },
  ],
  scope: "company",
};

describe("PregledBoard — redovi pažnje", () => {
  it("prikazuje redove po hitnosti (isteklo prije sukoba, blokada prije plana) sa brojevima", () => {
    render(<PregledBoard data={base} firstName="Emir" greeting="Dobro jutro" />);

    const rows = screen.getAllByRole("link").map((link) => link.textContent ?? "");
    const expiredAt = rows.findIndex((text) => text.includes("Istekli rokovi"));
    const conflictsAt = rows.findIndex((text) => text.includes("Nerazriješeni sukobi"));
    const soonAt = rows.findIndex((text) => text.includes("Rokovi koji ističu u 30 dana"));
    const daysAt = rows.findIndex((text) => text.includes("Dani za provjeru"));
    const blockedAt = rows.findIndex((text) => text.includes("blokiraju dodjelu"));
    const planAt = rows.findIndex((text) => text.includes("Rokovi 31–90 dana"));
    expect([expiredAt, conflictsAt, soonAt, daysAt, blockedAt, planAt]).toEqual([0, 1, 2, 3, 4, 5]);

    expect(screen.getByText("4", { selector: ".gx-attention-count" }).textContent).toBe("4");
  });

  it("svaki red vodi na ekran rješavanja (filter živi u adresi)", () => {
    render(<PregledBoard data={base} firstName="Emir" greeting="Dobro jutro" />);
    const byHref = (href: string) =>
      screen.getAllByRole("link").find((link) => link.getAttribute("href") === href);
    expect(byHref("/ured/rokovi?stanje=isteklo")).toBeTruthy();
    expect(byHref("/ured/sukobi?stanje=OPEN")).toBeTruthy();
    expect(byHref("/ured/rokovi?stanje=uskoro")).toBeTruthy();
    expect(byHref("/ured/radni-dani?filter=za-provjeru")).toBeTruthy();
    expect(byHref("/ured/projekti")).toBeTruthy();
    expect(byHref("/ured/rokovi?stanje=31-90")).toBeTruthy();
  });

  it("značka „stariji od praga“ stoji samo uz sukobe i samo kad ih ima", () => {
    render(<PregledBoard data={base} firstName="Emir" greeting="Dobro jutro" />);
    expect(screen.getByText("2 starija od praga firme (3 dana)")).toBeTruthy();
  });

  it("podnaslov broji hitne stvari; 31–90 dana je plan, ne uzbuna", () => {
    render(<PregledBoard data={base} firstName="Emir" greeting="Dobro jutro" />);
    // 4 istekla + 6 sukoba + 5 uskoro + 2 dana + 1 blokada = 18 (31–90 se ne broji).
    expect(screen.getByText("Petak, 13. novembar · 18 stvari traži vašu pažnju.")).toBeTruthy();
  });

  it("redovi s nulom NE postoje — prazna kartica ne laže da „nema“", () => {
    const quiet: PregledResponse = {
      ...base,
      attention: {
        ...base.attention,
        expired: { count: 0, oldest: [] },
        conflicts: { ...base.attention.conflicts, count: 0, olderThanThreshold: 0, oldest: [] },
        reviewDays: { count: 0, oldest: [] },
        blockedAssignments: { count: 0, examples: [] },
      },
    };
    render(<PregledBoard data={quiet} firstName="Emir" greeting="Dobro veče" />);
    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(hrefs).not.toContain("/ured/rokovi?stanje=isteklo");
    expect(hrefs).not.toContain("/ured/radni-dani?filter=za-provjeru");
    expect(hrefs).not.toContain("/ured/sukobi?stanje=OPEN");
    // Ostaju uskoro i plan — to nisu uzbune, ali su istina.
    expect(screen.getByText(/Rokovi koji ističu u 30 dana/)).toBeTruthy();
    expect(screen.queryByText(/Ništa ne traži pažnju/)).toBeNull();
  });

  it("prazno stanje: dobra vijest bez crvenog, s izlazom na rokove", () => {
    const empty: PregledResponse = {
      ...base,
      attention: {
        expired: { count: 0, oldest: [] },
        conflicts: { count: 0, olderThanThreshold: 0, thresholdDays: 3, oldest: [] },
        expiring30: { count: 0, nearest: null },
        reviewDays: { count: 0, oldest: [] },
        blockedAssignments: { count: 0, examples: [] },
        expiring3190: { count: 0, nearest: null },
      },
    };
    render(<PregledBoard data={empty} firstName={null} greeting="Dobar dan" />);
    expect(screen.getByText("Ništa ne traži pažnju")).toBeTruthy();
    expect(screen.getByText("Petak, 13. novembar · Ništa ne traži pažnju.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Svejedno pogledaj rokove" })).toHaveAttribute("href", "/ured/rokovi");
  });

  it("sažetak nosi četiri broja iz opsega", () => {
    render(<PregledBoard data={base} firstName="Emir" greeting="Dobro jutro" />);
    expect(screen.getByText("aktivni projekti")).toBeTruthy();
    expect(screen.getByText("aktivni radnici")).toBeTruthy();
    expect(screen.getByText("mašine")).toBeTruthy();
    expect(screen.getByText("unosi rada ovaj tjedan")).toBeTruthy();
  });

  it("sinhronizacija: renderuje se za OWNER/ADMIN (podaci) i NE renderuje za PM (null)", () => {
    const { unmount } = render(<PregledBoard data={base} firstName="Emir" greeting="Dobro jutro" />);
    expect(screen.getByText("Stanje sinhronizacije")).toBeTruthy();
    expect(screen.getByText(/2 neuspješne stavke/)).toBeTruthy();
    expect(screen.getByText("sve prošlo")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Audit trag" })).toHaveAttribute("href", "/ured/audit");

    unmount();
    const pmView: PregledResponse = { ...base, sync: null, scope: "projects" };
    render(<PregledBoard data={pmView} firstName="Kenan" greeting="Dobro jutro" />);
    expect(screen.queryByText("Stanje sinhronizacije")).toBeNull();
    expect(screen.getByText("samo vaš opseg")).toBeTruthy();
  });

  it("nema serious/critical a11y nalaza (axe, WCAG 2.1 AA)", async () => {
    const { container } = render(<PregledBoard data={base} firstName="Emir" greeting="Dobro jutro" />);
    await expectNoSeriousA11yViolations(container);
  });

  it("nema serious/critical a11y nalaza ni u praznom stanju", async () => {
    const empty: PregledResponse = {
      ...base,
      attention: {
        expired: { count: 0, oldest: [] },
        conflicts: { count: 0, olderThanThreshold: 0, thresholdDays: 3, oldest: [] },
        expiring30: { count: 0, nearest: null },
        reviewDays: { count: 0, oldest: [] },
        blockedAssignments: { count: 0, examples: [] },
        expiring3190: { count: 0, nearest: null },
      },
      sync: [],
    };
    const { container } = render(<PregledBoard data={empty} firstName="Emir" greeting="Dobro jutro" />);
    await expectNoSeriousA11yViolations(container);
  });
});
