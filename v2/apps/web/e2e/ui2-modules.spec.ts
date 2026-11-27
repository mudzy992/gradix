import { expect } from "@playwright/test";
import { test } from "./helpers/annotate";
import { E2E_USERS, loginUi, requireE2ePassword } from "./helpers/auth";

test.beforeAll(() => requireE2ePassword());
test.describe("UI-2 navigacija", {tag:["@smoke"]}, () => {
  test("radnik vidi lični pregled i nema uredske radnje",async ({page})=>{
    await loginUi(page,E2E_USERS.worker);
    await expect(page.getByText("Sati ovog mjeseca",{exact:true})).toBeVisible();
    await expect(page.getByText("Preostali godišnji",{exact:true})).toBeVisible();
    await expect(page.getByRole("link",{name:"Moj profil i sigurnost"})).toBeVisible();
    await page.goto("/ured/nabavka");
    await expect(page.getByRole("heading",{name:"Nemate pristup ovoj stranici"})).toBeVisible();
  });
  test("vlasnik otvara tabove i dijaloge bez promjene ruta",async ({page})=>{
    test.setTimeout(180_000);
    await loginUi(page,E2E_USERS.owner);
    await page.goto("/ured/nabavka");
    await expect(page.getByRole("tab",{name:"Zahtjevi",exact:true})).toBeVisible();
    await page.getByRole("button",{name:"+ Novi zahtjev"}).click();
    await expect(page.getByRole("dialog",{name:"Novi zahtjev za nabavku"})).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("tab",{name:"Narudžbenice"}).click();
    await expect(page.getByRole("button",{name:"+ Nova narudžbenica"})).toBeVisible();
    await page.goto("/ured/skladiste");
    await page.getByRole("tab",{name:"Popisi"}).click();
    await page.getByRole("button",{name:"+ Novi popis"}).click();
    await expect(page.getByRole("dialog",{name:"Novi popis"})).toBeVisible();
    await page.keyboard.press("Escape");
    await page.goto("/ured/podizvodjaci");
    await page.getByRole("tab",{name:"Situacije"}).click();
    await page.getByRole("button",{name:"+ Nova situacija"}).click();
    await expect(page.getByRole("dialog",{name:"Nova situacija"})).toBeVisible();
    await page.keyboard.press("Escape");
    await page.goto("/ured/hse");
    await page.getByRole("tab",{name:"Statistika"}).click();
    await expect(page.getByRole("link",{name:"Preuzmi HSE izvještaj (PDF)"})).toBeVisible();
    await page.getByRole("tab",{name:"Incidenti"}).click();
    await page.getByRole("button",{name:"+ Prijavi incident"}).click();
    await expect(page.getByRole("dialog",{name:"Prijavi incident"})).toBeVisible();
  });
});
