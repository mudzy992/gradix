import { describe, expect, it } from "vitest";
import {
  MoneyError,
  add,
  compare,
  money,
  multiplyByInteger,
  roundToCents,
  subtract,
  sum,
  toAmountString,
  zero,
} from "./money.js";

describe("money", () => {
  it("parsira tipične iznose iz niskogradnje", () => {
    expect(toAmountString(money("0", "BAM"))).toBe("0.00");
    expect(toAmountString(money("12", "BAM"))).toBe("12.00");
    expect(toAmountString(money("12.5", "BAM"))).toBe("12.50");
    expect(toAmountString(money("1234.56", "BAM"))).toBe("1234.56");
    expect(toAmountString(money("-7.05", "BAM"))).toBe("-7.05");
  });

  it("odbija unos koji bi tiho promijenio iznos", () => {
    expect(() => money("12.345", "BAM")).toThrow(MoneyError);
    expect(() => money("12,50", "BAM")).toThrow(MoneyError);
    expect(() => money(" 12.50", "BAM")).toThrow(MoneyError);
    expect(() => money("1e3", "BAM")).toThrow(MoneyError);
    expect(() => money("", "BAM")).toThrow(MoneyError);
    expect(() => money("99999999999", "BAM")).toThrow(MoneyError);
  });

  it("ne dozvoljava sabiranje različitih valuta", () => {
    expect(() => add(money("1", "BAM"), money("1", "EUR"))).toThrow(MoneyError);
    expect(() => compare(money("1", "BAM"), money("1", "EUR"))).toThrow(MoneyError);
  });

  it("sabira bez gubitka preciznosti", () => {
    const total = sum([money("0.1", "BAM"), money("0.2", "BAM")]);
    expect(toAmountString(total)).toBe("0.30");
    expect(toAmountString(subtract(money("100", "BAM"), money("33.33", "BAM")))).toBe("66.67");
  });

  it("množi satnicu cijelim brojem", () => {
    expect(toAmountString(multiplyByInteger(money("7.50", "BAM"), 8))).toBe("60.00");
  });

  it("zaokružuje pola naviše na jednom mjestu", () => {
    // 1234,56 × 3 / 7 = 529,0971… → 529,10
    expect(toAmountString(roundToCents(123456n * 3n, 7n, "BAM"))).toBe("529.10");
    expect(toAmountString(roundToCents(1n, 3n, "BAM"))).toBe("0.00");
    expect(toAmountString(roundToCents(2n, 3n, "BAM"))).toBe("0.01");
    expect(toAmountString(roundToCents(-2n, 3n, "BAM"))).toBe("-0.01");
    expect(() => roundToCents(1n, 0n, "BAM")).toThrow(MoneyError);
  });

  it("nula ima valutu", () => {
    expect(toAmountString(zero("EUR"))).toBe("0.00");
  });
});
