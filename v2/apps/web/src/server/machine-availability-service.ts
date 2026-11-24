/**
 * F4 (Modul 5 §1.7 i §1.8) — zauzetost mašine, iznimka od dvostruke dodjele i najam.
 *
 * Tri stvari koje ovdje žive:
 *
 *  1. **Zauzetost je izvedena iz dodjela**, ne tabela. Kalendar mjesec × mašina čita
 *     `project_assignments` i isključuje poništene (`voided_at`); „slobodno" je odsustvo reda.
 *  2. **Dvostruka dodjela je odbijena u BAZI** (triger + `pg_advisory_xact_lock`), a servis
 *     prepoznaje `MACHINE_DOUBLE_BOOKED` i nudi iznimku. Iznimka je zapis u `usage_overrides`
 *     sa razlogom i rokom — ne „labaviji indeks": preklapanje bez zapisa bi bilo nevidljivo.
 *  3. **Najam nosi stvarni trošak.** Unajmljena mašina bez komponente `RENTAL` izgleda
 *     besplatna, pa je sat rada na projektu precijenjen (ili potcijenjen) bez ijednog traga.
 *     Zato `setMachineRental` po defaultu otvara i komponentu sa istim periodom.
 */
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import { isCurrency, money, type Currency } from "@gradix/domain";
import { writeAudit } from "./audit";
import { can, type Role } from "./permissions";

export type AvailabilityActor = { userId: string; companyId: string; roles: readonly Role[] };

export type AvailabilitySlot = {
  project_id: string | null;
  project_code: string | null;
  project_name: string | null;
  from_date: string;
  to_date: string | null;
  /** Popunjeno kad je preklapanje pokriveno odobrenom iznimkom (Modul 2). */
  override_id: string | null;
};

export type AvailabilityView = {
  machine_id: string;
  from: string;
  to: string;
  slots: AvailabilitySlot[];
};

export type RentalOutcome =
  | { outcome: "OK"; id: string; componentId: string | null }
  | { outcome: "FORBIDDEN"; code: string; message?: string }
  | { outcome: "VALIDATION_FAILED"; code: string; message: string }
  | { outcome: "CONFLICT"; code: string; message: string };

export async function machineAvailability(
  pool: Pool,
  actor: AvailabilityActor,
  machineId: string,
  from: string,
  to: string,
): Promise<AvailabilityView | null> {
  if (!can(actor.roles, "equipment.view")) return null;
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const machine = await client.query<{ id: string }>(
      "SELECT id FROM public.machines WHERE company_id = $1 AND id = $2",
      [actor.companyId, machineId],
    );
    if (!machine.rows[0]) return null;
    /*
     * Dodjela „ulazi" u period ako joj se interval siječe sa traženim. `to_date IS NULL` je
     * otvorena dodjela — mašina je zauzeta do daljnjeg, i to mora biti vidljivo u kalendaru
     * (inače bi izgledala slobodna samo zato što kraj nije upisan).
     */
    const result = await client.query<{
      project_id: string | null;
      project_code: string | null;
      project_name: string | null;
      from_date: string;
      to_date: string | null;
      override_id: string | null;
    }>(
      `SELECT a.project_id, p.code AS project_code, p.name AS project_name,
              to_char(a.from_date, 'YYYY-MM-DD') AS from_date,
              to_char(a.to_date, 'YYYY-MM-DD') AS to_date,
              a.double_booking_override_id AS override_id
         FROM public.project_assignments a
         LEFT JOIN public.projects p ON p.company_id = a.company_id AND p.id = a.project_id
        WHERE a.company_id = $1 AND a.machine_id = $2 AND a.voided_at IS NULL
          AND a.from_date <= $4::date
          AND (a.to_date IS NULL OR a.to_date >= $3::date)
        ORDER BY a.from_date`,
      [actor.companyId, machineId, from, to],
    );
    return { machine_id: machineId, from, to, slots: result.rows };
  });
}

/**
 * Najam mašine: partner, stopa, osnova i period (+ komponenta `RENTAL`).
 *
 * Zašto i komponenta: najam je stvarni trošak po satu, a stopa se računa iz komponenti. Bez
 * komponente bi unajmljena mašina imala stopu samo iz depresijacije (koje nema, jer nije njena),
 * pa bi sat na projektu bio približno nula.
 *
 * Osnova `PER_DAY` se dijeli sa `workday_hours` firme — jedini način da dnevna cijena uđe u
 * satnu stopu bez izmišljanja broja sati po danu.
 */
export async function setMachineRental(
  pool: Pool,
  actor: AvailabilityActor,
  machineId: string,
  input: {
    partnerId: string;
    rate: string;
    basis: "PER_HOUR" | "PER_DAY" | "PER_MONTH";
    from: string;
    to?: string | null;
    createCostComponent?: boolean;
  },
): Promise<RentalOutcome> {
  if (!can(actor.roles, "equipment.manage")) return { outcome: "FORBIDDEN", code: "ROLE" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.from)) {
    return { outcome: "VALIDATION_FAILED", code: "FROM", message: "Datum početka mora biti GGGG-MM-DD." };
  }
  if (input.to && input.to < input.from) {
    return { outcome: "VALIDATION_FAILED", code: "RANGE", message: "Kraj najma ne smije biti prije početka." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const machine = await client.query<{ id: string; code: string }>(
      "SELECT id, code FROM public.machines WHERE company_id = $1 AND id = $2",
      [actor.companyId, machineId],
    );
    if (!machine.rows[0]) {
      return { outcome: "VALIDATION_FAILED", code: "MACHINE", message: "Mašina nije pronađena." };
    }
    const partner = await client.query<{ id: string }>(
      "SELECT id FROM public.partners WHERE company_id = $1 AND id = $2",
      [actor.companyId, input.partnerId],
    );
    if (!partner.rows[0]) {
      return { outcome: "VALIDATION_FAILED", code: "PARTNER", message: "Partner nije pronađen." };
    }
    const company = await client.query<{ currency: string; workday_hours: string }>(
      "SELECT currency, workday_hours::text FROM public.companies WHERE id = $1",
      [actor.companyId],
    );
    const currency = (isCurrency(company.rows[0]?.currency ?? "BAM")
      ? company.rows[0]!.currency
      : "BAM") as Currency;
    let rateCents: bigint;
    try {
      rateCents = money(input.rate, currency).cents;
    } catch {
      return { outcome: "VALIDATION_FAILED", code: "RATE", message: "Neispravna cijena najma." };
    }
    if (rateCents < 0n) {
      return { outcome: "VALIDATION_FAILED", code: "RATE", message: "Cijena najma ne smije biti negativna." };
    }

    await client.query(
      `UPDATE public.machines
          SET ownership = 'RENTED', rental_partner_id = $3, rental_rate_cents = $4,
              rental_basis = $5, rental_from = $6::date, rental_to = $7::date,
              updated_at = clock_timestamp()
        WHERE company_id = $1 AND id = $2`,
      [
        actor.companyId, machineId, input.partnerId, rateCents.toString(), input.basis,
        input.from, input.to ?? null,
      ],
    );

    let componentId: string | null = null;
    if (input.createCostComponent !== false) {
      /*
       * Komponenta `RENTAL` sa osnovom koja odgovara cijeni najma:
       *  - `PER_HOUR` → `PER_HOUR` (isto);
       *  - `PER_DAY`  → `PER_MONTH`? Ne: dnevna cijena × radni dani nije poznata ovdje. Zato se
       *    dnevna cijena dijeli sa `workday_hours` i upisuje kao `PER_HOUR` — to je TAČNO ono
       *    što sat košta kad mašina radi cijeli dan, i jedina vrijednost koja ne izmišlja broj
       *    radnih dana u mjesecu;
       *  - `PER_MONTH` → `PER_MONTH` (dijeli se sa planiranim satima u domeni).
       */
      let componentBasis: "PER_HOUR" | "PER_MONTH" = "PER_MONTH";
      let componentCents = rateCents;
      if (input.basis === "PER_HOUR") {
        componentBasis = "PER_HOUR";
      } else if (input.basis === "PER_DAY") {
        componentBasis = "PER_HOUR";
        const hoursPerDay = Number(company.rows[0]?.workday_hours ?? 8) || 8;
        componentCents = BigInt(Math.round(Number(rateCents) / hoursPerDay));
      }
      await client.query(
        `UPDATE public.machine_cost_components
            SET valid_to = ($3::date - interval '1 day')::date
          WHERE company_id = $1 AND machine_id = $2 AND component = 'RENTAL'
            AND valid_to IS NULL AND valid_from < $3::date`,
        [actor.companyId, machineId, input.from],
      );
      componentId = `mcc_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
      await client.query(
        `INSERT INTO public.machine_cost_components
           (id, company_id, machine_id, component, amount_cents, currency_code, basis,
            valid_from, valid_to, note, created_by)
         VALUES ($1,$2,$3,'RENTAL',$4,$5,$6,$7::date,$8::date,$9,$10)`,
        [
          componentId, actor.companyId, machineId, componentCents.toString(), currency,
          componentBasis, input.from, input.to ?? null,
          `Najam (${input.basis} ${input.rate} ${currency}) — automatski iz postavke najma.`,
          actor.userId,
        ],
      );
    }

    const id = `rnt_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "machine.rental_set",
      entityType: "equipment",
      entityId: machineId,
      metadata: {
        rentalId: id,
        partnerId: input.partnerId,
        basis: input.basis,
        rate: input.rate,
        from: input.from,
        to: input.to ?? null,
        componentId,
      },
      retentionClass: "FINANCIAL",
    });
    return { outcome: "OK", id, componentId };
  });
}

/**
 * Prag odobrenja troška kvara po firmi (spec 05 §1.6.24).
 *
 * Do F4 je prag bio konstanta (500 KM) u domeni. Sada je podatak firme — jer firma sa velikim
 * mašinama ima i drugačiju granicu „šta je skupo". Domen i dalje ima default za bazu bez F4.
 */
export async function faultApprovalThreshold(
  client: PoolClient,
  companyId: string,
): Promise<bigint> {
  const row = await client.query<{ fault_approval_threshold_cents: string }>(
    "SELECT fault_approval_threshold_cents::text FROM public.companies WHERE id = $1",
    [companyId],
  );
  return BigInt(row.rows[0]?.fault_approval_threshold_cents ?? "50000");
}

export type CompanyAvailabilityRow = {
  machine_id: string;
  machine_code: string;
  machine_name: string;
  slots: (AvailabilitySlot & { machine_id: string })[];
};

/**
 * Zauzetost SVIH mašina u periodu — jedan upit, ne N+1 po mašini.
 *
 * Kalendar mjesec × mašina čita ovo. „Slobodno" je odsustvo reda, i to je namjerno: posebna
 * tabela „slobodno" bila bi druga istina koja se raziđe sa dodjelama pri svakoj izmjeni.
 */
export async function companyAvailability(
  pool: Pool,
  actor: AvailabilityActor,
  from: string,
  to: string,
): Promise<CompanyAvailabilityRow[]> {
  if (!can(actor.roles, "equipment.view")) return [];
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const result = await client.query<{
      machine_id: string;
      machine_code: string;
      machine_name: string;
      project_id: string | null;
      project_code: string | null;
      project_name: string | null;
      from_date: string | null;
      to_date: string | null;
      override_id: string | null;
    }>(
      `SELECT m.id AS machine_id, m.code AS machine_code, m.name AS machine_name,
              a.project_id, p.code AS project_code, p.name AS project_name,
              to_char(a.from_date, 'YYYY-MM-DD') AS from_date,
              to_char(a.to_date, 'YYYY-MM-DD') AS to_date,
              a.double_booking_override_id AS override_id
         FROM public.machines m
         LEFT JOIN public.project_assignments a
                ON a.company_id = m.company_id AND a.machine_id = m.id AND a.voided_at IS NULL
               AND a.from_date <= $3::date
               AND (a.to_date IS NULL OR a.to_date >= $2::date)
         LEFT JOIN public.projects p ON p.company_id = a.company_id AND p.id = a.project_id
        WHERE m.company_id = $1 AND m.is_active
        ORDER BY m.code, a.from_date`,
      [actor.companyId, from, to],
    );
    const byMachine = new Map<string, CompanyAvailabilityRow>();
    for (const row of result.rows) {
      const existing = byMachine.get(row.machine_id) ?? {
        machine_id: row.machine_id,
        machine_code: row.machine_code,
        machine_name: row.machine_name,
        slots: [],
      };
      if (row.from_date) {
        existing.slots.push({
          machine_id: row.machine_id,
          project_id: row.project_id,
          project_code: row.project_code,
          project_name: row.project_name,
          from_date: row.from_date,
          to_date: row.to_date,
          override_id: row.override_id,
        });
      }
      byMachine.set(row.machine_id, existing);
    }
    return [...byMachine.values()];
  });
}
