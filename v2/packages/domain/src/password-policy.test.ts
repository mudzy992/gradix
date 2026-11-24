/**
 * Politika lozinki (spec 01 §1.4). Testovi pokrivaju ono što se u praksi pokvari:
 * lista postoji ali se ne konsultuje, zamjene slova zaobiđu listu, i identitet u lozinci.
 */
import { describe, expect, it } from "vitest";
import {
  PASSWORD_BLACKLIST,
  PASSWORD_HISTORY_DEPTH,
  PASSWORD_MIN_LENGTH,
  checkPasswordPolicy,
  containsIdentity,
  historyWindow,
  isBlacklistedPassword,
  isPasswordExpired,
  normalizeForBlacklist,
  requires2fa,
  requiresPasswordRotation,
  twoFactorGate,
} from "./index";

describe("lista najčešćih lozinki", () => {
  it("ima 10.000 jedinstvenih zapisa", () => {
    expect(PASSWORD_BLACKLIST).toHaveLength(10_000);
    expect(new Set(PASSWORD_BLACKLIST).size).toBe(10_000);
  });

  it("prepoznaje klasike i njihove varijante sa zamjenama", () => {
    for (const password of ["password", "Password1", "P@ssw0rd", "123456", "qwerty1"]) {
      expect(isBlacklistedPassword(password), password).toBe(true);
    }
  });

  it("ne blokira normalnu lozinku", () => {
    expect(isBlacklistedPassword("Kranjska16Most")).toBe(false);
  });

  it("normalizacija skida velika slova, brojeve-zamjene i interpunkciju", () => {
    expect(normalizeForBlacklist("P@ssw0rd!")).toBe("password");
  });
});

describe("checkPasswordPolicy", () => {
  it("traži minimalnu dužinu, slovo i broj — na bosanskom", () => {
    expect(checkPasswordPolicy({ password: "kratko1" })).toContain(String(PASSWORD_MIN_LENGTH));
    expect(checkPasswordPolicy({ password: "samoSlovaBezBroja" })).toContain("slovo i broj");
    expect(checkPasswordPolicy({ password: "1234567890" })).toContain("slovo i broj");
  });

  it("odbija lozinku sa liste prije nego što uopšte pogleda identitet", () => {
    expect(checkPasswordPolicy({ password: "password123", email: "neko@firma.ba" })).toContain(
      "najčešćih",
    );
  });

  it("odbija email, ime i prezime unutar lozinke", () => {
    expect(checkPasswordPolicy({ password: "amirhodzic1", firstName: "Amir" })).toContain("ime");
    expect(
      checkPasswordPolicy({ password: "hodzicamir9", lastName: "Hodžić" }),
    ).toContain("prezime");
    expect(
      checkPasswordPolicy({ password: "kancelarija9", email: "kancelarija@firma.ba" }),
    ).toContain("email");
  });

  it("kratko ime se ne pretvara u zabranu (Ana u banani nije Ana)", () => {
    expect(containsIdentity("banana1234", { password: "banana1234", firstName: "Ana" })).toBeNull();
  });

  it("propušta lozinku koja prolazi sva pravila", () => {
    expect(
      checkPasswordPolicy({
        password: "Kranjska16Most",
        email: "amir@firma.ba",
        firstName: "Amir",
        lastName: "Hodžić",
      }),
    ).toBeNull();
  });
});

describe("istorija lozinki", () => {
  it("gleda tačno zadnje 3", () => {
    expect(PASSWORD_HISTORY_DEPTH).toBe(3);
    expect(historyWindow(["a", "b", "c", "d"])).toEqual(["a", "b", "c"]);
  });
});

describe("rotacija lozinke poslije 180 dana", () => {
  it("važi samo za uredske role", () => {
    expect(requiresPasswordRotation(["OWNER"])).toBe(true);
    expect(requiresPasswordRotation(["ACCOUNTANT"])).toBe(true);
    expect(requiresPasswordRotation(["WORKER"])).toBe(false);
    expect(requiresPasswordRotation(["SITE_SUPERVISOR", "DRIVER"])).toBe(false);
  });

  it("terenska rola nije istekla ni sa prošlim datumom", () => {
    const past = new Date("2020-01-01T00:00:00Z");
    expect(isPasswordExpired(["WORKER"], past, new Date("2026-01-01T00:00:00Z"))).toBe(false);
    expect(isPasswordExpired(["OWNER"], past, new Date("2026-01-01T00:00:00Z"))).toBe(true);
  });

  it("nema datuma = nema isteka (nov nalog prije prve promjene)", () => {
    expect(isPasswordExpired(["OWNER"], null)).toBe(false);
  });
});

describe("2FA pravila", () => {
  it("obavezna za OWNER, ADMIN, ACCOUNTANT", () => {
    expect(requires2fa(["OWNER"])).toBe(true);
    expect(requires2fa(["ADMIN"])).toBe(true);
    expect(requires2fa(["ACCOUNTANT"])).toBe(true);
    expect(requires2fa(["PROJECT_MANAGER"])).toBe(false);
  });

  it("obavezna rola bez tajne mora na UPARIVANJE, ne na kod", () => {
    expect(twoFactorGate({ roles: ["ADMIN"], totpEnabled: false, mustEnroll: false })).toBe("ENROLL");
  });

  it("resetovana tajna vraća korisnika na uparivanje", () => {
    expect(twoFactorGate({ roles: ["WORKER"], totpEnabled: false, mustEnroll: true })).toBe("ENROLL");
  });

  it("ko je uključio sam, traži kod; ko nije, prolazi bez", () => {
    expect(twoFactorGate({ roles: ["WORKER"], totpEnabled: true, mustEnroll: false })).toBe("VERIFY");
    expect(twoFactorGate({ roles: ["WORKER"], totpEnabled: false, mustEnroll: false })).toBe("NONE");
  });
});
