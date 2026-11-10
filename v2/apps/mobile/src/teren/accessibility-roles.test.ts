/**
 * Regresija (telefon, 2026-11-07): accessibilityRole="status" je web/ARIA uloga —
 * react-native-web je prihvata, Android (RCTView) ruši ekran crvenom greškom
 * "Invalid accessibility role value: status". Render testovi to ne vide jer idu
 * kroz web, pa ovaj test čita izvor i odbija svaku ulogu koju RN ne poznaje.
 * Za žive poruke (banner, ishod slanja) koristi se accessibilityLiveRegion.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const VALID_ROLES = new Set([
  "none", "button", "togglebutton", "link", "search", "image", "keyboardkey",
  "text", "adjustable", "imagebutton", "header", "summary", "alert", "checkbox",
  "combobox", "menu", "menubar", "menuitem", "progressbar", "radio", "radiogroup",
  "scrollbar", "slider", "spinbutton", "switch", "tab", "tablist", "toolbar",
  "list", "listitem", "grid", "timer", "marquee",
]);

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsxFiles(path);
    return name.endsWith(".tsx") && !name.includes(".test.") ? [path] : [];
  });
}

describe("accessibilityRole vrijednosti", () => {
  it("sve uloge u ekranima postoje u React Native-u (ne web/ARIA)", () => {
    const srcDir = join(__dirname, "..");
    const offenders: string[] = [];
    for (const file of tsxFiles(srcDir)) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/accessibilityRole="([^"]+)"/g)) {
        if (!VALID_ROLES.has(match[1])) offenders.push(`${file}: "${match[1]}"`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
