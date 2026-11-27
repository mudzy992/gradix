/**
 * TOTP (RFC 6238). Vektori iz RFC-a su jedini način da se dokaže da kod nije „naš kod koji
 * se slaže sam sa sobom“ — Google Authenticator računa po istom RFC-u.
 */
import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  decryptTotpSecret,
  encryptTotpSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  normalizeRecoveryCode,
  totpCode,
  totpStep,
  totpUri,
  verifyTotp,
} from "./totp";

/** RFC 6238, dodatak A — tajna „12345678901234567890“ kao base32. */
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("base32", () => {
  it("kodira i dekodira isto", () => {
    const secret = generateTotpSecret();
    expect(base32Decode(secret).length).toBe(20);
    expect(base32Encode(base32Decode(secret))).toBe(secret);
  });

  it("odbija neispravan znak umjesto da tiho preskoči", () => {
    expect(() => base32Decode("ABC1")).toThrow(/base32/);
  });
});

describe("totpCode — RFC 6238 vektori", () => {
  // RFC daje 8 cifara; prvih 6 su isti kod za 6-cifreni TOTP.
  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ])("T=%i → %s", (seconds, expected) => {
    expect(totpCode(RFC_SECRET, Math.floor(seconds / 30))).toBe(expected);
  });

  it("korak je 30 sekundi", () => {
    expect(totpStep(59_000)).toBe(1);
    expect(totpStep(60_000)).toBe(2);
  });
});

describe("verifyTotp", () => {
  const nowMs = 1_234_567_890_000;
  const code = totpCode(RFC_SECRET, totpStep(nowMs));

  it("prihvata kod iz tekućeg koraka", () => {
    expect(verifyTotp(code, RFC_SECRET, { nowMs })).toMatchObject({ ok: true });
  });

  it("prihvata ±1 korak (telefon i server nisu isti sat)", () => {
    const previous = totpCode(RFC_SECRET, totpStep(nowMs) - 1);
    const next = totpCode(RFC_SECRET, totpStep(nowMs) + 1);
    expect(verifyTotp(previous, RFC_SECRET, { nowMs }).ok).toBe(true);
    expect(verifyTotp(next, RFC_SECRET, { nowMs }).ok).toBe(true);
  });

  it("odbija kod van prozora", () => {
    const old = totpCode(RFC_SECRET, totpStep(nowMs) - 3);
    expect(verifyTotp(old, RFC_SECRET, { nowMs })).toEqual({ ok: false, reason: "MISMATCH" });
  });

  it("odbija ponovnu upotrebu istog koda u istom koraku", () => {
    const result = verifyTotp(code, RFC_SECRET, { nowMs, lastUsedStep: totpStep(nowMs) });
    expect(result).toEqual({ ok: false, reason: "REPLAY" });
  });

  it("odbija pogrešan format prije računanja", () => {
    expect(verifyTotp("12 34", RFC_SECRET, { nowMs })).toEqual({ ok: false, reason: "FORMAT" });
    expect(verifyTotp("abcdef", RFC_SECRET, { nowMs })).toEqual({ ok: false, reason: "FORMAT" });
  });

  it("prihvata kod sa razmakom (korisnik kuca „123 456“)", () => {
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
    expect(verifyTotp(spaced, RFC_SECRET, { nowMs }).ok).toBe(true);
  });
});

describe("šifrovanje tajne", () => {
  it("šifrat se dekodira istim ključem", () => {
    const secret = generateTotpSecret();
    const enc = encryptTotpSecret(secret, "auth-secret-min-32-characters-long!!");
    expect(enc).not.toContain(secret);
    expect(decryptTotpSecret(enc, "auth-secret-min-32-characters-long!!")).toBe(secret);
  });

  it("drugi AUTH_SECRET ne može dešifrovati", () => {
    const enc = encryptTotpSecret(generateTotpSecret(), "auth-secret-min-32-characters-long!!");
    expect(() => decryptTotpSecret(enc, "neki-drugi-secret-isto-dovoljno-dugacak")).toThrow();
  });

  it("izmjena šifrata se detektuje (GCM tag)", () => {
    const secret = generateTotpSecret();
    const enc = encryptTotpSecret(secret, "auth-secret-min-32-characters-long!!");
    const parts = enc.split(".");
    parts[3] = `${parts[3]!.slice(0, -2)}AA`;
    expect(() => decryptTotpSecret(parts.join("."), "auth-secret-min-32-characters-long!!")).toThrow();
  });
});

describe("recovery kodovi", () => {
  it("10 komada, bez dvosmislenih znakova, jedinstveni", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[a-hj-km-np-z2-9]{5}-[a-hj-km-np-z2-9]{5}$/);
  });

  it("unos se normalizuje (razmaci, velika slova)", () => {
    expect(normalizeRecoveryCode(" ABC12-DEF34 ")).toBe("abc12def34");
  });
});

describe("totpUri", () => {
  it("nosi tajnu, izdavaoca i parametre koje authenticator očekuje", () => {
    const uri = totpUri({ secret: "ABC", account: "amir@firma.test", issuer: "Gradix" });
    expect(uri.startsWith("otpauth://totp/Gradix%3Aamir%40firma.test?")).toBe(true);
    expect(uri).toContain("secret=ABC");
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
  });
});
