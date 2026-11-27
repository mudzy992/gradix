import { describe, expect, it } from "vitest";
import { REVOKED_SESSION_MESSAGE } from "./session-lifecycle";

describe("izgubljen telefon — poruka na uređaju", () => {
  it("opozvana sesija daje jasnu poruku i kaže da neposlani zapisi ostaju na uređaju", () => {
    expect(REVOKED_SESSION_MESSAGE).toContain("sesija je opozvana ili istekla");
    expect(REVOKED_SESSION_MESSAGE).toContain("Prijavite se ponovo");
    expect(REVOKED_SESSION_MESSAGE).toContain("neposlani zapisi ostaju sačuvani");
  });
});
