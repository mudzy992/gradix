/**
 * R4a-2 korak a: matrica workdays.resolve, opseg razrješenja i pravilo
 * „strana u sukobu ne razrješava vlastiti sukob“ — bez baze (opseg nad bazom
 * dokazuje workday-review.integration.test.ts).
 */
import { describe, expect, it } from "vitest";
import { can } from "./permissions";
import { canResolveConflict, workdayResolveScopeFor } from "./workday-review";

describe("workdays.resolve (R4a-2 korak a)", () => {
  it("dozvola: OWNER/ADMIN/PM/šef da; ACCOUNTANT i ostali ne", () => {
    for (const role of ["OWNER", "ADMIN", "PROJECT_MANAGER", "SITE_SUPERVISOR"]) {
      expect(can([role], "workdays.resolve"), role).toBe(true);
    }
    for (const role of ["ACCOUNTANT", "WORKER", "DRIVER", "MACHINE_OPERATOR", "MECHANIC"]) {
      expect(can([role], "workdays.resolve"), role).toBe(false);
    }
    // ACCOUNTANT i dalje VIDI cijelu firmu (view bez resolve).
    expect(can(["ACCOUNTANT"], "workdays.view")).toBe(true);
  });

  it("opseg: OWNER/ADMIN cijela firma; PM/šef dodjele; ostali ništa", () => {
    expect(workdayResolveScopeFor(["OWNER"], null)).toEqual({ kind: "company" });
    expect(workdayResolveScopeFor(["ADMIN"], "wrk_x")).toEqual({ kind: "company" });
    expect(workdayResolveScopeFor(["PROJECT_MANAGER"], "wrk_x")).toEqual({ kind: "assignments", viewerWorkerId: "wrk_x" });
    expect(workdayResolveScopeFor(["SITE_SUPERVISOR"], null)).toEqual({ kind: "assignments", viewerWorkerId: null });
    expect(workdayResolveScopeFor(["ACCOUNTANT"], null)).toEqual({ kind: "none" });
    expect(workdayResolveScopeFor(["WORKER"], "wrk_x")).toEqual({ kind: "none" });
  });

  it("strana u sukobu ne razrješava: autor server ili telefon unosa je blokiran", () => {
    const party = ["wrk_server_author", "wrk_phone_author"];
    // Autor telefonskog unosa (šef koji je poslao unos za sebe) ne smije sam odlučiti.
    expect(canResolveConflict({ roles: ["SITE_SUPERVISOR"], resolverWorkerId: "wrk_phone_author", partyWorkerIds: party })).toBe(false);
    // Autor server unosa isto.
    expect(canResolveConflict({ roles: ["ADMIN"], resolverWorkerId: "wrk_server_author", partyWorkerIds: party })).toBe(false);
    // Druga osoba iz ureda smije.
    expect(canResolveConflict({ roles: ["SITE_SUPERVISOR"], resolverWorkerId: "wrk_third", partyWorkerIds: party })).toBe(true);
    // OWNER smije i kad je strana (zadnja instanca).
    expect(canResolveConflict({ roles: ["OWNER"], resolverWorkerId: "wrk_phone_author", partyWorkerIds: party })).toBe(true);
    // Bez dozvole nema razrješenja ni kad nisi strana.
    expect(canResolveConflict({ roles: ["ACCOUNTANT"], resolverWorkerId: "wrk_third", partyWorkerIds: party })).toBe(false);
    // Ured bez povezanog radnika nije strana ni u čijem sukobu.
    expect(canResolveConflict({ roles: ["ADMIN"], resolverWorkerId: null, partyWorkerIds: party })).toBe(true);
  });
});
