/**
 * Dizajn tokeni za mobilni — ISTE vrijednosti kao `apps/web/src/app/globals.css`.
 * Izvor istine: `docs/design/DESIGN.md` + `reference.html`.
 *
 * React Native ne poznaje CSS varijable ni `color-mix`, pa su vrijednosti razriješene u
 * konkretne hex brojeve. Da se web i mobilni ne raziđu, `tokens.test.ts` razriješi CSS istim
 * pravilom kao preglednik (`color-mix` po kanalima) i poredi svaki token.
 *
 * Tema je ista kao na webu: prati sistem, može se ručno promijeniti. Boje se NIKAD ne uzimaju
 * iz ovog fajla direktno po imenu brenda — uzimaju se iz `useTheme()` koji vraća semantičke
 * tokene (`text`, `panel`, `muted`, `line`, `primary`…), isto kao `var(--text)` na webu.
 */

/**
 * Šest boja palete + jedna izričita crvena (vlasnikova odluka 2026-11-08) — jedine dopuštene
 * „sirove“ boje (DESIGN.md „Paleta“). Sve ostale nijanse nastaju mješanjem. Crvena postoji
 * samo za grešku; uspjeh je `tint` (brend), da se ne uvodi zelena.
 */
export const palette = {
  brand: "#140a9a",
  accent: "#ffc82f",
  ink: "#1b232a",
  surface: "#ffffff",
  slate: "#59656f",
  edge: "#7b858d",
  danger: "#b42318",
} as const;

/** Semantički tokeni — imena su ista kao CSS varijable bez `--`. */
export type ThemeTokens = {
  bg: string;
  panel: string;
  raise: string;
  sunken: string;
  text: string;
  muted: string;
  line: string;
  field: string;
  primary: string;
  onPrimary: string;
  link: string;
  bar: string;
  accent: string;
  onAccent: string;
  tint: string;
  danger: string;
  dangerSoft: string;
  warnSoft: string;
};

export const lightTheme: ThemeTokens = {
  bg: "#f4f4f4",
  panel: "#ffffff",
  raise: "#f6f6f6",
  sunken: "#eff0f0",
  text: "#1b232a",
  muted: "#59656f",
  line: "#dadddf",
  field: "#7b858d",
  primary: "#140a9a",
  onPrimary: "#ffffff",
  link: "#140a9a",
  bar: "#140a9a",
  accent: "#ffc82f",
  onAccent: "#1b232a",
  tint: "#eae9f6",
  danger: "#b42318",
  dangerSoft: "#f8ebea",
  warnSoft: "#fff3d1",
};

export const darkTheme: ThemeTokens = {
  bg: "#1b232a",
  panel: "#262e35",
  raise: "#30373d",
  sunken: "#222a30",
  text: "#ffffff",
  muted: "#adb0b2",
  line: "#394046",
  field: "#72777b",
  primary: "#ffc82f",
  onPrimary: "#1b232a",
  link: "#a19dd7",
  bar: "#a19dd7",
  accent: "#ffc82f",
  onAccent: "#1b232a",
  tint: "#32393f",
  danger: "#ff9b90",
  dangerSoft: "#44393c",
  warnSoft: "#524b2b",
};

export type ThemeName = "light" | "dark";

export const themes: Record<ThemeName, ThemeTokens> = { light: lightTheme, dark: darkTheme };

/** Ime tokena u CSS-u: `onPrimary` → `--on-primary`. Isto pravilo kao u `globals.css`. */
export function cssVariableName(token: keyof ThemeTokens): string {
  return `--${token.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

/**
 * Terenski minimum: rukavice i sunce. DESIGN.md traži mete ≥ 56 dp — krupnije od weba.
 * Mreža je 4 px (8/12/16/20/24/28), isto kao na webu.
 */
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 28 } as const;

/** Oblik iz reference: ploča 18, kartica 16, polje 12, tile 20, dugme/chip pilula. */
export const radius = { panel: 18, card: 16, field: 12, tile: 20, pill: 999 } as const;

/**
 * Manrope za interfejs, IBM Plex Mono za brojeve i vrijeme (DESIGN.md „Tipografija“).
 *
 * Imena su ista kao na webu (`--font-manrope`, `--font-plex-mono`) da jedan test može
 * provjeriti da se web i mobilni ne raziđu. Fajlovi su statičke instance varijabilnog
 * Manrope-a i Plex Mono-a iz `apps/web/src/fonts` (isti izvor, spojeni latin + latin-ext
 * jer React Native ne poznaje `unicode-range`), učitani u `_layout.tsx` preko `expo-font`.
 */
export const fontFamily = {
  sans: "Manrope_500Medium",
  sansSemiBold: "Manrope_600SemiBold",
  sansBold: "Manrope_700Bold",
  sansExtraBold: "Manrope_800ExtraBold",
  mono: "IBMPlexMono_500Medium",
} as const;

export const typography = {
  page: { fontFamily: fontFamily.sansExtraBold, fontSize: 28, fontWeight: "800" as const },
  section: { fontFamily: fontFamily.sansBold, fontSize: 18, fontWeight: "700" as const },
  body: { fontFamily: fontFamily.sans, fontSize: 16, fontWeight: "500" as const },
  label: { fontFamily: fontFamily.sansSemiBold, fontSize: 13, fontWeight: "600" as const },
  button: { fontFamily: fontFamily.sansBold, fontSize: 17, fontWeight: "700" as const },
  mono: { fontFamily: fontFamily.mono, fontSize: 15, fontWeight: "500" as const },
} as const;

/** Minimalna dodirna površina — DESIGN.md traži ≥ 56 dp za teren. */
export const touchTarget = 56;
