/**
 * Snimci prijedloga okvira R1c — 3 ekrana × 2 širine × {sidebar otvoren, sklopljen},
 * plus `Ctrl+K` i mobilni drawer. Ovo je PRIJEDLOG za vlasnika, ne finalni demo.
 *
 * Pokretanje:
 *   LD_LIBRARY_PATH=/tmp/chlibs/lib BASE=http://127.0.0.1:3140 node scripts/demo-shots-r1c.mjs
 *
 * Izlaz: docs/design/r1c-predlog/<širina>-<ekran>-<stanje>.png
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "../../docs/design/r1c-predlog");
mkdirSync(outDir, { recursive: true });

const BASE = process.env.BASE ?? "http://127.0.0.1:3140";
const EMAIL = process.env.DEMO_EMAIL ?? "ured@demo.ba";
const PASSWORD = process.env.SEED_PASSWORD ?? "nije,kikiriki";
const WIDTHS = [360, 1440];

const browser = await puppeteer.launch({
  args: [...chromium.args, "--no-sandbox", "--disable-dev-shm-usage"],
  executablePath: await chromium.executablePath(),
  headless: true,
});

const shots = [];
async function shot(page, width, name, options = {}) {
  const file = join(outDir, `${width}-${name}.png`);
  await page.screenshot({ path: file, fullPage: options.fullPage ?? true });
  shots.push(`${width}-${name}.png`);
  console.log("snimljeno:", `${width}-${name}.png`);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `waitUntil: "networkidle0"` na ovoj aplikaciji nikad ne dođe (otvorena veza), a `load`
 * može proći prije nego što React preuzme stranicu — tada klik na hamburger promaši.
 * Zato se čeka konkretan element, ne vrijeme.
 */
async function gotoReady(page, path, selector) {
  await page.goto(`${BASE}${path}`, { waitUntil: "load" });
  await page.waitForSelector(".gx-shell", { timeout: 20000 });
  await page.waitForSelector(selector, { visible: true, timeout: 20000 });
  await wait(150);
}

const response = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
if (!response.ok) throw new Error(`prijava pala: ${response.status}`);
const cookies = response.headers.getSetCookie().map((raw) => {
  const [pair] = raw.split(";");
  const [name, ...rest] = pair.split("=");
  return { name, value: rest.join("="), domain: new URL(BASE).hostname, path: "/" };
});

async function freshPage(width) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: width === 360 ? 780 : 900, deviceScaleFactor: 1 });
  await page.setCookie(...cookies);
  return page;
}

const SCREENS = [
  ["korisnici", "/ured/korisnici"],
  ["matrica", "/ured/role"],
  ["audit", "/ured/audit"],
];

for (const width of WIDTHS) {
  for (const [name, path] of SCREENS) {
    // sidebar otvoren (na telefonu: drawer otvoren)
    const page = await freshPage(width);
    await gotoReady(page, path, width === 360 ? ".gx-header__menu" : ".gx-sidebar__collapse");
    if (width === 360) {
      await page.click(".gx-header__menu");
      await wait(250);
      await shot(page, width, `${name}-sidebar-otvoren`, { fullPage: false });
      // Zatvaranje ide klikom NA ZATAMNJENJE (desno od drawera), ne na centar ekrana —
      // centar 360 px ekrana je unutar samog drawera.
      await page.mouse.click(width - 20, 400);
      await wait(250);
      await shot(page, width, `${name}-sidebar-zatvoren`, { fullPage: false });
    } else {
      await shot(page, width, `${name}-sidebar-otvoren`);
      // sklopljen: klik na „Skupi“
      await page.click(".gx-sidebar__collapse");
      await wait(250);
      await shot(page, width, `${name}-sidebar-sklopljen`);
    }
    await page.close();
  }

  // Ctrl+K
  const palette = await freshPage(width);
  await gotoReady(palette, "/ured/korisnici", ".gx-search");
  await palette.click(".gx-search");
  await palette.keyboard.down("Control");
  await palette.keyboard.press("k");
  await palette.keyboard.up("Control");
  await wait(300);
  await palette.keyboard.type("mat");
  await wait(250);
  await shot(palette, width, "ctrl-k", { fullPage: false });
  await palette.close();
}

console.log(`\nUkupno snimaka: ${shots.length}`);
await browser.close();
