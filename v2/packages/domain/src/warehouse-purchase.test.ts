import { describe, expect, it } from "vitest";
import {
  averageIssueCostCents,
  purchaseNeedsApproval,
  stockCountDifference,
  subcontractorContractExceeded,
  subcontractorStatementAmounts,
  warehouseBalance,
} from "./warehouse-purchase";

describe("F10: skladište, nabavka i podizvođači", () => {
  it("transfer prenosi stanje bez promjene ukupnog stanja firme", () => {
    const source = warehouseBalance([{ kind: "IN", quantityMilli: 10000n }, { kind: "OUT", quantityMilli: 2500n }]);
    const target = warehouseBalance([{ kind: "IN", quantityMilli: 2500n }]);
    expect(source).toBe(7500n);
    expect(target).toBe(2500n);
    expect(source + target).toBe(10000n);
  });

  it("popis knjiži potpisanu razliku, naviše i naniže", () => {
    for (const counted of [12500n, 7000n, 10000n]) {
      const difference = stockCountDifference(10000n, counted);
      expect(warehouseBalance([{ kind: "IN", quantityMilli: 10000n }, { kind: "COUNT", quantityMilli: difference }])).toBe(counted);
    }
    expect(() => stockCountDifference(10n, -1n)).toThrow(RangeError);
  });

  it("odbija negativne IN/OUT količine umjesto da obrne smjer kretnje", () => {
    expect(() => warehouseBalance([{ kind: "OUT", quantityMilli: -1n }])).toThrow(RangeError);
    expect(() => warehouseBalance([{ kind: "IN", quantityMilli: -1n }])).toThrow(RangeError);
  });

  it("izlaz vrednuje po prosječnoj nabavnoj cijeni bez float greške", () => {
    expect(averageIssueCostCents(1001n, 3000n, 1500n)).toBe(501n);
    expect(averageIssueCostCents(1000n, 3000n, 1000n)).toBe(333n);
    expect(averageIssueCostCents(0n, 0n, 1000n)).toBeNull();
    expect(averageIssueCostCents(0n, 1000n, 1000n)).toBe(0n);
    expect(() => averageIssueCostCents(-1n, 1n, 1n)).toThrow(RangeError);
  });

  it("prag odobrenja je strogo iznad praga", () => {
    expect(purchaseNeedsApproval(100000n, 100000n)).toBe(false);
    expect(purchaseNeedsApproval(100001n, 100000n)).toBe(true);
    expect(() => purchaseNeedsApproval(-1n, 100000n)).toThrow(RangeError);
  });

  it("računa bruto, zadržavanje, garanciju i neto u feninzima", () => {
    expect(subcontractorStatementAmounts(100001n, 500n, 250n)).toEqual({
      grossCents: 100001n, retentionCents: 5000n, warrantyCents: 2500n, netCents: 92501n,
    });
    expect(subcontractorStatementAmounts(100n, 50n, 50n).netCents).toBe(98n);
    expect(() => subcontractorStatementAmounts(100n, 9000n, 2000n)).toThrow(RangeError);
    expect(() => subcontractorStatementAmounts(1n, 5000n, 5000n)).toThrow(RangeError);
  });

  it("upozorava tek kad zbir odobrenih i nove situacije pređe ugovor", () => {
    expect(subcontractorContractExceeded(700n, 300n, 1000n)).toBe(false);
    expect(subcontractorContractExceeded(700n, 301n, 1000n)).toBe(true);
    expect(() => subcontractorContractExceeded(-1n, 1n, 10n)).toThrow(RangeError);
  });
});
