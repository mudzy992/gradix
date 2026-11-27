import { describe, expect, it } from "vitest";
import {
  EMPTY_COST_FORM,
  amountProblem,
  bytesToBase64,
  formProblem,
  headBytes,
  photoFileName,
  toManualCostPayload,
} from "./trosak-model";

const READY = {
  ...EMPTY_COST_FORM,
  projectId: "prj_1",
  categoryId: "cat_gorivo",
  occurredOn: "2026-11-23",
  amount: "120.00",
  attachmentId: "att_1",
};

describe("brzi unos troška", () => {
  it("iznos traži dvije decimale i veći je od nule", () => {
    expect(amountProblem("120.00")).toBeNull();
    expect(amountProblem("120")).toMatch(/dvije decimale/);
    expect(amountProblem("120.000")).toMatch(/dvije decimale/);
    expect(amountProblem("1,20")).toMatch(/dvije decimale/);
    expect(amountProblem("0.00")).toMatch(/veći od nule/);
    expect(amountProblem(" ")).toMatch(/obavezan/);
  });

  it("bez fotografije računa nema slanja", () => {
    expect(formProblem({ ...READY, attachmentId: null })).toMatch(/Uslikajte račun/);
    expect(formProblem(READY)).toBeNull();
  });

  it("tijelo nosi tačan iznos i prilog, a prazna napomena se ne šalje", () => {
    expect(toManualCostPayload(READY)).toEqual({
      projectId: "prj_1",
      categoryId: "cat_gorivo",
      occurredOn: "2026-11-23",
      amount: "120.00",
      attachmentId: "att_1",
    });
    expect(toManualCostPayload({ ...READY, note: "  " })).not.toHaveProperty("note");
    expect(toManualCostPayload({ ...READY, note: "Gorivo za bager" })).toMatchObject({
      note: "Gorivo za bager",
    });
  });

  it("nepotpuna forma ne daje tijelo", () => {
    expect(toManualCostPayload({ ...READY, categoryId: "" })).toBeNull();
  });

  it("base64 je ispravan i ne pada na velikom nizu", () => {
    expect(bytesToBase64(new Uint8Array([0xff, 0xd8, 0xff]))).toBe("/9j/");
    expect(bytesToBase64(new Uint8Array([0x41]))).toBe("QQ==");
    expect(bytesToBase64(new Uint8Array([0x41, 0x42]))).toBe("QUI=");
    // 200 hiljada bajtova: `String.fromCharCode(...bytes)` bi ovdje bacio RangeError.
    expect(() => bytesToBase64(new Uint8Array(200_000))).not.toThrow();
  });

  it("head je prvih 32 bajta, ime fajla nema dvotačke ni razmak", () => {
    expect(headBytes(new Uint8Array(100)).length).toBe(32);
    const name = photoFileName(new Date("2026-11-23T10:11:12.345Z"));
    expect(name).toBe("racun-20261123T101112.jpg");
  });
});
