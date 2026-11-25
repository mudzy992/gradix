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
import { NAV_ENTRIES, navEntriesForRoles, navGroupsForRoles } from "./nav";
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
  "/ured/profil": "lični profil: ulaz iz korisničkog menija u okviru, nema dozvolu",
  "/ured/profil/sesije": "„Moje sesije“ — lično, ulaz sa profila i iz korisničkog menija",
  "/platform": "korijen platforme preusmjerava na /platform/firme",
  "/platform/login": "prijava operatora prije platform sesije (odvojen cookie)",
  "/platform/firme": "platforma nije dio tenant navigacije — operator nije član firme",
  "/platform/firme/nova": "onboarding čarobnjak, ulaz sa liste firmi",
  "/ured/obracun-sati/sati":
    "izvoz sirovih sati za PM/šefa: ista dozvola kao stavka „Obračun“ ali BEZ iznosa, pa ne dobija svoju stavku u meniju — ulaz je link na vrhu ekrana Obračun i na periodu",
  "/ured/tenderi/uspjesnost":
    "izvještaj uspješnosti je dio modula Tenderi — ulaz je link na vrhu liste tendera, ista dozvola (tenders.view), pa ne dobija svoju stavku u meniju",
  "/ured/tenderi/kalendar":
    "kalendar rokova je drugi pogled na iste rokove — ulaz je link na vrhu liste tendera, ista dozvola (tenders.view), pa ne dobija svoju stavku u meniju",
  "/ured/radni-dani/sedmica":
    "pogled „radnik × dan“ je dio ekrana Radni dani — ulaz je link na vrhu tog ekrana, i važi ista dozvola (workdays.view), pa ne dobija svoju stavku u meniju",
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

  it("R6.0: sidebar grupe su Pregled / Evidencija / Mehanizacija / Rad-obračun / Administracija", () => {
    const groups = navGroupsForRoles(["OWNER"]).map((group) => group.label);
    expect(groups).toEqual([
      "Pregled",
      "Evidencija",
      "Mehanizacija",
      "Rad / obračun",
      "Administracija",
    ]);
    const byHref = Object.fromEntries(
      NAV_ENTRIES.map((entry) => [entry.href, entry.group]),
    );
    expect(byHref["/ured/sati-masine"]).toBe("Mehanizacija");
    expect(byHref["/ured/radni-dani"]).toBe("Rad / obračun");
    expect(byHref["/ured/obracun-sati"]).toBe("Rad / obračun");
    expect(byHref["/ured/obracun-sati/postavke"]).toBe("Rad / obračun");
    expect(byHref["/ured/korisnici"]).toBe("Administracija");
  });

  /*
   * F6:„Obračun“ nosi IZNOSE, pa ga vide samo OWNER/ADMIN/ACCOUNTANT (`payroll.view`).
   * PM i šef više nisu na ovoj listi — oni sate dobijaju kroz izvoz sati
   * (`/ured/obracun-sati/sati`, dozvola `payroll.hours.export`), nikad kroz obračun s iznosima.
   */
  it("F6: obračun sa iznosima vide OWNER/ADMIN/ACCOUNTANT, ne PM ni šef", () => {
    const allowed = ["OWNER", "ADMIN", "ACCOUNTANT"];
    for (const role of ROLES) {
      const visible = navEntriesForRoles([role]).some((entry) => entry.href === "/ured/obracun-sati");
      expect(visible).toBe(allowed.includes(role));
    }
  });

  it("F6: postavke obračuna (komponente, parametri) su u meniju za one koji vide obračun", () => {
    const allowed = ["OWNER", "ADMIN", "ACCOUNTANT"];
    for (const role of ROLES) {
      const visible = navEntriesForRoles([role]).some(
        (entry) => entry.href === "/ured/obracun-sati/postavke",
      );
      expect(visible).toBe(allowed.includes(role));
    }
  });
});
