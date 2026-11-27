import { describe, expect, it } from "vitest";
import { resolveFuelAmount } from "./fuel-entry-money";

describe("resolveFuelAmount", () => {
  it("polje bez iznosa ostaje nepoznato, a 0.00 i cijena se odbijaju", () => {
    expect(resolveFuelAmount({ canPrice: false, totalAmount: undefined, currency: "BAM" })).toEqual({
      ok: true, cents: null, currency: "BAM",
    });
    expect(resolveFuelAmount({ canPrice: false, totalAmount: "0.00", currency: "BAM" }).ok).toBe(false);
    expect(resolveFuelAmount({ canPrice: false, totalAmount: "50.00", currency: "BAM" }).ok).toBe(false);
  });

  it("ured razlikuje prazno, nulu i negativan iznos", () => {
    expect(resolveFuelAmount({ canPrice: true, totalAmount: "", currency: "BAM" }).ok).toBe(false);
    expect(resolveFuelAmount({ canPrice: true, totalAmount: "0.00", currency: "BAM" })).toEqual({
      ok: true, cents: 0n, currency: "BAM",
    });
    expect(resolveFuelAmount({ canPrice: true, totalAmount: "12.50", currency: "BAM" }).ok).toBe(true);
    expect(resolveFuelAmount({ canPrice: true, totalAmount: "-1.00", currency: "BAM" }).ok).toBe(false);
  });
});
