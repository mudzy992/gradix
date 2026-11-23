/** Navigacija helpers — L1: zatvorene grupe nisu u a11y stablu; <960px drawer. */
import type { Page } from "@playwright/test";

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
  return (await nav.getByRole("link").allInnerTexts()).map((text) => text.trim());
}

export async function gotoOffice(page: Page, href: string): Promise<void> {
  await page.goto(href);
}
