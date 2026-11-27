/** R5.4: sync push handler for machine_daily_check. */
import type { PoolClient } from "pg";
import type { R4DailyCheckPushItem, R4SyncPushItemResult } from "@gradix/domain";
import { encodeSyncCursor } from "./sync-cursor";
import { activityRecordAllowed, equipmentTargetAllowed } from "./equipment-scope";
import type { SyncDailyCheckApplyDeps } from "./r4-sync-daily-check-types";

export type { SyncDailyCheckApplyDeps } from "./r4-sync-daily-check-types";

export async function applyDailyCheckSyncItem(
  client: PoolClient,
  deps: SyncDailyCheckApplyDeps,
  item: R4DailyCheckPushItem,
): Promise<R4SyncPushItemResult> {
  const { actor, worker, requestHash, reservation, helpers } = deps;
  const reject = (result = helpers.invalidItem(item)) =>
    helpers.rejectInTransaction(client, actor, item, requestHash, reservation, result);

  if (!await equipmentTargetAllowed(client, actor, item.check.projectId, item.check.machineId))
    return reject(helpers.invalidItem(item, "SYNC_ITEM_REJECTED"));
  const existing = await client.query("SELECT id FROM public.machine_daily_checks WHERE company_id=$1 AND id=$2", [actor.companyId, item.checkId]);
  if (existing.rows[0] && !await activityRecordAllowed(client, actor, "check", item.checkId))
    return reject(helpers.invalidItem(item, "SYNC_ITEM_REJECTED"));

  const machine = await client.query<{ id: string }>(
    "SELECT id FROM public.machines WHERE company_id = $1 AND id = $2 AND is_active",
    [actor.companyId, item.check.machineId],
  );
  if (!machine.rows[0]) return reject();
  if (item.check.projectId) {
    const project = await client.query<{ id: string }>(
      "SELECT id FROM public.projects WHERE company_id = $1 AND id = $2",
      [actor.companyId, item.check.projectId],
    );
    if (!project.rows[0]) return reject();
  }
  const workDate = await helpers.businessDate(client, item.check.checkedAt);
  if (!workDate) return reject();

  const duplicate = await client.query<{ id: string; version: number; result: string }>(
    `SELECT id, version, result FROM public.machine_daily_checks WHERE company_id = $1 AND id = $2`,
    [actor.companyId, item.checkId],
  );
  if (duplicate.rows[0]) {
    // Same entity id from another local_id → OPEN sync_conflict (no silent overwrite).
    return helpers.createConflict(
      client, actor, worker, item, workDate, requestHash, reservation,
      null, duplicate.rows[0].version, "MACHINE_DAILY_CHECK_EXISTS",
    );
  }

  const inserted = await client.query<{ id: string; version: number }>(
    `INSERT INTO public.machine_daily_checks
       (id, company_id, machine_id, worker_id, project_id, checked_at,
        result, checklist_json, note, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7,$8::jsonb,$9,$10,$10)
     RETURNING id, version`,
    [
      item.checkId, actor.companyId, item.check.machineId, worker.id, item.check.projectId,
      item.check.checkedAt, item.check.result, JSON.stringify(item.check.checklistJson ?? {}),
      item.check.note, actor.userId,
    ],
  );
  const row = inserted.rows[0];
  if (!row) return reject();
  const payload = {
    id: row.id,
    machineId: item.check.machineId,
    workerId: worker.id,
    workerName: `${worker.first_name} ${worker.last_name}`.trim(),
    workDate,
    checkedAt: item.check.checkedAt,
    result: item.check.result,
    checklistJson: item.check.checklistJson,
    note: item.check.note,
    projectId: item.check.projectId,
    version: row.version,
    clientLocalId: item.localId,
  };
  await helpers.publishEvent(
    client, actor, reservation, requestHash, "machine_daily_check", row.id, row.version, payload,
  );
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
