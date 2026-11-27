/** Posted and pending machine ledger entries for the period. Caller supplies an authorized project scope. */
import type { PoolClient } from "pg";

export type MachinePeriodCost = { amounts: Array<{ currency: string; cents: string }>; pendingCount: number };
export async function machinePeriodCosts(client: PoolClient, input: {
  companyId: string; machineIds: readonly string[]; from: string; to: string;
  projectIds: readonly string[] | null; projectId?: string;
}): Promise<Map<string, MachinePeriodCost>> {
  if (!input.machineIds.length) return new Map();
  const result = await client.query<{ machine_id: string; currency_code: string | null; cents: string; pending: number }>(
    `SELECT e.machine_id, e.currency_code,
       coalesce(sum(e.amount_cents) FILTER (WHERE e.status='POSTED'),0)::text AS cents,
       count(*) FILTER (WHERE e.status='PENDING')::int AS pending
       FROM public.cost_entries e
      WHERE e.company_id=$1 AND e.machine_id=ANY($2::text[])
        AND e.occurred_on BETWEEN $3::date AND $4::date AND e.status IN ('POSTED','PENDING')
        AND ($5::text[] IS NULL OR e.project_id=ANY($5::text[]))
        AND ($6::text IS NULL OR e.project_id=$6)
      GROUP BY e.machine_id,e.currency_code ORDER BY e.machine_id,e.currency_code`,
    [input.companyId, input.machineIds, input.from, input.to, input.projectIds, input.projectId ?? null],
  );
  const byMachine = new Map<string, MachinePeriodCost>();
  for (const row of result.rows) {
    const item = byMachine.get(row.machine_id) ?? { amounts: [], pendingCount: 0 };
    item.pendingCount += row.pending;
    if (row.currency_code !== null) item.amounts.push({ currency: row.currency_code, cents: row.cents });
    byMachine.set(row.machine_id, item);
  }
  return byMachine;
}

export function formatMachineCost(cost: MachinePeriodCost | undefined): string {
  if (!cost?.amounts.length) return "";
  return cost.amounts.map(({currency,cents}) => {
    const value = BigInt(cents), abs = value < 0n ? -value : value;
    return `${value < 0n ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2,"0")} ${currency}`;
  }).join("; ");
}
