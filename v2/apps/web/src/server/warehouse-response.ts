import { fail, ok } from "./api";
import type { WarehouseResult } from "./warehouse-service";

export function warehouseResponse<T>(result: WarehouseResult<T>): Response {
  if (result.outcome === "OK") return ok(result.data);
  if (result.code === "STOCK_INSUFFICIENT") return fail("STOCK_INSUFFICIENT", result.message);
  if (result.code === "STOCK_COUNT_IN_PROGRESS") return fail("STOCK_COUNT_IN_PROGRESS", result.message);
  return fail(result.outcome, result.message);
}
