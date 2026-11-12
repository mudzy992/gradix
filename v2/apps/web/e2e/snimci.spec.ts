/**
 * Dio 3c — snimci za pregled (NIJE kapija): katalog i ključne stranice u obje teme,
 * 360 i 1440 px. Fajlovi idu u `snimci/` i objavljuju se kao CI artefakt za preuzimanje.
 * Test namjerno ne pada: svaki snimak koji ne uspije samo nedostaje u artefaktu.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { test, type Page } from "@playwright/test";

const PASSWORD = process.env.E2E_PASSWORD ?? "";
const OUT = path.join(process.cwd(), "snimci");

const PAGES: { name: string; href: string }[] = [
  { name: "katalog", href: "/katalog" },
  { name: "pregled", href: "/pregled" },
  { name: "radnici", href: "/ured/radnici" },
  { name: "projekti", href: "/ured/projekti" },
  { name: "masine", href: "/ured/masine" },
  { name: "rokovi", href: "/ured/rokovi" },
  { name: "korisnici", href: "/ured/korisnici" },
  { name: "radni-dani", href: "/ured/radni-dani" },
  { name: "sukobi", href: "/ured/sukobi" },
  { name: "sukobi-detalj", href: "/ured/sukobi/cnf_demo_1?stanje=OPEN" },
];

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("vlasnik@demo.ba");
  await page.getByLabel("Lozinka").fill(PASSWORD);
  await page.getByRole("button", { name: "Prijavi se" }).click();
  await page.waitForURL("**/pregled");
}

test("snimci kataloga i ključnih stranica (obje teme, 360/1440)", async ({ page }) => {
  test.setTimeout(240_000);
  mkdirSync(OUT, { recursive: true });

  for (const theme of ["light", "dark"] as const) {
    for (const width of [360, 1440]) {
      try {
        await page.setViewportSize({ width, height: width === 360 ? 740 : 900 });
        await page.addInitScript((choice) => {
          try {
            window.localStorage.setItem("gx-theme", choice);
          } catch {
            /* snimak je i bez teme koristan */
          }
        }, theme);
        // Prijava se snima prije logina, ostalo poslije.
        await page.goto("/login");
        await page.screenshot({ path: path.join(OUT, `prijava-${theme}-${width}.png`), fullPage: true });
        await login(page);
        for (const target of PAGES) {
          try {
            await page.goto(target.href);
            await page.waitForTimeout(600);
            await page.screenshot({ path: path.join(OUT, `${target.name}-${theme}-${width}.png`), fullPage: true });
          } catch {
            /* jedan snimak manje, nije kapija */
          }
        }
      } catch {
        /* nije kapija */
      }
    }
  }
});
