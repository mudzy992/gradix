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
  href:
    | "/moj-dan"
    | "/grupa"
    | "/sati-masine"
    | "/gorivo"
    | "/ture"
    | "/dnevni-pregled"
    | "/kvarovi"
    /* F8: radionica — mehaničar mijenja stanje naloga i bilježi dijelove sa telefona. */
    | "/servisni-nalozi"
    | "/hse/prijava"
    | "/hse/toolbox"
    | "/rokovi"
    | "/projekti"
    | "/moji-zadaci"
    | "/trosak"
    /* F6: svoji sati po danu; iznosi tek kad period odobri računovodstvo. */
    | "/moj-obracun"
    /* F1: bez veze sa radnikom — svaki nalog ima svoje uređaje i može ih odjaviti. */
    | "/uredjaji";
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
  {
    href: "/sati-masine",
    label: "Sati mašine",
    visible: (p) => p.workerId !== null && p.roles.includes("MACHINE_OPERATOR"),
  },
  {
    href: "/gorivo",
    label: "Gorivo",
    visible: (p) => p.workerId !== null && (p.roles.includes("DRIVER") || p.roles.includes("MACHINE_OPERATOR")),
  },
  {
    href: "/ture",
    label: "Ture",
    visible: (p) => p.workerId !== null && p.roles.includes("DRIVER"),
  },
  {
    href: "/dnevni-pregled",
    label: "Dnevni pregled",
    visible: (p) =>
      p.workerId !== null
      && (p.roles.includes("MACHINE_OPERATOR") || p.roles.includes("MECHANIC")),
  },
  {
    href: "/servisni-nalozi",
    label: "Servisni nalozi",
    visible: (p) => p.workerId !== null && p.roles.includes("MECHANIC"),
  },
  {
    href: "/kvarovi",
    label: "Kvarovi",
    visible: (p) =>
      p.workerId !== null
      && (p.roles.includes("MACHINE_OPERATOR") || p.roles.includes("MECHANIC")),
  },
  {
    href: "/hse/prijava",
    label: "Prijava opasnosti",
    // Sync zahtijeva aktivnu vezu s radnikom i odgovarajuću terensku rolu.
    visible: (p) => p.workerId !== null && p.roles.some((role) =>
      ["WORKER", "DRIVER", "MACHINE_OPERATOR", "MECHANIC", "SITE_SUPERVISOR"].includes(role)),
  },
  { href: "/hse/toolbox", label: "Toolbox razgovor", visible: (p) =>
    p.workerId !== null && p.roles.includes("SITE_SUPERVISOR") },
  /*
   * F5: zadaci i trošak sa gradilišta.
   *
   * „Moji zadaci“ traži VEZU sa radnikom — bez nje nema čiji dan da se gleda (isti razlog kao
   * „Moj dan“). Trošak traži vezu isto: knjiži se u ime osobe koja je na gradilištu.
   */
  { href: "/moji-zadaci", label: "Moji zadaci danas", visible: (p) => p.workerId !== null },
  /*
   * F6: „Moj obračun“ traži VEZU sa radnikom — obračun je po radniku, pa nalog bez te veze nema
   * čiji obračun da gleda (isti uslov kao „Moj dan“ i „Moji zadaci“). Ne traži rolu: svaki
   * radnik ima pravo na svoje sate (`payroll.own.view`).
   */
  { href: "/moj-obracun", label: "Moj obračun", visible: (p) => p.workerId !== null },
  { href: "/trosak", label: "Trošak sa gradilišta", visible: (p) => p.workerId !== null },
  { href: "/rokovi", label: "Moji rokovi", visible: () => true },
  { href: "/projekti", label: "Moji projekti", visible: () => true },
  { href: "/uredjaji", label: "Moji uređaji", visible: () => true },
];

export function mobileNavForProfile(profile: MobileNavProfile): MobileNavEntry[] {
  return MOBILE_NAV.filter((entry) => entry.visible(profile));
}
