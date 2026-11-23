import { describe, expect, it } from "vitest";
import { darkTheme, lightTheme, type ThemeTokens } from "./tokens";

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** Telefon 2026-11-07: placeholder je bio Android default siva, nečitljiva na tamnoj temi. */
describe("kontrast teksta i placeholdera (muted na panelu)", () => {
  it.each([
    ["svijetla", lightTheme],
    ["tamna", darkTheme],
  ] as [string, ThemeTokens][])("%s tema: muted/panel i text/panel prolaze WCAG AA (4.5)", (_name, theme) => {
    expect(ratio(theme.muted, theme.panel)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(theme.text, theme.panel)).toBeGreaterThanOrEqual(4.5);
  });
});
