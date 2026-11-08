/**
 * Snimci svih stanja ekrana R1b na 360 px i 1440 px (demo, nije dio aplikacije).
 *
 * Zašto zasebna skripta od R1a: R1b ima svoje ekrane (matrica, audit), a R1a snimci ostaju
 * dokaz za svoj rez. Ista tehnika: prijava kroz `/api/auth/login`, cookie u preglednik, pa
 * prolaz kroz stanja — bez mock podataka.
 *
 * Pokretanje:
 *   npx --yes puppeteer-core@23 @sparticuz/chromium@131   # jednokratno, u temp folderu
 *   LD_LIBRARY_PATH=/tmp/chlibs/lib BASE=http://127.0.0.1:3140 node scripts/demo-shots-r1b.mjs
 *
 * Izlaz: docs/design/demo-r1b/{360,1440}-<stanje>.png
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "../../docs/design/demo-r1b");
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
/**
 * `fullPage` je podrazumijevano (duga lista se vidi cijela), ali NE za dijaloge: `fixed`
 * overlay pokriva samo visinu ekrana, pa bi na `fullPage` snimku ispod njega probila stranica
 * koja izgleda kao da dijalog ne prekriva sve. Za dijaloge: `{ fullPage: false }`.
 */
async function shot(page, width, name, { fullPage = true } = {}) {
  const file = join(outDir, `${width}-${name}.png`);
  await page.screenshot({ path: file, fullPage });
  shots.push(`${width}-${name}.png`);
  console.log("snimljeno:", `${width}-${name}.png`);
}

async function authCookies(email, password) {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error(`prijava pala (${email}): ${response.status}`);
  const body = await response.json();
  const cookies = response.headers.getSetCookie().map((raw) => {
    const [pair] = raw.split(";");
    const [name, ...rest] = pair.split("=");
    return { name, value: rest.join("="), domain: new URL(BASE).hostname, path: "/" };
  });
  return { cookies, data: body.data };
}

const session = await authCookies(EMAIL, PASSWORD);

/** Nova stranica sa sesijom — svako stanje svoja, da interception ne curi između stanja. */
async function freshPage(width, cookies = session.cookies) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: width === 360 ? 780 : 900, deviceScaleFactor: 1 });
  await page.setCookie(...cookies);
  return page;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ---------------------------------------------------------------- matrica rola */
for (const width of WIDTHS) {
  // 1. uspjeh
  const page = await freshPage(width);
  await page.goto(`${BASE}/ured/role`, { waitUntil: "networkidle0" });
  await shot(page, width, "matrica-uspjeh");

  // 2. greška — prekid samo za /api/roles
  const errorPage = await freshPage(width);
  await errorPage.setRequestInterception(true);
  errorPage.on("request", (request) => {
    if (request.url().includes("/api/roles")) request.abort();
    else request.continue();
  });
  await errorPage.goto(`${BASE}/ured/role`, { waitUntil: "networkidle0" });
  await shot(errorPage, width, "matrica-greska");
  errorPage.removeAllListeners("request");
  await errorPage.setRequestInterception(false).catch(() => {});
  await errorPage.close();

  // 3. učitavanje — zahtjev se drži otvorenim
  const slowPage = await freshPage(width);
  await slowPage.setRequestInterception(true);
  slowPage.on("request", (request) => {
    if (request.url().includes("/api/roles")) return; // namjerno bez odgovora: skeleton ostaje
    request.continue();
  });
  await slowPage.goto(`${BASE}/ured/role`, { waitUntil: "domcontentloaded" });
  await wait(900);
  await shot(slowPage, width, "matrica-ucitavanje");
  await slowPage.close();

  await page.close();
}

/* ------------------------------------------------------- dijalog role i opseg */
for (const width of WIDTHS) {
  // 4. zaštićen red — admin gleda vlasnika: nema akcije ni menija, piše „samo vlasnik".
  //    Ovo je namjerno PRIJE servera: dugme koje ne može proći ne postoji, pa se greška 403
  //    od servisa kroz ekran i ne može dobiti (test je ipak zove direktno).
  const page = await freshPage(width);
  await page.goto(`${BASE}/ured/korisnici`, { waitUntil: "networkidle0" });
  await shot(page, width, "red-zasticen");
  await page.close();

  // 5. dijalog na redu šefa gradilišta — normalan slučaj, sve opcije dostupne
  const editPage = await freshPage(width);
  await editPage.goto(`${BASE}/ured/korisnici`, { waitUntil: "networkidle0" });
  await editPage.evaluate(() => {
    const rows = [...document.querySelectorAll("tr")];
    const row = rows.find((tr) => tr.textContent?.includes("sef@demo.ba"));
    row?.querySelector('button[aria-haspopup="menu"]')?.click();
  });
  await wait(250);
  await editPage.evaluate(() => {
    const item = [...document.querySelectorAll('[role="menuitem"]')].find((button) =>
      button.textContent?.includes("Role i opseg"),
    );
    item?.click();
  });
  await wait(350);
  await shot(editPage, width, "dijalog-role", { fullPage: false });
  await editPage.close();

  // 6. greška U dijalogu — čuvanje padne (mreža prekinuta za PATCH). Poruka ostaje u
  //    dijalogu, forma se ne zatvara: korisnik ne izgubi ono što je izabrao.
  const errorPage = await freshPage(width);
  await errorPage.goto(`${BASE}/ured/korisnici`, { waitUntil: "networkidle0" });
  await errorPage.evaluate(() => {
    const rows = [...document.querySelectorAll("tr")];
    const row = rows.find((tr) => tr.textContent?.includes("sef@demo.ba"));
    row?.querySelector('button[aria-haspopup="menu"]')?.click();
  });
  await wait(250);
  await errorPage.evaluate(() => {
    const item = [...document.querySelectorAll('[role="menuitem"]')].find((button) =>
      button.textContent?.includes("Role i opseg"),
    );
    item?.click();
  });
  await wait(300);
  await errorPage.setRequestInterception(true);
  errorPage.on("request", (request) => {
    if (request.url().includes("/membership")) request.abort();
    else request.continue();
  });
  await errorPage.evaluate(() => {
    const worker = [...document.querySelectorAll("label")]
      .find((label) => label.textContent?.trim() === "Radnik")
      ?.querySelector("input");
    worker?.click();
    const save = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Sačuvaj"),
    );
    save?.click();
  });
  await wait(900);
  await shot(errorPage, width, "dijalog-greska", { fullPage: false });
  errorPage.removeAllListeners("request");
  await errorPage.setRequestInterception(false).catch(() => {});
  await errorPage.close();
}

/* --------------------------------------------------------------- audit trag */
for (const width of WIDTHS) {
  // 1. uspjeh
  const page = await freshPage(width);
  await page.goto(`${BASE}/ured/audit`, { waitUntil: "networkidle0" });
  await shot(page, width, "audit-uspjeh");

  // 2. detalj zapisa
  await page.evaluate(() => {
    const open = [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Otvori");
    open?.click();
  });
  await wait(350);
  await shot(page, width, "audit-detalj", { fullPage: false });
  await page.evaluate(() => {
    const close = [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Zatvori");
    close?.click();
  });
  await wait(200);

  // 3. prazno poslije filtera — radnja koju demo baza nema
  await page.select("#audit-action", "session.revoked_all");
  await wait(700);
  await shot(page, width, "audit-prazno-filter");
  await page.close();

  // 4. greška — prekid za /api/audit
  const errorPage = await freshPage(width);
  await errorPage.setRequestInterception(true);
  errorPage.on("request", (request) => {
    if (request.url().includes("/api/audit")) request.abort();
    else request.continue();
  });
  await errorPage.goto(`${BASE}/ured/audit`, { waitUntil: "networkidle0" });
  await shot(errorPage, width, "audit-greska");
  errorPage.removeAllListeners("request");
  await errorPage.setRequestInterception(false).catch(() => {});
  await errorPage.close();

  // 5. učitavanje
  const slowPage = await freshPage(width);
  await slowPage.setRequestInterception(true);
  slowPage.on("request", (request) => {
    if (request.url().includes("/api/audit")) return;
    request.continue();
  });
  await slowPage.goto(`${BASE}/ured/audit`, { waitUntil: "domcontentloaded" });
  await wait(900);
  await shot(slowPage, width, "audit-ucitavanje");
  await slowPage.close();
}

/* --------------------------------------- zabrana: radnik ne vidi matricu ni trag */
for (const width of WIDTHS) {
  const worker = await authCookies(process.env.WORKER_EMAIL ?? "sef@demo.ba", PASSWORD);
  const page = await freshPage(width, worker.cookies);
  // Server preusmjerava na /pregled — to je i dokaz da ekran nije samo sakriven u meniju.
  await page.goto(`${BASE}/ured/role`, { waitUntil: "networkidle0" });
  await shot(page, width, "zabrana-role");
  await page.close();
}

console.log(`\nUkupno snimaka: ${shots.length}`);
await browser.close();
