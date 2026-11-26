import { equipmentScope, equipmentTargetAllowed, isActorWorker, type EquipmentActor } from "./equipment-scope";
/** R5.5: machine fault list and create. */
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import { isCurrency } from "@gradix/domain";
import { can } from "./permissions";
import { resolveViewerWorkerId } from "./workday-review";
import { initialFaultStatus, insertFaultApprovalRequest } from "./machine-fault-approval";
import { faultApprovalThreshold } from "./machine-availability-service";
import {
  companyCurrency,
  isFaultPriority,
  mapFaultRow,
  parseFaultMoney,
  resolveFaultActorWorkerId,
  type DbFaultRow,
} from "./machine-fault-db-helpers";
import type { CreateInput, FaultRow, ListFilters, MutationOutcome } from "./machine-fault-types";

export type { CreateInput, FaultActor, FaultRow, ListFilters, MutationOutcome } from "./machine-fault-types";
export { reviseMachineFault } from "./machine-fault-revise";
export { approveMachineFault, rejectMachineFault } from "./machine-fault-decide";

const FIELD_ROLES = ["MACHINE_OPERATOR", "MECHANIC"] as const;
const OFFICE_ROLES = ["OWNER", "ADMIN", "PROJECT_MANAGER", "SITE_SUPERVISOR"] as const;

const FAULT_SELECT = `f.id, f.machine_id, m.code AS machine_code, m.name AS machine_name,
  f.reporter_worker_id,
  CASE WHEN w.id IS NULL THEN NULL ELSE w.first_name || ' ' || w.last_name END AS reporter_name,
  f.project_id, p.code AS project_code, p.name AS project_name,
  f.partner_id, pt.name AS partner_name,
  f.reported_at::text, f.title, f.description, f.priority, f.status,
  f.estimated_cost_cents::text, f.currency_code, f.downtime_minutes, f.version, f.created_at::text,
  ar.id AS approval_request_id, ar.status AS approval_status`;

export async function listMachineFaults(
  pool: Pool,
  actor: EquipmentActor,
  filters: ListFilters,
): Promise<FaultRow[]> {
  if (!can(actor.roles, "machines.fault.view")) return [];
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const viewerWorkerId = await resolveViewerWorkerId(client, actor.companyId, actor.userId);
    const isFieldOnly = FIELD_ROLES.some((role) => actor.roles.includes(role))
      && !actor.roles.some((role) => [...OFFICE_ROLES, "ACCOUNTANT"].includes(role));
    const conditions = ["f.company_id = $1"];
    const params: unknown[] = [actor.companyId];
    conditions.push(equipmentScope(actor, params, "f", "fault"));
    let idx = params.length + 1;
    if (isFieldOnly && !viewerWorkerId) return [];
    if (isFieldOnly) {
      conditions.push(`f.reporter_worker_id = $${idx}`);
      params.push(viewerWorkerId);
      idx += 1;
    }
    if (filters.openAssignedProjectIds) {
      conditions.push(`f.project_id = ANY($${idx}::text[]) AND f.status NOT IN ('DONE','CANCELLED')`);
      params.push(filters.openAssignedProjectIds);
      idx += 1;
    }
    if (filters.machineId) {
      conditions.push(`f.machine_id = $${idx}`);
      params.push(filters.machineId);
      idx += 1;
    }
    if (filters.status) {
      conditions.push(`f.status = $${idx}`);
      params.push(filters.status);
      idx += 1;
    }
    if (filters.from) {
      conditions.push(`f.reported_at >= $${idx}::timestamptz`);
      params.push(filters.from);
      idx += 1;
    }
    if (filters.to) {
      conditions.push(`f.reported_at <= $${idx}::timestamptz`);
      params.push(filters.to);
      idx += 1;
    }
    const result = await client.query<DbFaultRow>(
      `SELECT ${FAULT_SELECT}
         FROM public.machine_faults f
         JOIN public.machines m ON m.company_id = f.company_id AND m.id = f.machine_id
         LEFT JOIN public.workers w ON w.company_id = f.company_id AND w.id = f.reporter_worker_id
         LEFT JOIN public.projects p ON p.company_id = f.company_id AND p.id = f.project_id
         LEFT JOIN public.partners pt ON pt.company_id = f.company_id AND pt.id = f.partner_id
         LEFT JOIN LATERAL (
           SELECT id, status FROM public.approval_requests
            WHERE company_id = f.company_id AND subject_type = 'machine_fault' AND subject_id = f.id
            ORDER BY created_at DESC LIMIT 1
         ) ar ON true
        WHERE ${conditions.join(" AND ")}
        ORDER BY f.reported_at DESC, f.id
        LIMIT 500`,
      params,
    );
    return result.rows.map(mapFaultRow);
  });
}

export async function createMachineFault(
  pool: Pool,
  actor: EquipmentActor,
  input: CreateInput,
): Promise<MutationOutcome> {
  if (!can(actor.roles, "machines.fault.create")) return { outcome: "FORBIDDEN", code: "ROLE" };
  if (!isFaultPriority(input.priority)) {
    return { outcome: "VALIDATION_FAILED", code: "PRIORITY", message: "Prioritet nije validan." };
  }
  if (!input.title?.trim()) {
    return { outcome: "VALIDATION_FAILED", code: "TITLE", message: "Naslov je obavezan." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    if (!await equipmentTargetAllowed(client, actor, input.projectId, input.machineId))
      return { outcome: "FORBIDDEN", code: "SCOPE", message: "Nije dozvoljeno." };
    const isOffice = actor.roles.some((role) => OFFICE_ROLES.includes(role as typeof OFFICE_ROLES[number]));
    let reporterId: string | null = null;
    if (isOffice && input.reporterWorkerId) {
      const exists = await client.query<{ id: string }>(
        `SELECT id FROM public.workers WHERE company_id = $1 AND id = $2 AND is_active`,
        [actor.companyId, input.reporterWorkerId],
      );
      reporterId = exists.rows[0]?.id ?? null;
      if (!reporterId) {
        return { outcome: "VALIDATION_FAILED", code: "WORKER", message: "Prijavio nije pronađen." };
      }
    } else {
      reporterId = await resolveFaultActorWorkerId(client, actor);
    }
    if (actor.scope === "SELF" && !await isActorWorker(client, actor, reporterId))
      return { outcome: "FORBIDDEN", code: "SCOPE", message: "Nije dozvoljeno." };
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
    if (input.partnerId) {
      const partner = await client.query<{ id: string }>(
        `SELECT id FROM public.partners WHERE company_id = $1 AND id = $2 AND active`,
        [actor.companyId, input.partnerId],
      );
      if (!partner.rows[0]) {
        return { outcome: "VALIDATION_FAILED", code: "PARTNER", message: "Partner nije pronađen." };
      }
    }
    const hasAmount = input.estimatedCostAmount != null && input.estimatedCostAmount !== "";
    const currency = input.currencyCode
      ?? (hasAmount ? await companyCurrency(client, actor.companyId) : null);
    if (hasAmount !== (currency != null)) {
      return {
        outcome: "VALIDATION_FAILED",
        code: "MONEY_PAIR",
        message: "Iznos i valuta moraju biti oba postavljena ili oba prazna.",
      };
    }
    let costCents: bigint | null = null;
    if (hasAmount && currency) {
      if (!isCurrency(currency)) {
        return { outcome: "VALIDATION_FAILED", code: "CURRENCY", message: "Valuta nije validna." };
      }
      try {
        costCents = parseFaultMoney(input.estimatedCostAmount!, currency);
      } catch {
        return { outcome: "VALIDATION_FAILED", code: "AMOUNT", message: "Iznos nije validan." };
      }
    }
    // F4: prag je podatak firme, ne konstanta (spec 05 §1.6.24).
    const status = initialFaultStatus(costCents, await faultApprovalThreshold(client, actor.companyId));
    const id = `mf_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    await client.query(
      `INSERT INTO public.machine_faults
         (id, company_id, machine_id, reporter_worker_id, project_id, partner_id, reported_at,
          title, description, priority, status, estimated_cost_cents, currency_code,
          downtime_minutes, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8,$9,$10,$11,$12,$13,$14,$15,$15)`,
      [
        id, actor.companyId, input.machineId, reporterId, input.projectId ?? null,
        input.partnerId ?? null, input.reportedAt, input.title.trim(),
        input.description ?? null, input.priority, status,
        costCents?.toString() ?? null, currency, input.downtimeMinutes ?? null, actor.userId,
      ],
    );
    if (status === "WAITING_APPROVAL" && costCents !== null && currency) {
      await insertFaultApprovalRequest(client, {
        companyId: actor.companyId,
        faultId: id,
        amountCents: costCents,
        currencyCode: currency,
        requestedBy: actor.userId,
      });
    }
    return { outcome: "OK", id };
  });
}
