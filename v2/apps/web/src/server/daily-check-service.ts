import { activityScope, equipmentScope, equipmentTargetAllowed, isActorWorker, type EquipmentActor } from "./equipment-scope";
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
import {
  criticalFailures,
  templateForCategory,
  type CheckTemplateItem,
} from "./check-template-service";
import { writeAudit } from "./audit";

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
    conditions.push(activityScope(actor, params, "c", "worker_id"));
    let idx = params.length + 1;
    if (isFieldOnly && !viewerWorkerId) conditions.push("FALSE");
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
    const faultScope = can(actor.roles, "machines.fault.view") ? equipmentScope(actor, params, "f", "fault") : "FALSE";
    const result = await client.query<DbDailyCheckRow>(
      `SELECT c.id, c.machine_id, m.code AS machine_code, m.name AS machine_name,
              c.worker_id, w.first_name || ' ' || w.last_name AS worker_name,
              c.project_id, p.code AS project_code, p.name AS project_name,
              c.checked_at::text, c.result, c.checklist_json, c.note, c.version, c.created_at::text,
              c.template_id,
              c.photo_required, c.photo_confirmed_at::text,
              (SELECT f.id FROM public.machine_faults f
                WHERE f.company_id = c.company_id AND f.daily_check_id = c.id AND ${faultScope}
                ORDER BY f.created_at LIMIT 1) AS fault_id
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
  actor: EquipmentActor,
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
    const machine = await client.query<{ id: string; category_id: string; code: string; name: string }>(
      `SELECT id, category_id, code, name FROM public.machines
        WHERE company_id = $1 AND id = $2 AND is_active`,
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
    /*
     * Šablon: eksplicitno poslan ili aktivni šablon kategorije mašine (spec 05 §1.5.20).
     * Kad šablona nema, pregled ostaje slobodan — kao do F4. Ali tada nema ni kritičnih stavki,
     * pa nema ni auto-kvara: ne možemo izmisliti kritičnost koje šablon ne definiše.
     */
    const template = input.templateId
      ? await (async () => {
          const found = await client.query<{ id: string; items: CheckTemplateItem[] | string }>(
            `SELECT id, items FROM public.check_templates
              WHERE company_id = $1 AND id = $2 AND is_active`,
            [actor.companyId, input.templateId],
          );
          const row = found.rows[0];
          if (!row) return null;
          return {
            id: row.id,
            items: typeof row.items === "string"
              ? (JSON.parse(row.items) as CheckTemplateItem[])
              : row.items,
          };
        })()
      : await templateForCategory(client, actor.companyId, machine.rows[0].category_id);

    if (input.templateId && !template) {
      return {
        outcome: "VALIDATION_FAILED",
        code: "TEMPLATE",
        message: "Šablon nije pronađen ili nije aktivan.",
      };
    }

    /*
     * Kritična `FAIL` stavka (spec 05 §1.5.22): fotografija je OBAVEZNA i otvara se kvar.
     *
     * Rad NIJE blokiran — odluka je čovjeka. Ali dokaz (fotografija) mora postojati, a kvar se
     * otvara automatski jer bi inače kritičan nalaz zavisio od toga da se neko sjeti prijaviti
     * ga ručno. Fotografija se ne može poslati u ISTOM zahtjevu (prilog traži `check_id`), pa
     * pregled nosi `photo_required` i `photo_confirmed_at` dozvoljava potvrdu poslije.
     */
    const checklist = (input.checklistJson ?? {}) as Record<string, string>;
    const failed = template ? criticalFailures(template.items, checklist) : [];
    // A critical check creates a fault as a side effect: enforce the same fault boundary.
    if (!await equipmentTargetAllowed(client, actor, input.projectId, input.machineId)
      || (actor.scope === "SELF" && !await isActorWorker(client, actor, workerId))) {
      return { outcome: "FORBIDDEN", code: "SCOPE", message: "Nije dozvoljeno." };
    }

    const id = `mdc_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    await client.query(
      `INSERT INTO public.machine_daily_checks
         (id, company_id, machine_id, worker_id, project_id, checked_at,
          result, checklist_json, note, created_by, updated_by,
          template_id, photo_required)
       VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7,$8::jsonb,$9,$10,$10,$11,$12)`,
      [
        id, actor.companyId, input.machineId, workerId, input.projectId ?? null,
        input.checkedAt, input.result, JSON.stringify(input.checklistJson ?? {}),
        input.note ?? null, actor.userId,
        template?.id ?? null, failed.length > 0,
      ],
    );

    /*
     * Kvar se otvara sa statusom koji poštuje prag firme (spec 05 §1.6.24): iznad
     * `fault_approval_threshold_cents` ide `WAITING_APPROVAL`, ispod odmah `OPEN`. Namjerno
     * `OPEN`, a ne `APPROVED` — trošak popravke još nije poznat; `APPROVED` bi otvorio servisni
     * nalog bez ijednog iznosa, a to je nalog koji niko nije odobrio.
     */
    if (failed.length > 0) {
      const labels = failed.map((item) => item.label).join(", ");
      const faultId = `flt_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
      await client.query(
        `INSERT INTO public.machine_faults
           (id, company_id, machine_id, reporter_worker_id, project_id, reported_at,
            title, description, priority, status, daily_check_id, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7,$8,'HIGH','OPEN',$9,$10,$10)`,
        [
          faultId, actor.companyId, input.machineId, workerId, input.projectId ?? null,
          input.checkedAt,
          `Kritičan nalaz dnevnog pregleda: ${machine.rows[0].code}`,
          `Pregled ${id} prijavio kritičan FAIL: ${labels}. Fotografija je obavezna prije potvrde.`,
          id, actor.userId,
        ],
      );
      await writeAudit(client, {
        companyId: actor.companyId,
        actorId: actor.userId,
        actorEmail: null,
        action: "machine.fault.created_from_check",
        entityType: "machine_fault",
        entityId: faultId,
        metadata: { checkId: id, machineId: input.machineId, items: failed.map((item) => item.key) },
      });
      return { outcome: "OK", id };
    }

    return { outcome: "OK", id };
  });
}
