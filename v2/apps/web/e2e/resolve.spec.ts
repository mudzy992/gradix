/**
 * R4a-2/B E2E: ured sa liste (filteri u adresi) otvori zasebnu stranicu
 * sukoba, razriješi ga, vrati se na listu sa sačuvanim filterima; drugi
 * korisnik (vlasnik) na istoj stranici vidi „već razriješeno" (ko/kada/šta)
 * i ugašene akcije. Demo seed ima 3 sukoba; svako pokretanje u CI-ju kreće
 * od resetovane baze (mjerenje stabilnosti) ili svježeg seeda.
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

test("ured razrješava sukob na zasebnoj stranici, vlasnik vidi već razriješeno", async ({ page, browser }) => {
  await login(page, "ured@demo.ba");
  await page.goto("/ured/sukobi?stanje=OPEN");
  await expect(page.getByRole("heading", { name: "Sukobi radnih dana" })).toBeVisible();
  await expect(page.getByText("Nerazriješeni sukobi")).toBeVisible();

  // Sa liste na zasebnu stranicu detalja; filteri ostaju u adresi.
  await page.getByRole("link", { name: "Otvori" }).first().click();
  await page.waitForURL(/\/ured\/sukobi\/[^?]+\?stanje=OPEN/);
  const detailUrl = page.url();
  await expect(page.getByRole("heading", { name: "Detalj sukoba" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Unos sa servera" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Unos s telefona" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Nazad na listu/ })).toBeVisible();

  // Prihvati server unos uz obavezni razlog (>= 10 znakova; dugme je prije toga zaključano).
  await page.getByRole("button", { name: "Prihvati ovaj unos" }).first().click();
  const confirm = page.getByRole("button", { name: "Prihvati ovaj unos" }).last();
  await expect(confirm).toBeDisabled();
  await page.getByLabel(/Razlog \(vidi ga autor/).fill("Server unos je potvrđen s terena.");
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await expect(page.getByText(/Sukob je razriješen/)).toBeVisible();
  await expect(page.getByText(/Razriješio\/la/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Odbaci uz razlog" })).toBeDisabled();

  // Nazad na listu — filteri iz adrese su sačuvani.
  await page.getByRole("link", { name: /Nazad na listu/ }).click();
  await page.waitForURL(/\/ured\/sukobi\?stanje=OPEN/);
  await expect(page.getByRole("heading", { name: "Sukobi radnih dana" })).toBeVisible();

  // Drugi korisnik (vlasnik) direktnim linkom vidi isto stanje, bez akcija.
  const ctx = await browser.newContext();
  const owner = await ctx.newPage();
  await login(owner, "vlasnik@demo.ba");
  await owner.goto(detailUrl);
  await expect(owner.getByText(/Razriješio\/la Amina Karić/).first()).toBeVisible();
  await expect(owner.getByRole("button", { name: "Prihvati ovaj unos" }).first()).toBeDisabled();
  await expect(owner.getByRole("button", { name: "Odbaci uz razlog" })).toBeDisabled();
  await ctx.close();
});
