/**
 * Kompatibilnost: primitivi su u `components/ui/primitives.tsx` (U1 — sve komponente
 * žive u folderu ui/). Ovaj fajl samo re-izvozi da stari uvozi `@/components/ui` rade;
 * novi kod uvozi iz `@/components/ui/index` ili direktno iz podmodula.
 */
export * from "./ui/primitives";
