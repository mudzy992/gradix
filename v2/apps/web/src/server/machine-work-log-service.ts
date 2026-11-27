/** R5.1: machine work-log list and create. Revise lives in machine-work-log-revise.ts. */
import { machineActivityScope, machineActivityTargetAllowed } from "./machine-activity-scope";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import { can } from "./permissions";
import { bookMachineWorkLogCost } from "./cost-entry-service";
import { checkUse } from "./usage-service";
import { companyToday } from "./project-service";
import { usageBlockMessage } from "@gradix/domain";
import { resolveViewerWorkerId } from "./workday-review";
import type {
  CreateInput,
  ListFilters,
  MachineWorkLogActor,
  MachineWorkLogRow,
  MutationOutcome,
} from "./machine-work-log-types";

export type {
  CreateInput,
  ListFilters,
  MachineWorkLogActor,
  MachineWorkLogRow,
  MutationOutcome,
} from "./machine-work-log-types";
export { reviseMachineWorkLog } from "./machine-work-log-revise";

export async function listMachineWorkLogs(
  pool: Pool,
  actor: MachineWorkLogActor,
  filters: ListFilters,
): Promise<MachineWorkLogRow[]> {
  if (!can(actor.roles, "machines.work_log.view")) return [];
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const viewerWorkerId = await resolveViewerWorkerId(client, actor.companyId, actor.userId);
    const isOperatorOnly = actor.roles.includes("MACHINE_OPERATOR")
      && !actor.roles.some((role) =>
        ["OWNER", "ADMIN", "PROJECT_MANAGER", "SITE_SUPERVISOR", "ACCOUNTANT"].includes(role),
      );
    const conditions = ["mwl.company_id = $1"];
    const params: unknown[] = [actor.companyId];
    conditions.push(machineActivityScope(actor, params, "mwl", "worker_id"));
    let idx = params.length + 1;
    if (isOperatorOnly && !viewerWorkerId) conditions.push("FALSE");
    if (isOperatorOnly && viewerWorkerId) {
      conditions.push(`mwl.worker_id = $${idx}`);
      params.push(viewerWorkerId);
      idx += 1;
    }
    if (filters.machineId) {
      conditions.push(`mwl.machine_id = $${idx}`);
      params.push(filters.machineId);
      idx += 1;
    }
    if (filters.from) {
      conditions.push(`mwl.started_at >= $${idx}::timestamptz`);
      params.push(filters.from);
      idx += 1;
    }
    if (filters.to) {
      conditions.push(`mwl.ended_at <= $${idx}::timestamptz`);
      params.push(filters.to);
      idx += 1;
    }
    const rows = await client.query<MachineWorkLogRow>(
      `SELECT mwl.id, mwl.machine_id,
              m.code AS machine_code, m.name AS machine_name,
              mwl.worker_id, w.first_name || ' ' || w.last_name AS worker_name,
              mwl.project_id, p.code AS project_code, p.name AS project_name,
              mwl.started_at::text, mwl.ended_at::text, mwl.mode,
              mwl.meter_end::float8 AS meter_end, mwl.note, mwl.version, mwl.created_at::text
         FROM public.machine_work_logs mwl
         JOIN public.machines m ON m.company_id = mwl.company_id AND m.id = mwl.machine_id
         JOIN public.workers w ON w.company_id = mwl.company_id AND w.id = mwl.worker_id
         LEFT JOIN public.projects p ON p.company_id = mwl.company_id AND p.id = mwl.project_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY mwl.started_at DESC, mwl.id
        LIMIT 500`,
      params,
    );
    return rows.rows;
  });
}

async function insertMeterReading(
  client: PoolClient,
  actor: MachineWorkLogActor,
  machineId: string,
  value: number,
  workLogId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO public.machine_meter_readings
       (id, company_id, machine_id, reading_value, recorded_at, source, work_log_id, actor_id)
     VALUES ($1, $2, $3, $4, clock_timestamp(), 'WORK_LOG', $5, $6)`,
    [
      `mmr_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      actor.companyId,
      machineId,
      value,
      workLogId,
      actor.userId,
    ],
  );
}

async function resolveActorWorkerId(client: PoolClient, actor: MachineWorkLogActor): Promise<string | null> {
  const result = await client.query<{ id: string }>(
    `SELECT w.id FROM public.workers w
      WHERE w.company_id = $1 AND w.user_id = $2 AND w.is_active LIMIT 1`,
    [actor.companyId, actor.userId],
  );
  return result.rows[0]?.id ?? null;
}

export async function createMachineWorkLog(
  pool: Pool,
  actor: MachineWorkLogActor,
  input: CreateInput,
): Promise<MutationOutcome> {
  if (!can(actor.roles, "machines.work_log.create")) return { outcome: "FORBIDDEN", code: "ROLE" };
  if (!["WORK", "IDLE", "BREAKDOWN"].includes(input.mode)) {
    return { outcome: "VALIDATION_FAILED", code: "MODE", message: "Nepoznat režim rada." };
  }
  if (Date.parse(input.endedAt) <= Date.parse(input.startedAt)) {
    return { outcome: "VALIDATION_FAILED", code: "INTERVAL", message: "Kraj mora biti poslije početka." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const officeRoles = ["OWNER", "ADMIN", "PROJECT_MANAGER", "SITE_SUPERVISOR"];
    const isOffice = actor.roles.some((role) => officeRoles.includes(role));
    let workerId: string | null = null;
    if (isOffice && input.workerId) {
      const exists = await client.query<{ id: string }>(
        `SELECT id FROM public.workers WHERE company_id = $1 AND id = $2 AND is_active`,
        [actor.companyId, input.workerId],
      );
      workerId = exists.rows[0]?.id ?? null;
      if (!workerId) {
        return { outcome: "VALIDATION_FAILED", code: "WORKER", message: "Radnik nije pronađen." };
      }
    } else {
      workerId = await resolveActorWorkerId(client, actor);
    }
    if (!workerId) {
      return {
        outcome: "FORBIDDEN",
        code: "NO_WORKER",
        message: isOffice ? "Izaberi radnika za unos." : "Nalog nije povezan s radnikom.",
      };
    }
    if (!await machineActivityTargetAllowed(client, actor, input.projectId, workerId)) {
      return { outcome: "FORBIDDEN", code: "SCOPE", message: "Zapis nije u vašem opsegu." };
    }
    // F0.3: radni sati mašine traže važeće obaveze mašine (spec 05 §29).
    const decision = await checkUse(client, actor.companyId, {
      entityKind: "MACHINE",
      entityId: input.machineId,
      action: "machine_hours",
      today: await companyToday(client, toCompanyId(actor.companyId)),
    });
    if (!decision.allowed) {
      return {
        outcome: "CONFLICT",
        code: "BLOCKED",
        message: usageBlockMessage(decision) ?? "Mašina ne može raditi.",
      };
    }
    const id = `mwl_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    try {
      await client.query(
        `INSERT INTO public.machine_work_logs
           (id, company_id, machine_id, worker_id, project_id, started_at, ended_at,
            mode, meter_end, note, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, $8, $9, $10, $11, $11)`,
        [
          id, actor.companyId, input.machineId, workerId, input.projectId ?? null,
          input.startedAt, input.endedAt, input.mode,
          input.meterEnd ?? null, input.note ?? null, actor.userId,
        ],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("MACHINE_WORK_LOG_OVERLAP")) {
        return { outcome: "CONFLICT", code: "OVERLAP", message: "Mašina već ima zapis koji se preklapa." };
      }
      if (message.includes("METER_READING_REGRESSION")) {
        return { outcome: "CONFLICT", code: "METER", message: "Brojilo ne smije ići unazad bez ispravke." };
      }
      throw error;
    }
    /*
     * F5: sat mašine u `WORK` režimu knjiži trošak sada, sa zamrznutom stopom. `IDLE`/`BREAKDOWN`
     * trošak ne prave — oni su tu zbog iskorištenosti, ne zbog naplate.
     */
    await bookMachineWorkLogCost(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      workLogId: id,
    });
    if (input.meterEnd != null) {
      try {
        await insertMeterReading(client, actor, input.machineId, input.meterEnd, id);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (message.includes("METER_READING_REGRESSION")) {
          return { outcome: "CONFLICT", code: "METER", message: "Brojilo ne smije ići unazad bez ispravke." };
        }
        throw error;
      }
    }
    return { outcome: "OK", id };
  });
}
