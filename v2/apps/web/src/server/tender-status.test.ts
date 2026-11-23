import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseTenderMatrix } from "../../../../quality/parity/tender-matrix.mjs";
import { assertTenderTransition, isTenderStatus, TENDER_STATUSES, type TenderStatus } from "./tender-status";

const matrixPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../.cursor/docs/matrices/tenders/MATRIX.md",
);

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

  it("svaki par statusa slijedi matricu", () => {
    const markdown = readFileSync(matrixPath, "utf8");
    expect(markdown).toContain("| DRAFT | SUBMITTED, WITHDRAWN |");
    expect(markdown).toContain("| SUBMITTED | WON, LOST, WITHDRAWN |");
    expect(markdown).toContain("| WON / LOST / WITHDRAWN | (terminal) |");
    const matrix = parseTenderMatrix(markdown);
    const allowed = new Set(matrix.allowed);
    for (const from of TENDER_STATUSES) {
      for (const to of TENDER_STATUSES) {
        const edge = `${from}>${to}`;
        const legal = from === to || allowed.has(edge);
        if (legal) expect(() => assertTenderTransition(from as TenderStatus, to as TenderStatus)).not.toThrow();
        else expect(() => assertTenderTransition(from as TenderStatus, to as TenderStatus)).toThrow(/TENDER_INVALID_STATUS/);
      }
    }
    for (const edge of matrix.terminal) {
      const from = edge.slice(0, edge.indexOf(">"));
      for (const to of TENDER_STATUSES) {
        if (from === to) continue;
        expect(() => assertTenderTransition(from as TenderStatus, to)).toThrow(/TENDER_INVALID_STATUS/);
      }
    }
  });
});
