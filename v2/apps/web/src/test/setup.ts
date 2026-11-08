/**
 * Zajedničko za testove ekrana: `@testing-library/jest-dom` matcheri, `cleanup` između
 * testova i `matchMedia` (jsdom ga ne implementira, a okvir ga koristi za temu).
 *
 * `matchMedia` je stub koji vraća „svijetla tema po sistemu“ i ne mijenja se; testovi koji
 * provjeravaju prekidač pozivaju `applyTheme` direktno, ne kroz medij.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

afterEach(() => {
  cleanup();
  if (typeof window !== "undefined") window.localStorage.clear();
});
