/** Snimci odobrenog R4b dizajna (Step 7 demo): referenca, obje teme, 360 i 1440 px. */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "../../../docs/demo-dizajn");
mkdirSync(outDir, { recursive: true });
const reference = pathToFileURL(join(here, "../../../docs/design/reference.html")).href;

const browser = await puppeteer.launch({
  args: [...chromium.args, "--no-sandbox", "--disable-dev-shm-usage"],
  executablePath: await chromium.executablePath(),
  headless: true,
});
// 1440: cijela sekcija po page temi; 360: svaki artboard zasebno (svijetli pa tamni ekran).
for (const theme of ["light", "dark"]) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1100 });
  await page.goto(`${reference}?theme=${theme}`, { waitUntil: "networkidle0" });
  const section = await page.$("#step7-grupa-reference");
  await section.scrollIntoView();
  await new Promise((resolve) => setTimeout(resolve, 400));
  await section.screenshot({ path: join(outDir, `1440-${theme}-step7-grupa.png`) });
  await page.close();
}
{
  const page = await browser.newPage();
  await page.setViewport({ width: 360, height: 1100 });
  await page.goto(`${reference}?theme=light`, { waitUntil: "networkidle0" });
  const boards = await page.$$("#step7-grupa-reference .r4a-artboard");
  const names = ["light", "dark"];
  for (let i = 0; i < boards.length; i += 1) {
    await boards[i].scrollIntoView();
    await new Promise((resolve) => setTimeout(resolve, 300));
    await boards[i].screenshot({ path: join(outDir, `360-${names[i]}-step7-grupa.png`) });
  }
  await page.close();
}
await browser.close();
console.log("Step 7 demo snimci: docs/demo-dizajn/{360,1440}-{light,dark}-step7-grupa.png");
