/**
 * Razrješava `color-mix` iz `globals.css` u konkretne hex vrijednosti.
 *
 * Zašto: web koristi `color-mix` (preglednik ga razumije, nijanse se računaju iz palete), a
 * React Native ne poznaje CSS varijable ni `color-mix`. Da mobilni ne bi imao „svoje“ boje,
 * test razriješi CSS istim pravilom kao preglednik i poredi sa `apps/mobile/src/theme/tokens.ts`.
 *
 * Ovo je testna pomoć, ne runtime kod: ništa se odavde ne ugrađuje u bundle.
 */

export type Palette = Record<string, string>;

/** sRGB miješanje po kanalima — isto što `color-mix(in srgb, ...)` radi u pregledniku. */
export function mix(a: string, weightPercent: number, b: string): string {
  const parse = (hex: string) => {
    const value = hex.replace("#", "");
    if (value.length !== 6) throw new Error(`očekujem #rrggbb, dobio ${hex}`);
    return [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16));
  };
  const [ra, ga, ba] = parse(a);
  const [rb, gb, bb] = parse(b);
  const w = weightPercent / 100;
  const channel = (x: number, y: number) => Math.round(x * w + y * (1 - w));
  return `#${[channel(ra!, rb!), channel(ga!, gb!), channel(ba!, bb!)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`.toLowerCase();
}

const MIX = /^color-mix\(\s*in\s+srgb\s*,\s*(var\(--[\w-]+\)|#[0-9a-f]{6})\s+([\d.]+)%\s*,\s*(var\(--[\w-]+\)|#[0-9a-f]{6})\s*\)$/i;

/**
 * Vadi tijelo bloka koji počinje selektorom. Broji zagrade — `@theme` blokovi imaju
 * komentare i više linija, a `indexOf("}")` bi stao na prvom `}` u tekstu.
 */
function block(css: string, selector: string): string {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`nema selektora ${selector}`);
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, index);
    }
  }
  throw new Error(`blok ${selector} nije zatvoren`);
}

function declarations(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  // Komentari se sklanjaju PRIJE sječenja po `;`: komentar sa dvotačkom („paleta: šest
  // boja“) inače pojede prvu deklaraciju koja iza njega slijedi.
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const line of clean.split(";")) {
    const index = line.indexOf(":");
    if (index < 0) continue;
    const name = line.slice(0, index).trim();
    if (!name.startsWith("--")) continue;
    out[name] = line.slice(index + 1).trim();
  }
  return out;
}

export type Theme = "light" | "dark";

/**
 * Vraća razriješene vrijednosti za tražena imena tokena.
 * Redoslijed razrješavanja: `var(--x)` se prati rekurzivno, `color-mix` se računa.
 */
export function resolveTheme(css: string, theme: Theme): Record<string, string> {
  const palette = declarations(block(css, "@theme"));
  const themeBlock =
    theme === "light" ? block(css, '[data-theme="light"]') : block(css, '[data-theme="dark"]');
  const all = { ...palette, ...declarations(themeBlock) };

  const resolve = (value: string, depth = 0): string => {
    if (depth > 10) throw new Error(`ciklična referenca: ${value}`);
    const trimmed = value.trim();
    const single = trimmed.match(/^var\((--[\w-]+)\)$/);
    if (single) {
      const next = all[single[1]!];
      if (!next) throw new Error(`nepoznat token ${single[1]}`);
      return resolve(next, depth + 1);
    }
    if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toLowerCase();
    // `color-mix(..., transparent)` nije obična mješavina: prozirna strana se računa kao
    // crna (0,0,0) sa alfa 0, pa je rezultat boja pomiješana sa crnom. Sjene su jedini
    // tokeni koji ovo koriste; u tamnoj temi su `none`.
    if (/transparent/i.test(trimmed)) return "#000000";
    const mixed = trimmed.match(MIX);
    if (mixed) {
      const first = resolve(mixed[1]!, depth + 1);
      const second = resolve(mixed[3]!, depth + 1);
      return mix(first, Number(mixed[2]), second);
    }
    throw new Error(`ne znam razriješiti: ${value}`);
  };

  const out: Record<string, string> = {};
  for (const name of Object.keys(all)) {
    // `--font-*` nije boja.
    if (name.startsWith("--font")) continue;
    try {
      out[name.replace(/^--/, "")] = resolve(all[name]!);
    } catch {
      // Tokeni koji nisu boje (radijus, razmaci, skala) se preskaču — test boja ih ne traži.
    }
  }
  return out;
}

/** Relativna luminancija (WCAG 2.2). */
export function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}
