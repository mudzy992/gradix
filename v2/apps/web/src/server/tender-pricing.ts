/**
 * F7 — kalkulacija ponude: predmjer, resursi, obračun i revizije cijene (spec 08 §1.3).
 *
 * Pravila koja žive OVDJE:
 *
 *  - **Cijena se ne prepisuje, nego revidira.** Svaka promjena ponuđene vrijednosti je novi
 *    red u `tender_price_revisions`; odobrena revizija je jedini dokaz šta je poslano
 *    naručiocu. Zato nema `PATCH cijene` — postoji `POST /price-revisions`.
 *  - **Prag odobrenja je dva uslova** (izmjena > 5 % ILI marža ispod minimuma firme), i
 *    računa se u domeni (`priceChangeCheck`), ne u UI-u.
 *  - **Marža se ne šalje onome ko je ne smije vidjeti.** ACCOUNTANT dobija stavke i trošak,
 *    ali `calculation` mu vraća `FORBIDDEN` — isto pravilo kao satnice u Modulu 4.
 */
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import {
  calculateTender,
  formatPercent,
  isCurrency,
  marginPct,
  parsePercent,
  priceChangeCheck,
  toAmountString,
  type Currency,
} from "@gradix/domain";
import { writeAudit } from "./audit";
import { can } from "./permissions";
import type { TenderActor } from "./tender-service";

export type PricingOutcome<T> =
  | ({ outcome: "OK" } & T)
  | {
      outcome: "FORBIDDEN" | "VALIDATION_FAILED" | "CONFLICT" | "NOT_FOUND";
      code?: string;
      message?: string;
    };

export type TenderBoqItemRow = {
  id: string;
  code: string;
  description: string;
  unit: string;
  quantity: string;
  unitCostAmount: string;
  unitPriceAmount: string;
  totalCostAmount: string;
  sortOrder: number;
};

export type TenderResourceRow = {
  id: string;
  kind: "LABOR" | "MACHINE" | "MATERIAL" | "SUBCONTRACTOR" | "OTHER";
  description: string;
  quantity: string;
  unit: string;
  unitCostAmount: string;
  currencyCode: string;
  machineId: string | null;
  workerRateRef: string | null;
};

export type TenderCalculationView = {
  directCostAmount: string;
  boqCostAmount: string;
  resourcesCostAmount: string;
  baseAmount: string;
  offeredValueAmount: string;
  marginAmount: string;
  marginPct: string | null;
  markupPct: string;
  riskReservePct: string;
  discountPct: string;
  currencyCode: string;
  /** Nova revizija traži odobrenje (izmjena > 5 % ili marža ispod minimuma). */
  needsApproval: boolean;
  changePct: string | null;
  approvalReasons: Array<"ABOVE_CHANGE_THRESHOLD" | "BELOW_MIN_MARKUP">;
  minMarkupPct: string;
};

export type TenderPriceRevisionRow = {
  id: string;
  revision: number;
  offeredValueAmount: string;
  directCostAmount: string;
  markupPct: string;
  riskReservePct: string;
  discountPct: string;
  currencyCode: string;
  reason: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  createdAt: string;
};

const CENTS = (value: unknown) => BigInt(String(value ?? 0));

/** Provjera da tender postoji u firmi (RLS ne pušta tuđi red). */
async function tenderExists(client: PoolClient, companyId: string, tenderId: string): Promise<boolean> {
  const found = await client.query(`SELECT 1 FROM public.tenders WHERE id = $1 AND company_id = $2`, [
    tenderId,
    companyId,
  ]);
  return (found.rowCount ?? 0) > 0;
}

async function tenderCurrency(client: PoolClient, companyId: string, tenderId: string): Promise<Currency | null> {
  const row = await client.query<{ currency_code: string }>(
    `SELECT currency_code FROM public.tenders WHERE id = $1 AND company_id = $2`,
    [tenderId, companyId],
  );
  const code = row.rows[0]?.currency_code;
  return code && isCurrency(code) ? code : null;
}

/* ------------------------------------------------------------------ predmjer */

export async function listTenderBoq(
  pool: Pool,
  actor: TenderActor,
  tenderId: string,
): Promise<TenderBoqItemRow[] | { code: "FORBIDDEN" | "NOT_FOUND"; message: string }> {
  if (!can(actor.roles, "tenders.view")) return { code: "FORBIDDEN", message: "Nemate pravo pregleda." };
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    if (!(await tenderExists(client, actor.companyId, tenderId))) {
      return { code: "NOT_FOUND" as const, message: "Tender nije pronađen." };
    }
    const currency = (await tenderCurrency(client, actor.companyId, tenderId)) ?? "BAM";
    const rows = await client.query(
      `SELECT id, code, description, unit, quantity::text, unit_cost_cents, unit_price_cents, sort_order
         FROM public.tender_boq_items
        WHERE company_id = $1 AND tender_id = $2
        ORDER BY sort_order, code`,
      [actor.companyId, tenderId],
    );
    return rows.rows.map((row) => {
      const cost = CENTS(row.unit_cost_cents);
      return {
        id: String(row.id),
        code: String(row.code),
        description: String(row.description),
        unit: String(row.unit),
        quantity: String(row.quantity),
        unitCostAmount: toAmountString({ cents: cost, currency }),
        unitPriceAmount: toAmountString({ cents: CENTS(row.unit_price_cents), currency }),
        totalCostAmount: toAmountString({
          cents: divideRounded(parseQuantityOf(row.quantity) * cost, 1000n),
          currency,
        }),
        sortOrder: Number(row.sort_order),
      };
    });
  });
}

/**
 * Količina iz baze (`NUMERIC(14,3)`, string) u hiljadite dijelove — ista funkcija kao u
 * domeni, ali lokalna kopija bi se razila; zato se ovdje koristi `parseQuantity` iz domene
 * preko male omotnice da tip bude `bigint` bez `null` grane.
 */
function parseQuantityOf(value: unknown): bigint {
  const text = String(value);
  const [whole = "0", fraction = ""] = text.split(".");
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0").slice(0, 3));
}

function divideRounded(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

export type TenderBoqInput = {
  code: string;
  description: string;
  unit: string;
  quantity: string;
  unitCostAmount: string;
  unitPriceAmount?: string;
  sortOrder?: number;
};

export async function createTenderBoqItem(
  pool: Pool,
  actor: TenderActor,
  tenderId: string,
  input: TenderBoqInput,
): Promise<PricingOutcome<{ id: string }>> {
  if (!can(actor.roles, "tenders.price.manage")) return { outcome: "FORBIDDEN", code: "ROLE" };
  const invalid = validateBoq(input);
  if (invalid) return { outcome: "VALIDATION_FAILED", message: invalid };
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const currency = await tenderCurrency(client, actor.companyId, tenderId);
    if (!currency) return { outcome: "NOT_FOUND", message: "Tender nije pronađen." };
    const id = `tbi_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const cost = parseMoneyOrNull(input.unitCostAmount);
    const price = parseMoneyOrNull(input.unitPriceAmount ?? input.unitCostAmount);
    if (cost === null || price === null) {
      return { outcome: "VALIDATION_FAILED", message: "Neispravan iznos cijene." };
    }
    try {
      await client.query(
        `INSERT INTO public.tender_boq_items
           (id, company_id, tender_id, code, description, unit, quantity, unit_cost_cents,
            unit_price_cents, sort_order, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7::numeric,$8,$9,$10,$11,$11)`,
        [
          id, actor.companyId, tenderId, input.code.trim().toUpperCase(), input.description.trim(),
          input.unit.trim(), input.quantity.trim(), cost.toString(), price.toString(),
          input.sortOrder ?? 0, actor.userId,
        ],
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        return {
          outcome: "CONFLICT",
          code: "CONFLICT",
          message: `Stavka sa oznakom „${input.code.trim().toUpperCase()}“ već postoji.`,
        };
      }
      throw error;
    }
    await writeAudit(client, {
      companyId: actor.companyId, actorId: actor.userId, actorEmail: null,
      action: "tender.boq_item_added", entityType: "tender", entityId: tenderId,
      metadata: { code: input.code.trim().toUpperCase() },
    });
    return { outcome: "OK", id };
  });
}

export async function updateTenderBoqItem(
  pool: Pool,
  actor: TenderActor,
  tenderId: string,
  itemId: string,
  input: Partial<TenderBoqInput>,
): Promise<PricingOutcome<{ id: string }>> {
  if (!can(actor.roles, "tenders.price.manage")) return { outcome: "FORBIDDEN", code: "ROLE" };
  if (input.quantity !== undefined && !/^\d{1,11}(?:\.\d{1,3})?$/.test(input.quantity.trim())) {
    return { outcome: "VALIDATION_FAILED", message: "Količina mora biti broj (do tri decimale)." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const cost = input.unitCostAmount === undefined ? null : parseMoneyOrNull(input.unitCostAmount);
    const price = input.unitPriceAmount === undefined ? null : parseMoneyOrNull(input.unitPriceAmount);
    if (input.unitCostAmount !== undefined && cost === null) {
      return { outcome: "VALIDATION_FAILED", message: "Neispravan trošak stavke." };
    }
    if (input.unitPriceAmount !== undefined && price === null) {
      return { outcome: "VALIDATION_FAILED", message: "Neispravna cijena stavke." };
    }
    const updated = await client.query(
      `UPDATE public.tender_boq_items SET
         code = COALESCE($4, code),
         description = COALESCE($5, description),
         unit = COALESCE($6, unit),
         quantity = COALESCE($7::numeric, quantity),
         unit_cost_cents = COALESCE($8::bigint, unit_cost_cents),
         unit_price_cents = COALESCE($9::bigint, unit_price_cents),
         sort_order = COALESCE($10::int, sort_order),
         updated_by = $11, updated_at = clock_timestamp()
       WHERE id = $1 AND company_id = $2 AND tender_id = $3`,
      [
        itemId, actor.companyId, tenderId,
        input.code?.trim().toUpperCase() ?? null,
        input.description?.trim() ?? null,
        input.unit?.trim() ?? null,
        input.quantity?.trim() ?? null,
        cost?.toString() ?? null,
        price?.toString() ?? null,
        input.sortOrder ?? null,
        actor.userId,
      ],
    );
    if ((updated.rowCount ?? 0) === 0) return { outcome: "NOT_FOUND", message: "Stavka nije pronađena." };
    return { outcome: "OK", id: itemId };
  });
}

export async function deleteTenderBoqItem(
  pool: Pool,
  actor: TenderActor,
  tenderId: string,
  itemId: string,
): Promise<PricingOutcome<{ id?: string }>> {
  if (!can(actor.roles, "tenders.price.manage")) return { outcome: "FORBIDDEN", code: "ROLE" };
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const deleted = await client.query(
      `DELETE FROM public.tender_boq_items WHERE id = $1 AND company_id = $2 AND tender_id = $3`,
      [itemId, actor.companyId, tenderId],
    );
    if ((deleted.rowCount ?? 0) === 0) return { outcome: "NOT_FOUND", message: "Stavka nije pronađena." };
    return { outcome: "OK" as const };
  });
}

function validateBoq(input: TenderBoqInput): string | null {
  if (!input.code?.trim() || input.code.trim().length > 40) return "Oznaka stavke je obavezna (do 40 znakova).";
  if (!input.description?.trim() || input.description.trim().length > 500) {
    return "Opis stavke je obavezan (do 500 znakova).";
  }
  if (!input.unit?.trim() || input.unit.trim().length > 16) return "Jedinica mjere je obavezna (do 16 znakova).";
  if (!/^\d{1,11}(?:\.\d{1,3})?$/.test(input.quantity?.trim() ?? "") || Number(input.quantity) <= 0) {
    return "Količina mora biti broj veći od nule (do tri decimale).";
  }
  return null;
}

function parseMoneyOrNull(amount: string | undefined): bigint | null {
  if (amount === undefined) return null;
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(amount.trim())) return null;
  const [whole = "0", fraction = ""] = amount.trim().split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

/* ------------------------------------------------------------------ resursi */

export async function listTenderResources(
  pool: Pool,
  actor: TenderActor,
  tenderId: string,
): Promise<TenderResourceRow[] | { code: "FORBIDDEN" | "NOT_FOUND"; message: string }> {
  if (!can(actor.roles, "tenders.price.manage")) {
    return { code: "FORBIDDEN", message: "Nemate pravo pregleda kalkulacije." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    if (!(await tenderExists(client, actor.companyId, tenderId))) {
      return { code: "NOT_FOUND" as const, message: "Tender nije pronađen." };
    }
    const rows = await client.query(
      `SELECT id, kind, description, quantity::text, unit, unit_cost_cents, currency_code,
              machine_id, worker_rate_ref
         FROM public.tender_resources
        WHERE company_id = $1 AND tender_id = $2
        ORDER BY sort_order, description`,
      [actor.companyId, tenderId],
    );
    return rows.rows.map((row) => {
      const currency = String(row.currency_code) as Currency;
      return {
        id: String(row.id),
        kind: String(row.kind) as TenderResourceRow["kind"],
        description: String(row.description),
        quantity: String(row.quantity),
        unit: String(row.unit),
        unitCostAmount: toAmountString({ cents: CENTS(row.unit_cost_cents), currency }),
        currencyCode: currency,
        machineId: row.machine_id == null ? null : String(row.machine_id),
        workerRateRef: row.worker_rate_ref == null ? null : String(row.worker_rate_ref),
      };
    });
  });
}

export type TenderResourceInput = {
  kind: "LABOR" | "MACHINE" | "MATERIAL" | "SUBCONTRACTOR" | "OTHER";
  description: string;
  quantity: string;
  unit: string;
  unitCostAmount: string;
  machineId?: string | null;
  workerRateRef?: string | null;
  sortOrder?: number;
};

const RESOURCE_KINDS = ["LABOR", "MACHINE", "MATERIAL", "SUBCONTRACTOR", "OTHER"] as const;

export async function createTenderResource(
  pool: Pool,
  actor: TenderActor,
  tenderId: string,
  input: TenderResourceInput,
): Promise<PricingOutcome<{ id: string }>> {
  if (!can(actor.roles, "tenders.price.manage")) return { outcome: "FORBIDDEN", code: "ROLE" };
  if (!(RESOURCE_KINDS as readonly string[]).includes(input.kind)) {
    return { outcome: "VALIDATION_FAILED", message: "Nepoznata vrsta resursa." };
  }
  if (!input.description?.trim() || input.description.trim().length > 300) {
    return { outcome: "VALIDATION_FAILED", message: "Opis resursa je obavezan (do 300 znakova)." };
  }
  if (!/^\d{1,11}(?:\.\d{1,3})?$/.test(input.quantity?.trim() ?? "") || Number(input.quantity) <= 0) {
    return { outcome: "VALIDATION_FAILED", message: "Količina mora biti broj veći od nule." };
  }
  const cost = parseMoneyOrNull(input.unitCostAmount);
  if (cost === null) return { outcome: "VALIDATION_FAILED", message: "Neispravna jedinična cijena resursa." };

  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const currency = await tenderCurrency(client, actor.companyId, tenderId);
    if (!currency) return { outcome: "NOT_FOUND", message: "Tender nije pronađen." };
    if (input.machineId) {
      const machine = await client.query(`SELECT 1 FROM public.machines WHERE id = $1 AND company_id = $2`, [
        input.machineId,
        actor.companyId,
      ]);
      if ((machine.rowCount ?? 0) === 0) {
        return { outcome: "VALIDATION_FAILED", message: "Mašina nije pronađena u ovoj firmi." };
      }
    }
    const id = `trs_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    await client.query(
      `INSERT INTO public.tender_resources
         (id, company_id, tender_id, kind, description, quantity, unit, unit_cost_cents,
          currency_code, worker_rate_ref, machine_id, sort_order, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6::numeric,$7,$8,$9,$10,$11,$12,$13,$13)`,
      [
        id, actor.companyId, tenderId, input.kind, input.description.trim(),
        input.quantity.trim(), input.unit.trim().slice(0, 16), cost.toString(), currency,
        input.workerRateRef ?? null, input.machineId ?? null, input.sortOrder ?? 0, actor.userId,
      ],
    );
    return { outcome: "OK", id };
  });
}

export async function deleteTenderResource(
  pool: Pool,
  actor: TenderActor,
  tenderId: string,
  resourceId: string,
): Promise<PricingOutcome<{ id?: string }>> {
  if (!can(actor.roles, "tenders.price.manage")) return { outcome: "FORBIDDEN", code: "ROLE" };
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const deleted = await client.query(
      `DELETE FROM public.tender_resources WHERE id = $1 AND company_id = $2 AND tender_id = $3`,
      [resourceId, actor.companyId, tenderId],
    );
    if ((deleted.rowCount ?? 0) === 0) return { outcome: "NOT_FOUND", message: "Resurs nije pronađen." };
    return { outcome: "OK" as const };
  });
}

/**
 * Predlog cijene resursa iz šifarnika (§1.3/11): `worker_rates` daje satnicu radnika, a
 * `machine_cost_components` zbroj komponenti po satu. Vraća `null` kad podatka nema — bolje
 * prazno polje nego izmišljena cijena.
 */
export async function suggestResourceCost(
  pool: Pool,
  actor: TenderActor,
  tenderId: string,
  input: { kind: TenderResourceInput["kind"]; workerId?: string; machineId?: string },
): Promise<PricingOutcome<{ unitCostAmount: string | null }>> {
  if (!can(actor.roles, "tenders.price.manage")) return { outcome: "FORBIDDEN", code: "ROLE" };
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const currency = await tenderCurrency(client, actor.companyId, tenderId);
    if (!currency) return { outcome: "NOT_FOUND", message: "Tender nije pronađen." };
    if (input.kind === "LABOR" && input.workerId) {
      const rate = await client.query<{ amount_cents: string }>(
        `SELECT amount_cents FROM public.worker_rates
          WHERE company_id = $1 AND worker_id = $2 AND rate_kind = 'HOURLY'
            AND amount_cents IS NOT NULL AND valid_from <= current_date
            AND (valid_to IS NULL OR valid_to >= current_date)
          ORDER BY valid_from DESC LIMIT 1`,
        [actor.companyId, input.workerId],
      );
      const cents = rate.rows[0]?.amount_cents;
      return {
        outcome: "OK",
        unitCostAmount: cents ? toAmountString({ cents: BigInt(cents), currency }) : null,
      };
    }
    if (input.kind === "MACHINE" && input.machineId) {
      const sum = await client.query<{ total: string | null }>(
        `SELECT SUM(amount_cents)::text AS total FROM public.machine_cost_components
          WHERE company_id = $1 AND machine_id = $2 AND basis = 'PER_HOUR'
            AND valid_from <= current_date AND (valid_to IS NULL OR valid_to >= current_date)`,
        [actor.companyId, input.machineId],
      );
      const total = sum.rows[0]?.total;
      return {
        outcome: "OK",
        unitCostAmount: total ? toAmountString({ cents: BigInt(total), currency }) : null,
      };
    }
    return { outcome: "OK", unitCostAmount: null };
  });
}

/* ------------------------------------------------------------------ obračun */

type CalculationParams = {
  markupPct: string;
  riskReservePct: string;
  discountPct: string;
  minMarkupPct: string;
};

/**
 * Parametri obračuna: marža je na tenderu (zadnja odobrena revizija), a minimalna marža na
 * firmi. Rezerva i popust NISU kolone tendera — žive u reviziji, jer se mijenjaju s cijenom
 * i moraju ostati uz iznos koji su proizveli.
 */
async function loadCalculationParams(
  client: PoolClient,
  companyId: string,
  tenderId: string,
): Promise<CalculationParams> {
  const company = await client.query<{ min_markup_pct: string }>(
    `SELECT min_markup_pct::text FROM public.companies WHERE id = $1`,
    [companyId],
  );
  const latest = await client.query<{
    markup_pct: string;
    risk_reserve_pct: string;
    discount_pct: string;
  }>(
    `SELECT markup_pct::text, risk_reserve_pct::text, discount_pct::text
       FROM public.tender_price_revisions
      WHERE company_id = $1 AND tender_id = $2
      ORDER BY revision DESC LIMIT 1`,
    [companyId, tenderId],
  );
  const tender = await client.query<{ markup_pct: string | null }>(
    `SELECT markup_pct::text FROM public.tenders WHERE id = $1 AND company_id = $2`,
    [tenderId, companyId],
  );
  return {
    markupPct: latest.rows[0]?.markup_pct ?? tender.rows[0]?.markup_pct ?? "0.00",
    riskReservePct: latest.rows[0]?.risk_reserve_pct ?? "0.00",
    discountPct: latest.rows[0]?.discount_pct ?? "0.00",
    minMarkupPct: company.rows[0]?.min_markup_pct ?? "0.00",
  };
}

export type CalculateOptions = {
  markupPct?: string;
  riskReservePct?: string;
  discountPct?: string;
};

/**
 * Obračun ponude iz TRENUTNOG stanja predmjera i resursa. `markupPct`/`risk`/`discount` se
 * mogu poslati kao „šta bi bilo kad bi bilo“ (UI klizač), a bez njih se koristi zadnja
 * revizija — tako pregled i upis računaju istu stvar.
 */
export async function calculateTenderOffer(
  pool: Pool,
  actor: TenderActor,
  tenderId: string,
  options: CalculateOptions = {},
): Promise<PricingOutcome<{ calculation: TenderCalculationView }>> {
  if (!can(actor.roles, "tenders.price.manage")) {
    return { outcome: "FORBIDDEN", code: "ROLE", message: "Kalkulacija nije dostupna vašoj roli." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const currency = await tenderCurrency(client, actor.companyId, tenderId);
    if (!currency) return { outcome: "NOT_FOUND", message: "Tender nije pronađen." };
    const params = await loadCalculationParams(client, actor.companyId, tenderId);

    const boq = await client.query<{ quantity: string; unit_cost_cents: string }>(
      `SELECT quantity::text, unit_cost_cents FROM public.tender_boq_items
        WHERE company_id = $1 AND tender_id = $2 ORDER BY sort_order, code`,
      [actor.companyId, tenderId],
    );
    const resources = await client.query<{ quantity: string; unit_cost_cents: string }>(
      `SELECT quantity::text, unit_cost_cents FROM public.tender_resources
        WHERE company_id = $1 AND tender_id = $2 ORDER BY sort_order, description`,
      [actor.companyId, tenderId],
    );

    const markupPct = options.markupPct ?? params.markupPct;
    const riskReservePct = options.riskReservePct ?? params.riskReservePct;
    const discountPct = options.discountPct ?? params.discountPct;

    let calculation;
    try {
      calculation = calculateTender({
        boq: boq.rows.map((row) => ({ quantity: row.quantity, unitCostCents: CENTS(row.unit_cost_cents) })),
        resources: resources.rows.map((row) => ({
          quantity: row.quantity,
          unitCostCents: CENTS(row.unit_cost_cents),
        })),
        markupPct,
        riskReservePct,
        discountPct,
      });
    } catch {
      return { outcome: "VALIDATION_FAILED", message: "Procenti ili količine nijesu ispravni." };
    }

    const previous = await client.query<{ offered_value_cents: string }>(
      `SELECT offered_value_cents FROM public.tender_price_revisions
        WHERE company_id = $1 AND tender_id = $2 ORDER BY revision DESC LIMIT 1`,
      [actor.companyId, tenderId],
    );
    const previousCents = previous.rows[0] ? CENTS(previous.rows[0].offered_value_cents) : null;
    const check = priceChangeCheck(previousCents, calculation.offeredValueCents, markupPct, {
      minMarkupPct: params.minMarkupPct,
    });

    const money0 = (cents: bigint) => toAmountString({ cents, currency });
    return {
      outcome: "OK",
      calculation: {
        directCostAmount: money0(calculation.directCostCents),
        boqCostAmount: money0(calculation.boqCostCents),
        resourcesCostAmount: money0(calculation.resourcesCostCents),
        baseAmount: money0(calculation.baseCents),
        offeredValueAmount: money0(calculation.offeredValueCents),
        marginAmount: money0(calculation.marginCents),
        marginPct: marginPct(calculation),
        markupPct: formatPercent(parsePercent(markupPct) ?? 0n),
        riskReservePct: formatPercent(parsePercent(riskReservePct) ?? 0n),
        discountPct: formatPercent(parsePercent(discountPct) ?? 0n),
        currencyCode: currency,
        needsApproval: check.needsApproval,
        changePct: check.changePct,
        approvalReasons: check.reasons,
        minMarkupPct: params.minMarkupPct,
      },
    };
  });
}

/* ------------------------------------------------------------------ revizije */

export async function listTenderPriceRevisions(
  pool: Pool,
  actor: TenderActor,
  tenderId: string,
): Promise<TenderPriceRevisionRow[] | { code: "FORBIDDEN" | "NOT_FOUND"; message: string }> {
  if (!can(actor.roles, "tenders.price.manage")) {
    return { code: "FORBIDDEN", message: "Revizije cijene nijesu dostupne vašoj roli." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    if (!(await tenderExists(client, actor.companyId, tenderId))) {
      return { code: "NOT_FOUND" as const, message: "Tender nije pronađen." };
    }
    const rows = await client.query(
      `SELECT r.id, r.revision, r.offered_value_cents, r.direct_cost_cents, r.markup_pct::text,
              r.risk_reserve_pct::text, r.discount_pct::text, r.currency_code, r.reason,
              r.approved_at, r.created_at, u.first_name || ' ' || u.last_name AS approved_by_name
         FROM public.tender_price_revisions r
         LEFT JOIN public.users u ON u.id = r.approved_by
        WHERE r.company_id = $1 AND r.tender_id = $2
        ORDER BY r.revision DESC`,
      [actor.companyId, tenderId],
    );
    return rows.rows.map((row) => {
      const currency = String(row.currency_code) as Currency;
      return {
        id: String(row.id),
        revision: Number(row.revision),
        offeredValueAmount: toAmountString({ cents: CENTS(row.offered_value_cents), currency }),
        directCostAmount: toAmountString({ cents: CENTS(row.direct_cost_cents), currency }),
        markupPct: String(row.markup_pct),
        riskReservePct: String(row.risk_reserve_pct),
        discountPct: String(row.discount_pct),
        currencyCode: currency,
        reason: row.reason == null ? null : String(row.reason),
        approvedAt: row.approved_at == null ? null : new Date(String(row.approved_at)).toISOString(),
        approvedByName: row.approved_by_name == null ? null : String(row.approved_by_name),
        createdAt: new Date(String(row.created_at)).toISOString(),
      };
    });
  });
}

/**
 * Nova revizija ponude. Redoslijed je namjeran:
 *  1. obračun iz TRENUTNOG predmjera (cijena nije proizvoljan broj, nego rezultat),
 *  2. provjera praga (`priceChangeCheck`) — ako traži odobrenje, revizija se upisuje
 *     NEDOBRENA i ponuda se ne smije poslati iz nje,
 *  3. `current_revision` i `markup_pct` na tenderu se pomjeraju na novu reviziju.
 */
export async function createTenderPriceRevision(
  pool: Pool,
  actor: TenderActor,
  tenderId: string,
  input: { markupPct: string; riskReservePct: string; discountPct: string; reason?: string | null },
): Promise<PricingOutcome<{ revision: number; needsApproval: boolean; offeredValueAmount: string }>> {
  if (!can(actor.roles, "tenders.price.manage")) return { outcome: "FORBIDDEN", code: "ROLE" };
  const markup = parsePercent(input.markupPct);
  const risk = parsePercent(input.riskReservePct);
  const discount = parsePercent(input.discountPct);
  if (markup === null || risk === null || discount === null) {
    return { outcome: "VALIDATION_FAILED", message: "Procenti moraju biti brojevi sa do dvije decimale." };
  }
  if (discount < 0n || discount > 10_000n) {
    return { outcome: "VALIDATION_FAILED", message: "Popust mora biti između 0 i 100 %." };
  }
  if (risk < 0n || risk > 10_000n) {
    return { outcome: "VALIDATION_FAILED", message: "Rezerva za rizik mora biti između 0 i 100 %." };
  }

  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const tender = await client.query<{ status: string; currency_code: string }>(
      `SELECT status, currency_code FROM public.tenders WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [tenderId, actor.companyId],
    );
    const row = tender.rows[0];
    if (!row) return { outcome: "NOT_FOUND", message: "Tender nije pronađen." };
    const currency = String(row.currency_code) as Currency;

    const boq = await client.query<{ quantity: string; unit_cost_cents: string }>(
      `SELECT quantity::text, unit_cost_cents FROM public.tender_boq_items
        WHERE company_id = $1 AND tender_id = $2`,
      [actor.companyId, tenderId],
    );
    const resources = await client.query<{ quantity: string; unit_cost_cents: string }>(
      `SELECT quantity::text, unit_cost_cents FROM public.tender_resources
        WHERE company_id = $1 AND tender_id = $2`,
      [actor.companyId, tenderId],
    );
    const calculation = calculateTender({
      boq: boq.rows.map((r) => ({ quantity: r.quantity, unitCostCents: CENTS(r.unit_cost_cents) })),
      resources: resources.rows.map((r) => ({ quantity: r.quantity, unitCostCents: CENTS(r.unit_cost_cents) })),
      markupPct: formatPercent(markup),
      riskReservePct: formatPercent(risk),
      discountPct: formatPercent(discount),
    });

    const company = await client.query<{ min_markup_pct: string }>(
      `SELECT min_markup_pct::text FROM public.companies WHERE id = $1`,
      [actor.companyId],
    );
    const previous = await client.query<{ offered_value_cents: string }>(
      `SELECT offered_value_cents FROM public.tender_price_revisions
        WHERE company_id = $1 AND tender_id = $2 ORDER BY revision DESC LIMIT 1`,
      [actor.companyId, tenderId],
    );
    const previousCents = previous.rows[0] ? CENTS(previous.rows[0].offered_value_cents) : null;
    const check = priceChangeCheck(previousCents, calculation.offeredValueCents, formatPercent(markup), {
      minMarkupPct: company.rows[0]?.min_markup_pct ?? "0.00",
    });

    const nextRevision = Number(
      (
        await client.query<{ n: string }>(
          `SELECT COALESCE(MAX(revision), 0)::text AS n FROM public.tender_price_revisions
            WHERE company_id = $1 AND tender_id = $2`,
          [actor.companyId, tenderId],
        )
      ).rows[0]!.n,
    ) + 1;

    const autoApprove = !check.needsApproval;
    await client.query(
      `INSERT INTO public.tender_price_revisions
         (id, company_id, tender_id, revision, direct_cost_cents, markup_pct, risk_reserve_pct,
          discount_pct, offered_value_cents, currency_code, reason, approved_at, approved_by, created_by)
       VALUES ($1,$2,$3,$4,$5,$6::numeric,$7::numeric,$8::numeric,$9,$10,$11,$12,$13,$14)`,
      [
        `tpr_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        actor.companyId,
        tenderId,
        nextRevision,
        calculation.directCostCents.toString(),
        formatPercent(markup),
        formatPercent(risk),
        formatPercent(discount),
        calculation.offeredValueCents.toString(),
        currency,
        input.reason?.trim() || null,
        autoApprove ? new Date().toISOString() : null,
        autoApprove ? actor.userId : null,
        actor.userId,
      ],
    );

    await client.query(
      `UPDATE public.tenders SET current_revision = $3, markup_pct = $4::numeric,
              submitted_value_cents = $5::bigint, price_source = 'CALCULATED',
              updated_by = $6, updated_at = clock_timestamp()
        WHERE id = $1 AND company_id = $2`,
      [tenderId, actor.companyId, nextRevision, formatPercent(markup), calculation.offeredValueCents.toString(), actor.userId],
    );

    await writeAudit(client, {
      companyId: actor.companyId, actorId: actor.userId, actorEmail: null,
      action: "tender.price_revised", entityType: "tender", entityId: tenderId,
      metadata: {
        revision: nextRevision,
        needsApproval: check.needsApproval,
        reasons: check.reasons,
        changePct: check.changePct,
      },
    });

    return {
      outcome: "OK",
      revision: nextRevision,
      needsApproval: check.needsApproval,
      offeredValueAmount: toAmountString({ cents: calculation.offeredValueCents, currency }),
    };
  });
}

/**
 * Odobrenje revizije (`tenders.price.approve`, OWNER/ADMIN). Samo odobrenje mijenja
 * `approved_at`/`approved_by`; iznos se NE dira — triger u bazi bi ga odbio.
 */
export async function approveTenderPriceRevision(
  pool: Pool,
  actor: TenderActor,
  tenderId: string,
  revision: number,
): Promise<PricingOutcome<{ revision: number }>> {
  if (!can(actor.roles, "tenders.price.approve")) {
    return { outcome: "FORBIDDEN", code: "ROLE", message: "Odobrenje cijene traži vlasnika ili administratora." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const found = await client.query<{ approved_at: string | null }>(
      `SELECT approved_at FROM public.tender_price_revisions
        WHERE company_id = $1 AND tender_id = $2 AND revision = $3`,
      [actor.companyId, tenderId, revision],
    );
    if (!found.rows[0]) return { outcome: "NOT_FOUND", message: "Revizija nije pronađena." };
    if (found.rows[0].approved_at) {
      return { outcome: "CONFLICT", code: "CONFLICT", message: "Revizija je već odobrena." };
    }
    await client.query(
      `UPDATE public.tender_price_revisions SET approved_at = clock_timestamp(), approved_by = $4
        WHERE company_id = $1 AND tender_id = $2 AND revision = $3`,
      [actor.companyId, tenderId, revision, actor.userId],
    );
    await writeAudit(client, {
      companyId: actor.companyId, actorId: actor.userId, actorEmail: null,
      action: "tender.price_approved", entityType: "tender", entityId: tenderId,
      metadata: { revision },
    });
    return { outcome: "OK", revision };
  });
}

/** Zadnja odobrena revizija — osnov za `contract_value_cents` pri konverziji (§1.6/22.1). */
export async function approvedRevisionValue(
  client: PoolClient,
  companyId: string,
  tenderId: string,
): Promise<{ cents: bigint; currency: Currency } | null> {
  const row = await client.query<{ offered_value_cents: string; currency_code: string }>(
    `SELECT offered_value_cents, currency_code FROM public.tender_price_revisions
      WHERE company_id = $1 AND tender_id = $2 AND approved_at IS NOT NULL
      ORDER BY revision DESC LIMIT 1`,
    [companyId, tenderId],
  );
  const found = row.rows[0];
  if (!found) return null;
  return { cents: CENTS(found.offered_value_cents), currency: String(found.currency_code) as Currency };
}
