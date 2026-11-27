/** Navigacija helpers — L1: zatvorene grupe nisu u a11y stablu; <960px drawer. */
import { expect, type Page } from "@playwright/test";

/** Na Pixel 5 / uskom viewportu sidebar je drawer — otvori ga prije čitanja linkova. */
export async function ensureNavVisible(page: Page): Promise<void> {
  const openMenu = page.getByRole("button", { name: "Otvori meni" });
  if (await openMenu.isVisible().catch(() => false)) {
    await openMenu.click();
  }
}

export async function expandNavGroups(page: Page): Promise<void> {
  await ensureNavVisible(page);
  const nav = page.getByRole("navigation", { name: "Glavna navigacija" });
  await nav.waitFor({ state: "visible" });
  const groupButtons = nav.getByRole("button");
  const count = await groupButtons.count();
  for (let index = 0; index < count; index += 1) {
    const button = groupButtons.nth(index);
    if ((await button.getAttribute("aria-expanded")) === "false") {
      await button.click({ force: true });
    }
  }
}

export async function navLabels(page: Page): Promise<string[]> {
  await expandNavGroups(page);
  const nav = page.getByRole("navigation", { name: "Glavna navigacija" });
  return await nav.getByRole("link").evaluateAll(links => links.map(link => link.getAttribute("data-label") ?? link.textContent?.trim() ?? ""));
}

export async function gotoOffice(page: Page, href: string): Promise<void> {
  await page.goto(href);
}

/** Navigacija koristi stvarne klikove kroz modul i tab, uključujući mobilni drawer. */
export async function openModuleTab(page: Page, module: string, tab: string, href: string): Promise<void> {
  await ensureNavVisible(page);
  const link = page.getByRole("navigation", { name: "Glavna navigacija" }).locator("a[data-label]").filter({ has: page.locator(`span:text-is("${module}")`) });
  await expect(link).toBeVisible();
  await link.click();
  const tabs = page.getByRole("navigation", { name: `${module} — navigacija` });
  const target = tabs.getByRole("link", { name: tab, exact: true });
  await expect(target).toHaveAttribute("href", href);
  await target.click();
  await expect(page).toHaveURL(new RegExp(`${href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[?#].*)?$`), { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Nemate pristup ovoj stranici" })).toHaveCount(0);
}
