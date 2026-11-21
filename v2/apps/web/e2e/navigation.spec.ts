/**
 * E2E: prijava po rolama, meni, odjava, sesija (A4c) + C.1 pregled.
 * Tagovi: @smoke (meni/role), @deep-auth (sesija), @deep-admin (C.1 pregled).
 */
import { expect, test } from "@playwright/test";
import { E2E_USERS, loginUi, logoutUi, requireE2ePassword } from "./helpers/auth";
import { navLabels } from "./helpers/nav";

test.beforeAll(() => {
  requireE2ePassword();
});

test.describe("auth/nav smoke", { tag: ["@smoke"] }, () => {
  test("vlasnik: meni sadrži Radne dane i Korisnike; odjava vraća na prijavu", async ({ page }) => {
    await loginUi(page, E2E_USERS.owner);
    const labels = await navLabels(page);
    expect(labels).toContain("Radni dani");
    expect(labels).toContain("Korisnici");
    expect(labels).toContain("Radnici");
    await logoutUi(page);
    await expect(page.getByRole("heading", { name: "Prijava" })).toBeVisible();
  });

  test("radnik: meni nema uredske stavke (ni Radne dane ni Korisnike)", async ({ page }) => {
    await loginUi(page, E2E_USERS.worker);
    const labels = await navLabels(page);
    expect(labels).not.toContain("Radni dani");
    expect(labels).not.toContain("Korisnici");
    expect(labels).not.toContain("Radnici");
  });

  test("zabranjen direktan URL: radnik na /ured/korisnici dobija 403 stranicu", async ({ page }) => {
    await loginUi(page, E2E_USERS.worker);
    await page.goto("/ured/korisnici");
    await expect(page.getByRole("heading", { name: "Nemate pristup ovoj stranici" })).toBeVisible();
    await page.getByRole("link", { name: "Nazad na pregled" }).click();
    await page.waitForURL("**/pregled");
  });

  test("vlasnik i računovođa: meni sadrži Sati mašina", async ({ page }) => {
    await loginUi(page, E2E_USERS.owner);
    expect(await navLabels(page)).toContain("Sati mašina");
    await logoutUi(page);
    await loginUi(page, E2E_USERS.accountant);
    expect(await navLabels(page)).toContain("Sati mašina");
  });

  test("računovođa: na Sati mašina nema dugmeta Novi unos", async ({ page }) => {
    await loginUi(page, E2E_USERS.accountant);
    await page.goto("/ured/sati-masine");
    await expect(page.getByRole("heading", { name: "Sati mašina" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Novi unos" })).toHaveCount(0);
  });

  test("vlasnik i računovođa: stižu do Gorivo iz menija", async ({ page }) => {
    await loginUi(page, E2E_USERS.owner);
    expect(await navLabels(page)).toContain("Gorivo");
    await loginUi(page, E2E_USERS.accountant);
    expect(await navLabels(page)).toContain("Gorivo");
  });

  test("računovođa: na Gorivo nema dugmeta Novi unos", async ({ page }) => {
    await loginUi(page, E2E_USERS.accountant);
    await page.goto("/ured/gorivo");
    await expect(page.getByRole("heading", { name: "Gorivo" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Novi unos" })).toHaveCount(0);
  });

  test("vlasnik i računovođa: stižu do Ture iz menija", async ({ page }) => {
    await loginUi(page, E2E_USERS.owner);
    expect(await navLabels(page)).toContain("Ture");
    await loginUi(page, E2E_USERS.accountant);
    expect(await navLabels(page)).toContain("Ture");
  });

  test("računovođa: na Ture nema dugmeta Novi unos", async ({ page }) => {
    await loginUi(page, E2E_USERS.accountant);
    await page.goto("/ured/ture");
    await expect(page.getByRole("heading", { name: "Ture" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Novi unos" })).toHaveCount(0);
  });

  test("vlasnik i računovođa: stižu do Dnevni pregled iz menija", async ({ page }) => {
    await loginUi(page, E2E_USERS.owner);
    expect(await navLabels(page)).toContain("Dnevni pregled");
    await loginUi(page, E2E_USERS.accountant);
    expect(await navLabels(page)).toContain("Dnevni pregled");
  });

  test("računovođa: na Dnevni pregled nema dugmeta Novi unos", async ({ page }) => {
    await loginUi(page, E2E_USERS.accountant);
    await page.goto("/ured/dnevni-pregled");
    await expect(page.getByRole("heading", { name: "Dnevni pregled" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Novi unos" })).toHaveCount(0);
  });

  test("vlasnik i računovođa: stižu do Kvarovi iz menija", async ({ page }) => {
    await loginUi(page, E2E_USERS.owner);
    expect(await navLabels(page)).toContain("Kvarovi");
    await loginUi(page, E2E_USERS.accountant);
    expect(await navLabels(page)).toContain("Kvarovi");
  });

  test("vlasnik: stiže do Partneri i Tenderi iz menija", async ({ page }) => {
    await loginUi(page, E2E_USERS.owner);
    const labels = await navLabels(page);
    expect(labels).toContain("Partneri");
    expect(labels).toContain("Tenderi");
    await page.goto("/ured/partneri");
    await expect(page.getByRole("heading", { name: "Partneri" })).toBeVisible();
    await page.goto("/ured/tenderi");
    await expect(page.getByRole("heading", { name: "Tenderi" })).toBeVisible();
  });

  test("računovođa: vidi Tenderi, nema dugme Novi tender", async ({ page }) => {
    await loginUi(page, E2E_USERS.accountant);
    expect(await navLabels(page)).toContain("Tenderi");
    await page.goto("/ured/tenderi");
    await expect(page.getByRole("heading", { name: "Tenderi" })).toBeVisible();
    await expect(page.getByRole("button", { name: "+ Novi tender" })).toHaveCount(0);
  });

  test("radnik: ne vidi Partneri ni Tenderi u meniju", async ({ page }) => {
    await loginUi(page, E2E_USERS.worker);
    const labels = await navLabels(page);
    expect(labels).not.toContain("Partneri");
    expect(labels).not.toContain("Tenderi");
  });

  test("računovođa: na Kvarovi nema dugmeta Novi unos", async ({ page }) => {
    await loginUi(page, E2E_USERS.accountant);
    await page.goto("/ured/kvarovi");
    await expect(page.getByRole("heading", { name: "Kvarovi" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Novi unos" })).toHaveCount(0);
  });

  test("vlasnik: stiže do Trošak mašina i Troškovi projekta iz menija", async ({ page }) => {
    await loginUi(page, E2E_USERS.owner);
    const labels = await navLabels(page);
    expect(labels).toContain("Trošak mašina");
    expect(labels).toContain("Troškovi projekta");
    await page.goto("/ured/trosak-masina");
    await expect(page.getByRole("heading", { name: "Trošak mašina" })).toBeVisible();
    await page.goto("/ured/troskovi-projekta");
    await expect(page.getByRole("heading", { name: "Troškovi projekta" })).toBeVisible();
  });

  test("računovođa: vidi Troškovi projekta, nema dugme Knjiži period", async ({ page }) => {
    await loginUi(page, E2E_USERS.accountant);
    expect(await navLabels(page)).toContain("Troškovi projekta");
    await page.goto("/ured/troskovi-projekta");
    await expect(page.getByRole("heading", { name: "Troškovi projekta" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Knjiži period" })).toHaveCount(0);
  });

  test("računovođa: stiže do Obračun sati i vidi Preuzmi CSV", async ({ page }) => {
    await loginUi(page, E2E_USERS.accountant);
    expect(await navLabels(page)).toContain("Obračun sati");
    await page.goto("/ured/obracun-sati");
    await expect(page.getByRole("heading", { name: "Obračun sati" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Preuzmi CSV" })).toBeVisible();
  });

  test("radnik: ne vidi Obračun sati u meniju", async ({ page }) => {
    await loginUi(page, E2E_USERS.worker);
    expect(await navLabels(page)).not.toContain("Obračun sati");
  });

  test("šef: vidi Radnike i Radne dane, ne vidi Korisnike", async ({ page }) => {
    await loginUi(page, E2E_USERS.supervisor);
    const labels = await navLabels(page);
    expect(labels).toContain("Radnici");
    expect(labels).toContain("Radni dani");
    expect(labels).not.toContain("Korisnici");
  });
});

test.describe("auth session deep", { tag: ["@deep", "@deep-auth"] }, () => {
  test("A1e regresija: odjava pa ponovna prijava u istom kontekstu uspjeva", async ({ page }) => {
    await loginUi(page, E2E_USERS.owner);
    await logoutUi(page);
    await expect(page.getByRole("heading", { name: "Prijava" })).toBeVisible();
    await loginUi(page, E2E_USERS.owner);
    await expect(page.getByRole("navigation", { name: "Glavna navigacija" })).toBeVisible();
    await logoutUi(page);
    await loginUi(page, E2E_USERS.admin);
    await expect(page.getByRole("navigation", { name: "Glavna navigacija" })).toBeVisible();
  });

  test("istek/opoziv sesije: drugi tab završava na prijavi", async ({ browser }) => {
    const context = await browser.newContext();
    const tabA = await context.newPage();
    await loginUi(tabA, E2E_USERS.owner);
    const tabB = await context.newPage();
    await tabB.goto("/pregled");
    await expect(tabB.getByRole("navigation", { name: "Glavna navigacija" })).toBeVisible();
    await logoutUi(tabA);
    const status = await tabB.evaluate(async () => (await fetch("/api/me", { cache: "no-store" })).status);
    expect(status).toBe(401);
    await tabB.bringToFront();
    await tabB.evaluate(() => window.dispatchEvent(new Event("focus")));
    await tabB.waitForURL("**/login", { timeout: 15_000 });
    await context.close();
  });
});

test.describe("pregled C.1", { tag: ["@deep", "@deep-admin"] }, () => {
  test("C.1 vlasnik: pregled nudi redove pažnje, sažetak i sinhronizaciju", async ({ page }) => {
    await loginUi(page, E2E_USERS.owner);
    await expect(page.getByRole("heading", { name: "Šta traži pažnju" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sažetak" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Stanje sinhronizacije" })).toBeVisible();
    const expired = page.getByRole("link", { name: /^Istekli rokovi(?! blokiraju)/ });
    await expect(expired).toBeVisible();
    await expect(expired).toHaveAttribute("href", "/ured/rokovi?stanje=isteklo");
    const days = page.getByRole("link", { name: /^Dani za provjeru/ });
    await expect(days).toBeVisible();
    await expect(days).toHaveAttribute("href", "/ured/radni-dani?filter=za-provjeru");
  });

  test("C.1 vlasnik: klik na red otvara listu već filtriranu (rokovi → isteklo)", async ({ page }) => {
    await loginUi(page, E2E_USERS.owner);
    await page.getByRole("link", { name: /^Istekli rokovi(?! blokiraju)/ }).click();
    await page.waitForURL(/\/ured\/rokovi\?stanje=isteklo$/);
    await expect(page.getByRole("heading", { name: "Rokovi" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Stanje" })).toHaveValue("expired");
    await expect(page.getByRole("row").filter({ hasText: "Isteklo" }).first()).toBeVisible();
  });

  test("C.1 vlasnik: klik na dane za provjeru otvara samo dane s oznakom", async ({ page }) => {
    await loginUi(page, E2E_USERS.owner);
    await page.getByRole("link", { name: /^Dani za provjeru/ }).click();
    await page.waitForURL(/\/ured\/radni-dani\?filter=za-provjeru$/);
    await expect(page.getByRole("heading", { name: "Radni dani" })).toBeVisible();
    await expect(page.getByText("Za provjeru", { exact: false }).first()).toBeVisible();
    const rows = await page.getByRole("row").allInnerTexts();
    expect(rows.slice(1).every((text) => text.includes("Za provjeru"))).toBe(true);
  });

  test("C.1 admin (ured): vidi pregled i sinhronizaciju kao vlasnik", async ({ page }) => {
    await loginUi(page, E2E_USERS.admin);
    await expect(page.getByRole("heading", { name: "Šta traži pažnju" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Stanje sinhronizacije" })).toBeVisible();
    await expect(page.getByText("samo vaš opseg")).toHaveCount(0);
  });

  test("C.1 voditelj (PROJECTS opseg): pregled sužen, BEZ sinhronizacije", async ({ page }) => {
    await loginUi(page, E2E_USERS.pm);
    await expect(page.getByRole("heading", { name: "Šta traži pažnju" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Stanje sinhronizacije" })).toHaveCount(0);
    await expect(page.getByText("samo vaš opseg")).toBeVisible();
    await expect(page.getByRole("link", { name: /blokiraju dodjelu/ })).toBeVisible();
  });

  test("C.1 radnik: stari pregled — nema redova pažnje ni sinhronizacije", async ({ page }) => {
    await loginUi(page, E2E_USERS.worker);
    await expect(page.getByRole("heading", { name: "Dobro došli, Amar" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Šta traži pažnju" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Stanje sinhronizacije" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Mehanizacija" })).toBeVisible();
  });
});
