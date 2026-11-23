/**
 * Pravilo koje je jednom već palo na telefonu: `<Link asChild>` + `style={[a, b]}` = crveni ekran.
 *
 * Grešku ne hvata ni `tsc` ni lint ni web build — vidi se tek pri pokretanju na uređaju. Zato je
 * ovdje test koji PREGLEDA izvor: svako dijete `Link asChild` mora imati jedan stil, ne niz.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { jedanStil } from "./styles";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return full.endsWith(".tsx") ? [full] : [];
  });
}

/** Vraća `[fajl, isječak djeteta]` za svaki `<Link … asChild>` u projektu. */
function asChildChildren(): { file: string; child: string }[] {
  return tsxFiles(SRC).flatMap((file) => {
    const source = readFileSync(file, "utf8");
    const found: { file: string; child: string }[] = [];
    const link = /<Link\b[\s\S]*?>/g;
    for (const match of source.matchAll(link)) {
      if (!/\basChild\b/.test(match[0])) continue;
      found.push({
        file: path.relative(SRC, file),
        // Prvi element poslije otvarajuće oznake linka je dijete koje `<Slot>` klonira.
        child: source.slice(match.index + match[0].length).trimStart().split(">")[0] ?? "",
      });
    }
    return found;
  });
}

describe("stilovi za <Link asChild>", () => {
  it("spaja niz stilova u jedan objekat", () => {
    const spojen = jedanStil({ marginTop: 8 }, { backgroundColor: "transparent" }, undefined);
    expect(Array.isArray(spojen)).toBe(false);
    expect(spojen).toMatchObject({ marginTop: 8, backgroundColor: "transparent" });
  });

  it("nijedno dijete <Link asChild> ne dobija niz stilova", () => {
    const prekrsaji = asChildChildren()
      .filter(({ child }) => /style=\{\[/.test(child))
      .map(({ file, child }) => `${file}: ${child}`);

    expect(prekrsaji, "koristi `jedanStil(...)` iz `src/lib/styles.ts`").toEqual([]);
  });

  it("nađe barem jedan <Link asChild> — inače test ne provjerava ništa", () => {
    expect(asChildChildren().length).toBeGreaterThan(0);
  });
});
