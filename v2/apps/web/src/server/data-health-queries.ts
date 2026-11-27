/** Shared predicates keep the dashboard counts and filtered destination lists identical. */
export const HEALTH_QUERIES = {
  unconfirmed_days: `SELECT d.id, d.work_date::text AS label FROM public.workdays d
    WHERE d.company_id=$1 AND d.status='SUBMITTED' AND d.approval_status='SUBMITTED'
      AND ($2::text[] IS NULL OR EXISTS (SELECT 1 FROM public.work_entries e
        WHERE e.company_id=d.company_id AND e.workday_id=d.id AND e.project_id=ANY($2::text[])))`,
  projects_without_budget: `SELECT p.id, p.code || ' — ' || p.name AS label FROM public.projects p
    WHERE p.company_id=$1 AND p.is_active AND p.status<>'CANCELLED'
      AND ($2::text[] IS NULL OR p.id=ANY($2::text[]))
      AND NOT EXISTS (SELECT 1 FROM public.project_budget_lines b WHERE b.company_id=p.company_id AND b.project_id=p.id)`,
  machines_without_rate: `SELECT m.id, m.code || ' — ' || m.name AS label FROM public.machines m JOIN public.companies c ON c.id=m.company_id
    WHERE m.company_id=$1 AND m.is_active AND $2::text[] IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.machine_cost_rates r WHERE r.company_id=m.company_id AND r.machine_id=m.id
        AND r.valid_from<=(clock_timestamp() AT TIME ZONE c.timezone)::date AND (r.valid_to IS NULL OR r.valid_to>=(clock_timestamp() AT TIME ZONE c.timezone)::date))
      AND NOT EXISTS (SELECT 1 FROM public.machine_cost_components r WHERE r.company_id=m.company_id AND r.machine_id=m.id
        AND r.valid_from<=(clock_timestamp() AT TIME ZONE c.timezone)::date AND (r.valid_to IS NULL OR r.valid_to>=(clock_timestamp() AT TIME ZONE c.timezone)::date))`,
  workers_without_rate: `SELECT w.id, w.first_name || ' ' || w.last_name AS label FROM public.workers w JOIN public.companies c ON c.id=w.company_id
    WHERE w.company_id=$1 AND w.is_active AND $2::text[] IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.worker_rates r WHERE r.company_id=w.company_id AND r.worker_id=w.id
        AND r.rate_kind='HOURLY' AND r.valid_from<=(clock_timestamp() AT TIME ZONE c.timezone)::date
        AND (r.valid_to IS NULL OR r.valid_to>=(clock_timestamp() AT TIME ZONE c.timezone)::date))`,
  warehouses_without_minimum: `SELECT w.id, w.code || ' — ' || w.name AS label FROM public.warehouses w
    WHERE w.company_id=$1 AND w.is_active AND ($2::text[] IS NULL OR w.project_id=ANY($2::text[]))
      AND NOT EXISTS (SELECT 1 FROM public.stock_item_levels l WHERE l.company_id=w.company_id AND l.warehouse_id=w.id AND l.min_quantity>0)`,
  incidents_without_actions: `SELECT i.id, left(i.description,120) AS label FROM public.hse_incidents i
    WHERE i.company_id=$1 AND i.status<>'CLOSED' AND ($2::text[] IS NULL OR i.project_id=ANY($2::text[]))
      AND NOT EXISTS (SELECT 1 FROM public.hse_actions a WHERE a.company_id=i.company_id AND a.incident_id=i.id AND a.status<>'CANCELLED')`,
} as const;
export type HealthKey = keyof typeof HEALTH_QUERIES;
