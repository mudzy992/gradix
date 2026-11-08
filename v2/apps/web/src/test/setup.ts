/**
 * Zajedničko za testove ekrana (R1c): `@testing-library/jest-dom` matcheri i `cleanup`
 * između testova. Setup se učitava i za integracijske testove — tamo ne smeta, jer ne
 * dira ni bazu ni DOM.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
