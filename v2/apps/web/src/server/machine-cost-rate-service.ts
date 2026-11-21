/** R6.1: lista i upsert stopa troška mašine (Money). */
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import { isCurrency, money, toAmountString, type Currency } from "@gradix/domain";
import { can } from "./permissions";
import type {
  CostRateActor,
  CostRateRow,
  DbRateRow,
  MutationOutcome,
  UpsertRateInput,
} from "./machine-cost-rate-types";

async function companyCurrency(client: PoolClient, companyId: string): Promise<Currency> {
  const row = await client.query<{ currency: string }>(
    "SELECT currency FROM public.companies WHERE id = $1",
    [companyId],
  );
  const code = row.rows[0]?.currency ?? "BAM";
  return isCurrency(code) ? code : "BAM";
}

function mapRow(row: DbRateRow): CostRateRow {
  const currency = (isCurrency(row.currency_code) ? row.currency_code : "BAM") as Currency;
  return {
    id: row.id,
    machine_id: row.machine_id,
    machine_code: row.machine_code,
    machine_name: row.machine_name,
    amount: toAmountString({ cents: BigInt(row.amount_cents), currency }),
    currency_code: row.currency_code,
    valid_from: row.valid_from.slice(0, 10),
    valid_to: row.valid_to ? row.valid_to.slice(0, 10) : null,
    created_at: row.created_at,
  };
}

export async function listMachineCostRates(
  pool: Pool,
  actor: CostRateActor,
  machineId?: string,
): Promise<CostRateRow[]> {
  if (!can(actor.roles, "machines.cost_rate.view")) return [];
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const params: unknown[] = [actor.companyId];
    let filter = "";
    if (machineId) {
      params.push(machineId);
      filter = ` AND r.machine_id = $2`;
    }
    const result = await client.query<DbRateRow>(
      `SELECT r.id, r.machine_id, m.code AS machine_code, m.name AS machine_name,
              r.amount_cents::text, r.currency_code,
              r.valid_from::text, r.valid_to::text, r.created_at::text
         FROM public.machine_cost_rates r
         JOIN public.machines m ON m.company_id = r.company_id AND m.id = r.machine_id
        WHERE r.company_id = $1${filter}
        ORDER BY m.code, r.valid_from DESC, r.id
        LIMIT 500`,
      params,
    );
    return result.rows.map(mapRow);
  });
}

export async function upsertMachineCostRate(
  pool: Pool,
  actor: CostRateActor,
  input: UpsertRateInput,
): Promise<MutationOutcome> {
  if (!can(actor.roles, "machines.cost_rate.manage")) {
    return { outcome: "FORBIDDEN", code: "ROLE", message: "Nemate pravo upravljanja stopom." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.validFrom)) {
    return { outcome: "VALIDATION_FAILED", code: "VALID_FROM", message: "validFrom mora biti YYYY-MM-DD." };
  }
  if (input.validTo != null && input.validTo !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(input.validTo)) {
    return { outcome: "VALIDATION_FAILED", code: "VALID_TO", message: "validTo mora biti YYYY-MM-DD." };
  }
  if (input.validTo && input.validTo < input.validFrom) {
    return { outcome: "VALIDATION_FAILED", code: "RANGE", message: "validTo ne smije biti prije validFrom." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const machine = await client.query<{ id: string }>(
      "SELECT id FROM public.machines WHERE company_id = $1 AND id = $2",
      [actor.companyId, input.machineId],
    );
    if (!machine.rows[0]) {
      return { outcome: "VALIDATION_FAILED", code: "MACHINE", message: "Mašina nije pronađena." };
    }
    const currency = input.currencyCode && isCurrency(input.currencyCode)
      ? input.currencyCode
      : await companyCurrency(client, actor.companyId);
    let parsed;
    try {
      parsed = money(input.amount, currency);
    } catch {
      return { outcome: "VALIDATION_FAILED", code: "AMOUNT", message: "Neispravan iznos (Money string)." };
    }
    if (parsed.cents < 0n) {
      return { outcome: "VALIDATION_FAILED", code: "AMOUNT", message: "Iznos ne smije biti negativan." };
    }
    if (input.id) {
      const updated = await client.query<{ id: string }>(
        `UPDATE public.machine_cost_rates
            SET amount_cents = $3, currency_code = $4, valid_from = $5::date,
                valid_to = $6::date, updated_by = $7, updated_at = clock_timestamp()
          WHERE company_id = $1 AND id = $2
          RETURNING id`,
        [
          actor.companyId, input.id, parsed.cents.toString(), currency,
          input.validFrom, input.validTo ?? null, actor.userId,
        ],
      );
      if (!updated.rows[0]) {
        return { outcome: "VALIDATION_FAILED", code: "NOT_FOUND", message: "Stopa nije pronađena." };
      }
      return { outcome: "OK", id: updated.rows[0].id };
    }
    await client.query(
      `UPDATE public.machine_cost_rates
          SET valid_to = ($3::date - interval '1 day')::date,
              updated_by = $4, updated_at = clock_timestamp()
        WHERE company_id = $1 AND machine_id = $2 AND valid_to IS NULL
          AND valid_from < $3::date`,
      [actor.companyId, input.machineId, input.validFrom, actor.userId],
    );
    const id = randomUUID();
    await client.query(
      `INSERT INTO public.machine_cost_rates
         (id, company_id, machine_id, amount_cents, currency_code, valid_from, valid_to, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6::date,$7::date,$8,$8)`,
      [
        id, actor.companyId, input.machineId, parsed.cents.toString(), currency,
        input.validFrom, input.validTo ?? null, actor.userId,
      ],
    );
    return { outcome: "OK", id };
  });
}
