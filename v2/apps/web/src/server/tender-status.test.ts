import { describe, expect, it } from "vitest";
import { assertTenderTransition, isTenderStatus } from "./tender-status";

describe("tender-status", () => {
  it("dozvoljava DRAFT→SUBMITTED i SUBMITTED→WON", () => {
    expect(() => assertTenderTransition("DRAFT", "SUBMITTED")).not.toThrow();
    expect(() => assertTenderTransition("SUBMITTED", "WON")).not.toThrow();
    expect(() => assertTenderTransition("DRAFT", "DRAFT")).not.toThrow();
  });

  it("zabranjuje DRAFT→WON i povratak iz WON", () => {
    expect(() => assertTenderTransition("DRAFT", "WON")).toThrow(/TENDER_INVALID_STATUS/);
    expect(() => assertTenderTransition("WON", "SUBMITTED")).toThrow(/TENDER_INVALID_STATUS/);
  });

  it("isTenderStatus", () => {
    expect(isTenderStatus("DRAFT")).toBe(true);
    expect(isTenderStatus("X")).toBe(false);
  });
});
