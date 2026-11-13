/**
 * E2E: prijava po rolama, meni po roli, odjava, istek/opoziv sesije (A4c).
 * Podaci su demo seed (SEED_PASSWORD iz okruženja); testovi ne mijenjaju poslovne podatke.
 */
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = process.env.E2E_PASSWORD ?? "";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Lozinka").fill(PASSWORD);
  await page.getByRole("button", { name: "Prijavi se" }).click();
  await page.waitForURL("**/pregled");
}

async function navLabels(page: Page): Promise<string[]> {
  const nav = page.getByRole("navigation", { name: "Glavna navigacija" });
  return (await nav.getByRole("link").allInnerTexts()).map((text) => text.trim());
}

test.beforeAll(() => {
  if (!PASSWORD) throw new Error("E2E_PASSWORD nije postavljen (demo seed lozinka).");
});

test("vlasnik: meni sadrži Radne dane i Korisnike; odjava vraća na prijavu", async ({ page }) => {
  await login(page, "vlasnik@demo.ba");
  const labels = await navLabels(page);
  expect(labels).toContain("Radni dani");
  expect(labels).toContain("Korisnici");
  expect(labels).toContain("Radnici");

  await page.getByRole("button", { name: /Korisnički meni/ }).click();
  await page.getByRole("menuitem", { name: "Odjavi se" }).click();
  await page.waitForURL("**/login");
  await expect(page.getByRole("heading", { name: "Prijava" })).toBeVisible();
});

test("A1e regresija: odjava pa ponovna prijava u istom kontekstu uspjeva", async ({ page }) => {
  // Originalni bug (mobilni): prijava NAKON odjave vraćala je „Došlo je do greške."
  // (server 500, PG 22P05). Ovdje se ta sekvenca dokazuje na webu u istom
  // kontekstu: stari cookie/tokeni moraju otići, novi moraju raditi.
  await login(page, "vlasnik@demo.ba");

  await page.getByRole("button", { name: /Korisnički meni/ }).click();
  await page.getByRole("menuitem", { name: "Odjavi se" }).click();
  await page.waitForURL("**/login");
  await expect(page.getByRole("heading", { name: "Prijava" })).toBeVisible();

  // Ponovna prijava odmah, bez resetovanja konteksta.
  await login(page, "vlasnik@demo.ba");
  await expect(page.getByRole("navigation", { name: "Glavna navigacija" })).toBeVisible();

  // Još jedan ciklus: ni druga odjava i treća prijava ne smiju pasti.
  await page.getByRole("button", { name: /Korisnički meni/ }).click();
  await page.getByRole("menuitem", { name: "Odjavi se" }).click();
  await page.waitForURL("**/login");
  await login(page, "ured@demo.ba");
  await expect(page.getByRole("navigation", { name: "Glavna navigacija" })).toBeVisible();
});

test("radnik: meni nema uredske stavke (ni Radne dane ni Korisnike)", async ({ page }) => {
  await login(page, "radnik@demo.ba");
  const labels = await navLabels(page);
  expect(labels).not.toContain("Radni dani");
  expect(labels).not.toContain("Korisnici");
  expect(labels).not.toContain("Radnici");
});

test("zabranjen direktan URL: radnik na /ured/korisnici dobija 403 stranicu, ne tihi redirect", async ({ page }) => {
  await login(page, "radnik@demo.ba");
  await page.goto("/ured/korisnici");
  await expect(page.getByRole("heading", { name: "Nemate pristup ovoj stranici" })).toBeVisible();
  await page.getByRole("link", { name: "Nazad na pregled" }).click();
  await page.waitForURL("**/pregled");
});

test("šef: vidi Radnike i Radne dane (svoj opseg), ne vidi Korisnike", async ({ page }) => {
  await login(page, "sef@demo.ba");
  const labels = await navLabels(page);
  expect(labels).toContain("Radnici");
  expect(labels).toContain("Radni dani");
  expect(labels).not.toContain("Korisnici");
});

test("istek/opoziv sesije: drugi tab završava na prijavi", async ({ browser }) => {
  const context = await browser.newContext();
  const tabA = await context.newPage();
  await login(tabA, "vlasnik@demo.ba");

  const tabB = await context.newPage();
  await tabB.goto("/pregled");
  await expect(tabB.getByRole("navigation", { name: "Glavna navigacija" })).toBeVisible();

  // Odjava u tabu A opoziva sesiju (isti cookie u oba taba).
  await tabA.getByRole("button", { name: /Korisnički meni/ }).click();
  await tabA.getByRole("menuitem", { name: "Odjavi se" }).click();
  await tabA.waitForURL("**/login");

  // Dijagnostika granice: bez sesije /api/me mora biti 401 i u drugom tabu.
  const status = await tabB.evaluate(async () => (await fetch("/api/me", { cache: "no-store" })).status);
  expect(status).toBe(401);

  // Tab B pri sljedećoj provjeri sesije (fokus/vidljivost) ide na prijavu.
  await tabB.bringToFront();
  await tabB.evaluate(() => window.dispatchEvent(new Event("focus")));
  await tabB.waitForURL("**/login", { timeout: 15_000 });
  await context.close();
});

/* ================================================================ C.1 pregled */

/**
 * C.1: „šta moram danas uraditi?“ — po roli (odobren dizajn). Demo brojevi se pomiču
 * s datumom, pa testovi NE tvrde tačan broj: tvrde da RED POSTOJI kad podatka ima,
 * da vodi na filtriranu listu i da radik koji ga ne smije vidjeti ne dobija ništa od
 * toga. Sinhronizaciju traži samo vlasnik/admin — voditelj ne smije ni karticu.
 */

test("C.1 vlasnik: pregled nudi redove pažnje, sažetak i sinhronizaciju", async ({ page }) => {
  await login(page, "vlasnik@demo.ba");

  await expect(page.getByRole("heading", { name: "Šta traži pažnju" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sažetak" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Stanje sinhronizacije" })).toBeVisible();

  // Red isteklih rokova postoji (demo uvijek ima istekle) i nosi filter u adresi.
  const expired = page.getByRole("link", { name: /^Istekli rokovi(?! blokiraju)/ });
  await expect(expired).toBeVisible();
  await expect(expired).toHaveAttribute("href", "/ured/rokovi?stanje=isteklo");

  // Red dana za provjeru vodi na filtrirane radne dane (demo ima nepoznat kraj).
  const days = page.getByRole("link", { name: /^Dani za provjeru/ });
  await expect(days).toBeVisible();
  await expect(days).toHaveAttribute("href", "/ured/radni-dani?filter=za-provjeru");
});

test("C.1 vlasnik: klik na red otvara listu već filtriranu (rokovi → isteklo)", async ({ page }) => {
  await login(page, "vlasnik@demo.ba");
  await page.getByRole("link", { name: /^Istekli rokovi(?! blokiraju)/ }).click();
  await page.waitForURL(/\/ured\/rokovi\?stanje=isteklo$/);
  await expect(page.getByRole("heading", { name: "Rokovi" })).toBeVisible();
  // Lista se suzila: selektator stanja pokazuje „Isteklo“, a ne „Sva stanja“.
  await expect(page.getByRole("combobox", { name: "Stanje" })).toHaveValue("expired");
  // Bar jedan red s oznakom isteklog stanja postoji u tabeli.
  await expect(page.getByText("Isteklo").first()).toBeVisible();
});

test("C.1 vlasnik: klik na dane za provjeru otvara samo dane s oznakom", async ({ page }) => {
  await login(page, "vlasnik@demo.ba");
  await page.getByRole("link", { name: /^Dani za provjeru/ }).click();
  await page.waitForURL(/\/ured\/radni-dani\?filter=za-provjeru$/);
  await expect(page.getByRole("heading", { name: "Radni dani" })).toBeVisible();
  await expect(page.getByText("Za provjeru", { exact: false }).first()).toBeVisible();
  // Svaki prikazani red nosi oznaku „Za provjeru“ — filter je pošten prema onome što je obećao.
  const rows = await page.getByRole("row").allInnerTexts();
  expect(rows.slice(1).every((text) => text.includes("Za provjeru"))).toBe(true);
});

test("C.1 admin (ured): vidi pregled i sinhronizaciju kao vlasnik", async ({ page }) => {
  await login(page, "ured@demo.ba");
  await expect(page.getByRole("heading", { name: "Šta traži pažnju" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Stanje sinhronizacije" })).toBeVisible();
  // Opseg firme: bez natpisa „samo vaš opseg“.
  await expect(page.getByText("samo vaš opseg")).toHaveCount(0);
});

test("C.1 voditelj (PROJECTS opseg): pregled sužen, BEZ sinhronizacije", async ({ page }) => {
  await login(page, "voditelj@demo.ba");

  await expect(page.getByRole("heading", { name: "Šta traži pažnju" })).toBeVisible();
  // Kartica sinhronizacije ne postoji — ne ni prazna (design: samo OWNER i ADMIN).
  await expect(page.getByRole("heading", { name: "Stanje sinhronizacije" })).toHaveCount(0);
  // Opseg je istaknut da brojevi ne izgledaju kao greška.
  await expect(page.getByText("samo vaš opseg")).toBeVisible();
  // Blokirana dodjela (BAG-01 je na dionici — u opsegu voditelja) postoji.
  await expect(page.getByRole("link", { name: /blokiraju dodjelu/ })).toBeVisible();
});

test("C.1 radnik: stari pregled — nema redova pažnje ni sinhronizacije", async ({ page }) => {
  await login(page, "radnik@demo.ba");

  await expect(page.getByRole("heading", { name: "Dobro došli, Amar" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Šta traži pažnju" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Stanje sinhronizacije" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Mehanizacija" })).toBeVisible();
});
