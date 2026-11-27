/**
 * E2E: prijava po rolama, meni, odjava, sesija (A4c) + C.1 pregled.
 * Tagovi: @smoke (meni/role), @deep-auth (sesija), @deep-admin (C.1 pregled).
 */
import { expect } from "@playwright/test";
import { test } from "./helpers/annotate";
import { E2E_USERS, loginUi, logoutUi, requireE2ePassword } from "./helpers/auth";
import { ensureNavVisible, navLabels, openModuleTab } from "./helpers/nav";

test.beforeAll(() => {
  requireE2ePassword();
});

test.describe("auth/nav smoke", { tag: ["@smoke"] }, () => {
  test("vlasnik: fokusirani moduli i dozvoljeni tabovi vode na stvarne stranice", async ({ page }) => {
    test.setTimeout(180_000);
    await loginUi(page, E2E_USERS.owner);
    const labels = await navLabels(page);
    expect(labels.length).toBeLessThanOrEqual(10);
    for (const label of ["Projekti", "Radnici i sati", "Mehanizacija", "Postavke"]) expect(labels).toContain(label);
    for (const [module, tab, href] of [
      ["Radnici i sati", "Radni dani", "/ured/radni-dani"],
      ["Postavke", "Korisnici", "/ured/korisnici"],
      ["Projekti", "Partneri", "/ured/partneri"],
      ["Projekti", "Tenderi", "/ured/tenderi"],
      ["Mehanizacija", "Sati mašina", "/ured/sati-masine"],
      ["Mehanizacija", "Gorivo", "/ured/gorivo"],
      ["Mehanizacija", "Ture", "/ured/ture"],
      ["Mehanizacija", "Dnevni pregled", "/ured/dnevni-pregled"],
      ["Mehanizacija", "Kvarovi", "/ured/kvarovi"],
      ["Mehanizacija", "Trošak mašina", "/ured/trosak-masina"],
      ["Postavke", "Kategorije troška", "/ured/postavke/kategorije-troska"],
    ]) await openModuleTab(page, module!, tab!, href!);
    await logoutUi(page);
    await expect(page.getByRole("heading", { name: "Prijava" })).toBeVisible();
  });

  test("računovođa: tabovi su dostupni, ali unos ostaje zabranjen", async ({ page }) => {
    test.setTimeout(180_000);
    await loginUi(page, E2E_USERS.accountant);
    for (const [module, tab, href, heading, button] of [
      ["Mehanizacija", "Sati mašina", "/ured/sati-masine", "Sati mašina", "Novi unos"],
      ["Mehanizacija", "Gorivo", "/ured/gorivo", "Gorivo", "Novi unos"],
      ["Mehanizacija", "Ture", "/ured/ture", "Ture", "Novi unos"],
      ["Mehanizacija", "Dnevni pregled", "/ured/dnevni-pregled", "Dnevni pregled", "Novi unos"],
      ["Mehanizacija", "Kvarovi", "/ured/kvarovi", "Kvarovi", "Novi unos"],
      ["Projekti", "Tenderi", "/ured/tenderi", "Tenderi", "+ Novi tender"],
      ["Postavke", "Kategorije troška", "/ured/postavke/kategorije-troska", "Kategorije troška", "+ Nova kategorija"],
    ]) {
      await openModuleTab(page, module!, tab!, href!);
      await expect(page.getByRole("heading", { name: heading!, exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: button!, exact: true })).toHaveCount(0);
    }
    await openModuleTab(page, "Obračun", "Izvoz sati", "/ured/obracun-sati/sati");
    await expect(page.getByRole("heading", { name: "Izvoz sirovih sati" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Preuzmi CSV" })).toBeVisible();
  });

  test("šef: radni dani su dostupni, korisnička administracija nije", async ({ page }) => {
    await loginUi(page, E2E_USERS.supervisor);
    await openModuleTab(page, "Radnici i sati", "Radni dani", "/ured/radni-dani");
    await ensureNavVisible(page);
    const settings = page.getByRole("navigation", { name: "Glavna navigacija" }).getByRole("link", { name: "Postavke", exact: true });
    if (await settings.count()) {
      await settings.click();
      await expect(page.getByRole("navigation", { name: "Postavke — navigacija" }).getByRole("link", { name: "Korisnici", exact: true })).toHaveCount(0);
    }
  });

  test("profil: korisnički meni otvara sigurnost i dijalog za passkey", async ({ page }) => {
    await loginUi(page, E2E_USERS.owner);
    await page.getByRole("button", { name: /Korisnički meni/ }).click();
    await page.getByRole("menuitem", { name: "Moj profil i sigurnost" }).click();
    await expect(page).toHaveURL(/\/ured\/profil$/);
    await page.getByRole("button", { name: "Dodaj passkey" }).click();
    const dialog = page.getByRole("dialog", { name: "Dodaj passkey" });
    await expect(dialog.getByLabel("Naziv uređaja")).not.toHaveValue("");
    await expect(dialog.getByLabel("Trenutna lozinka")).toBeVisible();
    await expect(dialog.getByLabel(/Kod iz autentikatora/)).toBeVisible();
    await dialog.getByRole("button", { name: "Odustani" }).click();
    await expect(dialog).toHaveCount(0);
  });

  test("radnik: uredske funkcije ostaju zabranjene", async ({ page }) => {
    await loginUi(page, E2E_USERS.worker);
    const labels = await navLabels(page);
    expect(labels).not.toContain("Radnici i sati");
    expect(labels).not.toContain("Obračun");
    await page.goto("/ured/korisnici");
    await expect(page.getByRole("heading", { name: "Nemate pristup ovoj stranici" })).toBeVisible();
    await page.getByRole("link", { name: "Nazad na pregled" }).click();
    await page.waitForURL("**/pregled");
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
    const expired = page.getByRole("link", { name: /^Istekli rokovi(?! blokiraju)/ }).and(page.locator("a.gx-attention-row"));
    await expect(expired).toBeVisible();
    await expect(expired).toHaveAttribute("href", "/ured/rokovi?stanje=isteklo");
    const days = page.getByRole("link", { name: /^Dani za provjeru/ }).and(page.locator("a.gx-attention-row"));
    await expect(days).toBeVisible();
    await expect(days).toHaveAttribute("href", "/ured/radni-dani?filter=za-provjeru");
  });

  test("C.1 vlasnik: klik na red otvara listu već filtriranu (rokovi → isteklo)", async ({ page }) => {
    await loginUi(page, E2E_USERS.owner);
    await page.getByRole("link", { name: /^Istekli rokovi(?! blokiraju)/ }).and(page.locator("a.gx-attention-row")).click();
    await page.waitForURL(/\/ured\/rokovi\?stanje=isteklo$/);
    await expect(page.getByRole("heading", { name: "Rokovi" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Stanje" })).toHaveValue("expired", { timeout: 20_000 });
    await expect(page.getByRole("row").filter({ hasText: "Isteklo" }).first()).toBeVisible();
  });

  test("C.1 vlasnik: klik na dane za provjeru otvara samo dane s oznakom", async ({ page }) => {
    await loginUi(page, E2E_USERS.owner);
    await page.getByRole("link", { name: /^Dani za provjeru/ }).and(page.locator("a.gx-attention-row")).click();
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
