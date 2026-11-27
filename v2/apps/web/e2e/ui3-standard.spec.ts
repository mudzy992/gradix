import { expect, test } from "@playwright/test";
import { E2E_USERS, loginUi, requireE2ePassword } from "./helpers/auth";

test.beforeAll(() => requireE2ePassword());
test.describe("UI-3A standard", {tag: ["@smoke"]}, () => {
  test("dropdown i tabovi dostupni su tastaturom u svijetloj i tamnoj temi", async ({ page }) => {
    await loginUi(page,E2E_USERS.owner);
    const response=await page.goto("/katalog");
    test.skip(response?.status() === 404, "Katalog je u produkciji dozvoljen samo platformskom administratoru.");
    for (const theme of ["light", "dark"]) {
      await page.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
      const select = page.getByRole("combobox", { name: "Stilizovani izbor" });
      await select.focus();
      await page.keyboard.press("ArrowDown");
      await expect(select).toHaveAttribute("aria-expanded", "true");
      const search=page.getByRole("searchbox",{name:"Pretraži opcije"});
      await expect(search).toBeFocused();
      await search.fill("Treća");
      await expect(page.getByRole("listbox",{name:"Opcije: Stilizovani izbor"}).getByRole("option", { name: "Treća opcija" })).toBeVisible();
      await page.keyboard.press("Enter");
      await expect(select).toHaveText("Treća opcija⌄");
      await select.click();
      await page.keyboard.press("Escape");
      await expect(select).toBeFocused();
      await expect(select).toHaveAttribute("aria-expanded", "false");
    }
    const first=page.getByRole("tab",{name:"Preklopi",exact:true});
    await first.focus();await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab",{name:"Druga kartica"})).toBeFocused();
    await expect(page.getByRole("tabpanel",{name:"Druga kartica"})).toBeVisible();
    await first.click();
    await page.getByRole("button",{name:"Obični modal"}).click();
    const dialog=page.getByRole("dialog",{name:"Obični modal"});
    const dialogSelect=dialog.getByRole("combobox",{name:"Izbor u dijalogu"});
    await dialogSelect.click();
    await expect(dialog.getByRole("searchbox",{name:"Pretraži opcije"})).toBeFocused();
    await dialog.getByRole("option",{name:"Druga",exact:true}).click();
    await expect(dialogSelect).toHaveText("Druga⌄");
    await dialogSelect.click();await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();await expect(dialogSelect).toBeFocused();
    await page.keyboard.press("Escape");await expect(dialog).toBeHidden();
  });
});
