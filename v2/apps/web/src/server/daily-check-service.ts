/** R5.4: daily check list and create. Revise in daily-check-revise.ts. */
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import { can } from "./permissions";
import { resolveViewerWorkerId } from "./workday-review";
import {
  isDailyCheckResult,
  mapDailyCheckRow,
  resolveDailyCheckActorWorkerId,
  type DbDailyCheckRow,
} from "./daily-check-db-helpers";
import type { CreateInput, DailyCheckActor, DailyCheckRow, ListFilters, MutationOutcome } from "./daily-check-types";

export type { CreateInput, DailyCheckActor, DailyCheckRow, ListFilters, MutationOutcome } from "./daily-check-types";
export { reviseDailyCheck } from "./daily-check-revise";

const FIELD_ROLES = ["MACHINE_OPERATOR", "MECHANIC"] as const;
const OFFICE_ROLES = ["OWNER", "ADMIN", "PROJECT_MANAGER", "SITE_SUPERVISOR"] as const;

export async function listDailyChecks(
  pool: Pool,
  actor: DailyCheckActor,
  filters: ListFilters,
): Promise<DailyCheckRow[]> {
  if (!can(actor.roles, "machines.check.view")) return [];
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const viewerWorkerId = await resolveViewerWorkerId(client, actor.companyId, actor.userId);
    const isFieldOnly = FIELD_ROLES.some((role) => actor.roles.includes(role))
      && !actor.roles.some((role) => [...OFFICE_ROLES, "ACCOUNTANT"].includes(role));
    const conditions = ["c.company_id = $1"];
    const params: unknown[] = [actor.companyId];
    let idx = 2;
    if (isFieldOnly && viewerWorkerId) {
      conditions.push(`c.worker_id = $${idx}`);
      params.push(viewerWorkerId);
      idx += 1;
    }
    if (filters.machineId) {
      conditions.push(`c.machine_id = $${idx}`);
      params.push(filters.machineId);
      idx += 1;
    }
    if (filters.from) {
      conditions.push(`c.checked_at >= $${idx}::timestamptz`);
      params.push(filters.from);
      idx += 1;
    }
    if (filters.to) {
      conditions.push(`c.checked_at <= $${idx}::timestamptz`);
      params.push(filters.to);
      idx += 1;
    }
    if (filters.result) {
      conditions.push(`c.result = $${idx}`);
      params.push(filters.result);
      idx += 1;
    }
    const result = await client.query<DbDailyCheckRow>(
      `SELECT c.id, c.machine_id, m.code AS machine_code, m.name AS machine_name,
              c.worker_id, w.first_name || ' ' || w.last_name AS worker_name,
              c.project_id, p.code AS project_code, p.name AS project_name,
              c.checked_at::text, c.result, c.checklist_json, c.note, c.version, c.created_at::text
         FROM public.machine_daily_checks c
         JOIN public.machines m ON m.company_id = c.company_id AND m.id = c.machine_id
         JOIN public.workers w ON w.company_id = c.company_id AND w.id = c.worker_id
         LEFT JOIN public.projects p ON p.company_id = c.company_id AND p.id = c.project_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY c.checked_at DESC, c.id
        LIMIT 500`,
      params,
    );
    return result.rows.map(mapDailyCheckRow);
  });
}

export async function createDailyCheck(
  pool: Pool,
  actor: DailyCheckActor,
  input: CreateInput,
): Promise<MutationOutcome> {
  if (!can(actor.roles, "machines.check.create")) return { outcome: "FORBIDDEN", code: "ROLE" };
  if (!isDailyCheckResult(input.result)) {
    return {
      outcome: "VALIDATION_FAILED",
      code: "RESULT",
      message: "Ishod mora biti PASS, FAIL ili CONDITIONAL.",
    };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const isOffice = actor.roles.some((role) => OFFICE_ROLES.includes(role as typeof OFFICE_ROLES[number]));
    let workerId: string | null = null;
    if (isOffice && input.workerId) {
      const exists = await client.query<{ id: string }>(
        `SELECT id FROM public.workers WHERE company_id = $1 AND id = $2 AND is_active`,
        [actor.companyId, input.workerId],
      );
      workerId = exists.rows[0]?.id ?? null;
      if (!workerId) {
        return { outcome: "VALIDATION_FAILED", code: "WORKER", message: "Rukovalac nije pronađen." };
      }
    } else {
      workerId = await resolveDailyCheckActorWorkerId(client, actor);
    }
    if (!workerId) {
      return {
        outcome: "FORBIDDEN",
        code: "NO_WORKER",
        message: isOffice ? "Izaberi rukovaoca za unos." : "Nalog nije povezan s radnikom.",
      };
    }
    const machine = await client.query<{ id: string }>(
      `SELECT id FROM public.machines WHERE company_id = $1 AND id = $2 AND is_active`,
      [actor.companyId, input.machineId],
    );
    if (!machine.rows[0]) {
      return { outcome: "VALIDATION_FAILED", code: "MACHINE", message: "Mašina nije pronađena." };
    }
    if (input.projectId) {
      const project = await client.query<{ id: string }>(
        `SELECT id FROM public.projects WHERE company_id = $1 AND id = $2`,
        [actor.companyId, input.projectId],
      );
      if (!project.rows[0]) {
        return { outcome: "VALIDATION_FAILED", code: "PROJECT", message: "Projekat nije pronađen." };
      }
    }
    const id = `mdc_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    await client.query(
      `INSERT INTO public.machine_daily_checks
         (id, company_id, machine_id, worker_id, project_id, checked_at,
          result, checklist_json, note, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7,$8::jsonb,$9,$10,$10)`,
      [
        id, actor.companyId, input.machineId, workerId, input.projectId ?? null,
        input.checkedAt, input.result, JSON.stringify(input.checklistJson ?? {}),
        input.note ?? null, actor.userId,
      ],
    );
    return { outcome: "OK", id };
  });
}
