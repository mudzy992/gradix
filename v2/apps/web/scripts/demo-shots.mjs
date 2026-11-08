/**
 * Snimci svih stanja ekrana R1a na 360 px i 1440 px (demo, nije dio aplikacije).
 *
 * Zašto skripta u repou: snimci su dokaz koji vlasnik traži, a mora biti ponovljiv.
 * Zavisnosti (puppeteer-core + Chromium) NISU u `package.json` — snimci se prave rijetko.
 *
 * Pokretanje:
 *   npx --yes puppeteer-core@23 @sparticuz/chromium@131   # jednokratno, u temp folderu
 *   DATABASE_URL=... AUTH_SECRET=... BASE=http://127.0.0.1:3140 \
 *     LD_LIBRARY_PATH=/tmp/chlibs/lib node scripts/demo-shots.mjs
 *
 * Izlaz: docs/design/demo-r1a/{360,1440}-<stanje>.png
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "../../docs/design/demo-r1a");
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
async function shot(page, width, name) {
  const file = join(outDir, `${width}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  shots.push(`${width}-${name}.png`);
  console.log("snimljeno:", `${width}-${name}.png`);
}

/** Login kroz API, pa cookie u preglednik — isti put kao pravi korisnik. */
async function authCookies() {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!response.ok) throw new Error(`prijava pala: ${response.status}`);
  const body = await response.json();
  const cookies = response.headers.getSetCookie().map((raw) => {
    const [pair] = raw.split(";");
    const [name, ...rest] = pair.split("=");
    return { name, value: rest.join("="), domain: new URL(BASE).hostname, path: "/" };
  });
  return { cookies, data: body.data };
}

/** Pozivnica i reset link — prave se kroz API, kao što bi admin. */
async function issueLinks(cookies) {
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const users = await (
    await fetch(`${BASE}/api/users`, { headers: { cookie: cookieHeader } })
  ).json();
  const target = users.data.users.find((u) => u.roles.includes("WORKER") || u.roles.includes("SITE_SUPERVISOR"));

  const invite = await (
    await fetch(`${BASE}/api/users/invitations`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieHeader },
      body: JSON.stringify({
        email: `snimak+${Date.now()}@demo.ba`,
        roles: ["WORKER"],
        scope: "COMPANY",
      }),
    })
  ).json();

  const reset = await (
    await fetch(`${BASE}/api/users/${target.id}/reset-password`, {
      method: "POST",
      headers: { cookie: cookieHeader },
    })
  ).json();

  return {
    inviteLink: invite?.data?.link,
    inviteEmail: invite?.data?.email,
    resetLink: reset?.data?.link,
    target,
  };
}

const { cookies, data: session } = await authCookies();
const links = await issueLinks(cookies);

for (const width of WIDTHS) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: width === 360 ? 780 : 900, deviceScaleFactor: 1 });
  await page.setCookie(...cookies);

  // 1. lista korisnika — uspjeh (gusta tabela na 1440, kartice na 360)
  await page.goto(`${BASE}/ured/korisnici`, { waitUntil: "networkidle0" });
  await shot(page, width, "korisnici-uspjeh");

  // 2. prazno stanje poslije filtera
  await page.type('input[aria-label="Traži korisnika"]', "zzz-nema-ovakve-osobe");
  await new Promise((resolve) => setTimeout(resolve, 250));
  await shot(page, width, "korisnici-prazno-filter");

  // 3. greška — prekid mreže na /api/users
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (request.url().includes("/api/users")) request.abort();
    else request.continue();
  });
  await page.goto(`${BASE}/ured/korisnici`, { waitUntil: "networkidle0" });
  await shot(page, width, "korisnici-greska");

  // 4. učitavanje — zahtjev se drži otvorenim
  // Redoslijed je obavezan: prvo skinuti listener, pa tek onda ugasiti interception —
  // inače već poslani zahtjev uhvati handler koji više ne smije `continue()`.
  page.removeAllListeners("request");
  await page.setRequestInterception(false).catch(() => {});
  const slowPage = await browser.newPage();
  await slowPage.setViewport({ width, height: width === 360 ? 780 : 900 });
  await slowPage.setCookie(...cookies);
  await slowPage.setRequestInterception(true);
  slowPage.on("request", (request) => {
    if (request.url().includes("/api/users")) {
      // namjerno ne odgovaramo: skeleton ostaje vidljiv
      return;
    }
    request.continue();
  });
  await slowPage.goto(`${BASE}/ured/korisnici`, { waitUntil: "domcontentloaded" });
  await new Promise((resolve) => setTimeout(resolve, 900));
  await shot(slowPage, width, "korisnici-ucitavanje");
  await slowPage.close();

  // 5. dijalog pozivnice
  page.removeAllListeners("request");
  await page.setRequestInterception(false).catch(() => {});
  const page2 = await browser.newPage();
  await page2.setViewport({ width, height: width === 360 ? 780 : 900 });
  await page2.setCookie(...cookies);
  await page2.goto(`${BASE}/ured/korisnici`, { waitUntil: "networkidle0" });
  await page2.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Pozovi osobu"));
    button?.click();
  });
  await new Promise((resolve) => setTimeout(resolve, 300));
  await shot(page2, width, "pozivnica-dijalog");
  await page2.close();

  // 6. kartica sa izdatim linkom (poslije reset akcije)
  const page3 = await browser.newPage();
  await page3.setViewport({ width, height: width === 360 ? 780 : 900 });
  await page3.setCookie(...cookies);
  await page3.goto(`${BASE}/ured/korisnici`, { waitUntil: "networkidle0" });
  await page3.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Reset lozinke"),
    );
    button?.click();
  });
  await new Promise((resolve) => setTimeout(resolve, 800));
  await shot(page3, width, "link-izdat");
  await page3.close();

  // 7. prijava i greška prijave
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
  await shot(page, width, "prijava");
  await page.type("#email", "pogresan@demo.ba");
  await page.type("#password", "pogresna-lozinka");
  await page.click('button[type="submit"]');
  await new Promise((resolve) => setTimeout(resolve, 600));
  await shot(page, width, "prijava-greska");

  // 7b. limit prijave — brojač je po emailu, pa se troši tuđi (nepostojeći) email da demo
  // nalog ostane funkcionalan. Pet promašaja pa šesti kroz formu: poruka odbrojava.
  await page.evaluate(async (base) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "limit@demo.ba", password: "pogresna" }),
      });
    }
  }, BASE);
  await page.evaluate(() => {
    for (const id of ["email", "password"]) {
      const field = document.getElementById(id);
      if (field) field.value = "";
    }
  });
  await page.type("#email", "limit@demo.ba");
  await page.type("#password", "pogresna-lozinka");
  await page.click('button[type="submit"]');
  await new Promise((resolve) => setTimeout(resolve, 900));
  await shot(page, width, "prijava-limit");

  // 8. postavljanje lozinke preko linka — važeći i nevažeći
  await page.goto(links.inviteLink, { waitUntil: "networkidle0" });
  await shot(page, width, "postavi-lozinku");
  await page.goto(`${BASE}/lozinka/postavi?token=gxi_${"a".repeat(43)}`, { waitUntil: "networkidle0" });
  await shot(page, width, "link-nevazeci");

  await page.close();
}

// 9. obavezna promjena lozinke — treba sesija sa `mustChangePassword`
const mustPage = await browser.newPage();
for (const width of WIDTHS) {
  await mustPage.setViewport({ width, height: width === 360 ? 780 : 900 });
  await mustPage.setCookie(...cookies);
  await mustPage.goto(`${BASE}/lozinka/promjena`, { waitUntil: "networkidle0" });
  await shot(mustPage, width, "promjena-lozinke");
}
await mustPage.close();

console.log(`\nUkupno snimaka: ${shots.length}`);
console.log(`Pozivnica je za ${links.inviteEmail}; reset za ${links.target?.email}; sesija ${session.user.id}`);
await browser.close();
