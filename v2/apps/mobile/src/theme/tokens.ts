/**
 * Dizajn tokeni za mobilni — iste vrijednosti kao `apps/web/src/app/globals.css`.
 * Izvor odluke: docs/design/PALETA.md (vlasnik, 2026-11-08).
 *
 * React Native ne poznaje CSS varijable, pa su vrijednosti ovdje doslovno prepisane.
 * Da se dva fajla ne raziđu, `src/theme/tokens.test.ts` čita CSS i poredi svaki token.
 *
 * Pravila: `accent` je podloga i ivica, nikad tekst na svijetlom (1,55:1);
 * `borderStrong` je za ivice polja, ne za sitan tekst (3,76:1).
 */
export const colors = {
  brand: "#140a9a",
  brandHover: "#0d0770",
  brandSoft: "#e8e9fb",

  accent: "#ffc82f",
  accentSoft: "#fdf3d6",

  surface: "#ffffff",
  surfaceMuted: "#f5f6f7",
  surfaceInverse: "#1b232a",

  text: "#1b232a",
  textMuted: "#59656f",
  textInverse: "#ffffff",

  border: "#d7dbdf",
  borderStrong: "#7b858d",

  danger: "#c1121f",
  dangerSoft: "#fdecec",
  success: "#186b3e",
  successSoft: "#e8f5ec",
  warningText: "#8a5e06",
  warningSoft: "#fdf3d6",

  focus: "#140a9a",
  focusInverse: "#ffc82f",
} as const;

/** Ime tokena u CSS-u: `brandSoft` → `--color-brand-soft`. */
export function cssVariableName(token: keyof typeof colors): string {
  return `--color-${token.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

/**
 * Terenski minimum: rukavice i sunce. Isti pragovi kao web, ali krupnije —
 * dodirna površina 48px, tijelo teksta 17px (na telefonu se ne zumira).
 */
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { input: 10, card: 12, pill: 999 } as const;
export const typography = {
  title: { fontSize: 26, fontWeight: "700" },
  heading: { fontSize: 20, fontWeight: "700" },
  body: { fontSize: 17, fontWeight: "400" },
  label: { fontSize: 15, fontWeight: "600" },
  button: { fontSize: 18, fontWeight: "700" },
} as const;
/** Minimalna dodirna površina — WCAG 2.2 (2.5.8) traži 24px, teren traži 48px. */
export const touchTarget = 48;
