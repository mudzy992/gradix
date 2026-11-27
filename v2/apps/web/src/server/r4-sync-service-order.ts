/**
 * F8 — primjena offline radnje iz radionice (`service_order_action`).
 *
 * Telefon šalje NAMJERU („počni“, „završi sa 2,5 h“, „utrošen dio“), a ne stanje. Sve izvedeno —
 * trenuci, satnica, trošak, zaliha — računa se ovdje, istim funkcijama koje koristi web. Da
 * telefon računa `total_cost`, dva uređaja bi mogla dati dva troška za isti rad.
 *
 * Idempotencija po `actionId`:
 *  - `START`/`WAIT_PARTS` — ponovljeni prelaz u isto stanje je uspjeh (mehaničar nije pogriješio);
 *  - `FINISH` — drugi put daje `SERVICE_ALREADY_DONE`, pa se prijavljuje kao `DUPLICATE`: nema
 *    novog troška ni drugog reda u ledgeru;
 *  - `PART` — `stock_movements` ima djelimični unikat po `(source_type, source_id, item_id)`, pa
 *    drugi push istog ključa vraća `STOCK_ALREADY_POSTED` → `DUPLICATE`.
 */
import type { PoolClient } from "pg";
import type { R4ServiceOrderActionPushItem, R4SyncPushItemResult } from "@gradix/domain";
import { can } from "./permissions";
import { equipmentRecordAllowed, linkedFaultAllowed } from "./equipment-scope";
import { recordPartUsage } from "./service-order-actions";
import { finishOrderFromSync, setOrderStatusFromSync } from "./service-order-sync-actions";
import { encodeSyncCursor } from "./sync-cursor";
import type { SyncOrderActionDeps } from "./r4-sync-service-order-types";

export async function applyServiceOrderAction(
  client: PoolClient,
  deps: SyncOrderActionDeps,
  item: R4ServiceOrderActionPushItem,
): Promise<R4SyncPushItemResult> {
  const { actor, requestHash, reservation, helpers } = deps;

  const appliedResult = (entityId: string | null, version: number | null): R4SyncPushItemResult => ({
    localId: item.localId,
    status: "APPLIED",
    entityId,
    version,
    cursor: encodeSyncCursor(actor.companyId, reservation.cursor_seq),
  });
  const duplicateResult = (): R4SyncPushItemResult => ({
    localId: item.localId,
    status: "DUPLICATE",
    entityId: item.serviceOrderId,
    version: null,
    cursor: encodeSyncCursor(actor.companyId, reservation.cursor_seq),
  });
  const reject = (code: string) =>
    helpers.rejectInTransaction(client, actor, item, requestHash, reservation, {
      localId: item.localId,
      status: "REJECTED",
      entityId: null,
      version: null,
      cursor: null,
      code,
    });
  const finish = async (result: R4SyncPushItemResult): Promise<R4SyncPushItemResult> => {
    await helpers.saveReceipt(client, actor, item, requestHash, result);
    return result;
  };

  /* Dozvola se provjerava u ruti samo za tip stavke `service.manage`; ovdje je druga linija
     odbrane, jer batch može sadržati mješovite tipove. */
  if (!can(actor.roles, "service.manage")) return reject("FORBIDDEN");
  if (!await equipmentRecordAllowed(client, actor, "order", item.serviceOrderId)) return reject("NOT_FOUND");
  if (item.action.kind === "FINISH" && !await linkedFaultAllowed(client, actor, item.serviceOrderId)) return reject("NOT_FOUND");

  /* `FOR UPDATE` drži nalog zaključan kroz radnju: dva telefona ne smiju istovremeno „završiti“
     isti nalog i napraviti dva reda u ledgeru. */
  const order = await client.query<{ status: string; version: number }>(
    `SELECT status, version FROM public.service_orders
      WHERE company_id = $1 AND id = $2
      FOR UPDATE`,
    [actor.companyId, item.serviceOrderId],
  );
  const header = order.rows[0];
  if (!header) return reject("NOT_FOUND");

  if (item.action.kind === "PART") {
    const part = item.action.part!;
    const outcome = await recordPartUsage(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      orderId: item.serviceOrderId,
      itemId: part.itemId,
      quantity: part.quantity,
      unitCostAmount: part.unitCostAmount,
      note: part.note,
      /* `partId` iz `actionId`: ponovni push daje isti `source_id` u kretnji, pa unikat vraća
         `STOCK_ALREADY_POSTED` umjesto druge kretnje. */
      partId: `sop_${item.actionId}`.slice(0, 128),
    });
    if (outcome.outcome === "OK") return finish(appliedResult(item.serviceOrderId, null));
    if (outcome.outcome === "CONFLICT" && outcome.code === "STOCK_ALREADY_POSTED") {
      return finish(duplicateResult());
    }
    return reject(outcome.code);
  }

  if (item.action.kind === "START" || item.action.kind === "WAIT_PARTS") {
    const outcome = await setOrderStatusFromSync(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      orderId: item.serviceOrderId,
      target: item.action.kind === "START" ? "IN_PROGRESS" : "WAITING_PARTS",
      note: item.action.note,
    });
    return outcome.ok
      ? finish(appliedResult(item.serviceOrderId, null))
      : reject(outcome.code);
  }

  // The shared finish operation books the cost in this same transaction.
  const outcome = await finishOrderFromSync(client, {
    companyId: actor.companyId,
    actorId: actor.userId,
    orderId: item.serviceOrderId,
    laborHours: item.action.laborHours,
    externalCostAmount: item.action.externalCostAmount,
    warrantyUntil: item.action.warrantyUntil,
  });
  if (!outcome.ok) {
    return outcome.code === "SERVICE_ALREADY_DONE" ? finish(duplicateResult()) : reject(outcome.code);
  }
  const updated = await client.query<{ version: number; total_cost_cents: string; currency_code: string | null }>(
    `SELECT version, total_cost_cents::text, currency_code
       FROM public.service_orders WHERE company_id = $1 AND id = $2`,
    [actor.companyId, item.serviceOrderId],
  );
  const row = updated.rows[0];
  return finish(appliedResult(item.serviceOrderId, row?.version ?? null));
}
