import { describe, expect, it } from "vitest";
import {
  ACCESS_TTL_SECONDS,
  REFRESH_TTL_SECONDS,
  decideRefresh,
  isSessionUsable,
  isValidRefreshTokenFormat,
  refreshExpiry,
} from "./auth";

const now = new Date("2026-11-07T12:00:00Z");

describe("sesija i refresh", () => {
  it("važeća sesija se rotira", () => {
    expect(decideRefresh({ expiresAt: new Date(now.getTime() + 1000), revokedAt: null }, now)).toEqual({
      kind: "rotate",
    });
  });

  it("opozvan token je ponovna upotreba, ne samo nevažeći", () => {
    expect(
      decideRefresh({ expiresAt: new Date(now.getTime() + 1000), revokedAt: now }, now),
    ).toEqual({ kind: "reuse", code: "AUTH_REFRESH_REUSE" });
  });

  it("istekao token se odbija bez signala krađe", () => {
    expect(decideRefresh({ expiresAt: now, revokedAt: null }, now)).toEqual({
      kind: "reject",
      code: "AUTH_REFRESH_INVALID",
    });
  });

  it("nepoznat token se odbija", () => {
    expect(decideRefresh(null, now)).toEqual({ kind: "reject", code: "AUTH_REFRESH_INVALID" });
  });

  it("sesija nije upotrebljiva nakon isteka ni nakon opoziva", () => {
    expect(isSessionUsable({ expiresAt: now, revokedAt: null }, now)).toBe(false);
    expect(isSessionUsable({ expiresAt: new Date(now.getTime() + 1), revokedAt: now }, now)).toBe(false);
    expect(isSessionUsable({ expiresAt: new Date(now.getTime() + 1000), revokedAt: null }, now)).toBe(true);
  });

  it("rokovi su onakvi kakvi pišu u ADR-u", () => {
    expect(ACCESS_TTL_SECONDS).toBe(900);
    expect(refreshExpiry(now).getTime() - now.getTime()).toBe(REFRESH_TTL_SECONDS * 1000);
  });

  it("format refresh tokena je base64url od 48 bajtova", () => {
    expect(isValidRefreshTokenFormat("A".repeat(64))).toBe(true);
    expect(isValidRefreshTokenFormat("A".repeat(63))).toBe(false);
    expect(isValidRefreshTokenFormat("A".repeat(64) + "=")).toBe(false);
    expect(isValidRefreshTokenFormat("")).toBe(false);
  });
});
