/**
 * Dizajn pravila iz `docs/design/DESIGN.md` — kao test, ne kao dogovor.
 *
 * Šta se ovdje čuva:
 *  - paleta je šest boja; sve ostalo je `color-mix` (nema nove boje),
 *  - oblik je iz reference (ploča 18, kartica 16, polje 12, dugme/chip pilula),
 *  - nijedna komponenta ne sadrži hex — boje idu kroz semantičke tokene,
 *  - obje teme postoje i imaju ista imena tokena,
 *  - tipografija: Manrope kroz `next/font`, mono sa tabularnim ciframa,
 *  - tema se mijenja atributom `data-theme`, ne klasom po komponenti.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveTheme } from "@gradix/design/css-tokens";

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(join(here, "..", path), "utf8");

/** Komentari citiraju zabranjene vrijednosti („nijedan hex“), zato se prije provjere brišu. */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const globals = stripComments(read("app/globals.css"));
const shell = stripComments(read("app/shell.css"));
const ui = stripComments(read("components/ui.tsx"));
const shellTsx = stripComments(read("components/shell.tsx"));

const PALETTE = ["#140a9a", "#ffc82f", "#1b232a", "#ffffff", "#59656f", "#7b858d"];

describe("paleta i teme", () => {
  it("u globals.css postoji samo šest boja palete kao hex", () => {
    const found = new Set((globals.match(/#[0-9a-f]{6}\b/gi) ?? []).map((value) => value.toLowerCase()));
    for (const value of found) expect(PALETTE, `neočekivan hex ${value}`).toContain(value);
  });

  it("sve ostale nijanse nastaju color-mix-om", () => {
    // Broj `color-mix` poziva mora biti veći od broja semantičkih tokena: svaka nijansa koja
    // nije direktna paleta mora biti izmiješana, ne upisana.
    expect((globals.match(/color-mix\(/g) ?? []).length).toBeGreaterThanOrEqual(20);
  });

  it("obje teme postoje i imaju iste semantičke tokene", () => {
    // `shadow`/`shadow-lift` su izuzetak: u tamnoj temi su `none` (nema sjena), pa ih
    // razrješivač preskoči. Sve boje moraju postojati u obje teme.
    const colorsOnly = (keys: string[]) => keys.filter((key) => !key.startsWith("shadow")).sort();
    const light = colorsOnly(Object.keys(resolveTheme(globals, "light")));
    const dark = colorsOnly(Object.keys(resolveTheme(globals, "dark")));
    expect(light).toEqual(dark);
    // Semantički tokeni iz DESIGN.md moraju biti tu.
    for (const token of ["panel", "raise", "line", "primary", "link", "text", "muted", "tint", "bar"]) {
      expect(light).toContain(token);
    }
  });

  it("tema je atribut, ne klasa po komponenti", () => {
    expect(globals).toMatch(/\[data-theme="light"\]/);
    expect(globals).toMatch(/\[data-theme="dark"\]/);
    // Nijedna komponenta ne postavlja `data-theme` — to radi layout i prekidač.
    expect(ui).not.toMatch(/data-theme/);
  });
});

describe("oblik (DESIGN.md „Oblik“)", () => {
  it("radijusi su iz reference", () => {
    expect(globals).toMatch(/--radius-panel:\s*18px/);
    expect(globals).toMatch(/--radius-card:\s*16px/);
    expect(globals).toMatch(/--radius-field:\s*12px/);
    expect(globals).toMatch(/--radius-tile:\s*20px/);
    expect(globals).toMatch(/--radius-pill:\s*999px/);
  });

  it("nema oštrih radijusa iz odbačenog R1c okvira", () => {
    for (const source of [globals, shell, ui, shellTsx]) {
      // 2–4 px radijus je bio R1c. Izuzetak su tanke trake (akcentna linija u znaku firme
      // je 2 px visoka, pa joj radijus ne mijenja oblik). Fokus je `outline`, ne oblik.
      expect(source).not.toMatch(/--radius[\w-]*:\s*[234]px/);
      expect(source).not.toMatch(/border-radius:\s*[34]px/);
    }
    // Ploče i kartice su velike zaobljene površine, nikad oštre.
    expect(globals).toMatch(/--radius-panel:\s*18px/);
    expect(globals).toMatch(/--radius-card:\s*16px/);
  });

  it("sjene postoje samo u svijetloj temi", () => {
    const lightBlock = globals.slice(globals.indexOf('[data-theme="light"]'), globals.indexOf('[data-theme="dark"]'));
    const darkBlock = globals.slice(globals.indexOf('[data-theme="dark"]'));
    expect(lightBlock).toMatch(/--shadow:/);
    expect(lightBlock).not.toMatch(/--shadow:\s*none/);
    expect(darkBlock).toMatch(/--shadow:\s*none/);
  });
});

describe("komponente", () => {
  it("nijedna komponenta ne hardkodira boju", () => {
    for (const source of [ui, shellTsx, shell]) {
      expect(source).not.toMatch(/#[0-9a-f]{6}\b/i);
    }
  });

  it("dugme i chip su pilule, polje ima 12 px", () => {
    // Klase su u `shell.css` (jedno mjesto za pravilo), a primitive ih koriste.
    expect(shell).toMatch(/\.gx-btn\s*\{[^}]*border-radius:\s*var\(--radius-pill\)/);
    expect(shell).toMatch(/\.gx-chip\s*\{[^}]*border-radius:\s*var\(--radius-pill\)/);
    expect(shell).toMatch(/\.gx-input\s*\{[^}]*border-radius:\s*var\(--radius-field\)/);
    expect(ui).toMatch(/gx-btn--/);
    expect(ui).toMatch(/gx-input|inputClass/);
  });

  it("fokus je `--link`, 2 px, vidljiv", () => {
    expect(globals).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--link\)/);
  });

  it("prelaz traje 120 ms i poštuje `prefers-reduced-motion`", () => {
    expect(globals).toMatch(/120ms/);
    expect(globals).toMatch(/prefers-reduced-motion/);
  });
});

describe("tipografija", () => {
  it("Manrope i IBM Plex Mono dolaze kroz next/font", () => {
    const layout = stripComments(read("app/layout.tsx"));
    expect(layout).toMatch(/next\/font/);
    expect(layout.toLowerCase()).toMatch(/manrope/);
    expect(layout.toLowerCase()).toMatch(/plex.?mono/);
    // Bez mrežnog preuzimanja: `next/font/local` čita woff2 iz repoa.
    expect(layout).toMatch(/localFont/);
  });

  it("mono ima tabularne cifre, a sans je Manrope", () => {
    expect(globals).toMatch(/\.gx-mono\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
    expect(globals).toMatch(/--font-sans:\s*var\(--font-manrope\)/);
    expect(globals).toMatch(/--font-mono:\s*var\(--font-plex-mono\)/);
  });

  it("nema VELIKIH SLOVA u interfejsu (sentence case)", () => {
    expect(ui).not.toMatch(/uppercase/);
    expect(shellTsx).not.toMatch(/uppercase/);
    expect(shell).not.toMatch(/text-transform:\s*uppercase/);
  });
});

describe("gustina i okvir", () => {
  it("okvir je iz reference: sidebar 232 px, ploča sa gornjom trakom", () => {
    expect(globals).toMatch(/--sidebar-w:\s*232px/);
    expect(globals).toMatch(/--topbar-h:/);
    expect(shell).toMatch(/\.gx-shell/);
    expect(shell).toMatch(/\.gx-main\s*\{[^}]*border-radius:\s*var\(--radius-panel\)/);
  });
});
