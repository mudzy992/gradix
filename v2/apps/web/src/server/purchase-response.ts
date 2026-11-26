import { fail, ok } from "./api";
import type { WarehouseResult } from "./warehouse-service";

export function purchaseResponse<T>(result: WarehouseResult<T>): Response {
  if (result.outcome === "OK") return ok(result.data);
  if (result.code === "PURCHASE_APPROVAL_REQUIRED") return fail("PURCHASE_APPROVAL_REQUIRED",result.message);
  if (result.code === "INVOICE_ALREADY_REGISTERED") return fail("INVOICE_ALREADY_REGISTERED",result.message);
  if (result.code === "STOCK_INSUFFICIENT") return fail("STOCK_INSUFFICIENT",result.message);
  if (result.code === "STOCK_COUNT_IN_PROGRESS") return fail("STOCK_COUNT_IN_PROGRESS",result.message);
  if (result.code === "MATERIAL_ISSUE_EMPTY") return fail("MATERIAL_ISSUE_EMPTY",result.message);
  if (result.code === "PURCHASE_ALLOCATION_IN_PROGRESS") return fail("PURCHASE_ALLOCATION_IN_PROGRESS",result.message);
  return fail(result.outcome,result.message);
}
