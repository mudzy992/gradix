import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseTenderMatrix } from "../../../../quality/parity/tender-matrix.mjs";
import {
  assertTenderTransition,
  isTenderStatus,
  isTenderTerminal,
  nextTenderStatuses,
  TENDER_STATUSES,
  TENDER_STATUS_LABEL_BS,
  type TenderStatus,
} from "./tender-status";

const matrixPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../.cursor/docs/matrices/tenders/MATRIX.md",
);

describe("tender-status", () => {
  it("dozvoljava OPPORTUNITY→GO_NO_GO i SUBMITTED→WON", () => {
    expect(() => assertTenderTransition("OPPORTUNITY", "GO_NO_GO")).not.toThrow();
    expect(() => assertTenderTransition("SUBMITTED", "WON")).not.toThrow();
    expect(() => assertTenderTransition("OPPORTUNITY", "OPPORTUNITY")).not.toThrow();
  });

  it("zabranjuje preskakanje OPPORTUNITY→WON i povratak iz WON", () => {
    expect(() => assertTenderTransition("OPPORTUNITY", "WON")).toThrow(/TENDER_INVALID_STATUS/);
    expect(() => assertTenderTransition("WON", "SUBMITTED")).toThrow(/TENDER_INVALID_STATUS/);
    expect(() => assertTenderTransition("GO_NO_GO", "SUBMITTED")).toThrow(/TENDER_INVALID_STATUS/);
  });

  it("isTenderStatus poznaje 9 statusa i ne poznaje DRAFT", () => {
    expect(TENDER_STATUSES).toHaveLength(9);
    expect(isTenderStatus("OPPORTUNITY")).toBe(true);
    // `DRAFT` je migriran u `OPPORTUNITY`; stari naziv ne smije više proći.
    expect(isTenderStatus("DRAFT")).toBe(false);
    expect(isTenderStatus("X")).toBe(false);
  });

  it("terminalni statusi nemaju izlaz, otvoreni ga imaju", () => {
    for (const status of ["WON", "LOST", "WITHDRAWN", "CANCELLED"] as TenderStatus[]) {
      expect(isTenderTerminal(status)).toBe(true);
      expect(nextTenderStatuses(status)).toEqual([]);
    }
    expect(isTenderTerminal("PREPARATION")).toBe(false);
    expect(nextTenderStatuses("SUBMITTED")).toContain("EVALUATION");
  });

  it("svaki status ima bosansku oznaku", () => {
    for (const status of TENDER_STATUSES) {
      expect(TENDER_STATUS_LABEL_BS[status].length).toBeGreaterThan(2);
    }
  });

  it("svaki par statusa slijedi matricu", () => {
    const markdown = readFileSync(matrixPath, "utf8");
    expect(markdown).toContain("| OPPORTUNITY | GO_NO_GO, CANCELLED |");
    expect(markdown).toContain("| GO_NO_GO | PREPARATION, CANCELLED |");
    expect(markdown).toContain("| PREPARATION | SUBMITTED, CANCELLED |");
    expect(markdown).toContain("| SUBMITTED | EVALUATION, WON, LOST, WITHDRAWN |");
    expect(markdown).toContain("| EVALUATION | WON, LOST, WITHDRAWN |");
    expect(markdown).toContain("| WON / LOST / WITHDRAWN / CANCELLED | (terminal) |");
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
