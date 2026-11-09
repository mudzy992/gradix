/**
 * 68 postojećih snimaka za kapiju dizajna v2 + 4 R4a-1 dizajn-only prikaza (360/1440 × svijetlo/tamno).
 *
 * Pokretanje (server mora raditi, vidi `docs/DEMO-DIZAJN.md`):
 *   LD_LIBRARY_PATH=/tmp/chlibs/lib BASE=http://127.0.0.1:3140 \
 *     node apps/web/scripts/demo-shots-dizajn.mjs
 *
 * Izlaz: `docs/demo-dizajn/<širina>-<tema>-<ekran>.png`
 *
 * Tri stanja (prazno, greška, učitavanje) ne mogu se dobiti iz demo baze — baza uvijek ima
 * podatke, a pad servera se ne izaziva ručno. Zato se za ta stanja presreće mreža i vraća
 * isti ugovor koji API stvarno vraća; ekran, stilovi i tekst su stvarni. Stanja koja ne
 * mijenjaju bazu (pogrešna lozinka, nevažeći link) rade se bez presretanja.
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "../../../docs/demo-dizajn");
const referenceFile = join(here, "../../../docs/design/reference.html");
mkdirSync(outDir, { recursive: true });

const BASE = process.env.BASE ?? "http://127.0.0.1:3140";
const EMAIL = process.env.DEMO_EMAIL ?? "ured@demo.ba";
const PASSWORD = process.env.SEED_PASSWORD ?? "nije,kikiriki";

const WIDTHS = [1440, 360];
const THEMES = ["light", "dark"];

// Ugovori koje API stvarno vraća (vidi `docs/STATUS.md`, „API ugovor“).
const EMPTY_USERS = { success: true, data: { users: [] } };
const EMPTY_AUDIT = { success: true, data: { rows: [], nextCursor: null } };
const SERVER_ERROR = {
  success: false,
  error: { code: "INTERNAL", message: "Server nije odgovorio kako treba." },
};

const browser = await puppeteer.launch({
  args: [...chromium.args, "--no-sandbox", "--disable-dev-shm-usage"],
  executablePath: await chromium.executablePath(),
  headless: true,
});

const login = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
if (!login.ok) {
  throw new Error(`Prijava ${EMAIL} nije prošla (${login.status}). Provjeri SEED_PASSWORD i bazu.`);
}
const cookies = login.headers.getSetCookie().map((raw) => {
  const [pair] = raw.split(";");
  const [name, ...rest] = pair.split("=");
  return { name, value: rest.join("="), domain: "127.0.0.1", path: "/" };
});

/**
 * @param {object} job
 * @param {string} job.path putanja ekrana
 * @param {string} job.name ime snimka bez širine i teme
 * @param {"real"|"empty"|"error"|"slow"} [job.api] kako odgovara API
 * @param {boolean} [job.auth] da li nosi sesiju (prijava i postavljanje lozinke ne nose)
 * @param {(page: import("puppeteer-core").Page) => Promise<void>} [job.before] radnja prije snimka
 */
async function shot({ path, name, api = "real", auth = true, before }) {
  for (const width of WIDTHS) {
    for (const theme of THEMES) {
      const page = await browser.newPage();
      await page.setViewport({ width, height: width === 360 ? 800 : 960 });
      if (auth) await page.setCookie(...cookies);
      await page.evaluateOnNewDocument((value) => localStorage.setItem("gx-theme", value), theme);
      if (api !== "real") {
        await page.setRequestInterception(true);
        page.on("request", (request) => {
          const url = request.url();
          const isApi = url.includes("/api/users") || url.includes("/api/audit");
          if (!isApi) return request.continue();
          if (api === "error") {
            return request.respond({ status: 500, contentType: "application/json", body: JSON.stringify(SERVER_ERROR) });
          }
          if (api === "slow") {
            // 4 s: snimak se pravi dok skeleton još stoji.
            return setTimeout(
              () =>
                request.respond({
                  status: 200,
                  contentType: "application/json",
                  body: JSON.stringify(url.includes("/api/audit") ? EMPTY_AUDIT : EMPTY_USERS),
                }),
              4000,
            );
          }
          return request.respond({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(url.includes("/api/audit") ? EMPTY_AUDIT : EMPTY_USERS),
          });
        });
      }
      await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
      await new Promise((resolve) => setTimeout(resolve, api === "slow" ? 900 : 1500));
      if (before) await before(page);
      await page.screenshot({ path: join(outDir, `${width}-${theme}-${name}.png`) });
      console.log(`${width}-${theme}-${name}.png`);
      await page.close();
    }
  }
}

async function r4aReferenceShot({ screen, theme, width, height }) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  const url = `${pathToFileURL(referenceFile).href}?preview=r4a1&screen=${screen}&theme=${theme}`;
  await page.goto(url, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  const name = `${width}-${theme}-r4a1-${screen}.png`;
  await page.screenshot({ path: join(outDir, name), fullPage: true });
  console.log(name);
  await page.close();
}

const typeInto = async (page, selector, value) => {
  await page.waitForSelector(selector, { timeout: 15000 });
  await page.click(selector);
  await page.type(selector, value);
};

// 1. Prijava: prazna + greška (pogrešna lozinka ne mijenja bazu).
await shot({ path: "/login", name: "login", auth: false });
await shot({
  path: "/login",
  name: "login-greska",
  auth: false,
  before: async (page) => {
    await typeInto(page, 'input[name="email"]', EMAIL);
    await typeInto(page, 'input[name="password"]', "pogresna-lozinka");
    await page.click('button[type="submit"]');
    await new Promise((resolve) => setTimeout(resolve, 1500));
  },
});

// 2. Lozinke: forma, greška politike (bez upisa), nevažeći link.
await shot({ path: "/lozinka/promjena", name: "lozinka-promjena" });
await shot({
  path: "/lozinka/promjena",
  name: "lozinka-promjena-greska",
  before: async (page) => {
    await typeInto(page, 'input[name="currentPassword"]', "nesto");
    await typeInto(page, 'input[name="newPassword"]', "aaaaaaaaaaaa");
    await typeInto(page, 'input[name="repeat"]', "bbbbbbbbbbbb");
    await page.click('button[type="submit"]');
    await new Promise((resolve) => setTimeout(resolve, 600));
  },
});
await shot({ path: "/lozinka/postavi?token=nevalidan", name: "lozinka-postavi-nevazeci", auth: false });

// 3. Pregled.
await shot({ path: "/pregled", name: "pregled" });

// 4. Korisnici: puno, prazno, greška, učitavanje, drawer, dijalog role i opseg.
await shot({ path: "/ured/korisnici", name: "korisnici" });
await shot({ path: "/ured/korisnici", name: "korisnici-prazno", api: "empty" });
await shot({ path: "/ured/korisnici", name: "korisnici-greska", api: "error" });
await shot({ path: "/ured/korisnici", name: "korisnici-ucitavanje", api: "slow" });
await shot({
  path: "/ured/korisnici",
  name: "korisnici-drawer",
  before: async (page) => {
    // Dugme za drawer postoji i na 1440 samo je skriveno — klik ide tek ako je vidljivo.
    const opened = await page.evaluate(() => {
      const button = document.querySelector(".gx-topbar__menu");
      if (!(button instanceof HTMLElement) || button.offsetParent === null) return false;
      button.click();
      return true;
    });
    if (opened) await new Promise((resolve) => setTimeout(resolve, 300));
  },
});
await shot({
  path: "/ured/korisnici",
  name: "korisnici-dijalog",
  before: async (page) => {
    const trigger = await page.waitForSelector('button[aria-label^="Više radnji za"]', { timeout: 15000 });
    if (!trigger) return;
    await trigger.click();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await page.evaluate(() => {
      const item = [...document.querySelectorAll('[role="menuitem"]')].find((node) =>
        node.textContent?.includes("Role i opseg"),
      );
      item?.click();
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
  },
});

// 5. Pristup i role, audit trag (puno, prazno, greška, učitavanje).
await shot({ path: "/ured/role", name: "role" });
await shot({ path: "/ured/audit", name: "audit" });
await shot({ path: "/ured/audit", name: "audit-prazno", api: "empty" });
await shot({ path: "/ured/audit", name: "audit-greska", api: "error" });
await shot({ path: "/ured/audit", name: "audit-ucitavanje", api: "slow" });

// 6. R4a-1 design-only views from the existing reference (no product route or R4 data).
for (const view of [
  { screen: "worker", theme: "light", width: 360, height: 900 },
  { screen: "worker", theme: "dark", width: 360, height: 900 },
  { screen: "office", theme: "light", width: 1440, height: 960 },
  { screen: "office", theme: "dark", width: 1440, height: 960 },
]) {
  await r4aReferenceShot(view);
}

await browser.close();
console.log(`\nSnimci: ${outDir}`);
