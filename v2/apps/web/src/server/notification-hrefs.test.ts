/**
 * Kapija za `href` obavještenja — nastala poslije pada CI-ja na F3.
 *
 * `href` je obavezan i inbox ga renderuje kao `<Link>`; Next ga prefetchuje. Zato nepostojeća
 * putanja nije „mrtav link" nego 404 u konzoli ekrana, a `attachConsoleGuard` u E2E-u takav 404
 * uredno prijavi kao pad. Tako je `href: "/moj-dan"` (mobilni ekran) oborio WORKER smoke na webu.
 *
 * Test traži dvije stvari za SVAKU putanju iz `NOTIFICATION_HREFS`:
 *   1. stranica postoji u `src/app` — nema linka na ekran koji web nema;
 *   2. stranica nema `redirect("/nemate-pristup")` — primalac obavještenja može biti svaka rola,
 *      pa bi link za neku rolu vodio na 403 stranicu (isti simptom, drugi izvor).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NOTIFICATION_HREFS } from "./notification-hrefs";
import { DATA_HEALTH_HREFS } from "./data-health";
import { DASHBOARD_ACTIONS } from "./dashboard-actions";
import { can, type Permission } from "./permissions";

const appDir = fileURLToPath(new URL("../app", import.meta.url));

/** Putanja → fajl stranice, ili `null` kad ekran u webu ne postoji. */
function pageFileFor(href: string): string | null {
  const direct = join(appDir, href.split("?")[0]!.replace(/^\//, ""), "page.tsx");
  return existsSync(direct) ? direct : null;
}

describe("href obavještenja", () => {
  const entries = Object.entries(NOTIFICATION_HREFS);

  it("konstanta ima barem jedan unos", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  for (const [name, href] of entries) {
    it(`${name} (${href}) vodi na postojeći ekran bez zabrane`, () => {
      expect(href.startsWith("/"), "href mora biti putanja u aplikaciji").toBe(true);

      const file = pageFileFor(href);
      // Poruka testa imenuje putanju: kad padne, odmah se zna koji ekran nedostaje.
      expect(file, `web nema stranicu na ${href} — mobilni ekran ne smije biti href obavještenja`).not.toBeNull();

      const source = readFileSync(file as string, "utf8");
      expect(
        source.includes('redirect("/nemate-pristup")'),
        `${href} zabranjuje role — primalac obavještenja bi dobio 403 umjesto sadržaja`,
      ).toBe(false);
    });
  }

  it("nijedan href ne pokazuje na /api (JSON nije ekran)", () => {
    for (const [, href] of entries) expect(href.startsWith("/api")).toBe(false);
  });

  // Kontrola same kapije: da nije „prošla jer ne gleda ništa", mora prepoznati mobilni ekran.
  it("kapija prepoznaje putanju koje web nema", () => {
    expect(pageFileFor("/moj-dan")).toBeNull();
    expect(existsSync(join(appDir, "pregled", "page.tsx"))).toBe(true);
    // `nav.test.ts` već pokriva dosegljivost svih stranica; ovdje se provjerava samo pravac
    // obavještenje → stranica, pa se ne pravi druga evidencija ruta.
    expect(statSync(join(appDir, "pregled")).isDirectory()).toBe(true);
    expect(readdirSync(join(appDir, "pregled"))).toContain("page.tsx");
  });
});

// Role-targeted links are not broadcast notification links: their destination must exist
// and accept every role allowed to receive the data-health result, without weakening the page guard.
describe("data-health href", () => {
  const permissions: Record<keyof typeof DATA_HEALTH_HREFS, Permission> = {
    unconfirmed_days:"workdays.view", projects_without_budget:"projects.view",
    machines_without_rate:"equipment.view", workers_without_rate:"workers.view",
    warehouses_without_minimum:"stock.view", incidents_without_actions:"hse.view",
  };
  for (const key of Object.keys(DATA_HEALTH_HREFS) as Array<keyof typeof DATA_HEALTH_HREFS>) {
    it(`${key} vodi na postojeću stranicu dostupnu vlasniku i administratoru`, () => {
      const href=DATA_HEALTH_HREFS[key];
      expect(href.startsWith("/") && !href.startsWith("//") && !href.startsWith("/api")).toBe(true);
      const file=pageFileFor(href);
      expect(file).not.toBeNull();
      const source=readFileSync(file!, "utf8");
      expect(source).toContain(`"${permissions[key]}"`);
      expect(can(["OWNER"],permissions[key])).toBe(true);
      expect(can(["ADMIN"],permissions[key])).toBe(true);
    });
  }
});

describe("role dashboard href", () => {
  const pagePermission: Record<string, Permission> = {
    "/ured/projekti":"projects.view", "/ured/hse/inspekcije":"hse.view", "/ured/rokovi":"obligations.view",
    "/ured/nabavka":"purchase.view", "/ured/podizvodjaci":"subcontractors.view", "/ured/zadaci":"projects.view",
    "/ured/radni-dani":"workdays.view", "/ured/tenderi":"tenders.view", "/ured/dnevnik":"diary.view",
    "/ured/kvarovi":"machines.fault.view", "/ured/hse":"hse.view", "/ured/obracun-sati":"payroll.view",
    "/ured/servis":"service.view", "/ured/servis/planovi":"service.view",
  };
  for (const action of [...DASHBOARD_ACTIONS, {key:"preventive_due",role:"MECHANIC" as const,href:"/ured/servis/planovi"}]) {
    it(`${action.role}/${action.key} vodi na dostupnu stranicu`, () => {
      const permission=pagePermission[action.href.split("?")[0]!];
      expect(permission).toBeDefined();
      const file=pageFileFor(action.href);
      expect(file).not.toBeNull();
      expect(readFileSync(file!,"utf8")).toContain(`"${permission}"`);
      expect(can([action.role],permission!)).toBe(true);
    });
  }
});
