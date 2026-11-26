/** Data quality counts and filtered lists share one set of tenant-scoped predicates. */
import type { Pool } from "pg";
import { companyId, withCompany } from "@gradix/db";
import type { DashboardActor } from "./dashboard-aggregates";
import { HEALTH_QUERIES, type HealthKey } from "./data-health-queries";

export const DATA_HEALTH_HREFS = {
  unconfirmed_days: "/ured/radni-dani?filter=bez-potvrde",
  projects_without_budget: "/ured/projekti?filter=bez-budzeta",
  machines_without_rate: "/ured/masine?filter=bez-stope",
  workers_without_rate: "/ured/radnici?filter=bez-satnice",
  warehouses_without_minimum: "/ured/skladiste?filter=bez-minimuma",
  incidents_without_actions: "/ured/hse?filter=bez-mjera",
} as const;
export type HealthItem = { key: HealthKey; count: number; href: string };
const allowed = (actor: DashboardActor) => actor.roles.some(role => role === "OWNER" || role === "ADMIN");
const scopeIds = (actor: DashboardActor) => actor.scope === "COMPANY" ? null : actor.scope === "PROJECTS" ? [...(actor.projectIds ?? [])] : [];

export async function loadDataHealth(pool: Pool, actor: DashboardActor): Promise<{items: HealthItem[]} | null> {
  if (!allowed(actor)) return null;
  return withCompany(pool, companyId(actor.companyId), async client => {
    const params = [actor.companyId, scopeIds(actor)];
    const keys = Object.keys(HEALTH_QUERIES) as HealthKey[];
    const sql = keys.map(key => `(SELECT count(*)::int FROM (${HEALTH_QUERIES[key]}) health) AS ${key}`).join(",\n");
    const result = await client.query<Record<HealthKey, number>>(`SELECT ${sql}`, params);
    const values = result.rows[0]!;
    return {items: keys.filter(key => values[key] > 0).map(key => ({key, count: values[key], href: DATA_HEALTH_HREFS[key]}))};
  });
}

/** Owner/admin only, paginated under the same scope and RLS as the counts. */
export async function listDataHealth(pool: Pool, actor: DashboardActor, key: HealthKey, page: number) {
  if (!allowed(actor)) return null;
  const safePage = Number.isSafeInteger(page) && page > 0 && page <= 100000 ? page : 1;
  return withCompany(pool, companyId(actor.companyId), async client => {
    const result = await client.query<{id:string; label:string}>(
      `SELECT id, label FROM (${HEALTH_QUERIES[key]}) health ORDER BY label, id LIMIT 101 OFFSET $3`,
      [actor.companyId, scopeIds(actor), (safePage - 1) * 100]);
    return {rows: result.rows.slice(0,100), hasMore: result.rows.length > 100, page: safePage};
  });
}
