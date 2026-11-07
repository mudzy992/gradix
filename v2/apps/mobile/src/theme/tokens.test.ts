/**
 * Dva izvora tokena (web CSS i mobilni TS) ne smiju se razići.
 *
 * Test čita stvarni `globals.css`, pa hvata i slučaj kad neko promijeni boju samo na webu.
 * Uz to mjeri kontrast parova koji se stvarno koriste — jeftino, a sprječava da
 * pristupačnost padne potiho.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { colors, cssVariableName, touchTarget } from "./tokens";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "../../../web/src/app/globals.css"), "utf8");

/** Relativna luminancija po WCAG 2.2. */
function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

describe("dizajn tokeni", () => {
  it("web CSS i mobilni TS imaju iste vrijednosti", () => {
    for (const token of Object.keys(colors) as (keyof typeof colors)[]) {
      const name = cssVariableName(token);
      const match = css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
      expect(match, `token ${name} ne postoji u globals.css`).not.toBeNull();
      expect(colors[token].toLowerCase(), `token ${name} se razilazi`).toBe(match![1]!.toLowerCase());
    }
  });

  it("svaki tekst prolazi AA (4.5:1), a veliki tekst i ivice AA (3:1)", () => {
    const textPairs: [string, string][] = [
      [colors.text, colors.surface],
      [colors.text, colors.surfaceMuted],
      [colors.text, colors.accentSoft],
      [colors.text, colors.brandSoft],
      [colors.text, colors.dangerSoft],
      [colors.text, colors.successSoft],
      [colors.textMuted, colors.surface],
      [colors.textMuted, colors.surfaceMuted],
      [colors.textMuted, colors.brandSoft],
      [colors.textInverse, colors.brand],
      [colors.textInverse, colors.brandHover],
      [colors.textInverse, colors.surfaceInverse],
      [colors.textInverse, colors.danger],
      [colors.textInverse, colors.success],
      [colors.brand, colors.surface],
      [colors.danger, colors.surface],
      [colors.warningText, colors.surface],
    ];
    for (const [foreground, background] of textPairs) {
      expect(contrast(foreground, background), `${foreground} na ${background}`).toBeGreaterThanOrEqual(4.5);
    }

    const largeOrUiPairs: [string, string][] = [
      [colors.borderStrong, colors.surface],
      [colors.focus, colors.surface],
      [colors.focusInverse, colors.surfaceInverse],
      [colors.accent, colors.surfaceInverse],
    ];
    for (const [foreground, background] of largeOrUiPairs) {
      expect(contrast(foreground, background), `${foreground} na ${background}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("akcent nije upotrebljiv kao tekst na svijetlom (zato je zabranjen)", () => {
    // Ovo nije željeno ponašanje nego činjenica na koju se oslanja pravilo u PALETA.md.
    expect(contrast(colors.accent, colors.surface)).toBeLessThan(2);
  });

  it("dodirna površina je najmanje 44px (WCAG 2.2 traži 24, teren traži više)", () => {
    expect(touchTarget).toBeGreaterThanOrEqual(44);
  });
});
