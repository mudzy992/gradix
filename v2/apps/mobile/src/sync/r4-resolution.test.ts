import { describe, expect, it } from "vitest";
import { parseResolutionOutcome, resolutionDisplay, resolutionsByLocalId } from "./r4-resolution";

const payload = {
  id: "cnf_1",
  status: "RESOLVED",
  kind: "REJECTED",
  reason: "Dupli unos istog segmenta s telefona",
  localId: "local-1",
  workerId: "wrk_1",
  workDate: "2026-11-10",
  oldTimes: { startedAt: "2026-11-10T07:00:00.000Z", endedAt: "2026-11-10T14:30:00.000Z", endState: "KNOWN_END" },
  newTimes: null,
  correctedTarget: null,
};

describe("R4a-2 ishod na telefonu", () => {
  it("odbačen unos: labela i razlog koji je ured upisao", () => {
    const outcome = parseResolutionOutcome(payload)!;
    const display = resolutionDisplay(outcome);
    expect(display.label).toBe("Odbačeno");
    expect(display.detail).toContain("razlog: Dupli unos");
  });

  it("ispravljena vremena: bilo → sada u 24 h", () => {
    const outcome = parseResolutionOutcome({
      ...payload,
      kind: "CORRECTED_TIMES",
      correctedTarget: "RECEIVED",
      newTimes: { startedAt: "2026-11-10T07:30:00.000Z", endedAt: "2026-11-10T15:00:00.000Z", endState: "KNOWN_END" },
    })!;
    const display = resolutionDisplay(outcome);
    expect(display.label).toBe("Ispravljeno");
    expect(display.detail).toContain("Vremena je ispravio ured");
    expect(display.detail).toMatch(/bilo \d{2}:\d{2}–\d{2}:\d{2}, sada \d{2}:\d{2}–\d{2}:\d{2}/);
  });

  it("prihvaćen telefonski unos nije odbačen", () => {
    const outcome = parseResolutionOutcome({ ...payload, kind: "ACCEPT_RECEIVED" })!;
    expect(resolutionDisplay(outcome).label).toBe("Prihvaćeno");
  });

  it("interna napomena nema prolaz ni da je neko ubaci u payload", () => {
    const outcome = parseResolutionOutcome({ ...payload, internalNote: "INTERNA TAJNA" })!;
    const display = resolutionDisplay(outcome);
    expect(JSON.stringify(display)).not.toContain("INTERNA");
    expect(JSON.stringify(outcome)).not.toContain("INTERNA");
  });

  it("mapiranje po localId je idempotentno (isti događaj dvaput = isti ishod)", () => {
    const events = [
      { entityType: "sync_conflict", payload },
      { entityType: "sync_conflict", payload },
      { entityType: "work_entry", payload },
    ];
    const map = resolutionsByLocalId(events);
    expect(map.size).toBe(1);
    expect(map.get("local-1")?.label).toBe("Odbačeno");
  });

  it("otvoren sukob (bez RESOLVED) se ne prikazuje kao ishod", () => {
    expect(parseResolutionOutcome({ ...payload, status: "OPEN" })).toBeNull();
  });
});
