/** R5.5: sync push handler for machine_fault. */
import type { PoolClient } from "pg";
import {
  isCurrency,
  money,
  type R4FaultPushItem,
  type R4SyncPushItemResult,
} from "@gradix/domain";
import { encodeSyncCursor } from "./sync-cursor";
import { companyCurrency } from "./machine-fault-db-helpers";
import { initialFaultStatus, insertFaultApprovalRequest } from "./machine-fault-approval";
import type { SyncFaultApplyDeps } from "./r4-sync-fault-types";

export type { SyncFaultApplyDeps } from "./r4-sync-fault-types";

export async function applyFaultSyncItem(
  client: PoolClient,
  deps: SyncFaultApplyDeps,
  item: R4FaultPushItem,
): Promise<R4SyncPushItemResult> {
  const { actor, worker, requestHash, reservation, helpers } = deps;
  const reject = (result = helpers.invalidItem(item)) =>
    helpers.rejectInTransaction(client, actor, item, requestHash, reservation, result);

  const machine = await client.query<{ id: string }>(
    "SELECT id FROM public.machines WHERE company_id = $1 AND id = $2 AND is_active",
    [actor.companyId, item.fault.machineId],
  );
  if (!machine.rows[0]) return reject();
  if (item.fault.projectId) {
    const project = await client.query<{ id: string }>(
      "SELECT id FROM public.projects WHERE company_id = $1 AND id = $2",
      [actor.companyId, item.fault.projectId],
    );
    if (!project.rows[0]) return reject();
  }
  if (item.fault.partnerId) {
    const partner = await client.query<{ id: string }>(
      "SELECT id FROM public.partners WHERE company_id = $1 AND id = $2 AND active",
      [actor.companyId, item.fault.partnerId],
    );
    if (!partner.rows[0]) return reject();
  }
  const workDate = await helpers.businessDate(client, item.fault.reportedAt);
  if (!workDate) return reject();

  const hasAmount = item.fault.estimatedCostAmount !== null;
  const currencyCode = item.fault.currencyCode
    ?? (hasAmount ? await companyCurrency(client, actor.companyId) : null);
  if (hasAmount !== (currencyCode != null)) return reject();
  let costCents: bigint | null = null;
  if (hasAmount && currencyCode) {
    if (!isCurrency(currencyCode)) return reject();
    try {
      costCents = money(item.fault.estimatedCostAmount!, currencyCode).cents;
    } catch {
      return reject();
    }
  }

  const duplicate = await client.query<{ id: string; version: number }>(
    `SELECT id, version FROM public.machine_faults WHERE company_id = $1 AND id = $2`,
    [actor.companyId, item.faultId],
  );
  if (duplicate.rows[0]) {
    return helpers.createConflict(
      client, actor, worker, item, workDate, requestHash, reservation,
      null, duplicate.rows[0].version, "MACHINE_FAULT_EXISTS",
    );
  }

  const status = initialFaultStatus(costCents);
  const inserted = await client.query<{ id: string; version: number }>(
    `INSERT INTO public.machine_faults
       (id, company_id, machine_id, reporter_worker_id, project_id, partner_id, reported_at,
        title, description, priority, status, estimated_cost_cents, currency_code,
        downtime_minutes, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8,$9,$10,$11,$12,$13,$14,$15,$15)
     RETURNING id, version`,
    [
      item.faultId, actor.companyId, item.fault.machineId, worker.id, item.fault.projectId,
      item.fault.partnerId, item.fault.reportedAt, item.fault.title, item.fault.description,
      item.fault.priority, status, costCents?.toString() ?? null, currencyCode,
      item.fault.downtimeMinutes, actor.userId,
    ],
  );
  const row = inserted.rows[0];
  if (!row) return reject();
  if (status === "WAITING_APPROVAL" && costCents !== null && currencyCode) {
    await insertFaultApprovalRequest(client, {
      companyId: actor.companyId,
      faultId: row.id,
      amountCents: costCents,
      currencyCode,
      requestedBy: actor.userId,
    });
  }
  const payload = {
    id: row.id,
    machineId: item.fault.machineId,
    reporterWorkerId: worker.id,
    workerName: `${worker.first_name} ${worker.last_name}`.trim(),
    workDate,
    reportedAt: item.fault.reportedAt,
    title: item.fault.title,
    priority: item.fault.priority,
    status,
    projectId: item.fault.projectId,
    partnerId: item.fault.partnerId,
    version: row.version,
    clientLocalId: item.localId,
  };
  await helpers.publishEvent(
    client, actor, reservation, requestHash, "machine_fault", row.id, row.version, payload,
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
