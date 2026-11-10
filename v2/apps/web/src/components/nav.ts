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
  /** "authenticated" = svaki prijavljeni korisnik firme. */
  permission: Permission | "authenticated";
};

export const NAV_ENTRIES: readonly NavEntry[] = [
  { href: "/pregled", label: "Pregled", icon: "home", description: "Mašine i offline zapisi", group: "Pregled", permission: "authenticated" },
  { href: "/ured/projekti", label: "Projekti", icon: "pin", description: "Gradilišta, tim, mašine", group: "Evidencija", permission: "projects.view" },
  { href: "/ured/rokovi", label: "Rokovi", icon: "calendar", description: "Ljekarski, registracije, licence", group: "Evidencija", permission: "obligations.view" },
  { href: "/ured/masine", label: "Mašine i vozila", icon: "truck", description: "Inventar, kategorije, brojilo", group: "Evidencija", permission: "equipment.view" },
  { href: "/ured/radnici", label: "Radnici", icon: "users", description: "Ljudi, kontakt, angažman", group: "Evidencija", permission: "workers.view" },
  { href: "/ured/uvoz", label: "Uvoz iz Excela", icon: "upload", description: "Spisak sa papira", group: "Evidencija", permission: "workers.manage" },
  { href: "/ured/radni-dani", label: "Radni dani", icon: "calendar", description: "Dani sa terena, „Za provjeru“", group: "Ured", permission: "workdays.view" },
  { href: "/ured/korisnici", label: "Korisnici", icon: "users", description: "Ljudi, role, pristup", group: "Ured", permission: "users.manage" },
  { href: "/ured/role", label: "Pristup i role", icon: "shield", description: "Ko šta smije", group: "Ured", permission: "roles.view" },
  { href: "/ured/audit", label: "Audit trag", icon: "list", description: "Ko je šta mijenjao", group: "Ured", permission: "audit.view" },
];

const GROUP_ORDER = ["Pregled", "Evidencija", "Ured"] as const;

export function navEntriesForRoles(roles: readonly string[]): NavEntry[] {
  return NAV_ENTRIES.filter(
    (entry) => entry.permission === "authenticated" || can(roles, entry.permission),
  );
}

export function navGroupsForRoles(roles: readonly string[]): NavGroup[] {
  const visible = navEntriesForRoles(roles);
  return GROUP_ORDER.map((label) => ({
    label,
    items: visible
      .filter((entry) => entry.group === label)
      .map(({ href, label: itemLabel, icon, description }) => ({ href, label: itemLabel, icon, description })),
  })).filter((group) => group.items.length > 0);
}
