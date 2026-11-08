import { describe, expect, it } from "vitest";
import { SCOPES, SCOPE_LABELS, isScope, resolveScope, visibleProjectIds } from "./scope";

/**
 * Testovi za opseg. Postojeći slučajevi (`COMPANY`, `SELF`) nisu prepisani kad je `PROJECTS`
 * došao u R3 — dodati su novi, jer je i pravilo novo, a ne izmijenjeno.
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

  it("PROJECTS propušta zapise dodijeljenog projekta, za čitanje i izmjenu", () => {
    const actor = { userId: "u1", scope: "PROJECTS" as const, projectIds: ["p1", "p2"] };
    expect(resolveScope(actor, { kind: "read", projectId: "p1" })).toBe(true);
    expect(resolveScope(actor, { kind: "write", projectId: "p2" })).toBe(true);
  });

  it("PROJECTS ne propušta tuđi projekat", () => {
    const actor = { userId: "u1", scope: "PROJECTS" as const, projectIds: ["p1"] };
    expect(resolveScope(actor, { kind: "read", projectId: "p9" })).toBe(false);
    expect(resolveScope(actor, { kind: "write", projectId: "p9" })).toBe(false);
  });

  it("PROJECTS ne propušta zapis BEZ projekta ni radnju nad cijelom firmom", () => {
    const actor = { userId: "u1", scope: "PROJECTS" as const, projectIds: ["p1"] };
    expect(resolveScope(actor, { kind: "read" })).toBe(false);
    expect(resolveScope(actor, { kind: "read", projectId: null })).toBe(false);
    expect(resolveScope(actor, { kind: "company" })).toBe(false);
  });

  it("PROJECTS bez ijedne dodjele ne vidi ništa — i to je različito od COMPANY", () => {
    const actor = { userId: "u1", scope: "PROJECTS" as const };
    expect(resolveScope(actor, { kind: "read", projectId: "p1" })).toBe(false);
    expect(visibleProjectIds(actor)).toEqual([]);
    expect(visibleProjectIds({ userId: "u1", scope: "COMPANY" })).toBeNull();
  });

  it("visibleProjectIds: COMPANY bez filtera, PROJECTS spisak, SELF prazno", () => {
    expect(visibleProjectIds({ userId: "u1", scope: "COMPANY" })).toBeNull();
    expect(visibleProjectIds({ userId: "u1", scope: "PROJECTS", projectIds: ["p1"] })).toEqual(["p1"]);
    expect(visibleProjectIds({ userId: "u1", scope: "SELF" })).toEqual([]);
  });

  it("nepoznat vlasnik je tuđ — nepoznato nije dozvoljeno", () => {
    const actor = { userId: "u1", scope: "SELF" as const };
    expect(resolveScope(actor, { kind: "read" })).toBe(false);
    expect(resolveScope(actor, { kind: "read", ownerId: null })).toBe(false);
    expect(resolveScope(actor, { kind: "read", ownerId: "" })).toBe(false);
  });
});

describe("spisak opsega", () => {
  it("ima tri opsega — PROJECTS je vraćen u R3, kad projekti postoje", () => {
    expect([...SCOPES]).toEqual(["COMPANY", "PROJECTS", "SELF"]);
  });

  it("svaki opseg ima bosanski naziv i objašnjenje", () => {
    for (const scope of SCOPES) {
      expect(SCOPE_LABELS[scope].label.length).toBeGreaterThan(3);
      expect(SCOPE_LABELS[scope].description.length).toBeGreaterThan(20);
    }
  });

  it("isScope prihvata tri opsega i odbija sve drugo", () => {
    expect(isScope("COMPANY")).toBe(true);
    expect(isScope("SELF")).toBe(true);
    expect(isScope("PROJECTS")).toBe(true);
    expect(isScope("company")).toBe(false);
    expect(isScope(null)).toBe(false);
  });
});
