/**
 * Jedina definicija glavne navigacije (A, 2026-11-07).
 *
 * Zašto postoji: `/ured/radni-dani` je živjela kao stranica bez stavke u meniju jer su
 * meni (app-shell) i dozvole (page) održavani odvojeno. Ovdje svaka stavka nosi dozvolu
 * iz matrice; okvir filtrira po `can()`, stranica provjerava istu dozvolu, a
 * `nav.test.ts` dokazuje: (1) svaka stranica je ili u navigaciji ili na listi izuzetaka
 * s razlogom, (2) meni po roli == matrica dozvola.
 */
import { can, type Permission } from "@/server/permissions";
import type { IconName } from "./ui";
import type { NavGroup } from "./shell";

export type NavEntry = {
  href: string;
  label: string;
  icon: IconName;
  description: string;
  group: string;
  /** Bedž broji SAMO nerazriješene sukobe; `older` ih ističe (vidi AppShell). */
  badge?: { count: number; older: number };
  /** "authenticated" = svaki prijavljeni korisnik firme. */
  permission: Permission | "authenticated";
};

export const NAV_ENTRIES: readonly NavEntry[] = [
  { href: "/pregled", label: "Pregled", icon: "home", description: "Mašine i offline zapisi", group: "Pregled", permission: "authenticated" },
  { href: "/ured/projekti", label: "Projekti", icon: "pin", description: "Gradilišta, tim, mašine", group: "Evidencija", permission: "projects.view" },
  { href: "/ured/radnici", label: "Radnici", icon: "users", description: "Ljudi, kontakt, angažman", group: "Evidencija", permission: "workers.view" },
  { href: "/ured/masine", label: "Mašine i vozila", icon: "truck", description: "Inventar, kategorije, brojilo", group: "Evidencija", permission: "equipment.view" },
  { href: "/ured/masine/kalendar", label: "Zauzetost mašina", icon: "calendar", description: "Koja je mašina gdje, po danima", group: "Evidencija", permission: "equipment.view" },
  { href: "/ured/partneri", label: "Partneri", icon: "users", description: "Naručioci, dobavljači, servisi", group: "Evidencija", permission: "partners.view" },
  { href: "/ured/tenderi", label: "Tenderi", icon: "folder", description: "Ponude, status, konverzija", group: "Evidencija", permission: "tenders.view" },
  { href: "/ured/rokovi", label: "Rokovi", icon: "calendar", description: "Ljekarski, registracije, licence", group: "Evidencija", permission: "obligations.view" },
  { href: "/ured/uvoz", label: "Uvoz iz Excela", icon: "upload", description: "Spisak sa papira", group: "Evidencija", permission: "workers.manage" },
  { href: "/ured/sati-masine", label: "Sati mašina", icon: "truck", description: "Radni sati mašina i očitanja brojila", group: "Mehanizacija", permission: "machines.work_log.view" },
  { href: "/ured/gorivo", label: "Gorivo", icon: "fuel", description: "Točenja goriva po mašini", group: "Mehanizacija", permission: "machines.fuel.view" },
  { href: "/ured/ture", label: "Ture", icon: "truck", description: "Ture i stacionaža po mašini", group: "Mehanizacija", permission: "machines.haul.view" },
  { href: "/ured/dnevni-pregled", label: "Dnevni pregled", icon: "shield", description: "Dnevni pregled mašine prije rada", group: "Mehanizacija", permission: "machines.check.view" },
  { href: "/ured/kvarovi", label: "Kvarovi", icon: "shield", description: "Prijave kvarova i odobrenje troška", group: "Mehanizacija", permission: "machines.fault.view" },
  { href: "/ured/servis", label: "Servis", icon: "shield", description: "Radionica: red čekanja, naloge, planove održavanja i dijelove", group: "Mehanizacija", permission: "service.view" },
  /* F9: dnevnik i HSE su EVIDENCIJA, ne administracija — tamo ih šef traži. */
  { href: "/ured/dnevnik", label: "Dnevnik građenja", icon: "list", description: "Dnevni zapis po projektu: teren, količine, zastoji, potpis", group: "Evidencija", permission: "diary.view" },
  { href: "/ured/hse", label: "Zaštita na radu", icon: "shield", description: "Incidenti, mjere, obuke, inspekcije, LTIFR", group: "Evidencija", permission: "hse.view" },
  { href: "/ured/radni-dani", label: "Radni dani", icon: "calendar", description: "Potvrda dana, sedmica, zaključavanje", group: "Rad / obračun", permission: "workdays.view" },
  { href: "/ured/sukobi", label: "Sukobi", icon: "list", description: "Razrješenje sukoba radnih dana", group: "Rad / obračun", permission: "workdays.resolve" },
  { href: "/ured/trosak-masina", label: "Trošak mašina", icon: "list", description: "Stope troška po satu rada mašine", group: "Rad / obračun", permission: "machines.cost_rate.view" },
  /*
   * F5: troškovi projekta više NISU poseban ekran — ledger je tab unutar projekta (`Pregled` →
   * `Troškovi`), jer se trošak gleda uz svoj budžet i maržu. Stavka zato nestaje iz menija, a
   * dozvola `projects.costs.view` ostaje granica za tabove.
   */
  { href: "/ured/zadaci", label: "Zadaci", icon: "list", description: "Moji zadaci, kasne, po projektu", group: "Rad / obračun", permission: "projects.view" },
  /*
   * F6: „Obračun sati“ postaje „Obračun“ — mjesečni obračun sa iznosima (`payroll.view`).
   * Izvoz sirovih sati za PM/šefa ostaje na `/ured/obracun-sati/sati` i vide ga kroz
   * `payroll.hours.export` iz perioda; stavka u meniju ide onome ko vidi IZNOSE.
   */
  { href: "/ured/obracun-sati", label: "Obračun", icon: "list", description: "Mjesečni obračun: sati po vrsti, iznosi, odobrenje", group: "Rad / obračun", permission: "payroll.view" },
  { href: "/ured/obracun-sati/postavke", label: "Komponente obračuna", icon: "list", description: "Šifarnik komponenti i stope sa datumom važenja", group: "Rad / obračun", permission: "payroll.view" },
  { href: "/ured/postavke", label: "Postavke firme", icon: "pin", description: "Zaglavlje, rad, praznici, 2FA", group: "Administracija", permission: "company.settings.view" },
  /*
   * Kategorije troška su ŠIFARNIK KNJIGE, ne postavka firme: zato su ispod `projects.costs.view`
   * (vidi ih onaj ko vidi troškove), a ne `company.settings.view`.
   */
  { href: "/ured/postavke/kategorije-troska", label: "Kategorije troška", icon: "folder", description: "Šifarnik kategorija i mapiranje izvora", group: "Administracija", permission: "projects.costs.view" },
  { href: "/ured/obavjestenja", label: "Obavještenja", icon: "bell", description: "Inbox: rok, budžet, izvještaj", group: "Administracija", permission: "authenticated" },
  { href: "/ured/korisnici", label: "Korisnici", icon: "users", description: "Ljudi, role, pristup", group: "Administracija", permission: "users.manage" },
  { href: "/ured/role", label: "Pristup i role", icon: "shield", description: "Ko šta smije", group: "Administracija", permission: "roles.view" },
  { href: "/ured/audit", label: "Audit trag", icon: "list", description: "Ko je šta mijenjao", group: "Administracija", permission: "audit.view" },
];

const GROUP_ORDER = [
  "Pregled",
  "Evidencija",
  "Mehanizacija",
  "Rad / obračun",
  "Administracija",
] as const;

export function navEntriesForRoles(roles: readonly string[]): NavEntry[] {
  return NAV_ENTRIES.filter(
    (entry) => entry.permission === "authenticated" || can(roles, entry.permission),
  );
}

export function navGroupsForRoles(
  roles: readonly string[],
  badges: Partial<Record<string, { count: number; older: number }>> = {},
): NavGroup[] {
  const visible = navEntriesForRoles(roles);
  return GROUP_ORDER.map((label) => ({
    label,
    items: visible
      .filter((entry) => entry.group === label)
      .map(({ href, label: itemLabel, icon, description }) => ({
        href, label: itemLabel, icon, description, badge: badges[href],
      })),
  })).filter((group) => group.items.length > 0);
}
