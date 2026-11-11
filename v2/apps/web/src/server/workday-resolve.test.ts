import { describe, expect, it } from "vitest";
import { buildDeviceResolutionPayload, validateResolutionReason } from "./workday-resolve";
import { isConflictParty } from "./workday-review";

describe("R4a-2 razrješenje: validacija razloga (server, ne samo UI)", () => {
  it("razlog kraći od 10 znakova ne prolazi; 10+ prolazi; preko 500 ne", () => {
    expect(validateResolutionReason("kratko")).toBe(false);
    expect(validateResolutionReason("  devetznak ")).toBe(false);
    expect(validateResolutionReason("Dupli unos s telefona")).toBe(true);
    expect(validateResolutionReason("x".repeat(501))).toBe(false);
  });
});

describe("R4a-2: payload za uređaj nikad ne nosi internu napomenu", () => {
  it("device payload sadrži razlog i ishod, a interna napomena nema gdje ući", () => {
    const payload = buildDeviceResolutionPayload({
      conflictId: "cnf_1",
      kind: "REJECTED",
      reason: "Unos je duplikat s telefona",
      resolvedByParty: true,
      workEntryId: "we_1",
      oldTimes: { startedAt: "2026-11-10T08:00:00.000Z", endedAt: "2026-11-10T15:30:00.000Z", endState: "KNOWN_END" },
      newTimes: null,
      rejectedEntryId: "we_1",
      acceptedEntryId: null,
      correctedTarget: null,
      localId: "local-1",
      workerId: "wrk_1",
      workDate: "2026-11-10",
    });
    expect(payload.localId).toBe("local-1");
    expect(payload.kind).toBe("REJECTED");
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toMatch(/internal/i);
    expect(payload.reason).toContain("duplikat");
    expect(payload.resolvedByParty).toBe(true);
    expect(Object.keys(payload)).not.toContain("internalNote");
  });
});

describe("R4a-2: strana u sukobu (OWNER oznaka)", () => {
  it("isConflictParty prepoznaje autora bilo kojeg od dva unosa", () => {
    expect(isConflictParty("wrk_1", ["wrk_1", "wrk_2"])).toBe(true);
    expect(isConflictParty("wrk_1", [null, "wrk_2"])).toBe(false);
    expect(isConflictParty("wrk_1", [undefined, "wrk_1"])).toBe(true);
    expect(isConflictParty("wrk_1", ["wrk_2", "wrk_3"])).toBe(false);
    expect(isConflictParty(null, ["wrk_1"])).toBe(false);
  });
});
