/**
 * Dizajn sistem v1 (R1c) — provjere koje se ne vide okom:
 *  - oblik: radijus 2 px (dijalog 4 px), nema sjena ni gradijenata, nema pilula,
 *  - gustina: web `gusto` 36 px red, terenski `udobno` 56 px,
 *  - tipografija: sans + mono postoje, cifre u tabelama su tabularne,
 *  - boje: `#FFC82F` nikad kao tekst, `#140A9A` samo akcija/aktivna stavka.
 *
 * Test čita STVARNE fajlove. Ako se pravilo prekrši u novoj komponenti, padne ovdje — ne
 * na demo snimku.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
/**
 * Komentari u fajlovima objašnjavaju pravilo i često citiraju zabranjenu vrijednost
 * („nigdje `rounded-full`“). Test gleda kod, ne dokumentaciju — zato komentari ispadaju.
 */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const read = (path: string) => stripComments(readFileSync(join(here, "..", path), "utf8"));

const globals = read("app/globals.css");
const shell = read("app/shell.css");
const density = read("components/density.css");
const ui = read("components/ui.tsx");
const shellTsx = read("components/shell.tsx");

const gusto = density.match(/\[data-density="gusto"\]\s*\{([^}]*)\}/)?.[1] ?? "";
const udobno = density.match(/\[data-density="udobno"\]\s*\{([^}]*)\}/)?.[1] ?? "";

describe("oblik (R1c)", () => {
  it("radijus je 2 px, dijalog 4 px — nigdje veći", () => {
    expect(globals).toMatch(/--radius:\s*2px/);
    expect(globals).toMatch(/--radius-dialog:\s*4px/);
    // Nema starog mekanog radijusa (0.75rem) ni pilula.
    for (const source of [globals, shell, density, ui, shellTsx]) {
      expect(source).not.toMatch(/0\.75rem/);
      expect(source).not.toMatch(/rounded-\[10px\]/);
      expect(source).not.toMatch(/rounded-full/);
    }
  });

  it("nema sjena ni gradijenata", () => {
    for (const source of [globals, shell, density, ui, shellTsx]) {
      expect(source).not.toMatch(/shadow-(sm|md|lg|xl|2xl)/);
      expect(source).not.toMatch(/box-shadow/);
      expect(source).not.toMatch(/linear-gradient|radial-gradient/);
    }
  });

  it("linije su 1 px (ivica polja je border-strong, razdjelnik border)", () => {
    expect(globals).toMatch(/--color-border:/);
    expect(globals).toMatch(/--color-border-strong:/);
    // Nijedno polje nije sa 2 px ivicom (staro `border-2`).
    expect(ui).not.toMatch(/border-2/);
    expect(globals).not.toMatch(/border-2/);
  });
});

describe("gustina", () => {
  it("web `gusto` ima red 36 px, terenski `udobno` 56 px", () => {
    expect(gusto).toMatch(/--row-height:\s*36px/);
    expect(udobno).toMatch(/--row-height:\s*56px/);
  });

  it("kontrola na terenu je 48 px (dodir), na webu 32 px", () => {
    expect(gusto).toMatch(/--control-height:\s*32px/);
    expect(udobno).toMatch(/--control-height:\s*48px/);
  });

  it("gustina se mijenja atributom, ne klasom po komponenti", () => {
    expect(density).toMatch(/\[data-density="udobno"\]/);
    // Nijedna komponenta ne postavlja `data-density` — to radi layout (jedno mjesto).
    expect(ui).not.toMatch(/data-density/);
  });
});

describe("tipografija", () => {
  it("postoje sans i mono tokeni, mono bez mrežnog preuzimanja", () => {
    expect(globals).toMatch(/--font-sans:/);
    expect(globals).toMatch(/--font-mono:\s*ui-monospace/);
  });

  it("cifre u tabelama su tabularne", () => {
    expect(globals).toMatch(/\.gx-tabular\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
    expect(density).toMatch(/\.gx-table\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
  });

  it("mono klasa koristi mono font", () => {
    expect(globals).toMatch(/\.gx-mono\s*\{[^}]*font-family:\s*var\(--font-mono\)/);
  });
});

describe("boje (R1c pravila upotrebe)", () => {
  it("akcenat nikad nije tekst — koristi se kao podloga", () => {
    for (const source of [ui, shellTsx, globals, shell, density]) {
      expect(source).not.toMatch(/text-\[var\(--color-accent\)\]/);
      expect(source).not.toMatch(/color:\s*var\(--color-accent\)/);
    }
  });

  it("primarna akcija i aktivna stavka koriste brend", () => {
    expect(ui).toMatch(/primary:[\s\S]*?bg-\[var\(--color-brand\)\]/);
    expect(shell).toMatch(/\[aria-current="page"\][\s\S]*?border-left-color:\s*var\(--color-brand\)/);
  });

  it("brend boja je štedljiva: nema nijednog bedža u brend tonu", () => {
    // Pravilo vlasnika: `#140A9A` = aktivna stavka + primarna akcija. Bedž role ili radnje
    // u brend tonu znači da je brend na 25 mjesta u tabeli — tada više ne označava ništa.
    const screens = [
      read("app/ured/korisnici/users-client.tsx"),
      read("app/ured/audit/audit-client.tsx"),
      read("app/ured/role/roles-client.tsx"),
    ];
    for (const screen of screens) {
      expect(screen).not.toMatch(/tone="brand"/);
    }
  });

  it("nijedna komponenta ne hardkodira boju", () => {
    for (const source of [ui, shellTsx]) {
      expect(source).not.toMatch(/#[0-9a-fA-F]{6}\b/);
    }
  });
});
