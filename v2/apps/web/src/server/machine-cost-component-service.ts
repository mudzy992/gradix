/**
 * F4 (Modul 5 §1.1) — razložen trošak mašine: komponente, izračunata stopa, ručna stopa i snapshot.
 *
 * Tri odluke koje ovaj modul nosi i koje ne smiju završiti u UI-u:
 *
 *  1. **Istorija, ne prepisivanje.** Nova vrijednost komponente je NOVI red; stari dobija
 *     `valid_to`. Zato `createComponent` prvo zatvara otvoreni red istog tipa. Bez toga bi
 *     promjena depresijacije tiho promijenila i troškove proknjižene prije godinu dana.
 *  2. **Ručna stopa je odstupanje, ne tiho stanje.** Ide u audit SA RAZLOGOM (≥10 znakova) i
 *     ekran uvijek pokazuje OBA broja — izračunati i ručni. „Vrati na izračunato" zatvara ručni
 *     red (`valid_to`), ne briše ga: brisanje bi izbrisalo dokaz da je neko nadjačao obračun.
 *  3. **Snapshot pri knjiženju.** Kad `project_cost_entries` dobije trošak, u istom upisu ide i
 *     zamrznuta stopa sa razlaganjem. Baza (`project_cost_snapshot_immutable`) brani kasniju
 *     izmjenu — snapshot je dokaz, ne keš.
 */
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import {
  computedRatePerHour,
  isCurrency,
  money,
  toAmountString,
  type CostBasis,
  type CostComponent,
  type CostComponentRow,
  type Currency,
} from "@gradix/domain";
import { writeAudit } from "./audit";
import { can, type Role } from "./permissions";

export type CostActor = { userId: string; companyId: string; roles: readonly Role[] };

export type CostComponentView = {
  id: string;
  machine_id: string;
  component: CostComponent;
  basis: CostBasis;
  amount: string;
  currency_code: string;
  valid_from: string;
  valid_to: string | null;
  note: string | null;
  created_at: string;
};

export type CostRateView = {
  machine_id: string;
  machine_code: string;
  machine_name: string;
  calculated_rate: string;
  manual_rate: string | null;
  manual_reason: string | null;
  effective_rate: string;
  is_manual: boolean;
  currency_code: string;
  planned_hours_per_month: number;
  breakdown: {
    component: CostComponent;
    basis: CostBasis;
    amount: string;
    cents_per_hour: string;
  }[];
};

export type ComponentInput = {
  id?: string;
  machineId: string;
  component: CostComponent;
  basis: CostBasis;
  amount: string;
  currencyCode?: string;
  validFrom: string;
  validTo?: string | null;
  note?: string | null;
};

export type RateInput = {
  machineId: string;
  amount: string | null;
  reason?: string | null;
  validFrom: string;
};

export type ServiceOutcome =
  | { outcome: "OK"; id: string }
  | { outcome: "FORBIDDEN"; code: string; message?: string }
  | { outcome: "VALIDATION_FAILED"; code: string; message: string }
  | { outcome: "CONFLICT"; code: string; message: string };

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

async function companyCurrency(client: PoolClient, companyId: string): Promise<Currency> {
  const row = await client.query<{ currency: string }>(
    "SELECT currency FROM public.companies WHERE id = $1",
    [companyId],
  );
  const code = row.rows[0]?.currency ?? "BAM";
  return isCurrency(code) ? code : "BAM";
}

async function plannedHours(client: PoolClient, companyId: string): Promise<number> {
  const row = await client.query<{ planned_hours_per_month: number }>(
    "SELECT planned_hours_per_month FROM public.companies WHERE id = $1",
    [companyId],
  );
  return Number(row.rows[0]?.planned_hours_per_month ?? 160);
}

const toComponent = (row: {
  id: string;
  machine_id: string;
  component: string;
  basis: string;
  amount_cents: string;
  currency_code: string;
  valid_from: string;
  valid_to: string | null;
  note: string | null;
  created_at: string;
}): CostComponentView => {
  const currency = (isCurrency(row.currency_code) ? row.currency_code : "BAM") as Currency;
  return {
    id: row.id,
    machine_id: row.machine_id,
    component: row.component as CostComponent,
    basis: row.basis as CostBasis,
    amount: toAmountString({ cents: BigInt(row.amount_cents), currency }),
    currency_code: row.currency_code,
    valid_from: row.valid_from.slice(0, 10),
    valid_to: row.valid_to ? row.valid_to.slice(0, 10) : null,
    note: row.note,
    created_at: row.created_at,
  };
};

const COMPONENT_SELECT = `SELECT c.id, c.machine_id, c.component, c.basis, c.amount_cents::text,
         c.currency_code, c.valid_from::text, c.valid_to::text, c.note, c.created_at::text`;

export async function listCostComponents(
  pool: Pool,
  actor: CostActor,
  machineId: string,
): Promise<CostComponentView[]> {
  if (!can(actor.roles, "machines.cost_rate.view")) return [];
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const result = await client.query(
      `${COMPONENT_SELECT}
         FROM public.machine_cost_components c
        WHERE c.company_id = $1 AND c.machine_id = $2
        ORDER BY c.component, c.valid_from DESC`,
      [actor.companyId, machineId],
    );
    return result.rows.map(toComponent);
  });
}

/**
 * Komponente koje VAŽE na datum — jedini ulaz u izračunatu stopu.
 *
 * `valid_to` je uključiv (`BETWEEN`-semantika): dan kada komponenta prestaje da važi još je
 * njen. Isto pravilo kao kod satnica radnika, pa se dvije stope ne mogu razići u tumačenju.
 */
export async function componentsOnDate(
  client: PoolClient,
  companyId: string,
  machineId: string,
  onDate: string,
): Promise<{ row: CostComponentRow; amount_cents: string; currency_code: string; basis: CostBasis }[]> {
  const result = await client.query<{
    component: string;
    basis: string;
    amount_cents: string;
    currency_code: string;
  }>(
    `SELECT component, basis, amount_cents::text, currency_code
       FROM public.machine_cost_components
      WHERE company_id = $1 AND machine_id = $2
        AND valid_from <= $3::date
        AND (valid_to IS NULL OR valid_to >= $3::date)`,
    [companyId, machineId, onDate],
  );
  return result.rows.map((row) => ({
    row: {
      component: row.component as CostComponent,
      basis: row.basis as CostBasis,
      amountCents: BigInt(row.amount_cents),
      currencyCode: row.currency_code,
    },
    amount_cents: row.amount_cents,
    currency_code: row.currency_code,
    basis: row.basis as CostBasis,
  }));
}

/** Ručna stopa koja važi na datum, ako postoji. */
async function manualRateOn(
  client: PoolClient,
  companyId: string,
  machineId: string,
  onDate: string,
): Promise<{ amount_cents: string; currency_code: string; reason: string | null } | null> {
  const result = await client.query<{ amount_cents: string; currency_code: string; reason: string | null }>(
    `SELECT amount_cents::text, currency_code, reason
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

/**
 * Izračunata stopa + razlaganje + ručna stopa.
 *
 * `onDate` je opcion: za ekran „trošak mašina" pita se za danas, a za knjiženje se koristi dan
 * zapisa rada. Bez datuma bi trošak zavisio od toga kada je knjiženje pokrenuto — a to nije
 * događaj koji je u zapisu.
 */
export async function getMachineCostRate(
  pool: Pool,
  actor: CostActor,
  machineId: string,
  onDate?: string,
): Promise<CostRateView | null> {
  if (!can(actor.roles, "machines.cost_rate.view")) return null;
  return withCompany(pool, toCompanyId(actor.companyId), client => getMachineCostRateWithClient(client, actor, machineId, onDate));
}

/** Same computation as the cost screen, without opening a nested tenant transaction. */
export async function getMachineCostRateWithClient(
  client: PoolClient, actor: CostActor, machineId: string, onDate?: string,
): Promise<CostRateView | null> {
  if (!can(actor.roles, "machines.cost_rate.view")) return null;
    const machine = await client.query<{ id: string; code: string; name: string }>(
      "SELECT id, code, name FROM public.machines WHERE company_id = $1 AND id = $2",
      [actor.companyId, machineId],
    );
    if (!machine.rows[0]) return null;
    const today = await client.query<{ today: string }>(
      `SELECT (clock_timestamp() AT TIME ZONE timezone)::date::text AS today
         FROM public.companies WHERE id = $1`,
      [actor.companyId],
    );
    const date = onDate ?? today.rows[0]!.today;
    const currency = await companyCurrency(client, actor.companyId);
    const hours = await plannedHours(client, actor.companyId);
    const rows = await componentsOnDate(client, actor.companyId, machineId, date);
    const computed = computedRatePerHour(rows.map((r) => r.row), hours);
    const manual = await manualRateOn(client, actor.companyId, machineId, date);

    const breakdown = computed.breakdown.map((entry) => {
      const source = rows.find((r) => r.row.component === entry.component)!;
      return {
        component: entry.component,
        basis: entry.basis,
        amount: toAmountString({ cents: BigInt(source.amount_cents), currency }),
        cents_per_hour: toAmountString({ cents: entry.centsPerHour, currency }),
      };
    });

    return {
      machine_id: machine.rows[0].id,
      machine_code: machine.rows[0].code,
      machine_name: machine.rows[0].name,
      calculated_rate: toAmountString({ cents: computed.rateCents, currency }),
      manual_rate: manual ? toAmountString({ cents: BigInt(manual.amount_cents), currency }) : null,
      manual_reason: manual?.reason ?? null,
      // Ručna stopa nadjačava izračunatu — ali ekran uvijek pokazuje i izračunatu, da
      // odstupanje bude vidljivo, ne skriveno.
      effective_rate: toAmountString({
        cents: manual ? BigInt(manual.amount_cents) : computed.rateCents,
        currency,
      }),
      is_manual: Boolean(manual),
      currency_code: currency,
      planned_hours_per_month: hours,
      breakdown,
    };
}

export async function createCostComponent(
  pool: Pool,
  actor: CostActor,
  input: ComponentInput,
): Promise<ServiceOutcome> {
  if (!can(actor.roles, "machines.cost_rate.manage")) return { outcome: "FORBIDDEN", code: "ROLE" };
  if (!DATE_ONLY.test(input.validFrom)) {
    return { outcome: "VALIDATION_FAILED", code: "VALID_FROM", message: "validFrom mora biti GGGG-MM-DD." };
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
    let cents: bigint;
    try {
      cents = money(input.amount, currency).cents;
    } catch {
      return { outcome: "VALIDATION_FAILED", code: "AMOUNT", message: "Neispravan iznos." };
    }
    if (cents < 0n) {
      return { outcome: "VALIDATION_FAILED", code: "AMOUNT", message: "Iznos ne smije biti negativan." };
    }

    /*
     * Zatvaranje prethodne važeće komponente ISTOG tipa dan prije nove. Bez ovoga bi dvije
     * komponente važile istovremeno, a zbir bi bio proizvoljan — baza to i odbija (`EXCLUDE`
     * ili triger), ali bolje je da servis to uradi sam sa jasnom porukom nego da korisnik
     * dobije „conflicting key value".
     */
    await client.query(
      `UPDATE public.machine_cost_components
          SET valid_to = ($4::date - interval '1 day')::date
        WHERE company_id = $1 AND machine_id = $2 AND component = $3
          AND valid_to IS NULL AND valid_from < $4::date`,
      [actor.companyId, input.machineId, input.component, input.validFrom],
    );

    const id = `mcc_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    try {
      await client.query(
        `INSERT INTO public.machine_cost_components
           (id, company_id, machine_id, component, amount_cents, currency_code, basis,
            valid_from, valid_to, note, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$9::date,$10,$11)`,
        [
          id, actor.companyId, input.machineId, input.component, cents.toString(), currency,
          input.basis, input.validFrom, input.validTo ?? null, input.note ?? null, actor.userId,
        ],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("COST_COMPONENT_OVERLAP") || (error as { code?: string }).code === "23P01") {
        return {
          outcome: "CONFLICT",
          code: "OVERLAP",
          message: "Ta komponenta već važi u periodu koji se preklapa.",
        };
      }
      throw error;
    }

    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "machine.cost_component_opened",
      entityType: "machine_cost_component",
      entityId: id,
      metadata: { machineId: input.machineId, component: input.component, basis: input.basis, validFrom: input.validFrom },
      // Novac: 10 godina (spec 01 §1.9.41).
      retentionClass: "FINANCIAL",
    });
    return { outcome: "OK", id };
  });
}

/**
 * Zatvaranje komponente (`PATCH` sa `id`). Samo zatvaranje — iznos se NE mijenja.
 *
 * Zašto: iznos komponente je ušao u već proknjižene troškove. Njegova izmjena bi bila izmjena
 * prošlosti; ispravka se radi kao nova komponenta sa novim periodom. Ako je greška u kucanju,
 * zatvori red na dan prije greške i unesi novi — istorija tada pokazuje šta se desilo.
 */
export async function closeCostComponent(
  pool: Pool,
  actor: CostActor,
  input: ComponentInput,
): Promise<ServiceOutcome> {
  if (!can(actor.roles, "machines.cost_rate.manage")) return { outcome: "FORBIDDEN", code: "ROLE" };
  if (!input.id) {
    return { outcome: "VALIDATION_FAILED", code: "ID", message: "Nedostaje id komponente." };
  }
  const validTo: string | undefined = input.validTo ?? undefined;
  if (!validTo) {
    return { outcome: "VALIDATION_FAILED", code: "VALID_TO", message: "Zatvaranje traži validTo." };
  }
  const componentId: string = input.id;
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const updated = await client.query<{ id: string; valid_from: string }>(
      `UPDATE public.machine_cost_components
          SET valid_to = $4::date, note = COALESCE($5, note)
        WHERE company_id = $1 AND machine_id = $2 AND id = $3
          AND valid_to IS NULL
        RETURNING id, valid_from::text`,
      [actor.companyId, input.machineId, componentId, validTo, input.note ?? null],
    );
    if (!updated.rows[0]) {
      return {
        outcome: "VALIDATION_FAILED",
        code: "NOT_FOUND",
        message: "Komponenta nije pronađena ili je već zatvorena.",
      };
    }
    if (validTo < updated.rows[0].valid_from.slice(0, 10)) {
      return {
        outcome: "VALIDATION_FAILED",
        code: "RANGE",
        message: "validTo ne smije biti prije validFrom.",
      };
    }
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "machine.cost_component_closed",
      entityType: "machine_cost_component",
      entityId: componentId,
      metadata: { machineId: input.machineId, validTo },
      retentionClass: "FINANCIAL",
    });
    return { outcome: "OK", id: componentId };
  });
}

/**
 * Ručna stopa: postavljanje (sa OBAVEZNIM razlogom) ili povratak na izračunato (`amount: null`).
 *
 * Prag razloga je 10 znakova, isto kao revizija i odbijanje kvara: „ok" nije razlog, a audit
 * trag po kojem se poslije ne može reći ZAŠTO je obračun bio drugačiji ne vrijedi ništa.
 */
export async function setManualCostRate(
  pool: Pool,
  actor: CostActor,
  input: RateInput,
): Promise<ServiceOutcome> {
  if (!can(actor.roles, "machines.cost_rate.manage")) return { outcome: "FORBIDDEN", code: "ROLE" };
  if (!DATE_ONLY.test(input.validFrom)) {
    return { outcome: "VALIDATION_FAILED", code: "VALID_FROM", message: "validFrom mora biti GGGG-MM-DD." };
  }
  const reason = input.reason?.trim() ?? "";
  if (input.amount !== null && reason.length < 10) {
    return {
      outcome: "VALIDATION_FAILED",
      code: "REASON",
      message: "Ručna stopa traži razlog (najmanje 10 znakova) — ide u audit trag.",
    };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const machine = await client.query<{ id: string }>(
      "SELECT id FROM public.machines WHERE company_id = $1 AND id = $2",
      [actor.companyId, input.machineId],
    );
    if (!machine.rows[0]) {
      return { outcome: "VALIDATION_FAILED", code: "MACHINE", message: "Mašina nije pronađena." };
    }

    // Svaki novi unos zatvara prethodnu važeću stopu dan prije — jedna stopa u jednom periodu.
    await client.query(
      `UPDATE public.machine_cost_rates
          SET valid_to = ($3::date - interval '1 day')::date,
              updated_by = $4, updated_at = clock_timestamp()
        WHERE company_id = $1 AND machine_id = $2 AND valid_to IS NULL AND valid_from < $3::date`,
      [actor.companyId, input.machineId, input.validFrom, actor.userId],
    );

    if (input.amount === null) {
      // „Vrati na izračunato": ručna stopa prestaje da važi od `validFrom`. Red ostaje kao
      // dokaz da je neko neko vrijeme radio po ručnoj stopi.
      await client.query(
        `UPDATE public.machine_cost_rates
            SET valid_to = ($3::date - interval '1 day')::date,
                updated_by = $4, updated_at = clock_timestamp()
          WHERE company_id = $1 AND machine_id = $2 AND valid_to IS NULL`,
        [actor.companyId, input.machineId, input.validFrom, actor.userId],
      );
      await writeAudit(client, {
        companyId: actor.companyId,
        actorId: actor.userId,
        actorEmail: null,
        action: "machine.cost_rate_manual_cleared",
        entityType: "machine_cost_rate",
        entityId: input.machineId,
        metadata: { validFrom: input.validFrom },
        retentionClass: "FINANCIAL",
      });
      return { outcome: "OK", id: input.machineId };
    }

    const currency = await companyCurrency(client, actor.companyId);
    let cents: bigint;
    try {
      cents = money(input.amount, currency).cents;
    } catch {
      return { outcome: "VALIDATION_FAILED", code: "AMOUNT", message: "Neispravan iznos." };
    }
    const id = `mcr_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    await client.query(
      `INSERT INTO public.machine_cost_rates
         (id, company_id, machine_id, amount_cents, currency_code, valid_from, valid_to,
          is_manual, reason, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6::date,NULL,true,$7,$8,$8)`,
      [id, actor.companyId, input.machineId, cents.toString(), currency, input.validFrom, reason, actor.userId],
    );
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "machine.cost_rate_manual_set",
      entityType: "machine_cost_rate",
      entityId: id,
      // Razlog ide u metadata: bez njega audit ne odgovara na jedino pitanje koje se poslije
      // postavlja — „zašto je sat bio skuplji od komponenti".
      metadata: { machineId: input.machineId, amount: input.amount, reason },
      retentionClass: "FINANCIAL",
    });
    return { outcome: "OK", id };
  });
}

export type SnapshotResult = {
  snapshotId: string;
  rateCents: bigint;
  currency: Currency;
  components: unknown[];
};

/**
 * Snapshot stope za JEDNU mašinu na JEDAN datum, unutar transakcije knjiženja.
 *
 * Vraća `null` kad mašina nema nijednu komponentu i nema ručnu stopu — tada trošak nije moguć
 * i pozivalac to prijavljuje kao `NO_RATE` (isto kao R6.1 ponašanje, da se ne knjiži nula).
 *
 * Ručna stopa, kad postoji, ulazi u snapshot kao `source: "MANUAL"`; razlaganje ostaje uz nju,
 * pa se i poslije vidi kolika bi bila izračunata.
 */
export async function snapshotCostRate(
  client: PoolClient,
  input: { companyId: string; machineId: string; onDate: string; createdBy: string | null },
): Promise<SnapshotResult | null> {
  const currency = await companyCurrency(client, input.companyId);
  const hours = await plannedHours(client, input.companyId);
  const rows = await componentsOnDate(client, input.companyId, input.machineId, input.onDate);
  const manual = await manualRateOn(client, input.companyId, input.machineId, input.onDate);
  if (rows.length === 0 && !manual) return null;

  const computed = computedRatePerHour(rows.map((r) => r.row), hours);
  const components = computed.breakdown.map((entry) => {
    const source = rows.find((r) => r.row.component === entry.component)!;
    return {
      component: entry.component,
      basis: entry.basis,
      amount_cents: source.amount_cents,
      currency_code: source.currency_code,
      cents_per_hour: entry.centsPerHour.toString(),
    };
  });
  const rateCents = manual ? BigInt(manual.amount_cents) : computed.rateCents;
  const id = `mcs_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

  await client.query(
    `INSERT INTO public.machine_cost_rate_snapshots
       (id, company_id, machine_id, components, rate_cents, currency_code, source, planned_hours, created_by)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9)`,
    [
      id, input.companyId, input.machineId, JSON.stringify(components), rateCents.toString(),
      currency, manual ? "MANUAL" : "CALCULATED", hours, input.createdBy,
    ],
  );
  return { snapshotId: id, rateCents, currency, components };
}
