/** R6.1: lista knjiženja i book period/workLogIds (idempotentno). */
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import {
  computeCostAmount,
  computeHoursFromInterval,
  isCurrency,
  toAmountString,
  type Currency,
} from "@gradix/domain";
import { can } from "./permissions";
import type {
  BookInput,
  BookOutcome,
  DbEntryRow,
  DbWorkLogRow,
  ListCostFilters,
  ProjectCostActor,
  ProjectCostEntryRow,
} from "./project-cost-types";

function mapEntry(row: DbEntryRow): ProjectCostEntryRow {
  const currency = (isCurrency(row.currency_code) ? row.currency_code : "BAM") as Currency;
  return {
    id: row.id,
    project_id: row.project_id,
    project_code: row.project_code,
    project_name: row.project_name,
    source_type: "MACHINE_WORK_LOG",
    source_id: row.source_id,
    machine_id: row.machine_id,
    machine_code: row.machine_code,
    machine_name: row.machine_name,
    hours: row.hours,
    rate: toAmountString({ cents: BigInt(row.rate_cents), currency }),
    amount: toAmountString({ cents: BigInt(row.amount_cents), currency }),
    currency_code: row.currency_code,
    booked_at: row.booked_at,
    note: row.note,
  };
}

export async function listProjectCostEntries(
  pool: Pool,
  actor: ProjectCostActor,
  filters: ListCostFilters,
): Promise<ProjectCostEntryRow[]> {
  if (!can(actor.roles, "projects.costs.view")) return [];
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const conditions = ["e.company_id = $1"];
    const params: unknown[] = [actor.companyId];
    let idx = 2;
    if (filters.projectId) {
      conditions.push(`e.project_id = $${idx}`);
      params.push(filters.projectId);
      idx += 1;
    }
    if (filters.from) {
      conditions.push(`e.booked_at >= $${idx}::timestamptz`);
      params.push(filters.from);
      idx += 1;
    }
    if (filters.to) {
      conditions.push(`e.booked_at <= $${idx}::timestamptz`);
      params.push(filters.to);
      idx += 1;
    }
    const result = await client.query<DbEntryRow>(
      `SELECT e.id, e.project_id, p.code AS project_code, p.name AS project_name,
              e.source_type, e.source_id, e.machine_id,
              m.code AS machine_code, m.name AS machine_name,
              e.hours::text, e.rate_cents::text, e.amount_cents::text,
              e.currency_code, e.booked_at::text, e.note
         FROM public.project_cost_entries e
         JOIN public.projects p ON p.company_id = e.company_id AND p.id = e.project_id
         JOIN public.machines m ON m.company_id = e.company_id AND m.id = e.machine_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY e.booked_at DESC, e.id
        LIMIT 500`,
      params,
    );
    return result.rows.map(mapEntry);
  });
}

async function findRate(
  client: PoolClient,
  companyId: string,
  machineId: string,
  onDate: string,
): Promise<{ amount_cents: string; currency_code: string } | null> {
  const result = await client.query<{ amount_cents: string; currency_code: string }>(
    `SELECT amount_cents::text, currency_code
       FROM public.machine_cost_rates
      WHERE company_id = $1 AND machine_id = $2
        AND valid_from <= $3::date
        AND (valid_to IS NULL OR valid_to >= $3::date)
      ORDER BY valid_from DESC
      LIMIT 1`,
    [companyId, machineId, onDate],
  );
  return result.rows[0] ?? null;
}

export async function bookProjectCosts(
  pool: Pool,
  actor: ProjectCostActor,
  input: BookInput,
): Promise<BookOutcome> {
  if (!can(actor.roles, "projects.costs.book")) {
    return { outcome: "FORBIDDEN", code: "ROLE", message: "Nemate pravo knjiženja." };
  }
  const hasIds = Array.isArray(input.workLogIds) && input.workLogIds.length > 0;
  const hasRange = Boolean(input.from || input.to);
  if (!hasIds && !hasRange) {
    return {
      outcome: "VALIDATION_FAILED",
      code: "INPUT",
      message: "Potrebni su from/to ili workLogIds.",
    };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const conditions = ["mwl.company_id = $1", "mwl.project_id IS NOT NULL"];
    const params: unknown[] = [actor.companyId];
    let idx = 2;
    if (hasIds) {
      conditions.push(`mwl.id = ANY($${idx}::text[])`);
      params.push(input.workLogIds);
      idx += 1;
    }
    if (input.from) {
      conditions.push(`mwl.started_at >= $${idx}::timestamptz`);
      params.push(input.from);
      idx += 1;
    }
    if (input.to) {
      conditions.push(`mwl.ended_at <= $${idx}::timestamptz`);
      params.push(input.to);
      idx += 1;
    }
    const logs = await client.query<DbWorkLogRow>(
      `SELECT mwl.id, mwl.machine_id, mwl.project_id, mwl.started_at::text, mwl.ended_at::text
         FROM public.machine_work_logs mwl
        WHERE ${conditions.join(" AND ")}
        ORDER BY mwl.started_at, mwl.id
        LIMIT 500`,
      params,
    );
    if (logs.rows.length === 0) {
      return {
        outcome: "VALIDATION_FAILED",
        code: "EMPTY",
        message: "Nema radnih sati za knjiženje.",
      };
    }
    let booked = 0;
    let skippedExisting = 0;
    let skippedNoRate = 0;
    for (const log of logs.rows) {
      if (!log.project_id) continue;
      const onDate = log.started_at.slice(0, 10);
      const rate = await findRate(client, actor.companyId, log.machine_id, onDate);
      if (!rate) {
        skippedNoRate += 1;
        continue;
      }
      const currency = (isCurrency(rate.currency_code) ? rate.currency_code : "BAM") as Currency;
      const hours = computeHoursFromInterval(new Date(log.started_at), new Date(log.ended_at));
      const amount = computeCostAmount(hours, BigInt(rate.amount_cents), currency);
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO public.project_cost_entries
           (id, company_id, project_id, source_type, source_id, machine_id,
            hours, rate_cents, amount_cents, currency_code, booked_by, note)
         VALUES ($1,$2,$3,'MACHINE_WORK_LOG',$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (company_id, source_type, source_id) DO NOTHING
         RETURNING id`,
        [
          randomUUID(), actor.companyId, log.project_id, log.id, log.machine_id,
          hours.toFixed(3), rate.amount_cents, amount.cents.toString(), currency,
          actor.userId, input.note ?? null,
        ],
      );
      if (inserted.rows[0]) booked += 1;
      else skippedExisting += 1;
    }
    if (booked === 0 && skippedNoRate > 0 && skippedExisting === 0) {
      return {
        outcome: "VALIDATION_FAILED",
        code: "NO_RATE",
        message: "Nema stope troška za mašinu u periodu — knjiženje nije moguće.",
        booked: 0,
        skippedExisting: 0,
        skippedNoRate,
      };
    }
    return { outcome: "OK", booked, skippedExisting, skippedNoRate };
  });
}
