/** R5.1: sync push handler for machine_work_log — kept separate to limit r4-sync-service growth. */
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { R4MachineWorkLogPushItem, R4SyncPushItemResult } from "@gradix/domain";
import { encodeSyncCursor } from "./sync-cursor";
import { bookMachineWorkLogCost } from "./cost-entry-service";
import { checkUse } from "./usage-service";
import { companyToday } from "./project-service";
import type { SyncMachineWorkLogApplyDeps } from "./r4-sync-machine-work-log-types";

export type { SyncMachineWorkLogApplyDeps } from "./r4-sync-machine-work-log-types";

export async function applyMachineWorkLogSyncItem(
  client: PoolClient,
  deps: SyncMachineWorkLogApplyDeps,
  item: R4MachineWorkLogPushItem,
): Promise<R4SyncPushItemResult> {
  const { actor, worker, requestHash, reservation, helpers } = deps;
  const reject = (result = helpers.invalidItem(item)) =>
    helpers.rejectInTransaction(client, actor, item, requestHash, reservation, result);

  const machine = await client.query<{ id: string }>(
    "SELECT id FROM public.machines WHERE company_id = $1 AND id = $2 AND is_active",
    [actor.companyId, item.log.machineId],
  );
  if (!machine.rows[0]) return reject();
  if (item.log.projectId) {
    const project = await client.query<{ id: string }>(
      "SELECT id FROM public.projects WHERE company_id = $1 AND id = $2",
      [actor.companyId, item.log.projectId],
    );
    if (!project.rows[0]) return reject();
  }
  const duplicate = await client.query<{ id: string; version: number }>(
    `SELECT id, version FROM public.machine_work_logs
      WHERE company_id = $1 AND id = $2`,
    [actor.companyId, item.workLogId],
  );
  if (duplicate.rows[0]) {
    return reject({
      ...helpers.invalidItem(item),
      entityId: duplicate.rows[0].id,
      version: duplicate.rows[0].version,
    });
  }
  const decision=await checkUse(client,actor.companyId,{
    entityKind:"MACHINE",entityId:item.log.machineId,action:"machine_hours",
    today:await companyToday(client,actor.companyId),viewer:actor,
  });
  if(!decision.allowed) return reject(helpers.invalidItem(item,"SYNC_ITEM_REJECTED"));
  const workDate = await helpers.businessDate(client, item.log.startedAt);
  if (!workDate) return reject();
  try {
    const inserted = await client.query<{ id: string; version: number }>(
      `INSERT INTO public.machine_work_logs
         (id, company_id, machine_id, worker_id, project_id, started_at, ended_at,
          mode, meter_end, note, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, $8, $9, $10, $11, $11)
       RETURNING id, version`,
      [
        item.workLogId, actor.companyId, item.log.machineId, worker.id, item.log.projectId,
        item.log.startedAt, item.log.endedAt, item.log.mode, item.log.meterEnd, item.log.note, actor.userId,
      ],
    );
    const row = inserted.rows[0];
    if (!row) return reject();
    if (item.log.meterEnd != null) {
      await client.query(
        `INSERT INTO public.machine_meter_readings
           (id, company_id, machine_id, reading_value, recorded_at, source, work_log_id, actor_id)
         VALUES ($1, $2, $3, $4, clock_timestamp(), 'WORK_LOG', $5, $6)`,
        [
          `mmr_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
          actor.companyId,
          item.log.machineId,
          item.log.meterEnd,
          row.id,
          actor.userId,
        ],
      );
    }
    /*
     * F5: isti sat poslan sa terena knjiži trošak kao i unos kroz servis. `IDLE`/`BREAKDOWN` ne
     * prave trošak — to pravilo živi u `bookMachineWorkLogCost`, ne ovdje: jedno mjesto odlučuje.
     */
    await bookMachineWorkLogCost(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      workLogId: row.id,
    });
    const payload = {
      id: row.id,
      machineId: item.log.machineId,
      workerId: worker.id,
      workerName: `${worker.first_name} ${worker.last_name}`.trim(),
      workDate,
      startedAt: item.log.startedAt,
      endedAt: item.log.endedAt,
      mode: item.log.mode,
      meterEnd: item.log.meterEnd,
      note: item.log.note,
      projectId: item.log.projectId,
      version: row.version,
      clientLocalId: item.localId,
    };
    await helpers.publishEvent(client, actor, reservation, requestHash, "machine_work_log", row.id, row.version, payload);
    const result: R4SyncPushItemResult = {
      localId: item.localId,
      status: "APPLIED",
      entityId: row.id,
      version: row.version,
      cursor: encodeSyncCursor(actor.companyId, reservation.cursor_seq),
    };
    await helpers.saveReceipt(client, actor, item, requestHash, result);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("MACHINE_WORK_LOG_OVERLAP") || message.includes("METER_READING_REGRESSION")) {
      return helpers.createConflict(
        client, actor, worker, item, workDate, requestHash, reservation,
        null, null, message.includes("OVERLAP") ? "MACHINE_WORK_LOG_OVERLAP" : "METER_READING_REGRESSION",
      );
    }
    throw error;
  }
}