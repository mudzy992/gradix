import { describe, expect, it } from "vitest";
import {
  BLOCKING_USAGE_ACTIONS,
  USAGE_ACTIONS,
  canUseEntity,
  usageBlockMessage,
  usageBlocks,
  usageWarningMessage,
} from "./can-use-entity";

const TODAY = "2026-11-23";
const base = {
  entityKind: "MACHINE" as const,
  entityId: "mac_1",
  onDate: TODAY,
};

const obligation = (state: string, blocking = true) => ({
  source: "OBLIGATION" as const,
  label: `REGISTRACIJA (${state})`,
  state,
  blocking,
  referenceId: "obl_1",
});

describe("canUseEntity — matrica radnji", () => {
  const expired = obligation("expired");

  it("blokira assign, haul, machine_hours i tender_submit na isteklu obavezu", () => {
    for (const action of ["assign", "haul", "machine_hours", "tender_submit"] as const) {
      const decision = canUseEntity({ ...base, action, signals: [expired] });
      expect(decision.allowed, action).toBe(false);
      expect(decision.blockers).toHaveLength(1);
      expect(decision.overrideAvailable).toBe(true);
      expect(usageBlockMessage(decision)).toContain("Ne može se nastaviti");
    }
  });

  it("NE blokira gorivo ni radni dan — samo jako upozorenje", () => {
    for (const action of ["fuel", "workday"] as const) {
      const decision = canUseEntity({ ...base, action, signals: [expired] });
      expect(decision.allowed, action).toBe(true);
      expect(decision.blockers).toHaveLength(0);
      expect(decision.warns).toHaveLength(1);
      expect(decision.overrideAvailable).toBe(false);
      expect(usageWarningMessage(decision)).toContain("Unos je dozvoljen");
    }
  });

  it("pending_review, missing i expiring nikad ne blokiraju", () => {
    for (const state of ["pending_review", "missing", "expiring", "valid", "no_expiry"]) {
      for (const action of USAGE_ACTIONS) {
        const decision = canUseEntity({ ...base, action, signals: [obligation(state)] });
        expect(decision.allowed, `${state}/${action}`).toBe(true);
      }
    }
  });

  it("tip koji ne blokira (blocks_assignment = false) ne blokira ni istekao", () => {
    const decision = canUseEntity({
      ...base,
      action: "assign",
      signals: [obligation("expired", false)],
    });
    expect(decision.allowed).toBe(true);
    expect(decision.blockers).toHaveLength(0);
  });

  it("rejected blokira kao i expired", () => {
    const decision = canUseEntity({ ...base, action: "haul", signals: [obligation("rejected")] });
    expect(decision.allowed).toBe(false);
  });
});

describe("canUseEntity — kvar, servis, kategorija", () => {
  it("aktivan kvar NE blokira rad, samo upozorava", () => {
    const decision = canUseEntity({
      ...base,
      action: "machine_hours",
      signals: [{ source: "FAULT", label: "Kvar FS-12", state: "OPEN", blocking: true }],
    });
    expect(decision.allowed).toBe(true);
    expect(decision.warns).toHaveLength(1);
  });

  it("preventivni servis blokira samo uz uključenu opciju firme", () => {
    const signals = [{ source: "MAINTENANCE" as const, label: "Servis 500 h", state: "OVERDUE", blocking: true }];
    expect(canUseEntity({ ...base, action: "machine_hours", signals }).allowed).toBe(false);
    expect(
      canUseEntity({ ...base, action: "machine_hours", signals: [{ ...signals[0]!, blocking: false }] }).allowed,
    ).toBe(true);
  });

  it("vozačka kategorija je upozorenje, ne blokada", () => {
    const decision = canUseEntity({
      ...base,
      action: "haul",
      signals: [{ source: "CATEGORY", label: "Vozačka C", state: "missing", blocking: true }],
    });
    expect(decision.allowed).toBe(true);
  });
});

describe("canUseEntity — iznimke", () => {
  const override = (patch: Partial<{ referenceId: string; action: "assign"; validUntil: string; reason: string }> = {}) => ({
    referenceId: "obl_1",
    action: "assign" as const,
    validUntil: TODAY,
    reason: "Radnik ide na hitnu intervenciju.",
    ...patch,
  });

  it("važeća iznimka pušta, ali ostaje vidljiva kao upozorenje", () => {
    const decision = canUseEntity({
      ...base,
      action: "assign",
      signals: [obligation("expired")],
      overrides: [override()],
    });
    expect(decision.allowed).toBe(true);
    expect(decision.warns[0]).toMatchObject({ overridden: true });
    expect(decision.warns[0]?.reason).toContain("hitnu intervenciju");
  });

  it("istekla iznimka ne pušta (validUntil je uključiv)", () => {
    expect(
      canUseEntity({
        ...base,
        action: "assign",
        signals: [obligation("expired")],
        overrides: [override({ validUntil: "2026-11-22" })],
      }).allowed,
    ).toBe(false);
  });

  it("iznimka za drugu radnju ili drugi subjekt ne pušta", () => {
    expect(
      canUseEntity({
        ...base,
        action: "haul",
        signals: [obligation("expired")],
        overrides: [override()],
      }).allowed,
    ).toBe(false);
    expect(
      canUseEntity({
        ...base,
        action: "assign",
        signals: [obligation("expired")],
        overrides: [override({ referenceId: "obl_2" })],
      }).allowed,
    ).toBe(false);
  });

  it("iznimka bez razloga (kraći od 10 znakova) ne važi", () => {
    expect(
      canUseEntity({
        ...base,
        action: "assign",
        signals: [obligation("expired")],
        overrides: [override({ reason: "ok" })],
      }).allowed,
    ).toBe(false);
  });
});

describe("usageBlocks", () => {
  it("samo četiri radnje blokiraju — tabela je jedina istina", () => {
    expect([...BLOCKING_USAGE_ACTIONS]).toEqual(["assign", "haul", "machine_hours", "tender_submit"]);
    expect(usageBlocks("fuel")).toBe(false);
    expect(usageBlocks("workday")).toBe(false);
  });
});
