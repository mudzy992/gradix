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

test("radnik: meni nema uredske stavke (ni Radne dane ni Korisnike)", async ({ page }) => {
  await login(page, "radnik@demo.ba");
  const labels = await navLabels(page);
  expect(labels).not.toContain("Radni dani");
  expect(labels).not.toContain("Korisnici");
  expect(labels).not.toContain("Radnici");
});

test("šef: vidi Radnike, ne vidi Radne dane ni Korisnike", async ({ page }) => {
  await login(page, "sef@demo.ba");
  const labels = await navLabels(page);
  expect(labels).toContain("Radnici");
  expect(labels).not.toContain("Radni dani");
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

  // Tab B pri sljedećoj provjeri sesije (fokus/vidljivost) ide na prijavu.
  await tabB.bringToFront();
  await tabB.waitForURL("**/login", { timeout: 15_000 });
  await context.close();
});
