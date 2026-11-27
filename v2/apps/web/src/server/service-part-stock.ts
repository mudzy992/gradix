import type { PoolClient } from "pg";
import { toThousandths } from "@gradix/domain";
import { balanceExpression, lockWarehouse } from "./warehouse-service";
import type { ServiceOutcome } from "./service-order-types";

/** Isti kratki lock i provjera stanja za web i offline utrošak dijelova. */
export async function preparePartStock(client: PoolClient, params: { companyId: string; itemId: string; quantity: string; orderId: string; partId: string }): Promise<ServiceOutcome | null> {
  const warehouse = await client.query<{ id: string }>("SELECT id FROM public.warehouses WHERE company_id=$1 AND kind='CENTRAL'", [params.companyId]);
  const id = warehouse.rows[0]?.id;
  if (!id) return { outcome: "NOT_FOUND", code: "WAREHOUSE_NOT_FOUND", message: "Centralno skladište ne postoji." };
  if (!await lockWarehouse(client, params.companyId, id)) return { outcome: "CONFLICT", code: "STOCK_COUNT_IN_PROGRESS", message: "Popis ili kretnja su u toku." };
  const exists = await client.query("SELECT 1 FROM public.stock_movements WHERE company_id=$1 AND source_type='SERVICE_ORDER' AND source_id=$2 AND item_id=$3", [params.companyId, `${params.orderId}:${params.partId}`, params.itemId]);
  if (exists.rowCount) return { outcome: "CONFLICT", code: "STOCK_ALREADY_POSTED", message: "Taj dio je već proknjižen na nalog — zaliha nije skinuta dvaput." };
  const stock = await client.query<{ balance: string }>(`SELECT ${balanceExpression}::text AS balance FROM public.stock_movements WHERE company_id=$1 AND warehouse_id=$2 AND item_id=$3`, [params.companyId,id,params.itemId]);
  if (toThousandths(stock.rows[0]!.balance) < toThousandths(params.quantity)) return { outcome: "CONFLICT", code: "STOCK_INSUFFICIENT", message: "Nema dovoljno zaliha u centralnom skladištu." };
  return null;
}
