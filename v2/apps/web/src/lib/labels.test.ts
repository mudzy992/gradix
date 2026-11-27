import { describe, expect, it } from "vitest";
import { DAY_KINDS, OBLIGATION_STATES } from "@gradix/domain";
import { ProjectStatus, PayPeriodStatus, ServiceOrderStatus, PurchaseRequestRow, PurchaseOrderRow, PurchaseInvoiceRow, WarehousesResponse, HseIncidentKind, HseIncidentStatus, ServiceOrderEvent, PayrollLineStatus, MachineFaultRow } from "@gradix/contracts";
import { DAY_KIND_NAMES, OBLIGATION_STATE_LABELS, PROJECT_STATUS_NAMES, PAYROLL_STATUS_NAMES, SERVICE_STATUS_NAMES, REQUEST_STATUS_NAMES, ORDER_STATUS_NAMES, INVOICE_STATUS_NAMES, WAREHOUSE_KIND_NAMES, HSE_KIND_NAMES, HSE_STATUS_NAMES, SERVICE_EVENT_NAMES, PAYROLL_LINE_STATUS_NAMES, FAULT_STATUS_NAMES, labelFor } from "./labels";

describe("Bosanski sistemski rječnik", () => {
  it("pokriva sve vrijednosti iz ugovora i domene bez sirovih kodova", () => {
    const dictionaries = [
      [DAY_KINDS, DAY_KIND_NAMES], [OBLIGATION_STATES, OBLIGATION_STATE_LABELS],
      [ProjectStatus.options, PROJECT_STATUS_NAMES], [PayPeriodStatus.options, PAYROLL_STATUS_NAMES],
      [ServiceOrderStatus.options, SERVICE_STATUS_NAMES], [PurchaseRequestRow.shape.status.options, REQUEST_STATUS_NAMES],
      [PurchaseOrderRow.shape.status.options, ORDER_STATUS_NAMES], [PurchaseInvoiceRow.shape.status.options, INVOICE_STATUS_NAMES],
      [WarehousesResponse.shape.warehouses.element.shape.kind.options, WAREHOUSE_KIND_NAMES],
      [HseIncidentKind.options, HSE_KIND_NAMES], [HseIncidentStatus.options, HSE_STATUS_NAMES],
      [ServiceOrderEvent.shape.kind.options, SERVICE_EVENT_NAMES], [PayrollLineStatus.options, PAYROLL_LINE_STATUS_NAMES],
      [MachineFaultRow.shape.status.options, FAULT_STATUS_NAMES],
    ] as const;
    for (const [values, dictionary] of dictionaries) for (const value of values) {
      expect(labelFor(dictionary, value)).not.toBe("Nepoznato stanje");
      expect(labelFor(dictionary, value)).not.toMatch(/^[A-Z_]+$/);
    }
  });
  it("nepoznata i prazna vrijednost ne glume poznato stanje", () => {
    expect(labelFor(PAYROLL_STATUS_NAMES,"NOVI_KOD")).toBe("Nepoznato stanje");
    expect(labelFor(PAYROLL_STATUS_NAMES,"__proto__")).toBe("Nepoznato stanje");
    expect(labelFor(PAYROLL_STATUS_NAMES,null)).toBe("—");
  });
});
