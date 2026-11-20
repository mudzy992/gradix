/** Navigacija helpers — L1: zatvorene grupe nisu u a11y stablu. */
import type { Page } from "@playwright/test";

export async function expandNavGroups(page: Page): Promise<void> {
  const nav = page.getByRole("navigation", { name: "Glavna navigacija" });
  const groupButtons = nav.getByRole("button");
  const count = await groupButtons.count();
  for (let index = 0; index < count; index += 1) {
    const button = groupButtons.nth(index);
    if ((await button.getAttribute("aria-expanded")) === "false") {
      await button.click();
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
