/** R5.3: sync push handler for haul. */
import type { PoolClient } from "pg";
import type { R4HaulPushItem, R4SyncPushItemResult } from "@gradix/domain";
import { encodeSyncCursor } from "./sync-cursor";
import { activityRecordAllowed, equipmentTargetAllowed } from "./equipment-scope";
import { bookHaulCost } from "./cost-entry-service";
import { checkUse } from "./usage-service";
import { companyToday } from "./project-service";
import type { SyncHaulApplyDeps } from "./r4-sync-haul-types";

export type { SyncHaulApplyDeps } from "./r4-sync-haul-types";

export async function applyHaulSyncItem(
  client: PoolClient,
  deps: SyncHaulApplyDeps,
  item: R4HaulPushItem,
): Promise<R4SyncPushItemResult> {
  const { actor, worker, requestHash, reservation, helpers } = deps;
  const reject = (result = helpers.invalidItem(item)) =>
    helpers.rejectInTransaction(client, actor, item, requestHash, reservation, result);

  if (!await equipmentTargetAllowed(client, actor, item.haul.projectId, item.haul.machineId))
    return reject(helpers.invalidItem(item, "SYNC_ITEM_REJECTED"));
  const existing = await client.query("SELECT id FROM public.hauls WHERE company_id=$1 AND id=$2", [actor.companyId, item.haulId]);
  if (existing.rows[0] && !await activityRecordAllowed(client, actor, "haul", item.haulId))
    return reject(helpers.invalidItem(item, "SYNC_ITEM_REJECTED"));

  const machine = await client.query<{ id: string }>(
    "SELECT id FROM public.machines WHERE company_id = $1 AND id = $2 AND is_active",
    [actor.companyId, item.haul.machineId],
  );
  if (!machine.rows[0]) return reject();
  if (item.haul.projectId) {
    const project = await client.query<{ id: string }>(
      "SELECT id FROM public.projects WHERE company_id = $1 AND id = $2",
      [actor.companyId, item.haul.projectId],
    );
    if (!project.rows[0]) return reject();
  }
  if (item.haul.segmentId) {
    const segment = await client.query<{ id: string }>(
      "SELECT id FROM public.route_segments WHERE company_id = $1 AND id = $2 AND ($3::boolean OR project_id = $4)",
      [actor.companyId, item.haul.segmentId, actor.scope === "COMPANY", item.haul.projectId],
    );
    if (!segment.rows[0]) return reject();
  }
  const duplicate = await client.query<{ id: string; version: number }>(
    `SELECT id, version FROM public.hauls WHERE company_id = $1 AND id = $2`,
    [actor.companyId, item.haulId],
  );
  if (duplicate.rows[0]) {
    return reject({
      ...helpers.invalidItem(item),
      entityId: duplicate.rows[0].id,
      version: duplicate.rows[0].version,
    });
  }
  const decision = await checkUse(client, actor.companyId, { entityKind: "MACHINE", entityId: item.haul.machineId,
    action: "haul", today: await companyToday(client, actor.companyId), viewer: actor });
  if (!decision.allowed) return reject(helpers.invalidItem(item, "SYNC_ITEM_REJECTED"));
  const workDate = await helpers.businessDate(client, item.haul.hauledAt);
  if (!workDate) return reject();
  const inserted = await client.query<{ id: string; version: number }>(
    `INSERT INTO public.hauls
       (id, company_id, machine_id, driver_worker_id, project_id, segment_id, hauled_at,
        origin_text, destination_text, material_text, quantity, quantity_unit,
        scale_ticket_text, trip_count, note, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16)
     RETURNING id, version`,
    [
      item.haulId, actor.companyId, item.haul.machineId, worker.id, item.haul.projectId,
      item.haul.segmentId, item.haul.hauledAt, item.haul.originText.trim(),
      item.haul.destinationText.trim(), item.haul.materialText.trim(), item.haul.quantity,
      item.haul.quantityUnit, item.haul.scaleTicketText, item.haul.tripCount,
      item.haul.note, actor.userId,
    ],
  );
  const row = inserted.rows[0];
  if (!row) return reject();
  // F5: tura je trošak sa količinom (cijena iz dionice, inače `PENDING`) — isto kao kroz servis.
  await bookHaulCost(client, {
    companyId: actor.companyId,
    actorId: actor.userId,
    haulId: row.id,
  });
  const payload = {
    id: row.id,
    machineId: item.haul.machineId,
    driverWorkerId: worker.id,
    driverName: `${worker.first_name} ${worker.last_name}`.trim(),
    workDate,
    hauledAt: item.haul.hauledAt,
    originText: item.haul.originText,
    destinationText: item.haul.destinationText,
    materialText: item.haul.materialText,
    quantity: item.haul.quantity,
    quantityUnit: item.haul.quantityUnit,
    scaleTicketText: item.haul.scaleTicketText,
    tripCount: item.haul.tripCount,
    note: item.haul.note,
    projectId: item.haul.projectId,
    segmentId: item.haul.segmentId,
    version: row.version,
    clientLocalId: item.localId,
  };
  await helpers.publishEvent(client, actor, reservation, requestHash, "haul", row.id, row.version, payload);
  const result: R4SyncPushItemResult = {
    localId: item.localId,
    status: "APPLIED",
    entityId: row.id,
    version: row.version,
    cursor: encodeSyncCursor(actor.companyId, reservation.cursor_seq),
  };
  await helpers.saveReceipt(client, actor, item, requestHash, result);
  return result;
}
