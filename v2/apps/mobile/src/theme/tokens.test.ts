/**
 * Dva izvora tokena (web CSS i mobilni TS) ne smiju se razići — i obje teme moraju proći AA.
 *
 * Test čita STVARNI `globals.css`, razriješi `color-mix` isto kao preglednik i poredi sa
 * `apps/mobile/src/theme/tokens.ts`. Time hvata i slučaj kad neko promijeni nijansu samo na webu.
 *
 * Kontrast se mjeri za parove koji se STVARNO koriste, u obje teme:
 *  - tekst i tihi tekst na svakoj podlozi (ploča, podignuto, pozadina),
 *  - fokus (isti token kao link) na pozadini i na ploči,
 *  - tekst na primarnoj akciji (u tamnoj je to akcent — najveći rizik),
 *  - ivica polja na ploči (WCAG 1.4.11 traži 3:1 za granicu kontrole).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { darkTheme, lightTheme, palette, themes, touchTarget, type ThemeTokens } from "./tokens";
import { contrast, deltaE, resolveTheme } from "@gradix/design/css-tokens";

// Putanja od `apps/mobile/src/theme` do `apps/web/src/app/globals.css` — jedan nivo više
// nego što izgleda, jer `here` je već `…/src/theme`.
const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../../web/src/app/globals.css"),
  "utf8",
);

/** Mapiranje `--semantic-name` → polje u `ThemeTokens`. */
const TOKEN_NAMES: Record<keyof ThemeTokens, string> = {
  bg: "bg",
  panel: "panel",
  raise: "raise",
  sunken: "sunken",
  text: "text",
  muted: "muted",
  line: "line",
  field: "field",
  primary: "primary",
  onPrimary: "on-primary",
  link: "link",
  bar: "bar",
  accent: "accent",
  onAccent: "on-accent",
  tint: "tint",
  danger: "danger",
  dangerSoft: "danger-soft",
  warnSoft: "warn-soft",
};

describe("tokeni: web i mobilni", () => {
  it("paleta je šest boja + crvena i ista na oba mjesta", () => {
    for (const [name, value] of Object.entries(palette)) {
      const cssValue = resolveTheme(css, "light")[`palette-${name}`];
      expect(cssValue, `paleta ${name}`).toBe(value);
    }
    // Sedam: šest iz DESIGN.md + izričita crvena za grešku (vlasnikova odluka 2026-11-08).
    expect(Object.keys(palette)).toHaveLength(7);
  });

  it.each(["light", "dark"] as const)("%s tema se ne raziđe između web i mobilnog", (theme) => {
    const web = resolveTheme(css, theme);
    const mobile = themes[theme];
    for (const [key, cssName] of Object.entries(TOKEN_NAMES) as [keyof ThemeTokens, string][]) {
      expect(mobile[key].toLowerCase(), `${theme}: --${cssName}`).toBe(web[cssName]);
    }
  });

  it("paleta (šest + crvena, i svjetlija crvena za tamnu temu) je SVE što postoji kao hex", () => {
    // `#fff`/`#000` u CSS-u nisu dopušteni; sve nijanse su color-mix nad paletom.
    // Crvena u tamnoj temi je svjetlija (AA), pa je i ta vrijednost dio ugovora.
    const fromCss = new Set((css.match(/#[0-9a-f]{6}\b/gi) ?? []).map((value) => value.toLowerCase()));
    const allowed = new Set([...Object.values(palette), darkTheme.danger.toLowerCase()]);
    for (const value of fromCss) expect(allowed.has(value as never), `neočekivan hex ${value}`).toBe(true);
  });
});

describe("AA kontrast u obje teme", () => {
  /** Parovi koji se stvarno koriste; `min` je prag (4,5 tekst, 3 za veliki tekst i granice). */
  function pairs(t: ThemeTokens): [string, string, string, number][] {
    return [
      ["tekst na ploči", t.text, t.panel, 4.5],
      ["tekst na pozadini", t.text, t.bg, 4.5],
      ["tekst na podignutom", t.text, t.raise, 4.5],
      ["tihi tekst na ploči", t.muted, t.panel, 4.5],
      ["tihi tekst na pozadini", t.muted, t.bg, 4.5],
      ["tihi tekst na podignutom", t.muted, t.raise, 4.5],
      ["link na ploči", t.link, t.panel, 4.5],
      ["link na pozadini", t.link, t.bg, 4.5],
      ["link na obojenoj podlozi", t.link, t.tint, 4.5],
      ["fokus na ploči", t.link, t.panel, 3],
      ["fokus na pozadini", t.link, t.bg, 3],
      ["tekst na primarnoj akciji", t.onPrimary, t.primary, 4.5],
      ["ivica polja na ploči", t.field, t.panel, 3],
      ["ivica polja na pozadini", t.field, t.bg, 3],
      ["poruka greške na svojoj podlozi", t.danger, t.dangerSoft, 4.5],
      // Uspjeh nema svoju boju — ista ploha kao informacija, ikona nosi razliku.
      ["tekst na plohi uspjeha", t.text, t.tint, 4.5],
      ["tekst na žutoj podlozi", t.text, t.warnSoft, 4.5],
      // Crvena je izričit token (vlasnikova odluka 2026-11-08), pa se mjeri kao i sve ostalo.
      ["crvena na svojoj podlozi", t.danger, t.dangerSoft, 4.5],
      ["crvena na ploči", t.danger, t.panel, 4.5],
    ];
  }

  it("svijetla tema", () => {
    for (const [name, foreground, background, min] of pairs(lightTheme)) {
      expect(contrast(foreground, background), `${name}: ${foreground} na ${background}`).toBeGreaterThanOrEqual(min);
    }
  });

  it("tamna tema", () => {
    for (const [name, foreground, background, min] of pairs(darkTheme)) {
      expect(contrast(foreground, background), `${name}: ${foreground} na ${background}`).toBeGreaterThanOrEqual(min);
    }
  });

  it("podloge stanja se razlikuju jedna od druge (ΔE ≥ 5) u obje teme", () => {
    // AA kontrast ne hvata dvije podloge koje izgledaju isto — to hvata ΔE. Prije ove
    // provjere greška i informacija su u svijetloj temi bile ΔE 2,3 (nerazlučivo).
    for (const theme of [lightTheme, darkTheme]) {
      const podloge = [theme.tint, theme.dangerSoft, theme.warnSoft];
      for (let i = 0; i < podloge.length; i += 1) {
        for (let j = i + 1; j < podloge.length; j += 1) {
          expect(deltaE(podloge[i]!, podloge[j]!), `${podloge[i]} vs ${podloge[j]}`).toBeGreaterThanOrEqual(5);
        }
        // Ploha samo mora biti vidljiva kao zasebna (3); razlika između stanja je 5.
        expect(deltaE(podloge[i]!, theme.panel), `${podloge[i]} vs ploča`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("primarna akcija se razlikuje po temi: brend na svijetlom, akcent na tamnom", () => {
    expect(lightTheme.primary).toBe(palette.brand);
    expect(lightTheme.onPrimary).toBe(palette.surface);
    expect(darkTheme.primary).toBe(palette.accent);
    expect(darkTheme.onPrimary).toBe(palette.ink);
  });

  it("akcent nikad nije tekst na svijetloj ploči (prirodno ne prolazi, zato je zabranjen)", () => {
    // Ovo nije želja nego činjenica na koju se pravilo oslanja: 1,55:1.
    expect(contrast(palette.accent, palette.surface)).toBeLessThan(3);
  });

  it("brend na tamnoj pozadini ne prolazi — zato se u tamnoj koristi osvijetljeni `link`", () => {
    expect(contrast(palette.brand, palette.ink)).toBeLessThan(3);
    expect(contrast(darkTheme.link, darkTheme.bg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("oblik i gustina", () => {
  it("terenska meta je najmanje 56 dp (DESIGN.md)", () => {
    expect(touchTarget).toBeGreaterThanOrEqual(56);
  });

  it("radijusi iz reference postoje u CSS-u", () => {
    expect(css).toMatch(/--radius-panel:\s*18px/);
    expect(css).toMatch(/--radius-card:\s*16px/);
    expect(css).toMatch(/--radius-field:\s*12px/);
    expect(css).toMatch(/--radius-pill:\s*999px/);
  });
});
