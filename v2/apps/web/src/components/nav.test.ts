/**
 * A4a/A4b (2026-11-07): dosegljivost i meni po roli.
 *
 * Nastalo jer je `/ured/radni-dani` postojala bez stavke u navigaciji. Od sada CI pada
 * ako nova stranica nije ni u navigaciji (za rolu koja je smije otvoriti) ni na listi
 * izuzetaka s razlogom — i ako meni bilo koje role odstupi od matrice dozvola.
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NAV_ENTRIES, navEntriesForRoles } from "./nav";
import { PERMISSIONS, ROLES, can } from "@/server/permissions";

const appDir = fileURLToPath(new URL("../app", import.meta.url));

function pageRoutes(dir: string, prefix = ""): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pageRoutes(path, `${prefix}/${name}`);
    return name === "page.tsx" ? [prefix === "" ? "/" : prefix] : [];
  });
}

/** Stranice koje namjerno nisu u glavnoj navigaciji — svaka s razlogom. */
const NAV_EXCEPTIONS: Record<string, string> = {
  "/": "korijen samo preusmjerava na /pregled ili /login",
  "/login": "javna stranica prijave, prije sesije",
  "/lozinka/postavi": "dolazi se isključivo token-linkom iz pozivnice/reseta",
  "/lozinka/promjena": "korisnički meni u okviru + prisilna promjena poslije prijave",
  "/katalog": "U5 katalog UI komponenti — razvojni alat, otvara se direktnim URL-om",
};

describe("dosegljivost stranica (A4a)", () => {
  it("svaka stranica je u navigaciji ili na listi izuzetaka s razlogom", () => {
    const routes = pageRoutes(appDir);
    const navHrefs = new Set(NAV_ENTRIES.map((entry) => entry.href));
    // Dinamička ruta-dijete (npr. /ured/sukobi/[id]) NIJE izuzetak i ne ide
    // na listu izuzetaka: pokriva je roditelj u navigaciji, jer se na dijete
    // dolazi isključivo kroz roditeljsku listu i važi ista dozvola. Razlog
    // živi ovdje, u pravilu pokrivanja, a ne u listi izuzetaka — izuzetak bi
    // značio da stranica svjesno nema ulaz, a detalj ga ima (red liste).
    const covered = (route: string) =>
      navHrefs.has(route) || navHrefs.has(route.replace(/\/\[[^\]]+\]$/, ""));
    const uncovered = routes.filter((route) => !covered(route) && !(route in NAV_EXCEPTIONS));
    expect(uncovered).toEqual([]);
    for (const [route, reason] of Object.entries(NAV_EXCEPTIONS)) {
      expect(routes).toContain(route);
      expect(reason.length).toBeGreaterThan(10);
    }
  });

  it("svaka stavka navigacije vodi na postojeću stranicu i neku rolu je smije otvoriti", () => {
    const routes = new Set(pageRoutes(appDir));
    for (const entry of NAV_ENTRIES) {
      expect(routes.has(entry.href)).toBe(true);
      const allowed = ROLES.filter(
        (role) => entry.permission === "authenticated" || can([role], entry.permission),
      );
      expect(allowed.length).toBeGreaterThan(0);
    }
  });
});

describe("meni po roli == matrica dozvola (A4b, web)", () => {
  it.each(ROLES.map((role) => [role] as const))("rola %s vidi tačno ono što smije", (role) => {
    const visible = navEntriesForRoles([role]).map((entry) => entry.href);
    const expected = NAV_ENTRIES.filter(
      (entry) => entry.permission === "authenticated" || (PERMISSIONS[entry.permission] as readonly string[]).includes(role),
    ).map((entry) => entry.href);
    expect(visible).toEqual(expected);
  });

  it("Radni dani po A2: OWNER/ADMIN/ACCOUNTANT cijela firma, PM/šef opseg, ostali ništa", () => {
    const allowed = ["OWNER", "ADMIN", "PROJECT_MANAGER", "SITE_SUPERVISOR", "ACCOUNTANT"];
    for (const role of ROLES) {
      const visible = navEntriesForRoles([role]).some((entry) => entry.href === "/ured/radni-dani");
      expect(visible).toBe(allowed.includes(role));
    }
  });
});
