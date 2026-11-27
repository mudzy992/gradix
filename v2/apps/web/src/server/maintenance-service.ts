/**
 * F8 — preventivno održavanje: šabloni po kategoriji, planovi po mašini i okidač iz stvarnih podataka.
 *
 * Tri pravila koja ovaj fajl drži (spec 09 §1.2):
 *  1. **Šablon je jedan po kategoriji** (§1.2/12); mašina nasljeđuje vrijednosti i može ih prepisati.
 *     Zato plan čuva SVOJE `interval_value`/`tolerance_pct` — promjena šablona ne mijenja planove
 *     koji su već „prepisani“, a ni one koji nisu (izmjena šablona je izmjena budućih planova).
 *  2. **Okidač dolazi iz brojila i datuma** (§1.2/9): pređen prag `next_due − interval × tolerance`
 *     otvara nalog `PLANNED` sa `origin='PREVENTIVE'`. Dedupe je (plan, `planned_for`) — posao koji
 *     ide svakih 15 minuta ne smije praviti nalog svakih 15 minuta.
 *  3. **Zatvaranje računa sljedeći rok iz STVARNOG brojila** (§1.2/11), ne iz plana — inače svaki
 *     zakašnjeli servis pomjera ciklus unazad i zaostatak raste zauvijek.
 */
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import {
  addDays,
  evaluateMaintenance,
  nextMaintenanceDue,
  type MaintenanceBasis,
} from "@gradix/domain";
import { can } from "./permissions";
import { companyToday } from "./project-service";
import type { ServiceActor } from "./service-order-types";

export type MaintenanceTemplateRow = {
  id: string;
  category_id: string | null;
  category_name: string | null;
  code: string;
  name: string;
  basis: MaintenanceBasis;
  interval_value: string;
  tolerance_pct: string;
  items: string[];
  sort_order: number;
  is_active: boolean;
};

export type MaintenancePlanRow = {
  id: string;
  machine_id: string;
  template_id: string | null;
  name: string;
  basis: MaintenanceBasis;
  interval_value: string;
  tolerance_pct: string;
  last_done_at: string | null;
  last_done_meter: string | null;
  next_due_at: string | null;
  next_due_meter: string | null;
  is_active: boolean;
  status: "OK" | "DUE_SOON" | "OVERDUE" | "NO_DATA";
  current_meter: string | null;
  due_soon_at: string | null;
  remaining: string | null;
  open_order_id: string | null;
};

/* ----------------------------------------------------------------- šabloni */

export async function listMaintenanceTemplates(
  pool: Pool,
  actor: ServiceActor,
): Promise<MaintenanceTemplateRow[]> {
  if (!can(actor.roles, "service.view")) return [];
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const result = await client.query<MaintenanceTemplateRow & { items: unknown }>(
      `SELECT t.id, t.category_id, ec.name AS category_name, t.code, t.name, t.basis,
              t.interval_value::text, t.tolerance_pct::text, t.items, t.sort_order, t.is_active
         FROM public.maintenance_templates t
         LEFT JOIN public.equipment_categories ec
           ON ec.company_id = t.company_id AND ec.id = t.category_id
        WHERE t.company_id = $1
        ORDER BY t.sort_order, t.code`,
      [actor.companyId],
    );
    return result.rows.map((row) => ({
      ...row,
      items: Array.isArray(row.items) ? (row.items as string[]) : [],
    }));
  });
}

export type MaintenanceTemplateInput = {
  categoryId?: string | null;
  code?: string;
  name?: string;
  basis?: MaintenanceBasis;
  intervalValue?: string;
  tolerancePct?: string;
  items?: string[];
  sortOrder?: number;
  isActive?: boolean;
};

export async function saveMaintenanceTemplate(
  pool: Pool,
  actor: ServiceActor,
  templateId: string | null,
  input: MaintenanceTemplateInput,
): Promise<{ outcome: "OK"; id: string } | { outcome: "FORBIDDEN" } | { outcome: "NOT_FOUND" } | { outcome: "VALIDATION_FAILED"; message: string }> {
  if (!can(actor.roles, "service.manage")) return { outcome: "FORBIDDEN" };
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    if (templateId) {
      const existing = await client.query<{ id: string }>(
        "SELECT id FROM public.maintenance_templates WHERE company_id = $1 AND id = $2",
        [actor.companyId, templateId],
      );
      if (!existing.rows[0]) return { outcome: "NOT_FOUND" as const };
      await client.query(
        `UPDATE public.maintenance_templates
            SET category_id = COALESCE($3, category_id),
                code = COALESCE($4, code),
                name = COALESCE($5, name),
                basis = COALESCE($6, basis),
                interval_value = COALESCE($7, interval_value),
                tolerance_pct = COALESCE($8, tolerance_pct),
                items = COALESCE($9::jsonb, items),
                sort_order = COALESCE($10, sort_order),
                is_active = COALESCE($11, is_active),
                updated_by = $12,
                updated_at = clock_timestamp()
          WHERE company_id = $1 AND id = $2`,
        [
          actor.companyId,
          templateId,
          input.categoryId ?? null,
          input.code ?? null,
          input.name ?? null,
          input.basis ?? null,
          input.intervalValue ?? null,
          input.tolerancePct ?? null,
          input.items ? JSON.stringify(input.items) : null,
          input.sortOrder ?? null,
          input.isActive ?? null,
          actor.userId,
        ],
      );
      return { outcome: "OK" as const, id: templateId };
    }
    if (!input.code || !input.name || !input.basis || !input.intervalValue) {
      return {
        outcome: "VALIDATION_FAILED" as const,
        message: "code, name, basis i intervalValue su obavezni za novi šablon.",
      };
    }
    const id = `mtp_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    await client.query(
      `INSERT INTO public.maintenance_templates
         (id, company_id, category_id, code, name, basis, interval_value, tolerance_pct, items,
          sort_order, is_active, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,10),COALESCE($9::jsonb,'[]'::jsonb),
               COALESCE($10,0),COALESCE($11,true),$12,$12)`,
      [
        id,
        actor.companyId,
        input.categoryId ?? null,
        input.code,
        input.name,
        input.basis,
        input.intervalValue,
        input.tolerancePct ?? null,
        JSON.stringify(input.items ?? []),
        input.sortOrder ?? 0,
        input.isActive ?? true,
        actor.userId,
      ],
    );
    return { outcome: "OK" as const, id };
  });
}

/* ------------------------------------------------------------------ planovi */

/** Brojilo mašine na današnji dan: zadnje očitano ili zadnje iz radnih sati (Modul 5). */
async function currentMeter(client: PoolClient, companyId: string, machineId: string): Promise<string | null> {
  const row = await client.query<{ value: string | null }>(
    `SELECT GREATEST(
              COALESCE((SELECT mr.reading_value::numeric FROM public.machine_meter_readings mr
                         WHERE mr.company_id = $1 AND mr.machine_id = $2
                         ORDER BY mr.recorded_at DESC LIMIT 1), 0),
              COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (l.ended_at - l.started_at)) / 3600.0)
                          FROM public.machine_work_logs l
                         WHERE l.company_id = $1 AND l.machine_id = $2
                           AND l.mode = 'WORK' AND l.ended_at IS NOT NULL), 0)
            )::text AS value`,
    [companyId, machineId],
  );
  const value = row.rows[0]?.value;
  return value === null || value === undefined ? null : value;
}

export async function listMaintenancePlans(
  pool: Pool,
  actor: ServiceActor,
  machineId: string,
): Promise<MaintenancePlanRow[]> {
  if (!can(actor.roles, "service.view")) return [];
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const today = await companyToday(client, toCompanyId(actor.companyId));
    const meter = await currentMeter(client, actor.companyId, machineId);
    const result = await client.query<{
      id: string;
      machine_id: string;
      template_id: string | null;
      name: string;
      basis: MaintenanceBasis;
      interval_value: string;
      tolerance_pct: string;
      last_done_at: string | null;
      last_done_meter: string | null;
      next_due_at: string | null;
      next_due_meter: string | null;
      is_active: boolean;
      open_order_id: string | null;
    }>(
      `SELECT p.id, p.machine_id, p.template_id, p.name, p.basis, p.interval_value::text,
              p.tolerance_pct::text, p.last_done_at::text, p.last_done_meter::text,
              p.next_due_at::text, p.next_due_meter::text, p.is_active,
              (SELECT so.id FROM public.service_orders so
                WHERE so.company_id = p.company_id AND so.maintenance_plan_id = p.id
                  AND so.status NOT IN ('DONE', 'CANCELLED')
                ORDER BY so.opened_at DESC LIMIT 1) AS open_order_id
         FROM public.maintenance_plans p
        WHERE p.company_id = $1 AND p.machine_id = $2
        ORDER BY p.is_active DESC, p.next_due_at NULLS LAST, p.name`,
      [actor.companyId, machineId],
    );
    return result.rows.map((row) => {
      const evaluation = evaluateMaintenance(
        {
          basis: row.basis,
          intervalValue: row.interval_value,
          tolerancePct: row.tolerance_pct,
          nextDueAt: row.next_due_at,
          nextDueMeter: row.next_due_meter,
          isActive: row.is_active,
        },
        { meter, onDate: today },
      );
      return {
        ...row,
        status: evaluation.status,
        current_meter: evaluation.current,
        due_soon_at: evaluation.dueSoonAt,
        remaining: evaluation.remaining,
      };
    });
  });
}

export type MaintenancePlanInput = {
  templateId?: string | null;
  name?: string;
  basis?: MaintenanceBasis;
  intervalValue?: string;
  tolerancePct?: string;
  lastDoneAt?: string | null;
  lastDoneMeter?: string | null;
  nextDueAt?: string | null;
  nextDueMeter?: string | null;
  isActive?: boolean;
};

export async function saveMaintenancePlan(
  pool: Pool,
  actor: ServiceActor,
  machineId: string,
  planId: string | null,
  input: MaintenancePlanInput,
): Promise<{ outcome: "OK"; id: string } | { outcome: "FORBIDDEN" } | { outcome: "NOT_FOUND" } | { outcome: "VALIDATION_FAILED"; message: string }> {
  if (!can(actor.roles, "service.manage")) return { outcome: "FORBIDDEN" };
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    if (planId) {
      const existing = await client.query<{ id: string }>(
        "SELECT id FROM public.maintenance_plans WHERE company_id = $1 AND id = $2 AND machine_id = $3",
        [actor.companyId, planId, machineId],
      );
      if (!existing.rows[0]) return { outcome: "NOT_FOUND" as const };
      await client.query(
        `UPDATE public.maintenance_plans
            SET template_id = COALESCE($4, template_id),
                name = COALESCE($5, name),
                basis = COALESCE($6, basis),
                interval_value = COALESCE($7, interval_value),
                tolerance_pct = COALESCE($8, tolerance_pct),
                last_done_at = COALESCE($9::date, last_done_at),
                last_done_meter = COALESCE($10::numeric, last_done_meter),
                next_due_at = COALESCE($11::date, next_due_at),
                next_due_meter = COALESCE($12::numeric, next_due_meter),
                is_active = COALESCE($13, is_active),
                updated_by = $14,
                updated_at = clock_timestamp()
          WHERE company_id = $1 AND id = $2 AND machine_id = $3`,
        [
          actor.companyId,
          planId,
          machineId,
          input.templateId ?? null,
          input.name ?? null,
          input.basis ?? null,
          input.intervalValue ?? null,
          input.tolerancePct ?? null,
          input.lastDoneAt ?? null,
          input.lastDoneMeter ?? null,
          input.nextDueAt ?? null,
          input.nextDueMeter ?? null,
          input.isActive ?? null,
          actor.userId,
        ],
      );
      return { outcome: "OK" as const, id: planId };
    }

    /* Nasljeđivanje iz šablona (§1.2/12): kad je `templateId` zadat a vrijednosti nijesu, plan
       preuzima interval i toleranciju šablona — inače bi svaki novi plan tražio ručni unos istih
       brojeva koje firma već definiše na jednom mjestu. */
    let basis = input.basis;
    let intervalValue = input.intervalValue;
    let tolerancePct = input.tolerancePct;
    let name = input.name;
    if (input.templateId) {
      const template = await client.query<{
        name: string;
        basis: MaintenanceBasis;
        interval_value: string;
        tolerance_pct: string;
      }>(
        `SELECT name, basis, interval_value::text, tolerance_pct::text
           FROM public.maintenance_templates WHERE company_id = $1 AND id = $2`,
        [actor.companyId, input.templateId],
      );
      const found = template.rows[0];
      if (!found) return { outcome: "NOT_FOUND" as const };
      basis = basis ?? found.basis;
      intervalValue = intervalValue ?? found.interval_value;
      tolerancePct = tolerancePct ?? found.tolerance_pct;
      name = name ?? found.name;
    }
    if (!basis || !intervalValue || !name) {
      return {
        outcome: "VALIDATION_FAILED" as const,
        message: "Plan traži naziv, osnov i interval (ili šablon iz kojeg se nasljeđuju).",
      };
    }
    const id = `mpl_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    await client.query(
      `INSERT INTO public.maintenance_plans
         (id, company_id, machine_id, template_id, name, basis, interval_value, tolerance_pct,
          last_done_at, last_done_meter, next_due_at, next_due_meter, is_active, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,10),$9::date,$10::numeric,$11::date,$12::numeric,
               COALESCE($13,true),$14,$14)`,
      [
        id,
        actor.companyId,
        machineId,
        input.templateId ?? null,
        name,
        basis,
        intervalValue,
        tolerancePct ?? null,
        input.lastDoneAt ?? null,
        input.lastDoneMeter ?? null,
        input.nextDueAt ?? null,
        input.nextDueMeter ?? null,
        input.isActive ?? true,
        actor.userId,
      ],
    );
    return { outcome: "OK" as const, id };
  });
}

/* ------------------------------------------------------------------ okidač */

export type DueMaintenancePlan = {
  plan_id: string;
  company_id: string;
  machine_id: string;
  machine_name: string;
  name: string;
  basis: MaintenanceBasis;
  planned_for: string;
  open_order_id: string | null;
};

/**
 * Planovi koji su prešli prag, za jednu firmu. Koristi ih i worker (`reminders.scan`) i ekran
 * `/ured/servis` — ista funkcija, jer bi dvije verzije „šta je dospjelo“ dale dvije liste.
 */
export async function dueMaintenancePlans(
  client: PoolClient,
  companyId: string,
  onDate: string,
): Promise<DueMaintenancePlan[]> {
  const result = await client.query<{
    plan_id: string;
    machine_id: string;
    machine_name: string;
    name: string;
    basis: MaintenanceBasis;
    interval_value: string;
    tolerance_pct: string;
    next_due_at: string | null;
    next_due_meter: string | null;
    meter: string | null;
    open_order_id: string | null;
  }>(
    `SELECT p.id AS plan_id, p.machine_id, m.name AS machine_name, p.name, p.basis,
            p.interval_value::text, p.tolerance_pct::text, p.next_due_at::text,
            p.next_due_meter::text,
            GREATEST(
              COALESCE((SELECT mr.reading_value::numeric FROM public.machine_meter_readings mr
                         WHERE mr.company_id = p.company_id AND mr.machine_id = p.machine_id
                         ORDER BY mr.recorded_at DESC LIMIT 1), 0),
              COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (l.ended_at - l.started_at)) / 3600.0)
                          FROM public.machine_work_logs l
                         WHERE l.company_id = p.company_id AND l.machine_id = p.machine_id
                           AND l.mode = 'WORK' AND l.ended_at IS NOT NULL), 0)
            )::text AS meter,
            (SELECT so.id FROM public.service_orders so
              WHERE so.company_id = p.company_id AND so.maintenance_plan_id = p.id
                AND so.status NOT IN ('DONE', 'CANCELLED')
              ORDER BY so.opened_at DESC LIMIT 1) AS open_order_id
       FROM public.maintenance_plans p
       JOIN public.machines m ON m.company_id = p.company_id AND m.id = p.machine_id
      WHERE p.company_id = $1 AND p.is_active`,
    [companyId],
  );
  const due: DueMaintenancePlan[] = [];
  for (const row of result.rows) {
    const evaluation = evaluateMaintenance(
      {
        basis: row.basis,
        intervalValue: row.interval_value,
        tolerancePct: row.tolerance_pct,
        nextDueAt: row.next_due_at,
        nextDueMeter: row.next_due_meter,
        isActive: true,
      },
      { meter: row.meter, onDate },
    );
    if (evaluation.status !== "DUE_SOON" && evaluation.status !== "OVERDUE") continue;
    due.push({
      plan_id: row.plan_id,
      company_id: companyId,
      machine_id: row.machine_id,
      machine_name: row.machine_name,
      name: row.name,
      basis: row.basis,
      /* `planned_for` je DEDUPE ključ ciklusa zajedno sa planom: isti ciklus = isti datum. */
      planned_for: row.next_due_at ?? onDate,
      open_order_id: row.open_order_id,
    });
  }
  return due;
}

export type OpenPreventiveResult = {
  created: number;
  skipped: number;
  orderIds: string[];
};

/**
 * Otvara preventivne naloge za dospjele planove. Idempotentno: djelimični unikat
 * `service_orders_preventive_cycle_unique (company_id, maintenance_plan_id, planned_for)` čini
 * drugi prolaz no-op, pa worker smije da se vrti koliko hoće.
 */
export async function openPreventiveOrders(
  client: PoolClient,
  companyId: string,
  onDate: string,
  actorId: string,
  planId?: string,
): Promise<OpenPreventiveResult> {
  const plans = await dueMaintenancePlans(client, companyId, onDate);
  let created = 0;
  let skipped = 0;
  const orderIds: string[] = [];
  for (const plan of plans) {
    if (planId && plan.plan_id !== planId) continue;
    const id = `svo_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO public.service_orders
         (id, company_id, machine_id, description, currency_code, created_by, updated_by,
          origin, kind, priority, planned_for, maintenance_plan_id, status, amount_cents)
       VALUES ($1,$2,$3,$4,(SELECT currency FROM public.companies WHERE id = $2),$5,$5,
               'PREVENTIVE','INTERNAL','MEDIUM',$6::date,$7,'PLANNED',0)
       ON CONFLICT (company_id, maintenance_plan_id, planned_for)
         WHERE maintenance_plan_id IS NOT NULL AND status <> 'CANCELLED' DO NOTHING
       RETURNING id`,
      [
        id,
        companyId,
        plan.machine_id,
        `Preventivni servis: ${plan.name}`.slice(0, 2000),
        actorId,
        plan.planned_for,
        plan.plan_id,
      ],
    );
    const row = inserted.rows[0];
    if (row) {
      created += 1;
      orderIds.push(row.id);
    } else {
      skipped += 1;
    }
  }
  return { created, skipped, orderIds };
}

/**
 * Zatvaranje preventivnog naloga pomjera plan (§1.2/11). Računa se iz STVARNOG brojila u trenutku
 * izvršenja; datum se pomjera od dana izvršenja, ne od propuštenog roka.
 */
export async function advancePlanAfterService(
  client: PoolClient,
  params: { companyId: string; planId: string; machineId: string; performedOn: string },
): Promise<void> {
  const plan = await client.query<{ basis: MaintenanceBasis; interval_value: string; next_due_meter: string | null }>(
    `SELECT basis, interval_value::text, next_due_meter::text FROM public.maintenance_plans
      WHERE company_id = $1 AND id = $2`,
    [params.companyId, params.planId],
  );
  const row = plan.rows[0];
  if (!row) return;
  const meter = await currentMeter(client, params.companyId, params.machineId);
  const next = nextMaintenanceDue(
    { basis: row.basis, intervalValue: row.interval_value },
    { meter, onDate: params.performedOn },
  );
  await client.query(
    `UPDATE public.maintenance_plans
        SET last_done_at = $3::date,
            last_done_meter = $4::numeric,
            next_due_at = $5::date,
            next_due_meter = COALESCE($6::numeric, next_due_meter),
            updated_at = clock_timestamp()
      WHERE company_id = $1 AND id = $2`,
    [
      params.companyId,
      params.planId,
      params.performedOn,
      meter,
      next.nextDueAt ?? (row.basis === "DAYS" ? addDays(params.performedOn, 0) : null),
      next.nextDueMeter,
    ],
  );
}
