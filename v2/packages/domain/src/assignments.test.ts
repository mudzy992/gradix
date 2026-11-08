import { describe, expect, it } from "vitest";
import {
  assignmentBlockMessage,
  checkAssignment,
  isOverrideActive,
  type AssignmentObligation,
  type AssignmentOverride,
} from "./assignments";

/**
 * Kapija R3 (§7.6): mašina sa isteklom registracijom ne može na projekat; iznimka sa razlogom
 * prolazi. Testovi pokrivaju i ono što NE smije blokirati — jer je „uskoro istječe" upozorenje,
 * a ne zabrana.
 */
const today = "2026-11-09";

const obaveza = (over: Partial<AssignmentObligation> = {}): AssignmentObligation => ({
  id: "ob1",
  typeLabel: "Registracija",
  state: "expired",
  blocksAssignment: true,
  ...over,
});

describe("checkAssignment", () => {
  it("istekla blokirajuća obaveza blokira dodjelu", () => {
    const check = checkAssignment([obaveza()], [], today);
    expect(check.blocked).toHaveLength(1);
    expect(check.overridden).toHaveLength(0);
    expect(assignmentBlockMessage(check)).toContain("Registracija");
  });

  it("uskoro istječe NIJE blokada — samo isteklo blokira", () => {
    const check = checkAssignment([obaveza({ state: "expiring" })], [], today);
    expect(check.blocked).toHaveLength(0);
  });

  it("važeća obaveza ne blokira", () => {
    expect(checkAssignment([obaveza({ state: "valid" })], [], today).blocked).toHaveLength(0);
  });

  it("tip koji firma nije označila kao blokirajući ne blokira ni kad je istekao", () => {
    const check = checkAssignment([obaveza({ blocksAssignment: false })], [], today);
    expect(check.blocked).toHaveLength(0);
  });

  it("iznimka sa razlogom pokriva blokadu — i vidi se kao iznimka, ne kao odsustvo blokade", () => {
    const override: AssignmentOverride = {
      obligationId: "ob1",
      reason: "Radnik ide na obuku sljedeće sedmice, posao ne trpi odlaganje.",
      validUntil: "2026-11-30",
    };
    const check = checkAssignment([obaveza()], [override], today);
    expect(check.blocked).toHaveLength(0);
    expect(check.overridden[0]?.reason).toContain("obuku");
  });

  it("istekla iznimka ne važi više", () => {
    const override: AssignmentOverride = {
      obligationId: "ob1",
      reason: "Kratkoročno, dokument je na putu.",
      validUntil: "2026-11-08",
    };
    expect(checkAssignment([obaveza()], [override], today).blocked).toHaveLength(1);
  });

  it("iznimka važi i NA dan isteka (uključivo)", () => {
    const override: AssignmentOverride = {
      obligationId: "ob1",
      reason: "Dokument je na putu, potvrđeno telefonom.",
      validUntil: today,
    };
    expect(checkAssignment([obaveza()], [override], today).blocked).toHaveLength(0);
  });

  it("iznimka bez razloga ne važi — nije iznimka nego tiho gašenje pravila", () => {
    const override: AssignmentOverride = {
      obligationId: "ob1",
      reason: "   kratko ",
      validUntil: "2026-12-31",
    };
    expect(checkAssignment([obaveza()], [override], today).blocked).toHaveLength(1);
  });

  it("iznimka za drugu obavezu ne pokriva ovu", () => {
    const override: AssignmentOverride = {
      obligationId: "ob9",
      reason: "Neko drugi dokument, ne ovaj.",
      validUntil: "2026-12-31",
    };
    expect(checkAssignment([obaveza()], [override], today).blocked).toHaveLength(1);
  });

  it("više blokada odjednom — sve se imenuju u poruci", () => {
    const check = checkAssignment(
      [obaveza(), obaveza({ id: "ob2", typeLabel: "Tehnički pregled" })],
      [],
      today,
    );
    expect(check.blocked).toHaveLength(2);
    expect(assignmentBlockMessage(check)).toContain("Tehnički pregled");
  });

  it("nema blokada → nema poruke", () => {
    expect(assignmentBlockMessage(checkAssignment([], [], today))).toBeNull();
  });
});

describe("isOverrideActive", () => {
  it("poredi po datumu, bez vremenske zone", () => {
    const base = { obligationId: "ob1", reason: "razlog za iznimku" };
    expect(isOverrideActive({ ...base, validUntil: "2026-11-09" }, "2026-11-09")).toBe(true);
    expect(isOverrideActive({ ...base, validUntil: "2026-11-10" }, "2026-11-09")).toBe(true);
    expect(isOverrideActive({ ...base, validUntil: "2026-11-08" }, "2026-11-09")).toBe(false);
  });
});
