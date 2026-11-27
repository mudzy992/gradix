/**
 * F8 — dijeljeni dijelovi servisnog naloga (bez zavisnosti na `service-order-actions.ts`).
 *
 * Zašto zaseban fajl: `service-order-actions.ts` otvara transakciju i zove
 * `service-order-transaction.ts` (završetak), a transakcija mora pročitati trenutno stanje i
 * protumačiti iznos. Da su te dvije funkcije ostale u `actions`, import bi bio kružan; ovdje su
 * najniži sloj i oba fajla ih uvoze bez ciklusa.
 */
import type { PoolClient } from "pg";
import { isServiceOrderStatus, toHundredths, type ServiceOrderStatus } from "@gradix/domain";
import type { ServiceOutcome } from "./service-order-types";

export async function orderStatus(
  client: PoolClient,
  companyId: string,
  orderId: string,
): Promise<
  | { ok: true; status: ServiceOrderStatus }
  | { ok: false; result: ServiceOutcome }
> {
  const row = await client.query<{ status: string }>(
    "SELECT status FROM public.service_orders WHERE company_id = $1 AND id = $2 FOR UPDATE",
    [companyId, orderId],
  );
  const found = row.rows[0];
  if (!found) {
    return {
      ok: false,
      result: { outcome: "NOT_FOUND", code: "NOT_FOUND", message: "Nalog ne postoji." },
    };
  }
  if (!isServiceOrderStatus(found.status)) {
    return {
      ok: false,
      result: { outcome: "CONFLICT", code: "SERVICE_INVALID_STATUS", message: "Nepoznato stanje naloga." },
    };
  }
  return { ok: true, status: found.status };
}

export function parseExternalCost(value: string | null | undefined): bigint | null | "INVALID" {
  if (!value) return null;
  try {
    return toHundredths(value);
  } catch {
    return "INVALID";
  }
}
