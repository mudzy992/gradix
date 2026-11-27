/** Sesije kao uređaji (spec 01 §1.6) — pravila koja moraju biti ista na webu i mobilnom. */
import { describe, expect, it } from "vitest";
import {
  describeDevice,
  deviceFingerprint,
  isCurrentDevice,
  isSessionActive,
  sessionsToRevokeOthers,
} from "./index";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1";
const WINDOWS_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36";
const WINDOWS_CHROME_NEW = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";

describe("deviceFingerprint", () => {
  it("iPhone Safari i Windows Chrome su različiti uređaji", () => {
    expect(deviceFingerprint(IPHONE)).toBe("ios/safari");
    expect(deviceFingerprint(WINDOWS_CHROME)).toBe("windows/chrome");
  });

  it("nova verzija pretraživača NIJE nov uređaj (inače stara sesija ostane visjeti)", () => {
    expect(deviceFingerprint(WINDOWS_CHROME_NEW)).toBe(deviceFingerprint(WINDOWS_CHROME));
  });

  it("bez UA vraća „unknown“, ne prazan string", () => {
    expect(deviceFingerprint(null)).toBe("unknown");
  });
});

describe("describeDevice", () => {
  it("daje čitljivu oznaku, a ne sirovi UA", () => {
    expect(describeDevice(IPHONE)).toBe("iPhone · Safari");
    expect(describeDevice(WINDOWS_CHROME)).toBe("Windows · Chrome");
    expect(describeDevice(null)).toBe("Nepoznat uređaj");
  });
});

describe("isSessionActive", () => {
  const now = new Date("2026-01-01T12:00:00Z");
  it("opozvana sesija nije aktivna ni ako nije istekla", () => {
    expect(
      isSessionActive({ revokedAt: new Date("2026-01-01T11:00:00Z"), expiresAt: new Date("2027-01-01T00:00:00Z") }, now),
    ).toBe(false);
  });
  it("istekla sesija nije aktivna", () => {
    expect(isSessionActive({ revokedAt: null, expiresAt: new Date("2026-01-01T11:59:00Z") }, now)).toBe(false);
  });
  it("važeća i neopozvana jeste", () => {
    expect(isSessionActive({ revokedAt: null, expiresAt: new Date("2026-02-01T00:00:00Z") }, now)).toBe(true);
  });
});

describe("sessionsToRevokeOthers", () => {
  it("tekuća sesija OSTAJE, ostale idu", () => {
    const sessions = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(sessionsToRevokeOthers(sessions, "b")).toEqual(["a", "c"]);
  });

  it("„ovo je ovaj uređaj“ ide po ID-u sesije, ne po UA", () => {
    expect(isCurrentDevice("b", "b")).toBe(true);
    expect(isCurrentDevice("b", "c")).toBe(false);
  });
});
