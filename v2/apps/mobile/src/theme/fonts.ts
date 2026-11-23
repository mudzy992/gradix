/* eslint-disable @typescript-eslint/no-require-imports -- `require` je jedini način da Metro
   razriješi `.ttf`; isto pravilo važi za svaki font u React Native projektu. */
import { Asset } from "expo-asset";

/**
 * Fajlovi fontova za `useFonts` (`_layout.tsx`).
 *
 * Kroz `Asset.fromModule` a ne `require(...)` direktno: `require` vraća broj (Metro) ili
 * objekat (web), a `Asset` je jedini oblik koji `useFonts` prima na svim platformama.
 *
 * Odvojeno od `tokens.ts` namjerno: `tokens.ts` čita i Node (vitest).
 */
export const fontAssets = {
  Manrope_500Medium: Asset.fromModule(require("../../assets/fonts/manrope-500.ttf")),
  Manrope_600SemiBold: Asset.fromModule(require("../../assets/fonts/manrope-600.ttf")),
  Manrope_700Bold: Asset.fromModule(require("../../assets/fonts/manrope-700.ttf")),
  Manrope_800ExtraBold: Asset.fromModule(require("../../assets/fonts/manrope-800.ttf")),
  IBMPlexMono_500Medium: Asset.fromModule(require("../../assets/fonts/plex-mono-500.ttf")),
} as const;
