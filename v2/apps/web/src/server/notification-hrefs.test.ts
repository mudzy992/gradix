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

const appDir = fileURLToPath(new URL("../app", import.meta.url));

/** Putanja → fajl stranice, ili `null` kad ekran u webu ne postoji. */
function pageFileFor(href: string): string | null {
  const direct = join(appDir, href.replace(/^\//, ""), "page.tsx");
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
