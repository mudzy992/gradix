/**
 * Mobilna navigacija (A2, 2026-11-07) — jedina definicija, kao nav.ts na webu.
 *
 * A2 izmjena nakon pregleda tabela: "Moj dan" ne zavisi od role nego od veze
 * korisnik-radnik (bez povezanog radnika nema čiji dan da se unosi), a "Grupa" traži
 * VEZU + ulogu šefa + bar jednu aktivnu dodjelu (foremanScope sa /api/me).
 * Rokovi/Projekti i Odjava su za svaki prijavljeni nalog; odjava stoji na početnom
 * i na terenskim ekranima (TerenShell) za svaku rolu.
 */
export type MobileNavProfile = {
  roles: readonly string[];
  workerId: string | null;
  foremanScope: boolean;
};

export type MobileNavEntry = {
  href: "/moj-dan" | "/grupa" | "/rokovi" | "/projekti";
  label: string;
  visible: (profile: MobileNavProfile) => boolean;
};

export const MOBILE_NAV: readonly MobileNavEntry[] = [
  { href: "/moj-dan", label: "Moj dan", visible: (p) => p.workerId !== null },
  {
    href: "/grupa",
    label: "Grupa — unos za ekipu",
    visible: (p) => p.workerId !== null && p.foremanScope && p.roles.includes("SITE_SUPERVISOR"),
  },
  { href: "/rokovi", label: "Moji rokovi", visible: () => true },
  { href: "/projekti", label: "Moji projekti", visible: () => true },
];

export function mobileNavForProfile(profile: MobileNavProfile): MobileNavEntry[] {
  return MOBILE_NAV.filter((entry) => entry.visible(profile));
}
