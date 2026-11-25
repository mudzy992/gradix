import { describe, expect, it } from "vitest";
import {
  ORDER_STATUS_LABEL,
  actionPayload,
  canWaitParts,
  mechanicAction,
  mechanicQueue,
  normalizeLaborHours,
  normalizeQuantity,
  partFormProblem,
  type MechanicOrder,
} from "./servis-model";

const order = (overrides: Partial<MechanicOrder> = {}): MechanicOrder => ({
  id: "so_1",
  machineCode: "BAG-01",
  machineName: "Bager",
  description: "Hidraulika",
  status: "APPROVED",
  priority: "MEDIUM",
  assignedToMe: true,
  openedOn: "2026-11-01",
  totalCostAmount: "0.00",
  currencyCode: "BAM",
  ...overrides,
});

describe("red čekanja radionice", () => {
  it("moje naloge stavlja ispred tuđih, pa po prioritetu i starosti", () => {
    const queue = mechanicQueue([
      order({ id: "tudji-kritican", assignedToMe: false, priority: "CRITICAL", openedOn: "2026-10-01" }),
      order({ id: "moj-nizak", priority: "LOW", openedOn: "2026-11-10" }),
      order({ id: "moj-kritican", priority: "CRITICAL", openedOn: "2026-11-05" }),
    ]);
    expect(queue.map((row) => row.id)).toEqual(["moj-kritican", "moj-nizak", "tudji-kritican"]);
  });

  it("završene i otkazane ne prikazuje u redu čekanja", () => {
    expect(mechanicQueue([order({ status: "DONE" }), order({ status: "CANCELLED" })])).toHaveLength(0);
  });

  it("isti prioritet i vlasništvo rješava stariji nalog", () => {
    const queue = mechanicQueue([
      order({ id: "noviji", openedOn: "2026-11-10" }),
      order({ id: "stariji", openedOn: "2026-11-01" }),
    ]);
    expect(queue[0]?.id).toBe("stariji");
  });
});

describe("glavna radnja mehaničara", () => {
  it("planiran nalog nema radnju — nije odobren", () => {
    expect(mechanicAction(order({ status: "PLANNED" }))).toBeNull();
  });

  it("odobren i onaj koji čeka dio počinju rad", () => {
    expect(mechanicAction(order({ status: "APPROVED" }))?.kind).toBe("START");
    expect(mechanicAction(order({ status: "WAITING_PARTS" }))?.label).toBe("Nastavi rad");
  });

  it("u radu je jedina radnja završetak, a čekanje dijela je dostupno", () => {
    expect(mechanicAction(order({ status: "IN_PROGRESS" }))?.kind).toBe("FINISH");
    expect(canWaitParts(order({ status: "IN_PROGRESS" }))).toBe(true);
    expect(canWaitParts(order({ status: "APPROVED" }))).toBe(false);
  });

  it("završen i otkazan nemaju radnju", () => {
    expect(mechanicAction(order({ status: "DONE" }))).toBeNull();
    expect(mechanicAction(order({ status: "CANCELLED" }))).toBeNull();
  });

  it("svaki status ima natpis na ekranu", () => {
    for (const status of ["PLANNED", "APPROVED", "IN_PROGRESS", "WAITING_PARTS", "DONE", "CANCELLED"] as const) {
      expect(ORDER_STATUS_LABEL[status].length).toBeGreaterThan(2);
    }
  });
});

describe("unos sati i količine", () => {
  it("prazno polje znači nula sati, a zarez je decimalni znak", () => {
    expect(normalizeLaborHours("")).toBe("0");
    expect(normalizeLaborHours("2,5")).toBe("2.5");
    expect(normalizeLaborHours("2.50")).toBe("2.50");
  });

  it("odbija sate sa tri decimale i slova", () => {
    expect(normalizeLaborHours("2.555")).toBeNull();
    expect(normalizeLaborHours("dva")).toBeNull();
    expect(normalizeLaborHours("-1")).toBeNull();
  });

  it("količina mora biti veća od nule i do tri decimale", () => {
    expect(normalizeQuantity("1,5")).toBe("1.5");
    expect(normalizeQuantity("0")).toBeNull();
    expect(normalizeQuantity("0.000")).toBeNull();
    expect(normalizeQuantity("1.5000")).toBeNull();
  });

  it("dio bez artikla ili količine ne ulazi u red", () => {
    expect(partFormProblem({ itemId: "", quantity: "1", note: "" })).toContain("šifarnika");
    expect(partFormProblem({ itemId: "itm_1", quantity: "0", note: "" })).toContain("Količina");
    expect(partFormProblem({ itemId: "itm_1", quantity: "2", note: "" })).toBeNull();
  });
});

describe("tijelo radnje", () => {
  it("uvijek nosi sva polja, pa outbox stavka ima isti oblik za svaku radnju", () => {
    const start = actionPayload({ kind: "START" });
    expect(start).toEqual({
      kind: "START",
      laborHours: null,
      externalCostAmount: null,
      warrantyUntil: null,
      note: null,
      part: null,
    });
    expect(actionPayload({ kind: "FINISH", laborHours: "2.5" }).laborHours).toBe("2.5");
    expect(actionPayload({ kind: "WAIT_PARTS", note: "  naručeno  " }).note).toBe("naručeno");
  });
});
