/** Data quality counts. No global entity is exposed to PROJECTS/SELF scope. */
import type { Pool } from "pg";
import { companyId, withCompany } from "@gradix/db";
import type { DashboardActor } from "./dashboard-aggregates";

export const DATA_HEALTH_HREFS = {
  unconfirmed_days: "/ured/radni-dani?filter=bez-potvrde",
  projects_without_budget: "/ured/projekti",
  machines_without_rate: "/ured/masine",
  workers_without_rate: "/ured/radnici",
  warehouses_without_minimum: "/ured/skladiste",
  incidents_without_actions: "/ured/hse",
} as const;

export type HealthItem = { key: keyof typeof DATA_HEALTH_HREFS; count: number; href: string };

export async function loadDataHealth(pool: Pool, actor: DashboardActor): Promise<{items: HealthItem[]} | null> {
  if (!actor.roles.some(role => role === "OWNER" || role === "ADMIN")) return null;
  const ids = actor.scope === "COMPANY" ? null : actor.scope === "PROJECTS" ? [...(actor.projectIds ?? [])] : [];
  return withCompany(pool, companyId(actor.companyId), async client => {
    const row = await client.query<Record<keyof typeof DATA_HEALTH_HREFS, number>>(`
      SELECT
        (SELECT count(*)::int FROM public.workdays d
          WHERE d.company_id=$1 AND d.status='SUBMITTED' AND d.approval_status='SUBMITTED'
            AND ($2::text[] IS NULL OR EXISTS (SELECT 1 FROM public.work_entries e
              WHERE e.company_id=d.company_id AND e.workday_id=d.id AND e.project_id=ANY($2::text[])))) AS unconfirmed_days,
        (SELECT count(*)::int FROM public.projects p WHERE p.company_id=$1 AND p.is_active AND p.status<>'CANCELLED'
          AND ($2::text[] IS NULL OR p.id=ANY($2::text[]))
          AND NOT EXISTS (SELECT 1 FROM public.project_budget_lines b WHERE b.company_id=p.company_id AND b.project_id=p.id)) AS projects_without_budget,
        (SELECT count(*)::int FROM public.machines m JOIN public.companies c ON c.id=m.company_id
          WHERE m.company_id=$1 AND m.is_active AND $2::text[] IS NULL
          AND NOT EXISTS (SELECT 1 FROM public.machine_cost_rates r WHERE r.company_id=m.company_id AND r.machine_id=m.id
            AND r.valid_from<=(clock_timestamp() AT TIME ZONE c.timezone)::date AND (r.valid_to IS NULL OR r.valid_to>=(clock_timestamp() AT TIME ZONE c.timezone)::date))
          AND NOT EXISTS (SELECT 1 FROM public.machine_cost_components r WHERE r.company_id=m.company_id AND r.machine_id=m.id
            AND r.valid_from<=(clock_timestamp() AT TIME ZONE c.timezone)::date AND (r.valid_to IS NULL OR r.valid_to>=(clock_timestamp() AT TIME ZONE c.timezone)::date))) AS machines_without_rate,
        (SELECT count(*)::int FROM public.workers w JOIN public.companies c ON c.id=w.company_id
          WHERE w.company_id=$1 AND w.is_active AND $2::text[] IS NULL
          AND NOT EXISTS (SELECT 1 FROM public.worker_rates r WHERE r.company_id=w.company_id AND r.worker_id=w.id
            AND r.rate_kind='HOURLY' AND r.valid_from<=(clock_timestamp() AT TIME ZONE c.timezone)::date
            AND (r.valid_to IS NULL OR r.valid_to>=(clock_timestamp() AT TIME ZONE c.timezone)::date))) AS workers_without_rate,
        (SELECT count(*)::int FROM public.warehouses w WHERE w.company_id=$1 AND w.is_active
          AND ($2::text[] IS NULL OR w.project_id=ANY($2::text[]))
          AND NOT EXISTS (SELECT 1 FROM public.stock_item_levels l WHERE l.company_id=w.company_id AND l.warehouse_id=w.id AND l.min_quantity>0)) AS warehouses_without_minimum,
        (SELECT count(*)::int FROM public.hse_incidents i WHERE i.company_id=$1 AND i.status<>'CLOSED'
          AND ($2::text[] IS NULL OR i.project_id=ANY($2::text[]))
          AND NOT EXISTS (SELECT 1 FROM public.hse_actions a WHERE a.company_id=i.company_id AND a.incident_id=i.id AND a.status<>'CANCELLED')) AS incidents_without_actions
    `, [actor.companyId, ids]);
    const values = row.rows[0]!;
    return {items: (Object.keys(DATA_HEALTH_HREFS) as Array<keyof typeof DATA_HEALTH_HREFS>)
      .filter(key => values[key] > 0).map(key => ({key, count: values[key], href: DATA_HEALTH_HREFS[key]}))};
  });
}
