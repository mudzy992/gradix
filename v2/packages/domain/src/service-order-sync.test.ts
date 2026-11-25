import { describe, expect, it } from "vitest";
import {
  serviceActionOutcomeLabel,
  validServiceOrderActionPayload,
  validServiceOrderPushItem,
  type R4ServiceOrderActionPushItem,
  type ServiceOrderActionPayload,
} from "./r5-service-order-sync";
import { validateR4SyncPush } from "./r4-sync";

const action = (overrides: Partial<ServiceOrderActionPayload> = {}): ServiceOrderActionPayload => ({
  kind: "START",
  laborHours: null,
  externalCostAmount: null,
  warrantyUntil: null,
  note: null,
  part: null,
  ...overrides,
});

const item = (overrides: Partial<R4ServiceOrderActionPushItem> = {}): R4ServiceOrderActionPushItem => ({
  localId: "00000000-0000-4000-8000-00000000000a",
  entityType: "service_order_action",
  actionId: "act_1",
  serviceOrderId: "so_1",
  deviceSentAt: "2026-11-20T08:00:00+01:00",
  action: action(),
  ...overrides,
});

describe("radionička radnja iz telefona — provjera prije reda", () => {
  it("prihvata početak, čekanje, završetak i dio sa ispravnim oblicima", () => {
    expect(validServiceOrderActionPayload(action())).toBe(true);
    expect(validServiceOrderActionPayload(action({ kind: "WAIT_PARTS", note: "naručeno" }))).toBe(true);
    expect(validServiceOrderActionPayload(action({ kind: "FINISH", laborHours: "2.50" }))).toBe(true);
    expect(
      validServiceOrderActionPayload(
        action({
          kind: "PART",
          part: { itemId: "itm_1", quantity: "2.5", unitCostAmount: "12.00", note: null },
        }),
      ),
    ).toBe(true);
  });

  it("odbija sate sa tri decimale, novac bez dvije decimale i datum garancije koji nije datum", () => {
    expect(validServiceOrderActionPayload(action({ kind: "FINISH", laborHours: "2.555" }))).toBe(false);
    expect(validServiceOrderActionPayload(action({ kind: "FINISH", laborHours: "dva" }))).toBe(false);
    expect(
      validServiceOrderActionPayload(action({ kind: "FINISH", externalCostAmount: "120.0" })),
    ).toBe(false);
    expect(
      validServiceOrderActionPayload(action({ kind: "FINISH", warrantyUntil: "20.11.2026" })),
    ).toBe(false);
    expect(
      validServiceOrderActionPayload(action({ kind: "FINISH", warrantyUntil: "2026-11-20" })),
    ).toBe(true);
  });

  it("radnja stanja ne smije nositi dio, a dio ne smije nositi sate", () => {
    expect(
      validServiceOrderActionPayload(
        action({ kind: "START", part: { itemId: "itm_1", quantity: "1", unitCostAmount: null, note: null } }),
      ),
    ).toBe(false);
    expect(
      validServiceOrderActionPayload(
        action({
          kind: "PART",
          laborHours: "2",
          part: { itemId: "itm_1", quantity: "1", unitCostAmount: null, note: null },
        }),
      ),
    ).toBe(false);
  });

  it("početak i čekanje ne nose trošak ni garanciju (samo završetak)", () => {
    expect(validServiceOrderActionPayload(action({ kind: "START", externalCostAmount: "10.00" }))).toBe(false);
    expect(validServiceOrderActionPayload(action({ kind: "WAIT_PARTS", warrantyUntil: "2026-12-01" }))).toBe(
      false,
    );
  });

  it("količina dijela mora biti do tri decimale i veća od nule", () => {
    const part = (quantity: string) =>
      validServiceOrderActionPayload(
        action({ kind: "PART", part: { itemId: "itm_1", quantity, unitCostAmount: null, note: null } }),
      );
    expect(part("1.500")).toBe(true);
    expect(part("1.5000")).toBe(false);
    expect(part("0")).toBe(false);
  });

  it("batch sa radioničkom radnjom prolazi `validateR4SyncPush`", () => {
    const result = validateR4SyncPush([item()]);
    expect(result.ok).toBe(true);
    expect(validServiceOrderPushItem(item())).toBe(true);
    expect(validServiceOrderPushItem(item({ serviceOrderId: "" }))).toBe(false);
    expect(validServiceOrderPushItem(item({ deviceSentAt: "2026-11-20 08:00" }))).toBe(false);
  });
});

describe("ishod radnje na telefonu", () => {
  it("već primijenjeno nije greška — red se zatvara, a ne vrti u istu grešku", () => {
    expect(serviceActionOutcomeLabel("APPLIED").done).toBe(true);
    expect(serviceActionOutcomeLabel("DUPLICATE").done).toBe(true);
    expect(serviceActionOutcomeLabel("CONFLICT", "SERVICE_ALREADY_DONE").done).toBe(true);
    expect(serviceActionOutcomeLabel("CONFLICT", "STOCK_ALREADY_POSTED").done).toBe(true);
  });

  it("odbijeno i nepoznat sukob ostaju za čovjeka", () => {
    expect(serviceActionOutcomeLabel("REJECTED").done).toBe(false);
    expect(serviceActionOutcomeLabel("CONFLICT", "SYNC_VERSION_CONFLICT").done).toBe(false);
  });
});
