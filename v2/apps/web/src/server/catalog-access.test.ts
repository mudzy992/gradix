import { describe, expect, it } from "vitest";
import { catalogAllowed, parsePlatformAdminEmails } from "./catalog-access";

describe("katalog nije javan (Dio 2)", () => {
  it("u razvoju je otvoren i bez prijave", () => {
    expect(catalogAllowed({ nodeEnv: "development", email: null, adminEmailsRaw: "" })).toBe(true);
    expect(catalogAllowed({ nodeEnv: "test", email: null, adminEmailsRaw: "" })).toBe(true);
  });

  it("u produkciji: samo platformski administrator po emailu iz env-a", () => {
    const admins = " admin@gradix.test , drugi@gradix.test";
    expect(catalogAllowed({ nodeEnv: "production", email: "admin@gradix.test", adminEmailsRaw: admins })).toBe(true);
    expect(catalogAllowed({ nodeEnv: "production", email: "Admin@Gradix.test", adminEmailsRaw: admins })).toBe(true);
    expect(catalogAllowed({ nodeEnv: "production", email: "vlasnik@firma.test", adminEmailsRaw: admins })).toBe(false);
    expect(catalogAllowed({ nodeEnv: "production", email: null, adminEmailsRaw: admins })).toBe(false);
    expect(catalogAllowed({ nodeEnv: "production", email: "admin@gradix.test", adminEmailsRaw: "" })).toBe(false);
  });

  it("parsePlatformAdminEmails: odreže razmake, mala slova, prazne unose", () => {
    expect(parsePlatformAdminEmails(" A@x.test,, b@y.test ")).toEqual(["a@x.test", "b@y.test"]);
    expect(parsePlatformAdminEmails(undefined)).toEqual([]);
  });
});
