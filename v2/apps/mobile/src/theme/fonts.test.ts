/**
 * Dio 1d: fontovi na nativnom uređaju — dokaz koji CI može dati bez uređaja:
 * svako ime iz `fontFamily` tokena ima stvaran .ttf fajl u assets, a `_layout`
 * ne renderuje sadržaj dok `useFonts` ne završi (nema prvog kadra u sistemskom fontu).
 * Stvarni render na uređaju dokazuje tek snimak iz emulatora (Dio 1c posao).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fontFamily } from "./tokens";

const ASSETS = path.join(process.cwd(), "assets/fonts");
const EXPECTED_FILES: Record<string, string> = {
  [fontFamily.sans]: "manrope-500.ttf",
  [fontFamily.sansSemiBold]: "manrope-600.ttf",
  [fontFamily.sansBold]: "manrope-700.ttf",
  [fontFamily.sansExtraBold]: "manrope-800.ttf",
  [fontFamily.mono]: "plex-mono-500.ttf",
};

describe("fontovi (Dio 1d)", () => {
  it("svako fontFamily ime ima .ttf fajl koji Metro pakuje", () => {
    for (const [family, file] of Object.entries(EXPECTED_FILES)) {
      expect(family.length, "ime fonta").toBeGreaterThan(0);
      expect(existsSync(path.join(ASSETS, file)), file).toBe(true);
    }
  });

  it("_layout čeka useFonts prije sadržaja", () => {
    const layout = readFileSync(path.join(process.cwd(), "src/app/_layout.tsx"), "utf8");
    expect(layout).toContain("useFonts(fontAssets)");
    expect(layout).toContain("if (!loaded)");
  });
});
