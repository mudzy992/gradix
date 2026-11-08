import { describe, expect, it } from "vitest";
import { SCOPES, SCOPE_LABELS, isScope, resolveScope } from "./scope";

/**
 * Testovi za opseg. Namjerno pokrivaju OBA postojeća slučaja i granicu prema R2:
 * kad `PROJECTS` dođe, ovdje se dodaje jedan `it`, a ne prepisuje postojeće.
 */
describe("resolveScope", () => {
  it("COMPANY propušta sve — i tuđe zapise i radnje nad firmom", () => {
    const actor = { userId: "u1", scope: "COMPANY" as const };
    expect(resolveScope(actor, { kind: "read", ownerId: "u2" })).toBe(true);
    expect(resolveScope(actor, { kind: "write", ownerId: "u2" })).toBe(true);
    expect(resolveScope(actor, { kind: "company" })).toBe(true);
  });

  it("SELF propušta samo svoje zapise, za čitanje i izmjenu", () => {
    const actor = { userId: "u1", scope: "SELF" as const };
    expect(resolveScope(actor, { kind: "read", ownerId: "u1" })).toBe(true);
    expect(resolveScope(actor, { kind: "write", ownerId: "u1" })).toBe(true);
  });

  it("SELF ne propušta tuđe zapise", () => {
    const actor = { userId: "u1", scope: "SELF" as const };
    expect(resolveScope(actor, { kind: "read", ownerId: "u2" })).toBe(false);
    expect(resolveScope(actor, { kind: "write", ownerId: "u2" })).toBe(false);
  });

  it("SELF ne propušta radnje nad cijelom firmom", () => {
    expect(resolveScope({ userId: "u1", scope: "SELF" }, { kind: "company" })).toBe(false);
    expect(resolveScope({ userId: "u1", scope: "COMPANY" }, { kind: "company" })).toBe(true);
  });

  it("nepoznat vlasnik je tuđ — nepoznato nije dozvoljeno", () => {
    const actor = { userId: "u1", scope: "SELF" as const };
    expect(resolveScope(actor, { kind: "read" })).toBe(false);
    expect(resolveScope(actor, { kind: "read", ownerId: null })).toBe(false);
    expect(resolveScope(actor, { kind: "read", ownerId: "" })).toBe(false);
  });
});

describe("spisak opsega", () => {
  it("ima tačno dva opsega dok projekti ne postoje (PROJECTS se vraća u R2)", () => {
    expect([...SCOPES]).toEqual(["COMPANY", "SELF"]);
  });

  it("svaki opseg ima bosanski naziv i objašnjenje", () => {
    for (const scope of SCOPES) {
      expect(SCOPE_LABELS[scope].label.length).toBeGreaterThan(3);
      expect(SCOPE_LABELS[scope].description.length).toBeGreaterThan(20);
    }
  });

  it("isScope odbija nepoznato i vrijednost koja je odložena (PROJECTS)", () => {
    expect(isScope("COMPANY")).toBe(true);
    expect(isScope("SELF")).toBe(true);
    expect(isScope("PROJECTS")).toBe(false);
    expect(isScope("company")).toBe(false);
    expect(isScope(null)).toBe(false);
  });
});
