/**
 * F4 (Modul 5 §1.3) — gorivo: šifarnik cijena, cisterne i odstupanja potrošnje.
 *
 * Tri stvari koje ovaj modul odlučuje i koje ne smiju ostati na ekranu:
 *
 *  1. **Cijena se PREDLAŽE, ne nameće.** Točenje dobija cijenu iz šifarnika po datumu; ured je
 *     može prepisati i tada zapis nosi `price_source = MANUAL`. Bez šifarnika se cijena po litru
 *     pogađa ili prepisuje sa računa — a onda odstupanje potrošnje mjeri grešku u cijeni.
 *  2. **`NULL` iznos ostaje `NULL` (D1).** Kad iznos nije poznat, ne upisuje se nula. Nula bi u
 *     zbiru izgledala kao besplatno gorivo i pokvarila svaki trošak po kilometru.
 *  3. **Odstupanje se ne zatvara tiho.** Iznad praga firme upozorenje ide u `OPEN`; zatvara se
 *     SAMO sa razlogom (šifra + napomena ≥10 znakova) u `EXPLAINED` ili `DISMISSED`. Točenje je
 *     uvijek dopušteno — crveno upozorenje, ne blokada (spec 05 §1.3.15).
 *
 * Cisterna i pumpa se NIKAD ne vode paralelno: ako je `tank_id` popunjen, zapis je iz cisterne i
 * stanje se skida; ako nije, točenje je na pumpi i stanja nema.
 */
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import {
  fuelConsumption,
  fuelDeviation,
  isCurrency,
  money,
  toAmountString,
  type Currency,
} from "@gradix/domain";
import { writeAudit } from "./audit";
import { can, type Role } from "./permissions";

export type FuelActor = { userId: string; companyId: string; roles: readonly Role[] };

export type FuelPriceView = {
  id: string;
  fuel_kind: string;
  supplier_partner_id: string | null;
  supplier_name: string | null;
  price: string;
  currency_code: string;
  valid_from: string;
  note: string | null;
  created_at: string;
};

export type FuelTankView = {
  id: string;
  name: string;
  capacity_l: number;
  current_l: number;
  last_count_at: string | null;
  is_active: boolean;
};

export type DeviationView = {
  id: string;
  entry_id: string;
  machine_id: string;
  machine_code: string;
  machine_name: string;
  filled_at: string;
  liters: number;
  consumption: number | null;
  consumption_unit: "l/h" | "l/100km" | null;
  baseline: number | null;
  deviation_pct: number | null;
  threshold_pct: number;
  status: "OPEN" | "EXPLAINED" | "DISMISSED";
  reason: "BREAKDOWN" | "THEFT" | "MISREAD" | "OTHER" | null;
  note: string | null;
  reviewed_at: string | null;
};

export type Outcome<T = void> =
  | { outcome: "OK"; data: T }
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

/* ================================================================== šifarnik cijena */

export async function listFuelPrices(
  pool: Pool,
  actor: FuelActor,
  filters: { fuelKind?: string } = {},
): Promise<FuelPriceView[]> {
  if (!can(actor.roles, "machines.fuel.view")) return [];
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const params: unknown[] = [actor.companyId];
    let filter = "";
    if (filters.fuelKind) {
      params.push(filters.fuelKind);
      filter = " AND p.fuel_kind = $2";
    }
    const result = await client.query<{
      id: string;
      fuel_kind: string;
      supplier_partner_id: string | null;
      supplier_name: string | null;
      price_cents: string;
      currency_code: string;
      valid_from: string;
      note: string | null;
      created_at: string;
    }>(
      `SELECT p.id, p.fuel_kind, p.supplier_partner_id, pt.name AS supplier_name,
              p.price_cents::text, p.currency_code, p.valid_from::text, p.note, p.created_at::text
         FROM public.fuel_prices p
         LEFT JOIN public.partners pt ON pt.company_id = p.company_id AND pt.id = p.supplier_partner_id
        WHERE p.company_id = $1${filter}
        ORDER BY p.valid_from DESC, p.fuel_kind
        LIMIT 500`,
      params,
    );
    return result.rows.map((row) => {
      const currency = (isCurrency(row.currency_code) ? row.currency_code : "BAM") as Currency;
      return {
        id: row.id,
        fuel_kind: row.fuel_kind,
        supplier_partner_id: row.supplier_partner_id,
        supplier_name: row.supplier_name,
        price: toAmountString({ cents: BigInt(row.price_cents), currency }),
        currency_code: row.currency_code,
        valid_from: row.valid_from.slice(0, 10),
        note: row.note,
        created_at: row.created_at,
      };
    });
  });
}

export async function createFuelPrice(
  pool: Pool,
  actor: FuelActor,
  input: {
    fuelKind: string;
    supplierPartnerId?: string | null;
    price: string;
    currencyCode?: string;
    validFrom: string;
    note?: string | null;
  },
): Promise<Outcome<FuelPriceView>> {
  if (!can(actor.roles, "machines.fuel.manage")) return { outcome: "FORBIDDEN", code: "ROLE" };
  if (!DATE_ONLY.test(input.validFrom)) {
    return { outcome: "VALIDATION_FAILED", code: "VALID_FROM", message: "Datum mora biti GGGG-MM-DD." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const currency = input.currencyCode && isCurrency(input.currencyCode)
      ? input.currencyCode
      : await companyCurrency(client, actor.companyId);
    let cents: bigint;
    try {
      cents = money(input.price, currency).cents;
    } catch {
      return { outcome: "VALIDATION_FAILED", code: "PRICE", message: "Neispravna cijena." };
    }
    if (cents <= 0n) {
      return { outcome: "VALIDATION_FAILED", code: "PRICE", message: "Cijena mora biti veća od nule." };
    }
    if (input.supplierPartnerId) {
      const partner = await client.query<{ id: string }>(
        "SELECT id FROM public.partners WHERE company_id = $1 AND id = $2",
        [actor.companyId, input.supplierPartnerId],
      );
      if (!partner.rows[0]) {
        return { outcome: "VALIDATION_FAILED", code: "PARTNER", message: "Dobavljač nije pronađen." };
      }
    }
    const id = `fpr_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    try {
      await client.query(
        `INSERT INTO public.fuel_prices
           (id, company_id, fuel_kind, supplier_partner_id, price_cents, currency_code,
            valid_from, note, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8,$9)`,
        [
          id, actor.companyId, input.fuelKind, input.supplierPartnerId ?? null, cents.toString(),
          currency, input.validFrom, input.note ?? null, actor.userId,
        ],
      );
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        return {
          outcome: "CONFLICT",
          code: "DUPLICATE",
          message: "Za tu vrstu goriva već postoji cijena s tim datumom.",
        };
      }
      throw error;
    }
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "fuel.price_created",
      entityType: "fuel_price",
      entityId: id,
      metadata: { fuelKind: input.fuelKind, validFrom: input.validFrom },
      retentionClass: "FINANCIAL",
    });
    const row = await client.query<{
      id: string; fuel_kind: string; supplier_partner_id: string | null; supplier_name: string | null;
      price_cents: string; currency_code: string; valid_from: string; note: string | null; created_at: string;
    }>(
      `SELECT p.id, p.fuel_kind, p.supplier_partner_id, pt.name AS supplier_name,
              p.price_cents::text, p.currency_code, p.valid_from::text, p.note, p.created_at::text
         FROM public.fuel_prices p
         LEFT JOIN public.partners pt ON pt.company_id = p.company_id AND pt.id = p.supplier_partner_id
        WHERE p.company_id = $1 AND p.id = $2`,
      [actor.companyId, id],
    );
    const created = row.rows[0]!;
    return {
      outcome: "OK",
      data: {
        id: created.id,
        fuel_kind: created.fuel_kind,
        supplier_partner_id: created.supplier_partner_id,
        supplier_name: created.supplier_name,
        price: toAmountString({ cents: BigInt(created.price_cents), currency }),
        currency_code: created.currency_code,
        valid_from: created.valid_from.slice(0, 10),
        note: created.note,
        created_at: created.created_at,
      },
    };
  });
}

/**
 * Predložena cijena za vrstu goriva na datum — NAJNOVIJA cijena koja nije poslije datuma.
 *
 * Zašto „najnovija ≤ datum", a ne tačan datum: cijena se mijenja rijetko, a točenja su svaki
 * dan. Traženje tačnog datuma bi značilo da cijena „nedostaje" skoro uvijek.
 */
export async function suggestedFuelPrice(
  client: PoolClient,
  companyId: string,
  fuelKind: string,
  onDate: string,
): Promise<{ price_cents: string; currency_code: string; valid_from: string } | null> {
  const result = await client.query<{ price_cents: string; currency_code: string; valid_from: string }>(
    `SELECT price_cents::text, currency_code, valid_from::text
       FROM public.fuel_prices
      WHERE company_id = $1 AND fuel_kind = $2 AND valid_from <= $3::date
      ORDER BY valid_from DESC
      LIMIT 1`,
    [companyId, fuelKind, onDate],
  );
  return result.rows[0] ?? null;
}

/* ================================================================== cisterne */

export async function listFuelTanks(pool: Pool, actor: FuelActor): Promise<FuelTankView[]> {
  if (!can(actor.roles, "machines.fuel.view")) return [];
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const result = await client.query<{
      id: string; name: string; capacity_l: string; current_l: string;
      last_count_at: string | null; is_active: boolean;
    }>(
      `SELECT id, name, capacity_l::text, current_l::text, last_count_at::text, is_active
         FROM public.fuel_tanks
        WHERE company_id = $1
        ORDER BY is_active DESC, name`,
      [actor.companyId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      capacity_l: Number(row.capacity_l),
      current_l: Number(row.current_l),
      last_count_at: row.last_count_at,
      is_active: row.is_active,
    }));
  });
}

export async function createFuelTank(
  pool: Pool,
  actor: FuelActor,
  input: { name: string; capacityL: number; currentL?: number; isActive?: boolean },
): Promise<Outcome<FuelTankView>> {
  if (!can(actor.roles, "machines.fuel.manage")) return { outcome: "FORBIDDEN", code: "ROLE" };
  const current = input.currentL ?? 0;
  if (current > input.capacityL) {
    return {
      outcome: "VALIDATION_FAILED",
      code: "CAPACITY",
      message: "Trenutno stanje ne može biti veće od kapaciteta.",
    };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const id = `ftk_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    await client.query(
      `INSERT INTO public.fuel_tanks (id, company_id, name, capacity_l, current_l, is_active)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, actor.companyId, input.name.trim(), input.capacityL, current, input.isActive ?? true],
    );
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "fuel.tank_created",
      entityType: "fuel_tank",
      entityId: id,
      metadata: { capacityL: input.capacityL },
      retentionClass: "FINANCIAL",
    });
    return {
      outcome: "OK",
      data: {
        id,
        name: input.name.trim(),
        capacity_l: input.capacityL,
        current_l: current,
        last_count_at: null,
        is_active: input.isActive ?? true,
      },
    };
  });
}

/**
 * Popis cisterne: očitano stanje zamjenjuje izvedeno.
 *
 * Razlika između očitanog i izvedenog je ono što popis i postoji — zato se popis bilježi u audit
 * sa oba broja, a ne samo sa novim stanjem: gubitak goriva se vidi tek iz razlike.
 */
export async function countFuelTank(
  pool: Pool,
  actor: FuelActor,
  tankId: string,
  input: { currentL: number; note?: string | null },
): Promise<Outcome<FuelTankView>> {
  if (!can(actor.roles, "machines.fuel.manage")) return { outcome: "FORBIDDEN", code: "ROLE" };
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const tank = await client.query<{ capacity_l: string; current_l: string }>(
      "SELECT capacity_l::text, current_l::text FROM public.fuel_tanks WHERE company_id = $1 AND id = $2 FOR UPDATE",
      [actor.companyId, tankId],
    );
    if (!tank.rows[0]) {
      return { outcome: "VALIDATION_FAILED", code: "NOT_FOUND", message: "Cisterna nije pronađena." };
    }
    if (input.currentL < 0 || input.currentL > Number(tank.rows[0].capacity_l)) {
      return {
        outcome: "VALIDATION_FAILED",
        code: "CAPACITY",
        message: "Očitano stanje mora biti između nule i kapaciteta.",
      };
    }
    const previous = Number(tank.rows[0].current_l);
    await client.query(
      `UPDATE public.fuel_tanks
          SET current_l = $3, last_count_at = clock_timestamp(), updated_at = clock_timestamp()
        WHERE company_id = $1 AND id = $2`,
      [actor.companyId, tankId, input.currentL],
    );
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "fuel.tank_counted",
      entityType: "fuel_tank",
      entityId: tankId,
      // `differenceL` je srž popisa: bez njega se gubitak ne vidi.
      metadata: { fromL: previous, toL: input.currentL, differenceL: Number((input.currentL - previous).toFixed(2)), note: input.note ?? null },
      retentionClass: "FINANCIAL",
    });
    const updated = await client.query<{
      id: string; name: string; capacity_l: string; current_l: string; last_count_at: string | null; is_active: boolean;
    }>(
      `SELECT id, name, capacity_l::text, current_l::text, last_count_at::text, is_active
         FROM public.fuel_tanks WHERE company_id = $1 AND id = $2`,
      [actor.companyId, tankId],
    );
    const row = updated.rows[0]!;
    return {
      outcome: "OK",
      data: {
        id: row.id,
        name: row.name,
        capacity_l: Number(row.capacity_l),
        current_l: Number(row.current_l),
        last_count_at: row.last_count_at,
        is_active: row.is_active,
      },
    };
  });
}

/* ================================================================== odstupanja */

/**
 * Prag odstupanja firme.
 *
 * Ide iz `companies`, ne iz konstante: firma sa starim voznim parkom ima drugačiji normalan
 * rasip, a prag od 20% bi joj svaki drugi dan palio crveno — i onda se upozorenje ignoriše,
 * što je gore od toga da ga nema.
 */
async function deviationThreshold(client: PoolClient, companyId: string): Promise<number> {
  const row = await client.query<{ fuel_deviation_threshold_pct: number }>(
    "SELECT fuel_deviation_threshold_pct FROM public.companies WHERE id = $1",
    [companyId],
  );
  return Number(row.rows[0]?.fuel_deviation_threshold_pct ?? 20);
}

/**
 * `YYYY-MM-DD` → početak tog dana; već potpuni trenutak ostaje nepromijenjen.
 *
 * Pozivaoci šalju OBOJE: ekran šalje datum, a lista odstupanja šalje `filled_at` iz baze
 * (`2026-02-11 09:00:00+00`). Lijepljenje `T00:00:00Z` na potpuni trenutak daje neispravan
 * timestamp i ruši upit — a to je put kojim ide SVAKI unos goriva.
 */
function asInstant(value: string): string {
  if (value.includes("T") || value.includes(" ")) return value;
  return `${value}T00:00:00Z`;
}

/** Prosjek potrošnje mašine u zadnjih 90 dana prije datuma (spec 05 §1.3.13). */
async function baselineConsumption(
  client: PoolClient,
  companyId: string,
  machineId: string,
  beforeDate: string,
): Promise<number | null> {
  const row = await client.query<{ avg: string | null }>(
    `SELECT avg(fe.liters / NULLIF(delta, 0)) AS avg
       FROM (
         SELECT fe.liters,
                (fe.meter_reading - lag(fe.meter_reading) OVER (ORDER BY fe.filled_at)) AS delta
           FROM public.fuel_entries fe
          WHERE fe.company_id = $1 AND fe.machine_id = $2
            AND fe.meter_reading IS NOT NULL
            AND fe.filled_at < $3::timestamptz
            AND fe.filled_at >= ($3::timestamptz - interval '90 days')
       ) fe
      WHERE delta > 0`,
    [companyId, machineId, asInstant(beforeDate)],
  );
  const avg = row.rows[0]?.avg;
  return avg === null || avg === undefined ? null : Number(avg);
}

/**
 * Procjena odstupanja za točenje koje se upravo unosi.
 *
 * Vraća `null` kad nema osnova za poređenje (nema prethodnog očitanja) — tada NEMA upozorenja.
 * To je namjerno: prvo točenje nove mašine ne može biti „odstupanje" i ne smije tražiti
 * objašnjenje, jer bi time svaki novi unos tražio pisanje razloga.
 */
export async function assessFuelDeviation(
  client: PoolClient,
  input: {
    companyId: string;
    machineId: string;
    filledAt: string;
    liters: number;
    meterReading: number | null;
  },
): Promise<{ deviationPct: number | null; flagged: boolean; status: "OPEN" | null }> {
  if (input.meterReading === null) return { deviationPct: null, flagged: false, status: null };
  const machine = await client.query<{ meter: string }>(
    "SELECT meter FROM public.machines WHERE company_id = $1 AND id = $2",
    [input.companyId, input.machineId],
  );
  const meter = machine.rows[0]?.meter === "KM" ? "KM" : "HOURS";
  const previous = await client.query<{ meter_reading: string }>(
    `SELECT meter_reading::text FROM public.fuel_entries
      WHERE company_id = $1 AND machine_id = $2 AND meter_reading IS NOT NULL
        AND filled_at < $3::timestamptz
      ORDER BY filled_at DESC LIMIT 1`,
    [input.companyId, input.machineId, input.filledAt],
  );
  if (!previous.rows[0]) return { deviationPct: null, flagged: false, status: null };
  const consumption = fuelConsumption({
    liters: input.liters,
    meterStart: Number(previous.rows[0].meter_reading),
    meterEnd: input.meterReading,
    meter,
  });
  if (!consumption) return { deviationPct: null, flagged: false, status: null };
  const baselineRow = await baselineConsumption(client, input.companyId, input.machineId, input.filledAt);
  const threshold = await deviationThreshold(client, input.companyId);
  if (baselineRow === null) return { deviationPct: null, flagged: false, status: null };
  // `l/100km` i `l/h` imaju istu jedinicu osnova poređenja jer se i baseline računa po litru na
  // jedinicu brojila (litri / delta). Faktor 100 se primjenjuje samo na prikaz za `KM`.
  const baseline = meter === "KM" ? baselineRow * 100 : baselineRow;
  const verdict = fuelDeviation({ consumption: consumption.value, baseline, thresholdPct: threshold });
  return {
    deviationPct: verdict.deviationPct,
    flagged: verdict.flagged,
    status: verdict.flagged ? "OPEN" : null,
  };
}

/**
 * Lista odstupanja za ured. `OPEN` idu prva — to su ona koja traže odluku.
 *
 * Potrošnja i baseline se računaju iz zapisa (nema čuvanja izvedenog), da se poslije ispravke
 * točenja ne prikazuje stara brojka. `deviation_pct` je zapisan pri unosu jer je to bio podatak
 * u trenutku odluke; prikaz koristi zapisano, ali uz svježe litre.
 */
export async function listFuelDeviations(
  pool: Pool,
  actor: FuelActor,
  filters: { status?: "OPEN" | "EXPLAINED" | "DISMISSED"; machineId?: string } = {},
): Promise<{ deviations: DeviationView[]; open_count: number }> {
  if (!can(actor.roles, "machines.fuel.view")) return { deviations: [], open_count: 0 };
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const threshold = await deviationThreshold(client, actor.companyId);
    const params: unknown[] = [actor.companyId];
    const conditions = ["fe.company_id = $1", "fe.deviation_status IS NOT NULL"];
    if (filters.status) {
      params.push(filters.status);
      conditions.push(`fe.deviation_status = $${params.length}`);
    }
    if (filters.machineId) {
      params.push(filters.machineId);
      conditions.push(`fe.machine_id = $${params.length}`);
    }
    const result = await client.query<{
      id: string; machine_id: string; machine_code: string; machine_name: string;
      filled_at: string; liters: string; deviation_pct: string | null; deviation_status: string;
      deviation_reason: string | null; deviation_note: string | null;
      deviation_reviewed_at: string | null; meter: string; meter_reading: string | null;
    }>(
      `SELECT fe.id, fe.machine_id, m.code AS machine_code, m.name AS machine_name,
              fe.filled_at::text, fe.liters::text, fe.deviation_pct::text, fe.deviation_status,
              fe.deviation_reason, fe.deviation_note, fe.deviation_reviewed_at::text,
              m.meter, fe.meter_reading::text
         FROM public.fuel_entries fe
         JOIN public.machines m ON m.company_id = fe.company_id AND m.id = fe.machine_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY (fe.deviation_status = 'OPEN') DESC, fe.filled_at DESC
        LIMIT 500`,
      params,
    );

    const { rows: openRows } = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM public.fuel_entries
        WHERE company_id = $1 AND deviation_status = 'OPEN'`,
      [actor.companyId],
    );

    const deviations: DeviationView[] = [];
    for (const row of result.rows) {
      // Prethodno očitanje iste mašine prije ovog točenja — potrošnja se računa, ne čuva.
      const previous = await client.query<{ meter_reading: string }>(
        `SELECT meter_reading::text FROM public.fuel_entries
          WHERE company_id = $1 AND machine_id = $2 AND meter_reading IS NOT NULL
            AND filled_at < $3::timestamptz
          ORDER BY filled_at DESC LIMIT 1`,
        [actor.companyId, row.machine_id, row.filled_at],
      );
      const consumption = fuelConsumption({
        liters: Number(row.liters),
        meterStart: previous.rows[0] ? Number(previous.rows[0].meter_reading) : null,
        meterEnd: row.meter_reading === null ? null : Number(row.meter_reading),
        meter: row.meter === "KM" ? "KM" : "HOURS",
      });
      const baselineRow = await baselineConsumption(client, actor.companyId, row.machine_id, row.filled_at);
      const baseline = baselineRow === null
        ? null
        : row.meter === "KM" ? Number((baselineRow * 100).toFixed(2)) : Number(baselineRow.toFixed(2));
      deviations.push({
        id: row.id,
        entry_id: row.id,
        machine_id: row.machine_id,
        machine_code: row.machine_code,
        machine_name: row.machine_name,
        filled_at: row.filled_at,
        liters: Number(row.liters),
        consumption: consumption?.value ?? null,
        consumption_unit: consumption?.unit ?? null,
        baseline,
        deviation_pct: row.deviation_pct === null ? null : Number(row.deviation_pct),
        threshold_pct: threshold,
        status: row.deviation_status as DeviationView["status"],
        reason: row.deviation_reason as DeviationView["reason"],
        note: row.deviation_note,
        reviewed_at: row.deviation_reviewed_at,
      });
    }
    return { deviations, open_count: Number(openRows[0]?.count ?? 0) };
  });
}

/**
 * Objašnjenje odstupanja.
 *
 * `OPEN` → `EXPLAINED`/`DISMISSED`, uz šifru razloga i napomenu ≥10 znakova. Bez toga upozorenje
 * ostaje otvoreno: „ne zatvara se tiho" (spec 05 §1.3.13). Baza ima isti CHECK — servis ga ne
 * duplira zbog reda, nego zato što poruka „check constraint violated" korisniku ništa ne kaže.
 */
export async function explainFuelDeviation(
  pool: Pool,
  actor: FuelActor,
  entryId: string,
  input: { status: "EXPLAINED" | "DISMISSED"; reason: "BREAKDOWN" | "THEFT" | "MISREAD" | "OTHER"; note: string },
): Promise<Outcome<{ id: string; status: string }>> {
  if (!can(actor.roles, "machines.fuel.view")) return { outcome: "FORBIDDEN", code: "ROLE" };
  const note = input.note.trim();
  if (note.length < 10) {
    return {
      outcome: "VALIDATION_FAILED",
      code: "NOTE",
      message: "Objašnjenje traži najmanje 10 znakova — kratka riječ ne objašnjava odstupanje.",
    };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const entry = await client.query<{ deviation_status: string | null }>(
      "SELECT deviation_status FROM public.fuel_entries WHERE company_id = $1 AND id = $2 FOR UPDATE",
      [actor.companyId, entryId],
    );
    if (!entry.rows[0]) {
      return { outcome: "VALIDATION_FAILED", code: "NOT_FOUND", message: "Točenje nije pronađeno." };
    }
    if (entry.rows[0].deviation_status === null) {
      return {
        outcome: "CONFLICT",
        code: "NO_DEVIATION",
        message: "To točenje nema zabilježeno odstupanje.",
      };
    }
    if (entry.rows[0].deviation_status !== "OPEN") {
      return {
        outcome: "CONFLICT",
        code: "ALREADY_CLOSED",
        message: "Odstupanje je već objašnjeno.",
      };
    }
    await client.query(
      `UPDATE public.fuel_entries
          SET deviation_status = $3, deviation_reason = $4, deviation_note = $5,
              deviation_reviewed_by = $6, deviation_reviewed_at = clock_timestamp()
        WHERE company_id = $1 AND id = $2`,
      [actor.companyId, entryId, input.status, input.reason, note, actor.userId],
    );
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "fuel.deviation_explained",
      entityType: "fuel_deviation",
      entityId: entryId,
      metadata: { status: input.status, reason: input.reason },
      retentionClass: "FINANCIAL",
    });
    return { outcome: "OK", data: { id: entryId, status: input.status } };
  });
}
