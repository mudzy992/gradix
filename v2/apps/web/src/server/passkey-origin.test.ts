import { describe, expect, it } from "vitest";
import { passkeyOrigin } from "./passkey-origin";

describe("WebAuthn trust origin", () => {
  it("uses configured origin, not an attacker-controlled Host", () => {
    expect(passkeyOrigin("evil.test", { NODE_ENV: "production", APP_URL: "https://gradix.ba101.top" })).toEqual({ origin: "https://gradix.ba101.top", rpID: "gradix.ba101.top" });
  });
  it("allows loopback development and rejects untrusted fallbacks, mismatches and insecure deployment", () => {
    expect(passkeyOrigin("localhost:3000", { NODE_ENV: "development" })).toEqual({ origin: "http://localhost:3000", rpID: "localhost" });
    expect(() => passkeyOrigin("evil.test", { NODE_ENV: "development" })).toThrow();
    expect(() => passkeyOrigin("gradix.ba101.top", { NODE_ENV: "production" })).toThrow();
    expect(() => passkeyOrigin(null, { NODE_ENV: "production", APP_URL: "http://gradix.ba101.top" })).toThrow();
    expect(() => passkeyOrigin(null, { NODE_ENV: "test", APP_URL: "https://a.test", NEXT_PUBLIC_APP_URL: "https://b.test" })).toThrow();
    expect(() => passkeyOrigin(null, { NODE_ENV: "test", APP_URL: "https://a.test/path" })).toThrow();
  });
});
