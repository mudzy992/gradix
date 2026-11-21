/**
 * Dio 3b — zaštita od klase buga „funkcija iz serverske u klijentsku komponentu"
 * (Pregled/Radni dani pad, CI 42965829962): serverska komponenta (bez "use client")
 * NE smije prosljeđivati funkcije kao propove — React ih ne može serijalizovati i
 * stranica pada tek u runtime-u. Zato u serverskim fajlovima zabranjujemo JSX
 * handlere (onX=), DataTable `cell:`/`actions=` i svaki prop koji je arrow funkcija.
 * Klijentski omotač (npr. machines-table.tsx) je jedino mjesto za to.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_DIR = path.join(process.cwd(), "src/app");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return name.endsWith(".tsx") && !name.endsWith(".test.tsx") ? [full] : [];
  });
}

const FORBIDDEN: { pattern: RegExp; why: string }[] = [
  { pattern: /\bon[A-Z]\w*=\{/, why: "JSX handler (funkcija) u serverskoj komponenti" },
  { pattern: /\bcell:\s*\(/, why: "DataTable cell funkcija u serverskoj komponenti" },
  { pattern: /\bactions=\{\(/, why: "DataTable actions funkcija u serverskoj komponenti" },
  { pattern: /\browKey=\{\(/, why: "DataTable rowKey funkcija u serverskoj komponenti" },
];

describe("granica server/klijent (Dio 3b)", () => {
  it("nijedna serverska komponenta ne prosljeđuje funkcije klijentskim komponentama", () => {
    const violations: string[] = [];
    for (const file of tsxFiles(APP_DIR)) {
      const source = readFileSync(file, "utf8");
      if (source.startsWith('"use client"')) continue;
      for (const { pattern, why } of FORBIDDEN) {
        if (pattern.test(source)) {
          violations.push(`${path.relative(APP_DIR, file)}: ${why}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
