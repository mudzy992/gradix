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

/**
 * CIEDE2000 — razlika dvije boje onako kako je vidi oko, ne po kanalima.
 *
 * Zašto u dizajn paketu: AA kontrast mjeri samo „je li tekst čitljiv na podlozi“. Ne kaže da su
 * dvije obojene podloge (informacija / greška / upozorenje) različite — dvije skoro iste nijanse
 * prolaze AA svaka za sebe, a čovjek ne vidi razliku. Prag koji se koristi u testu je 2
 * (ispod toga se boje ne razlikuju ni posmatrane jedna uz drugu), a za podloge stanja tražimo 5.
 *
 * Formula: Sharma, Wu, Dalal (2005), „The CIEDE2000 color-difference formula“.
 */
export function deltaE(a: string, b: string): number {
  const toLab = (hex: string) => {
    const value = hex.replace("#", "");
    const [r, g, b] = [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16) / 255) as [
      number,
      number,
      number,
    ];
    const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const [lr, lg, lb] = [linear(r), linear(g), linear(b)];
    const x = (lr * 0.4124 + lg * 0.3576 + lb * 0.1805) / 0.95047;
    const y = lr * 0.2126 + lg * 0.7152 + lb * 0.0722;
    const z = (lr * 0.0193 + lg * 0.1192 + lb * 0.9505) / 1.08883;
    const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))] as [number, number, number];
  };

  const [l1, a1, b1] = toLab(a);
  const [l2, a2, b2] = toLab(b);
  const rad = Math.PI / 180;
  const c1 = Math.hypot(a1, b1);
  const c2 = Math.hypot(a2, b2);
  const cBar = (c1 + c2) / 2;
  const g = 0.5 * (1 - Math.sqrt(cBar ** 7 / (cBar ** 7 + 25 ** 7)));
  const a1p = a1 * (1 + g);
  const a2p = a2 * (1 + g);
  const c1p = Math.hypot(a1p, b1);
  const c2p = Math.hypot(a2p, b2);
  const h1p = (Math.atan2(b1, a1p) / rad + 360) % 360;
  const h2p = (Math.atan2(b2, a2p) / rad + 360) % 360;

  const dLp = l2 - l1;
  const dCp = c2p - c1p;
  let dhp = 0;
  if (c1p * c2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(c1p * c2p) * Math.sin((dhp * rad) / 2);

  const lBar = (l1 + l2) / 2;
  const cBarP = (c1p + c2p) / 2;
  let hBar = h1p + h2p;
  if (c1p * c2p !== 0) hBar = Math.abs(h1p - h2p) > 180 ? (h1p + h2p + 360) / 2 : (h1p + h2p) / 2;

  const t =
    1 -
    0.17 * Math.cos((hBar - 30) * rad) +
    0.24 * Math.cos(2 * hBar * rad) +
    0.32 * Math.cos((3 * hBar + 6) * rad) -
    0.2 * Math.cos((4 * hBar - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hBar - 275) / 25) ** 2));
  const rc = 2 * Math.sqrt(cBarP ** 7 / (cBarP ** 7 + 25 ** 7));
  const sl = 1 + (0.015 * (lBar - 50) ** 2) / Math.sqrt(20 + (lBar - 50) ** 2);
  const sc = 1 + 0.045 * cBarP;
  const sh = 1 + 0.015 * cBarP * t;
  const rt = -Math.sin(2 * dTheta * rad) * rc;

  return Math.sqrt(
    (dLp / sl) ** 2 + (dCp / sc) ** 2 + (dHp / sh) ** 2 + rt * (dCp / sc) * (dHp / sh),
  );
}
