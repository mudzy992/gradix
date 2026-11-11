/**
 * R4a-2 E2E: ured razrješava sukob iz demo seeda; drugi korisnik (vlasnik)
 * zatim vidi stanje „već razriješeno" (ko/kada/šta) i nema akcija.
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

test.beforeAll(() => {
  if (!PASSWORD) throw new Error("E2E_PASSWORD nije postavljen (demo seed lozinka).");
});

test("ured razrješava sukob, vlasnik vidi već razriješeno", async ({ page, browser }) => {
  await login(page, "ured@demo.ba");
  await page.goto("/ured/sukobi");
  await expect(page.getByRole("heading", { name: "Sukobi radnih dana" })).toBeVisible();

  // Bedž/kartica: brojevi nerazriješenih postoje (demo seed ima 3 sukoba).
  await expect(page.getByText("Nerazriješeni sukobi")).toBeVisible();

  await page.getByRole("button", { name: "Otvori" }).first().click();
  await expect(page.getByText("Unos sa servera")).toBeVisible();
  await expect(page.getByText("Unos s telefona")).toBeVisible();

  // Prihvati server unos uz obavezni razlog (>= 10 znakova; dugme je prije toga zaključano).
  await page.getByRole("button", { name: "Prihvati ovaj unos" }).first().click();
  const confirm = page.getByRole("button", { name: "Prihvati ovaj unos" }).last();
  await expect(confirm).toBeDisabled();
  await page.getByLabel(/Razlog \(vidi ga autor/).fill("Server unos je potvrđen s terena.");
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await expect(page.getByText(/Sukob je razriješen/)).toBeVisible();
  await expect(page.getByText(/Razriješio\/la/)).toBeVisible();

  // Drugi korisnik (vlasnik) vidi isto stanje, bez mogućnosti nove odluke.
  const ctx = await browser.newContext();
  const owner = await ctx.newPage();
  await login(owner, "vlasnik@demo.ba");
  await owner.goto("/ured/sukobi");
  await owner.getByLabel("Stanje").selectOption("RESOLVED");
  await owner.getByRole("button", { name: "Otvori" }).first().click();
  await expect(owner.locator("text=Razriješio/la Amina Karić").first()).toBeVisible();
  await expect(owner.getByRole("button", { name: "Prihvati ovaj unos" })).toBeDisabled();
  await ctx.close();
});
