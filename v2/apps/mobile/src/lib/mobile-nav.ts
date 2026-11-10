/**
 * Mobilna navigacija po roli (A3/A4b, 2026-11-07) — jedina definicija, kao nav.ts na webu.
 *
 * Pravilo: svaka prijavljena rola ima Moj dan, Moje rokove, Moje projekte i Odjavu;
 * Grupa je samo za šefa (SITE_SUPERVISOR). Odjava nije stavka liste jer nije ekran —
 * ali je obavezna za svaku rolu i stoji na početnom i na terenskim ekranima
 * (TerenShell), što testovi ovdje i u render testovima dokazuju.
 */
export type MobileNavEntry = {
  href: "/moj-dan" | "/grupa" | "/rokovi" | "/projekti";
  label: string;
  /** null = sve prijavljene role. */
  roles: readonly string[] | null;
};

export const MOBILE_NAV: readonly MobileNavEntry[] = [
  { href: "/moj-dan", label: "Moj dan", roles: null },
  { href: "/grupa", label: "Grupa — unos za ekipu", roles: ["SITE_SUPERVISOR"] },
  { href: "/rokovi", label: "Moji rokovi", roles: null },
  { href: "/projekti", label: "Moji projekti", roles: null },
];

export function mobileNavForRoles(roles: readonly string[]): MobileNavEntry[] {
  return MOBILE_NAV.filter((entry) => entry.roles === null || entry.roles.some((role) => roles.includes(role)));
}
