/**
 * F6 (Modul 7) — obračun sati: periodi, izračun, revizije, odobrenje i zaključavanje.
 *
 * Tri pravila određuju cijeli fajl:
 *
 *  1. **Mjesečni period je jedinica obračuna**, ne izvoz segmenata. Obračun je revizija
 *     (`payroll_runs.revision`) koja se NE prepisuje: ponovni izračun je nova revizija, stara
 *     ostaje čitljiva sa istim iznosima.
 *  2. **Nema izmišljenih brojeva.** Nedostaje satnica → linija `RATE_MISSING`; nedostaje
 *     parametar → `PARAMETER_MISSING`; u oba slučaja `amount_cents` je `NULL`, nikad 0. Period
 *     sa ijednom takvom linijom ne može u `APPROVED` — inače bi „nepoznato“ postalo dio zarade.
 *  3. **Sat je u tačno jednoj kategoriji.** Klasifikacija je u domeni (`classifyDay`); ovdje se
 *     samo primjenjuje na segmente i sabira sa raspisom, pa se svaki cent može objasniti.
 *
 * Zaključan period se ne dira. Izmjena dana u `LOCKED` periodu otvara `pay_corrections` red koji
 * se primjenjuje u narednom mjesecu — to radi triger u bazi, a iznos korekcije računa servis.
 */
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import {
  WEEK_START_ISO,
  classifyDay,
  isSundayDate,
  money,
  type CategoryHours,
  type Currency,
  type OvertimeBasis,
  type PayrollRules,
} from "@gradix/domain";
import { can } from "./permissions";
import { writeAudit } from "./audit";
import { bookWorkdayCost } from "./cost-entry-service";

export type PayrollActor = {
  userId: string;
  companyId: string;
  roles: readonly string[];
  /** Kad je `true`, servis ne provjerava dozvolu (poziv iz worker posla / testa). */
  system?: boolean;
};

export type PayrollError = {
  code:
    | "FORBIDDEN"
    | "NOT_FOUND"
    | "VALIDATION_FAILED"
    | "CONFLICT"
    | "RATE_MISSING"
    | "PARAMETER_MISSING"
    | "PERIOD_NOT_READY"
    | "SELF_APPROVAL_FORBIDDEN"
    | "PAYROLL_ALREADY_LOCKED"
    | "PERIOD_LOCKED_CORRECTION"
    | "NEGATIVE_NET_FORBIDDEN";
  message: string;
  /** Koliko linija/dana blokira — ekran pokazuje broj, ne „nešto nije u redu“. */
  detail?: Record<string, unknown>;
};

export type PayrollResult<T> = T | PayrollError;

export function isPayrollError(value: unknown): value is PayrollError {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    "message" in value &&
    !("lines" in value) &&
    !("periods" in value)
  );
}

const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "")}`;

/* ============================================================ šifarnik komponenti */

export type PayrollComponentRow = {
  id: string;
  code: string;
  name: string;
  kind: "EARNING" | "DEDUCTION";
  basis: "HOURS" | "DAYS" | "FIXED" | "PERCENT_OF_EARNINGS";
  category: string;
  is_taxable: boolean;
  sort_order: number;
  is_active: boolean;
};

/**
 * Zadani set komponenti. Vrijednosti MORAJU odgovarati `seed_payroll_components()` u migraciji —
 * inače firma nastala prije F6 i firma nastala poslije imaju različit šifarnik, a obračun zavisi
 * od toga kad je firma napravljena.
 */
const DEFAULT_COMPONENTS: ReadonlyArray<
  Omit<PayrollComponentRow, "id" | "is_taxable" | "is_active"> & { is_taxable?: boolean }
> = [
  { code: "REDOVNI", name: "Redovni sati", kind: "EARNING", basis: "HOURS", category: "REGULAR", sort_order: 10 },
  { code: "PREKOVREMENI", name: "Prekovremeni sati", kind: "EARNING", basis: "HOURS", category: "OVERTIME", sort_order: 20 },
  { code: "NOCNI", name: "Noćni sati", kind: "EARNING", basis: "HOURS", category: "NIGHT", sort_order: 30 },
  { code: "NEDJELJA", name: "Nedjeljni sati", kind: "EARNING", basis: "HOURS", category: "SUNDAY", sort_order: 40 },
  { code: "PRAZNIK", name: "Praznični sati", kind: "EARNING", basis: "HOURS", category: "HOLIDAY", sort_order: 50 },
  { code: "BOLOVANJE", name: "Bolovanje", kind: "EARNING", basis: "DAYS", category: "ABSENCE", sort_order: 60 },
  { code: "GODISNJI", name: "Godišnji odmor", kind: "EARNING", basis: "DAYS", category: "ABSENCE", sort_order: 70 },
  /* Neplaćeni izostanci su POSEBNE linije sa iznosom 0, a ne „nema linije“. Razlika je bitna:
     odsustvo linije znači „ništa se nije dogodilo“, a nula znači „događaj postoji i ne plaća se“.
     Bez njih bi neopravdani izostanak nestao iz obračuna — a upravo njega računovodstvo traži. */
  { code: "NEPLACENO", name: "Neplaćeni dopust", kind: "EARNING", basis: "DAYS", category: "ABSENCE", is_taxable: false, sort_order: 75 },
  { code: "NEOPRAVDANO", name: "Neopravdani izostanak", kind: "EARNING", basis: "DAYS", category: "ABSENCE", is_taxable: false, sort_order: 76 },
  { code: "TERENSKI", name: "Terenski dodatak", kind: "EARNING", basis: "DAYS", category: "FIELD_ALLOWANCE", sort_order: 80 },
  { code: "AKONTACIJA", name: "Akontacija", kind: "DEDUCTION", basis: "FIXED", category: "ADVANCE", is_taxable: false, sort_order: 90 },
  { code: "POZAJMICA", name: "Pozajmica", kind: "DEDUCTION", basis: "FIXED", category: "LOAN", is_taxable: false, sort_order: 100 },
  { code: "OSTALO", name: "Ostalo", kind: "EARNING", basis: "FIXED", category: "OTHER", sort_order: 110 },
];

/**
 * Dopunjava šifarnik ako je prazan. Isti razlog kao kod kategorija troška: `created_by` je
 * NOT NULL i pokazuje na stvarnog korisnika, a firma bez člana ga nema — pa se set pravi pri
 * prvom stvarnom radu, ne pri onboarding-u bez korisnika.
 */
async function ensureComponents(client: PoolClient, company: string, actorId: string): Promise<void> {
  const existing = await client.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM public.payroll_components WHERE company_id = $1",
    [company],
  );
  if (Number(existing.rows[0]?.n ?? "0") > 0) return;
  /*
   * `OVERTIME_MULTIPLIER = 1.0` dolazi s firmom, kao i komponente. Razlog je isti kao u migraciji:
   * 1,0 je NEUTRALNI množilac (sat ostaje sat), a ne izmišljena zakonska stopa. Bez njega bi svaki
   * period sa prekovremenim satom bio `PARAMETER_MISSING` dok računovođa ne unese broj — a to nije
   * nedostatak podatka, nego odsustvo uvećanja. Sve OSTALE stope (noć, nedjelja, praznik,
   * bolovanje, terenski) i dalje traži računovodstvo.
   */
  await client.query(
    `INSERT INTO public.payroll_parameters
       (id, company_id, code, value, unit, valid_from, confirmed_by, created_by, note)
     SELECT $1, $2, 'OVERTIME_MULTIPLIER', 1.0000, 'MULTIPLIER', DATE '2000-01-01', $3, $3,
            'Neutralni množilac (sat ostaje sat) — nije zakonska stopa.'
      WHERE NOT EXISTS (
        SELECT 1 FROM public.payroll_parameters p
         WHERE p.company_id = $2 AND p.code = 'OVERTIME_MULTIPLIER'
      )`,
    [newId("pp"), company, actorId],
  );

  for (const component of DEFAULT_COMPONENTS) {
    await client.query(
      `INSERT INTO public.payroll_components
         (id, company_id, code, name, kind, basis, category, is_taxable, sort_order, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
       ON CONFLICT (company_id, code) DO NOTHING`,
      [
        newId("pc"),
        company,
        component.code,
        component.name,
        component.kind,
        component.basis,
        component.category,
        component.is_taxable ?? true,
        component.sort_order,
        actorId,
      ],
    );
  }
}

export async function listComponents(
  pool: Pool,
  actor: PayrollActor,
): Promise<PayrollResult<{ components: PayrollComponentRow[] }>> {
  if (!actor.system && !can(actor.roles, "payroll.view")) {
    return { code: "FORBIDDEN", message: "Nemate pravo pregleda šifarnika obračuna." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    await ensureComponents(client, actor.companyId, actor.userId);
    const rows = await client.query<PayrollComponentRow>(
      `SELECT id, code, name, kind, basis, category, is_taxable, sort_order, is_active
         FROM public.payroll_components
        WHERE company_id = $1
        ORDER BY sort_order, code`,
      [actor.companyId],
    );
    return { components: rows.rows };
  });
}

export type PayrollComponentInput = {
  code: string;
  name: string;
  kind: "EARNING" | "DEDUCTION";
  basis: "HOURS" | "DAYS" | "FIXED" | "PERCENT_OF_EARNINGS";
  category: string;
  is_taxable?: boolean;
  sort_order?: number;
  is_active?: boolean;
};

export async function saveComponent(
  pool: Pool,
  actor: PayrollActor,
  input: PayrollComponentInput,
  id?: string,
): Promise<PayrollResult<PayrollComponentRow>> {
  if (!actor.system && !can(actor.roles, "payroll.manage")) {
    return { code: "FORBIDDEN", message: "Nemate pravo uređivanja šifarnika obračuna." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    if (id) {
      const updated = await client.query<PayrollComponentRow>(
        `UPDATE public.payroll_components
            SET name = $3, kind = $4, basis = $5, category = $6, is_taxable = $7,
                sort_order = $8, is_active = $9, updated_by = $10, updated_at = clock_timestamp()
          WHERE company_id = $1 AND id = $2
          RETURNING id, code, name, kind, basis, category, is_taxable, sort_order, is_active`,
        [
          actor.companyId,
          id,
          input.name,
          input.kind,
          input.basis,
          input.category,
          input.is_taxable ?? true,
          input.sort_order ?? 100,
          input.is_active ?? true,
          actor.userId,
        ],
      );
      const row = updated.rows[0];
      if (!row) return { code: "NOT_FOUND", message: "Komponenta ne postoji." };
      await writeAudit(client, {
        companyId: actor.companyId,
        actorId: actor.userId,
        actorEmail: null,
        action: "payroll.component_updated",
        entityType: "payroll_component",
        entityId: row.id,
        metadata: { code: row.code },
      });
      return row;
    }

    const inserted = await client.query<PayrollComponentRow>(
      `INSERT INTO public.payroll_components
         (id, company_id, code, name, kind, basis, category, is_taxable, sort_order, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
       RETURNING id, code, name, kind, basis, category, is_taxable, sort_order, is_active`,
      [
        newId("pc"),
        actor.companyId,
        input.code,
        input.name,
        input.kind,
        input.basis,
        input.category,
        input.is_taxable ?? true,
        input.sort_order ?? 100,
        actor.userId,
      ],
    ).catch((error: unknown) => {
      if (error instanceof Error && error.message.includes("payroll_components_company_code_unique")) {
        return null;
      }
      throw error;
    });
    if (!inserted) {
      return { code: "CONFLICT", message: "Komponenta sa tom šifrom već postoji." };
    }
    const row = inserted.rows[0]!;
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "payroll.component_created",
      entityType: "payroll_component",
      entityId: row.id,
      metadata: { code: row.code },
    });
    return row;
  });
}

/* ============================================================ parametri */

export type PayrollParameterRow = {
  id: string;
  code: string;
  value: string;
  unit: "MULTIPLIER" | "PERCENT" | "CENTS";
  valid_from: string;
  valid_to: string | null;
  confirmed_by_name: string | null;
  confirmed_at: string;
  note: string | null;
};

/** Kodovi koje obračun traži. Ekran ih pokazuje PRIJE izračuna, da nedostatak ne bude iznenađenje. */
export const REQUIRED_PARAMETER_CODES = [
  "OVERTIME_MULTIPLIER",
  "NIGHT_MULTIPLIER",
  "SUNDAY_MULTIPLIER",
  "HOLIDAY_MULTIPLIER",
  "SICK_PAY_PCT",
  "FIELD_ALLOWANCE_PER_DAY",
] as const;

/**
 * Parametar koji važi NA DAN. Vraća `null` kad ga nema — pozivalac tada pravi `PARAMETER_MISSING`,
 * a ne nulu. Datumi su uključivi sa oba kraja (`valid_from <= dan <= valid_to`), kao u bazi.
 */
export async function parameterOn(
  client: PoolClient,
  company: string,
  code: string,
  isoDate: string,
): Promise<{ value: number; unit: string; validFrom: string; id: string } | null> {
  const row = await client.query<{ id: string; value: string; unit: string; valid_from: string }>(
    `SELECT id, value::text, unit, valid_from::text
       FROM public.payroll_parameters
      WHERE company_id = $1 AND code = $2
        AND valid_from <= $3::date
        AND (valid_to IS NULL OR valid_to >= $3::date)
      ORDER BY valid_from DESC
      LIMIT 1`,
    [company, code, isoDate],
  );
  const found = row.rows[0];
  if (!found) return null;
  return {
    id: found.id,
    value: Number(found.value),
    unit: found.unit,
    validFrom: found.valid_from,
  };
}

export async function listParameters(
  pool: Pool,
  actor: PayrollActor,
): Promise<PayrollResult<{ parameters: PayrollParameterRow[]; required_codes: string[] }>> {
  if (!actor.system && !can(actor.roles, "payroll.view")) {
    return { code: "FORBIDDEN", message: "Nemate pravo pregleda parametara obračuna." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const rows = await client.query<PayrollParameterRow>(
      `SELECT p.id, p.code, p.value::text, p.unit, p.valid_from::text, p.valid_to::text,
              COALESCE(u.first_name || ' ' || u.last_name, u.email) AS confirmed_by_name,
              p.confirmed_at::text, p.note
         FROM public.payroll_parameters p
         LEFT JOIN public.users u ON u.id = p.confirmed_by
        WHERE p.company_id = $1
        ORDER BY p.code, p.valid_from DESC`,
      [actor.companyId],
    );
    return { parameters: rows.rows, required_codes: [...REQUIRED_PARAMETER_CODES] };
  });
}

export type PayrollParameterInput = {
  code: string;
  value: string;
  unit: "MULTIPLIER" | "PERCENT" | "CENTS";
  valid_from: string;
  valid_to?: string | null;
  note?: string;
};

export async function createParameter(
  pool: Pool,
  actor: PayrollActor,
  input: PayrollParameterInput,
): Promise<PayrollResult<PayrollParameterRow>> {
  if (!actor.system && !can(actor.roles, "payroll.manage")) {
    return { code: "FORBIDDEN", message: "Nemate pravo uređivanja parametara obračuna." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const inserted = await client.query<PayrollParameterRow>(
      `INSERT INTO public.payroll_parameters
         (id, company_id, code, value, unit, valid_from, valid_to, confirmed_by, created_by, note)
       VALUES ($1, $2, $3, $4, $5, $6::date, $7::date, $8, $8, $9)
       RETURNING id, code, value::text, unit, valid_from::text, valid_to::text,
                 NULL::text AS confirmed_by_name, confirmed_at::text, note`,
      [
        newId("pp"),
        actor.companyId,
        input.code,
        input.value,
        input.unit,
        input.valid_from,
        input.valid_to ?? null,
        actor.userId,
        input.note ?? null,
      ],
    ).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("payroll_parameters_company_code_from_unique")) {
        return "DUPLICATE" as const;
      }
      if (message.includes("PARAMETER_OVERLAP") || message.includes("payroll_parameters_no_overlap")) {
        return "OVERLAP" as const;
      }
      throw error;
    });
    if (inserted === "DUPLICATE") {
      return { code: "CONFLICT", message: "Parametar sa tim kodom i datumom već postoji." };
    }
    if (inserted === "OVERLAP") {
      return {
        code: "CONFLICT",
        message: "Parametar sa tim kodom već važi u tom periodu; zatvorite prethodni datumom „važi do“.",
      };
    }
    const row = inserted.rows[0]!;
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "payroll.parameter_created",
      entityType: "payroll_parameter",
      entityId: row.id,
      metadata: { code: row.code, validFrom: row.valid_from, value: row.value },
    });
    return row;
  });
}

/* ============================================================ periodi */

export type PayPeriodRow = {
  id: string;
  year: number;
  month: number;
  status: "OPEN" | "CALCULATED" | "APPROVED" | "LOCKED";
  calculated_at: string | null;
  approved_at: string | null;
  locked_at: string | null;
  worker_count: number;
  gross_total: string | null;
  revision: number | null;
  blockers: { code: string; count: number; message: string }[];
};

const periodBounds = (year: number, month: number) => {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start, end: `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}` };
};

/**
 * „Spremnost“ perioda (§1.8/30) — VIDLJIVO stanje, ne skrivena provjera pri odobrenju.
 *
 * Blokiraju: dan koji nije potvrđen, otvoren sukob, linija sa nedostajućom satnicom ili
 * parametrom, i period bez ijednog izračuna. Odobrenje ih sve ponovo provjerava — ekran nije
 * kapija, ali mora pokazati ISTI razlog koji bi odobrenje odbilo.
 */
async function periodBlockers(
  client: PoolClient,
  company: string,
  periodId: string,
  bounds: { start: string; end: string },
): Promise<PayPeriodRow["blockers"]> {
  const blockers: PayPeriodRow["blockers"] = [];

  const submitted = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM public.workdays d
      WHERE d.company_id = $1 AND d.work_date BETWEEN $2::date AND $3::date
        AND d.approval_status = 'SUBMITTED'`,
    [company, bounds.start, bounds.end],
  );
  if (Number(submitted.rows[0]?.n ?? "0") > 0) {
    blockers.push({
      code: "SUBMITTED_DAY",
      count: Number(submitted.rows[0]!.n),
      message: "Ima dana koji nisu potvrđeni od šefa.",
    });
  }

  const conflicts = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM public.sync_conflicts
      WHERE company_id = $1 AND status = 'OPEN'
        AND created_at >= $2::date AND created_at < ($3::date + 1)`,
    [company, bounds.start, bounds.end],
  );
  if (Number(conflicts.rows[0]?.n ?? "0") > 0) {
    blockers.push({
      code: "OPEN_CONFLICT",
      count: Number(conflicts.rows[0]!.n),
      message: "Ima otvorenih sukoba sinhronizacije u periodu.",
    });
  }

  // A correction must belong to the latest revision, not just any old run.
  const corrections = await client.query<{n:string}>(
    `SELECT count(*)::text AS n FROM public.pay_corrections c
      WHERE c.company_id=$1 AND c.target_period_id=$2
        AND (c.status <> 'APPLIED' OR c.applied_run_id IS DISTINCT FROM
          (SELECT id FROM public.payroll_runs WHERE company_id=$1 AND period_id=$2 ORDER BY revision DESC LIMIT 1))`,
    [company,periodId],
  );
  if (Number(corrections.rows[0]?.n ?? 0) > 0) blockers.push({
    code:"PENDING_CORRECTIONS",count:Number(corrections.rows[0]!.n),message:"Postoje neobrađene korekcije iz zaključanog perioda.",
  });

  const run = await client.query<{ id: string }>(
    "SELECT id FROM public.payroll_runs WHERE company_id = $1 AND period_id = $2 ORDER BY revision DESC LIMIT 1",
    [company, periodId],
  );
  const runId = run.rows[0]?.id;
  if (!runId) {
    blockers.push({ code: "NO_RUN", count: 1, message: "Period još nije izračunat." });
    return blockers;
  }

  const negative = await client.query<{n:string}>(
    `SELECT count(*)::text AS n FROM (
       SELECT worker_id FROM public.payroll_run_lines WHERE company_id=$1 AND run_id=$2
       GROUP BY worker_id HAVING sum(amount_cents) < 0
     ) x`, [company,runId],
  );
  if (Number(negative.rows[0]?.n ?? 0) > 0) blockers.push({
    code:"NEGATIVE_NET_FORBIDDEN",count:Number(negative.rows[0]!.n),message:"Korekcija ili odbici stvaraju negativan obračun radnika.",
  });

  const missing = await client.query<{ status: string; n: string }>(
    `SELECT status, count(*)::text AS n FROM public.payroll_run_lines
      WHERE company_id = $1 AND run_id = $2 AND status <> 'OK'
      GROUP BY status`,
    [company, runId],
  );
  for (const row of missing.rows) {
    blockers.push({
      code: row.status === "RATE_MISSING" ? "RATE_MISSING" : "PARAMETER_MISSING",
      count: Number(row.n),
      message:
        row.status === "RATE_MISSING"
          ? "Nedostaje satnica za neke radnike u periodu."
          : "Nedostaje parametar obračuna (množilac ili procenat).",
    });
  }
  return blockers;
}

export async function listPeriods(
  pool: Pool,
  actor: PayrollActor,
  filters: { year?: number } = {},
): Promise<PayrollResult<{ periods: PayPeriodRow[]; can_create: boolean }>> {
  if (!actor.system && !can(actor.roles, "payroll.view")) {
    return { code: "FORBIDDEN", message: "Nemate pravo pregleda obračuna." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const rows = await client.query<Omit<PayPeriodRow, "blockers" | "gross_total"> & { gross_total: string | null }>(
      `SELECT p.id, p.year, p.month, p.status, p.calculated_at::text, p.approved_at::text,
              p.locked_at::text,
              COALESCE(r.worker_count, 0)::int AS worker_count,
              r.gross_total::text AS gross_total,
              r.revision
         FROM public.pay_periods p
         LEFT JOIN LATERAL (
           SELECT pr.revision,
                  count(DISTINCT l.worker_id)::int AS worker_count,
                  /* Bruto osnova je zbir ZARADA (bez odbitaka) i samo kad sve linije imaju
                     iznos; inače je NULL — djelimičan zbir bi bio lažno tačan broj. */
                  CASE WHEN count(*) FILTER (WHERE l.status <> 'OK') > 0 THEN NULL
                       ELSE sum(l.amount_cents) FILTER (WHERE l.amount_cents > 0 OR l.component_code = 'KOREKCIJA') END AS gross_total
             FROM public.payroll_runs pr
             JOIN public.payroll_run_lines l
               ON l.company_id = pr.company_id AND l.run_id = pr.id
            WHERE pr.company_id = p.company_id AND pr.period_id = p.id
            GROUP BY pr.revision
            ORDER BY pr.revision DESC
            LIMIT 1
         ) r ON true
        WHERE p.company_id = $1 AND ($2::int IS NULL OR p.year = $2::int)
        ORDER BY p.year DESC, p.month DESC`,
      [actor.companyId, filters.year ?? null],
    );

    const periods: PayPeriodRow[] = [];
    for (const row of rows.rows) {
      const bounds = periodBounds(row.year, row.month);
      periods.push({
        ...row,
        blockers: await periodBlockers(client, actor.companyId, row.id, bounds),
      });
    }
    return { periods, can_create: can(actor.roles, "payroll.manage") || Boolean(actor.system) };
  });
}

export async function createPeriod(
  pool: Pool,
  actor: PayrollActor,
  input: { year: number; month: number },
): Promise<PayrollResult<PayPeriodRow>> {
  if (!actor.system && !can(actor.roles, "payroll.manage")) {
    return { code: "FORBIDDEN", message: "Nemate pravo otvaranja perioda obračuna." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const id = newId("prd");
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO public.pay_periods (id, company_id, year, month)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (company_id, year, month) DO NOTHING
       RETURNING id`,
      [id, actor.companyId, input.year, input.month],
    );
    if (!inserted.rows[0]) {
      return { code: "CONFLICT", message: "Period za taj mjesec već postoji." };
    }
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "payroll.period_opened",
      entityType: "pay_period",
      entityId: id,
      metadata: { year: input.year, month: input.month },
      retentionClass: "FINANCIAL",
    });
    const bounds = periodBounds(input.year, input.month);
    return {
      id,
      year: input.year,
      month: input.month,
      status: "OPEN",
      calculated_at: null,
      approved_at: null,
      locked_at: null,
      worker_count: 0,
      gross_total: null,
      revision: null,
      blockers: await periodBlockers(client, actor.companyId, id, bounds),
    };
  });
}

/* ============================================================ izračun */

type CompanyRulesRow = {
  night_from: string | null;
  night_to: string | null;
  week_start: string;
  overtime_basis: string;
  overtime_daily_threshold: string;
  overtime_weekly_threshold: string | null;
  city: string | null;
};

async function loadRules(client: PoolClient, company: string): Promise<PayrollRules> {
  const row = await client.query<CompanyRulesRow>(
    `SELECT night_from::text, night_to::text, week_start, overtime_basis,
            overtime_daily_threshold::text, overtime_weekly_threshold::text, city
       FROM public.companies WHERE id = $1`,
    [company],
  );
  const found = row.rows[0];
  if (!found) throw new Error("COMPANY_MISSING");
  return {
    nightFrom: found.night_from,
    nightTo: found.night_to,
    overtimeBasis: (found.overtime_basis === "WEEKLY" ? "WEEKLY" : "DAILY") as OvertimeBasis,
    overtimeDailyThreshold: Number(found.overtime_daily_threshold),
    overtimeWeeklyThreshold:
      found.overtime_weekly_threshold === null ? null : Number(found.overtime_weekly_threshold),
    weekStartIso: WEEK_START_ISO[found.week_start] ?? 1,
  };
}

/** Segment preveden u komade dana: `[from, to)` u minutama od početka POSLOVNOG dana. */
type SegmentSlice = { from: number; to: number; workEntryId: string };

/**
 * Reže segmente po ponoći POSLOVNOG dana firme.
 *
 * Zašto ne po `started_at::time`: segment 22:00–02:00 traje dva dana, a `work_date` je jedan dan.
 * Ako se ne reže, noćni sati poslije ponoći pripadnu danu u kojem segment NIJE počeo — ili se
 * izgube. Rezanje po lokalnoj ponoći daje tačno jedan dan po komadu.
 */
function splitAcrossMidnight(startedAt: Date, endedAt: Date, tzOffsetMinutes: number): SegmentSlice[] {
  const slices: SegmentSlice[] = [];
  let cursor = new Date(startedAt.getTime());
  const end = new Date(endedAt.getTime());
  // Ograničenje na 48 h: segment duži od toga je greška unosa, ne rad.
  for (let guard = 0; guard < 4 && cursor < end; guard += 1) {
    const local = new Date(cursor.getTime() + tzOffsetMinutes * 60_000);
    const midnight = Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate() + 1,
    );
    const boundary = new Date(midnight - tzOffsetMinutes * 60_000);
    const sliceEnd = boundary < end ? boundary : end;
    const fromLocal = new Date(cursor.getTime() + tzOffsetMinutes * 60_000);
    const toLocal = new Date(sliceEnd.getTime() + tzOffsetMinutes * 60_000);
    const fromMinutes = fromLocal.getUTCHours() * 60 + fromLocal.getUTCMinutes();
    const sameDay =
      fromLocal.getUTCFullYear() === toLocal.getUTCFullYear() &&
      fromLocal.getUTCMonth() === toLocal.getUTCMonth() &&
      fromLocal.getUTCDate() === toLocal.getUTCDate();
    const toMinutes = sameDay ? toLocal.getUTCHours() * 60 + toLocal.getUTCMinutes() : 1440;
    if (toMinutes > fromMinutes) {
      slices.push({ from: fromMinutes, to: toMinutes, workEntryId: "" });
    }
    cursor = sliceEnd;
  }
  return slices;
}

type WorkerPeriod = {
  worker_id: string;
  worker_name: string;
  days: Array<{
    workday_id: string;
    work_date: string;
    day_kind: string;
    approval_status: string;
    slices: { from: number; to: number; workEntryId: string }[];
    hours: CategoryHours;
    hours_decimal: number;
  }>;
};

/**
 * Učitava dane perioda i klasifikuje sate.
 *
 * Ulaz su SAMO potvrđeni dani (`FOREMAN_CONFIRMED`/`LOCKED`) sa `day_kind='WORK'` i segmentima
 * `end_state='KNOWN_END'`. `SUBMITTED` dan NIJE tiho preskočen — on je blokada perioda (§1.8/30);
 * preskakanje bi značilo da obračun izgleda spreman, a sati nedostaju.
 */
async function loadPeriodDays(
  client: PoolClient,
  company: string,
  bounds: { start: string; end: string },
  rules: PayrollRules,
): Promise<Map<string, WorkerPeriod>> {
  const tz = await client.query<{ timezone: string }>(
    "SELECT timezone FROM public.companies WHERE id = $1",
    [company],
  );
  const zone = tz.rows[0]?.timezone ?? "UTC";
  const offsetRow = await client.query<{ off: string }>(
    `SELECT EXTRACT(EPOCH FROM (($1::timestamptz) AT TIME ZONE $2 - ($1::timestamptz) AT TIME ZONE 'UTC')) / 60 AS off`,
    [`${bounds.start}T12:00:00Z`, zone],
  );
  const offsetMinutes = Number(offsetRow.rows[0]?.off ?? 0);

  const holidays = await client.query<{ holiday_date: string; is_paid: boolean }>(
    `SELECT holiday_date::text, is_paid FROM public.company_holidays
      WHERE company_id = $1 AND holiday_date BETWEEN $2::date AND $3::date AND is_paid`,
    [company, bounds.start, bounds.end],
  );
  const paidHolidays = new Set(holidays.rows.map((row) => row.holiday_date));

  const rows = await client.query<{
    workday_id: string;
    worker_id: string;
    worker_name: string;
    work_date: string;
    day_kind: string;
    approval_status: string;
    entry_id: string | null;
    started_at: Date | null;
    ended_at: Date | null;
  }>(
    `SELECT d.id AS workday_id, d.worker_id,
            (w.first_name || ' ' || w.last_name) AS worker_name,
            d.work_date::text, d.day_kind, d.approval_status,
            e.id AS entry_id, e.started_at, e.ended_at
       FROM public.workdays d
       JOIN public.workers w ON w.company_id = d.company_id AND w.id = d.worker_id
       LEFT JOIN public.work_entries e
         ON e.company_id = d.company_id AND e.workday_id = d.id
        AND e.kind = 'WORK' AND e.end_state = 'KNOWN_END'
        AND e.ended_at IS NOT NULL AND e.resolution_state = 'ACTIVE'
      WHERE d.company_id = $1
        AND d.work_date BETWEEN $2::date AND $3::date
        AND d.approval_status IN ('FOREMAN_CONFIRMED', 'LOCKED')
      ORDER BY d.worker_id, d.work_date, e.started_at`,
    [company, bounds.start, bounds.end],
  );

  const byWorker = new Map<string, WorkerPeriod>();
  const daySlices = new Map<string, SegmentSlice[]>();

  for (const row of rows.rows) {
    if (!byWorker.has(row.worker_id)) {
      byWorker.set(row.worker_id, {
        worker_id: row.worker_id,
        worker_name: row.worker_name,
        days: [],
      });
    }
    if (row.entry_id && row.started_at && row.ended_at) {
      const existing = daySlices.get(row.workday_id) ?? [];
      const parts = splitAcrossMidnight(row.started_at, row.ended_at, offsetMinutes);
      for (const part of parts) existing.push({ ...part, workEntryId: row.entry_id });
      daySlices.set(row.workday_id, existing);
    }
    const worker = byWorker.get(row.worker_id)!;
    if (worker.days.some((day) => day.workday_id === row.workday_id)) continue;

    const slices = daySlices.get(row.workday_id) ?? [];
    const hours = classifyDay(
      {
        slices,
        dayKind: row.day_kind as "WORK",
        isPaidHoliday: paidHolidays.has(row.work_date),
        isSunday: isSundayDate(row.work_date),
        priorWeekMinutes: 0,
      },
      rules,
    );
    worker.days.push({
      workday_id: row.workday_id,
      work_date: row.work_date,
      day_kind: row.day_kind,
      approval_status: row.approval_status,
      slices,
      hours,
      hours_decimal: slices.reduce((sum, slice) => sum + Math.max(0, slice.to - slice.from), 0) / 60,
    });
  }

  /* Sedmični osnov se računa POSLIJE, jer prag zavisi od prethodnih dana iste sedmice — a oni
     uključuju i dane van mjeseca (sedmica 30.01–05.02). Zato `priorWeekMinutes` ulazi u drugi
     prolaz, po radniku i po datumu. */
  if (rules.overtimeBasis === "WEEKLY") {
    for (const worker of byWorker.values()) {
      const sorted = [...worker.days].sort((a, b) => a.work_date.localeCompare(b.work_date));
      let weekKey = "";
      let accumulated = 0;
      for (const day of sorted) {
        const key = weekKeyOf(day.work_date, rules.weekStartIso);
        if (key !== weekKey) {
          weekKey = key;
          accumulated = 0;
        }
        const hours = classifyDay(
          {
            slices: day.slices,
            dayKind: day.day_kind as "WORK",
            isPaidHoliday: paidHolidays.has(day.work_date),
            isSunday: isSundayDate(day.work_date),
            priorWeekMinutes: accumulated,
          },
          rules,
        );
        day.hours = hours;
        accumulated += Math.round(day.hours_decimal * 60);
      }
    }
  }

  return byWorker;
}

/** Ključ sedmice (datum početka) za ISO dan početka; `1` = ponedjeljak. */
export function weekKeyOf(isoDate: string, weekStartIso: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  const isoDow = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  const diff = (isoDow - weekStartIso + 7) % 7;
  date.setUTCDate(date.getUTCDate() - diff);
  return date.toISOString().slice(0, 10);
}

/* ============================================================ satnica na dan rada */

type RateOnDay = {
  rate_cents: bigint | null;
  coefficient: number | null;
  note: string;
};

/**
 * Satnica koja važi NA DAN RADA — nikad „trenutna“.
 *
 * `worker_rates` je historija (Modul 4): dan rada od prošle sedmice mora ući po cijeni koja je
 * tada važila, inače promjena satnice retroaktivno mijenja zatvorene mjesece. Vrste:
 * `HOURLY` direktno, `DAILY` / `MONTHLY` preko imenioca iz `companies.workday_hours` (za dnevnu) i
 * 160 h (za mjesečnu, isti imenilac kao kod mašine), `COEFFICIENT` se primjenjuje na osnovnu
 * satnicu istog dana. Bez osnovice koeficijent nije novac — tada je satnica nepoznata.
 */
async function rateOnDay(
  client: PoolClient,
  company: string,
  worker: string,
  isoDate: string,
  workdayHours: number,
): Promise<RateOnDay | null> {
  const row = await client.query<{
    rate_kind: string;
    amount_cents: string | null;
    currency_code: string | null;
    coefficient: string | null;
  }>(
    `SELECT rate_kind, amount_cents::text, currency_code, coefficient::text
       FROM public.worker_rates
      WHERE company_id = $1 AND worker_id = $2
        AND valid_from <= $3::date AND (valid_to IS NULL OR valid_to >= $3::date)
      ORDER BY valid_from DESC, created_at DESC`,
    [company, worker, isoDate],
  );
  const rows = row.rows;
  if (rows.length === 0) return null;

  const hourly = rows.find((entry) => entry.rate_kind === "HOURLY");
  const coefficientRow = rows.find((entry) => entry.rate_kind === "COEFFICIENT");
  const coefficient = coefficientRow?.coefficient ? Number(coefficientRow.coefficient) : null;

  if (hourly?.amount_cents) {
    const base = BigInt(hourly.amount_cents);
    // Koeficijent je decimalan (4 decimale): `base * coef` u hiljaditim dijelovima centa, pa
    // zaokruživanje na cijeli cent. Float ne odlučuje o centu.
    const cents =
      coefficient === null
        ? base
        : roundHalfUp((base * BigInt(Math.round(coefficient * 10_000))) / 10_000n);
    return {
      rate_cents: cents,
      coefficient,
      note: coefficient === null ? "Satnica po satu na dan rada." : `Satnica × koeficijent ${coefficient}.`,
    };
  }

  const daily = rows.find((entry) => entry.rate_kind === "DAILY");
  if (daily?.amount_cents) {
    const hours = workdayHours > 0 ? workdayHours : 8;
    const cents = roundHalfUp((BigInt(daily.amount_cents) * 1000n) / BigInt(Math.round(hours * 1000)));
    return { rate_cents: cents, coefficient, note: `Dnevnica podijeljena sa ${hours} h.` };
  }

  const monthly = rows.find((entry) => entry.rate_kind === "MONTHLY");
  if (monthly?.amount_cents) {
    // Isti imenilac kao kod mašine (`DEFAULT_PLANNED_HOURS_PER_MONTH` = 160).
    const cents = roundHalfUp(BigInt(monthly.amount_cents) * 1000n / 160000n);
    return { rate_cents: cents, coefficient, note: "Mjesečna plata podijeljena sa 160 h." };
  }

  /* Samo koeficijent, bez osnovice: koeficijent nije novac. Satnica je NEPOZNATA — `RATE_MISSING`,
     a ne izmišljena osnovica. */
  return {
    rate_cents: null,
    coefficient,
    note: "Postoji samo koeficijent, bez osnovne satnice — satnica se ne može izračunati.",
  };
}

function roundHalfUp(value: bigint): bigint {
  // `value` je već u centima × 1000 kad dođe iz dijeljenja; zaokruživanje na cijeli cent.
  return value < 0n ? -((-value + 5n) / 10n) * 10n : ((value + 5n) / 10n) * 10n;
}

/* ============================================================ akontacije */

/**
 * Koliko se odbija od akontacije/pozajmice u ovom periodu.
 *
 * Akontacija (`ADVANCE`) se odbija u mjesecu izdavanja u cjelosti; pozajmica (`LOAN`) u ratama.
 * Pravilo koje se ne smije izgubiti (§1.5/21): odbici NIKAD ne daju negativan obračun — naplati
 * se do nule, a ostatak ostaje u `remaining_cents` i prelazi u sljedeći mjesec.
 */
function installmentFor(
  advance: { kind: string; remaining_cents: string; installment_cents: string | null; issued_on: string },
  bounds: { start: string; end: string },
): bigint {
  const remaining = BigInt(advance.remaining_cents);
  if (remaining <= 0n || advance.issued_on > bounds.end) return 0n;
  if (advance.kind === "ADVANCE") {
    // U mjesecu izdavanja cijela; poslije izdavanja samo ono što je ostalo (npr. djelimično
    // naplaćeno ranije) — nikad više od ostatka.
    return remaining;
  }
  const installment = advance.installment_cents ? BigInt(advance.installment_cents) : remaining;
  return installment < remaining ? installment : remaining;
}

/* ============================================================ izračun perioda */

export type CalculateOutcome = {
  period_id: string;
  revision: number;
  status: "CALCULATED";
  worker_count: number;
  line_count: number;
  rate_missing: number;
  parameter_missing: number;
  gross_cents: string | null;
  cost_entries_written: number;
  cost_entries_skipped: number;
};

/**
 * Izračun perioda. UVIJEK nova revizija — stara ostaje čitljiva, sa istim iznosima.
 *
 * Redoslijed je namjeran: prvo se provjeri da period nije `LOCKED` (tada se ne računa, nego se
 * prave korekcije), pa se čitaju dani, pa satnice i parametri, pa se pišu linije i raspis, i tek
 * na kraju trošak rada u `cost_entries`.
 */
export async function calculatePeriod(
  pool: Pool,
  actor: PayrollActor,
  periodId: string,
): Promise<PayrollResult<CalculateOutcome>> {
  if (!actor.system && !can(actor.roles, "payroll.manage")) {
    return { code: "FORBIDDEN", message: "Nemate pravo izračuna obračuna." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const period = await client.query<{
      id: string;
      year: number;
      month: number;
      status: string;
    }>(
      "SELECT id, year, month, status FROM public.pay_periods WHERE company_id = $1 AND id = $2 FOR UPDATE",
      [actor.companyId, periodId],
    );
    const found = period.rows[0];
    if (!found) return { code: "NOT_FOUND", message: "Period ne postoji." } as PayrollError;
    if (found.status === "LOCKED") {
      return {
        code: "PAYROLL_ALREADY_LOCKED",
        message: "Period je zaključan; ispravke idu kroz korekcije u narednom periodu.",
      } as PayrollError;
    }
    if (found.status === "APPROVED") {
      return {
        code: "CONFLICT",
        message: "Period je odobren; ponovni izračun traži novo otvaranje perioda.",
      } as PayrollError;
    }

    await ensureComponents(client, actor.companyId, actor.userId);
    const rules = await loadRules(client, actor.companyId);
    const bounds = periodBounds(found.year, found.month);

    const company = await client.query<{ workday_hours: string; city: string | null }>(
      "SELECT workday_hours::text, city FROM public.companies WHERE id = $1",
      [actor.companyId],
    );
    const workdayHours = Number(company.rows[0]?.workday_hours ?? 8);
    const companyCity = company.rows[0]?.city ?? null;

    const workers = await loadPeriodDays(client, actor.companyId, bounds, rules);
    // Only explicitly valued corrections can be applied without guessing payroll rules.
    // Rebind previously applied ones to every new revision; unresolved ones remain OPEN.
    const corrections = await client.query<{
      id:string; worker_id:string|null; worker_name:string|null; work_date:string|null;
      delta_amount_cents:string|null; delta_hours:string; reason:string;
    }>(`SELECT c.id,COALESCE(d.worker_id,l.worker_id) AS worker_id,
       (w.first_name || ' ' || w.last_name) AS worker_name,d.work_date::text,
       c.delta_amount_cents::text,c.delta_hours::text,c.reason
      FROM public.pay_corrections c
      JOIN public.pay_periods source ON source.company_id=c.company_id AND source.id=c.period_id AND source.status='LOCKED'
      LEFT JOIN public.workdays d ON d.company_id=c.company_id AND d.id=c.workday_id
      LEFT JOIN public.payroll_run_lines l ON l.company_id=c.company_id AND l.id=c.payroll_line_id
      LEFT JOIN public.workers w ON w.company_id=c.company_id AND w.id=COALESCE(d.worker_id,l.worker_id)
      WHERE c.company_id=$1 AND c.target_period_id=$2 ORDER BY c.created_at,c.id FOR UPDATE OF c`,
      [actor.companyId,periodId]);
    for (const correction of corrections.rows) {
      if (correction.delta_amount_cents === null || !correction.worker_id || !correction.worker_name) continue;
      if (!workers.has(correction.worker_id)) workers.set(correction.worker_id, {
        worker_id:correction.worker_id,worker_name:correction.worker_name,days:[],
      });
    }

    const revisionRow = await client.query<{ next: number }>(
      `SELECT COALESCE(max(revision), 0) + 1 AS next FROM public.payroll_runs
        WHERE company_id = $1 AND period_id = $2`,
      [actor.companyId, periodId],
    );
    const revision = Number(revisionRow.rows[0]?.next ?? 1);
    const runId = newId("prn");

    await client.query(
      `INSERT INTO public.payroll_runs (id, company_id, period_id, revision, computed_by, payload)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        runId,
        actor.companyId,
        periodId,
        revision,
        actor.userId,
        JSON.stringify({ year: found.year, month: found.month, bounds, rules, workers: workers.size }),
      ],
    );

    const components = await client.query<{
      code: string;
      name: string;
      kind: string;
      category: string;
      sort_order: number;
    }>(
      "SELECT code, name, kind, category, sort_order FROM public.payroll_components WHERE company_id = $1",
      [actor.companyId],
    );

    let rateMissing = 0;
    let parameterMissing = 0;
    let lineCount = 0;
    let grossTotal = 0n;
    let anyMissing = false;
    const currency: Currency = "BAM";

    const insertLine = async (params: {
      workerId: string;
      componentCode: string;
      hours: number;
      days: number;
      rateCents: bigint | null;
      amountCents: bigint | null;
      status: "OK" | "RATE_MISSING" | "PARAMETER_MISSING";
      note: string;
      ordinal: number;
      sources: Array<{
        sourceType: "WORK_ENTRY" | "WORKDAY" | "ADJUSTMENT" | "ADVANCE" | "CORRECTION";
        sourceId: string;
        workDate: string | null;
        hours: number;
        days: number;
        amountCents: bigint | null;
        appliedParameters: Record<string, unknown>;
        note?: string;
      }>;
    }): Promise<string> => {
      const lineId = newId("prl");
      await client.query(
        `INSERT INTO public.payroll_run_lines
           (id, company_id, run_id, worker_id, component_code, hours, days, rate_cents,
            amount_cents, currency_code, calc_note, status, ordinal)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          lineId,
          actor.companyId,
          runId,
          params.workerId,
          params.componentCode,
          params.hours.toFixed(3),
          params.days.toFixed(1),
          params.rateCents === null ? null : params.rateCents.toString(),
          // Negativan iznos = odbitak (u bazi CHECK dozvoljava `<= 0`).
          params.amountCents === null ? null : params.amountCents.toString(),
          params.status === "OK" ? currency : null,
          params.note,
          params.status,
          params.ordinal,
        ],
      );
      for (const source of params.sources) {
        await client.query(
          `INSERT INTO public.payroll_line_sources
             (id, company_id, line_id, source_type, source_id, work_date, hours, days,
              amount_cents, applied_parameters)
           VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10::jsonb)`,
          [
            newId("pls"),
            actor.companyId,
            lineId,
            source.sourceType,
            source.sourceId,
            source.workDate,
            source.hours.toFixed(3),
            source.days.toFixed(1),
            source.amountCents === null ? null : source.amountCents.toString(),
            JSON.stringify(source.appliedParameters),
          ],
        );
      }
      lineCount += 1;
      return lineId;
    };

    const componentByCode = new Map(components.rows.map((row) => [row.code, row]));
    const categoryToCode: Record<string, string> = {
      REGULAR: "REDOVNI",
      OVERTIME: "PREKOVREMENI",
      NIGHT: "NOCNI",
      SUNDAY: "NEDJELJA",
      HOLIDAY: "PRAZNIK",
    };

    for (const worker of [...workers.values()].sort((a,b)=>Buffer.compare(Buffer.from(a.worker_id), Buffer.from(b.worker_id)))) {
      let ordinal = 0;
      // Zarada TOG radnika — osnovica za granicu odbitka (vidi `deductable` niže).
      let workerEarnings = 0n;
      const rated = await rateOnDay(
        client,
        actor.companyId,
        worker.worker_id,
        `${bounds.start}`,
        workdayHours,
      );

      // ---- sati po kategorijama, sa raspisom po danu
      const totals: CategoryHours = { HOLIDAY: 0, SUNDAY: 0, NIGHT: 0, OVERTIME: 0, REGULAR: 0 };
      for (const day of worker.days) {
        for (const key of Object.keys(totals) as (keyof CategoryHours)[]) {
          totals[key] += day.hours[key];
        }
      }

      for (const key of ["HOLIDAY", "SUNDAY", "NIGHT", "OVERTIME", "REGULAR"] as const) {
        const hours = totals[key];
        if (hours <= 0) continue;
        const code = categoryToCode[key]!;
        const component = componentByCode.get(code);
        if (!component) continue; // firma je ugasila komponentu — nema linije, nema izmišljanja
        ordinal += 1;

        // Satnica po DANU: svaki dan nosi svoju satnicu, pa zbir nije „prosječna satnica × sati“.
        let amount = 0n;
        let status: "OK" | "RATE_MISSING" | "PARAMETER_MISSING" = "OK";
        const applied: Record<string, unknown> = {};
        let note = rated?.note ?? "Satnica nije unesena.";
        const sources = [];

        if (key !== "REGULAR") {
          const parameterCode = `${key === "OVERTIME" ? "OVERTIME" : key}_MULTIPLIER`;
          const parameter = await parameterOn(
            client,
            actor.companyId,
            parameterCode,
            `${bounds.start}`,
          );
          if (!parameter) {
            status = "PARAMETER_MISSING";
            note = `Nedostaje parametar ${parameterCode} za ${bounds.start}.`;
            parameterMissing += 1;
          } else {
            applied[parameterCode] = {
              value: parameter.value,
              unit: parameter.unit,
              valid_from: parameter.validFrom,
            };
          }
        }

        for (const day of worker.days) {
          const dayHours = key === "HOLIDAY" ? day.hours.HOLIDAY : day.hours[key];
          if (dayHours <= 0) continue;
          const dayRate =
            day === worker.days[0]
              ? rated
              : await rateOnDay(client, actor.companyId, worker.worker_id, day.work_date, workdayHours);
          if (!dayRate || dayRate.rate_cents === null) {
            status = "RATE_MISSING";
            note = `Nedostaje satnica na ${day.work_date}.`;
          }
          const multiplier = Number(applied[`${key}_MULTIPLIER`] instanceof Object
            ? (applied[`${key}_MULTIPLIER`] as { value: number }).value
            : 1);
          const rateCents = dayRate?.rate_cents ?? 0n;
          const dayAmount = scaleCents(rateCents, dayHours, multiplier);
          if (status === "OK") amount += dayAmount;
          sources.push({
            sourceType: "WORKDAY" as const,
            sourceId: day.workday_id,
            workDate: day.work_date,
            hours: dayHours,
            days: 0,
            amountCents: status === "OK" ? dayAmount : null,
            appliedParameters: { ...applied, rate_cents: rateCents.toString() },
          });
        }

        if (status === "RATE_MISSING") rateMissing += 1;
        if (status !== "OK") {
          anyMissing = true;
          amount = 0n;
        }
        await insertLine({
          workerId: worker.worker_id,
          componentCode: code,
          hours,
          days: 0,
          rateCents: rated?.rate_cents ?? null,
          amountCents: status === "OK" ? amount : null,
          status,
          note,
          ordinal,
          sources,
        });
        if (status === "OK") {
          grossTotal += amount;
          workerEarnings += amount;
        }
      }

      // ---- izostanci: dani, ne sati (§1.2/10). UNPAID_LEAVE/NO_SHOW su vidljivi sa 0.
      for (const day of worker.days) {
        const absenceCode =
          day.day_kind === "SICK"
            ? "BOLOVANJE"
            : day.day_kind === "VACATION"
              ? "GODISNJI"
              : day.day_kind === "PAID_LEAVE"
                ? "GODISNJI"
                : null;
        const zeroCode =
          day.day_kind === "UNPAID_LEAVE" ? "NEPLACENO" : day.day_kind === "NO_SHOW" ? "NEOPRAVDANO" : null;
        if (!absenceCode && !zeroCode) continue;
        const componentCode = absenceCode ?? zeroCode!;
        const component = componentByCode.get(componentCode);
        if (!component) continue;
        ordinal += 1;
        const days = 1;
        let amount = 0n;
        let status: "OK" | "PARAMETER_MISSING" = "OK";
        const applied: Record<string, unknown> = {};
        let note = `Izostanak (${day.day_kind}) — dani, ne sati.`;
        if (absenceCode && day.day_kind === "SICK") {
          const parameter = await parameterOn(client, actor.companyId, "SICK_PAY_PCT", day.work_date);
          if (!parameter) {
            status = "PARAMETER_MISSING";
            note = "Nedostaje parametar SICK_PAY_PCT.";
            parameterMissing += 1;
          } else {
            applied.SICK_PAY_PCT = {
              value: parameter.value,
              unit: parameter.unit,
              valid_from: parameter.validFrom,
            };
          }
        }
        if (status === "OK" && absenceCode) {
          const dayRate = await rateOnDay(client, actor.companyId, worker.worker_id, day.work_date, workdayHours);
          if (!dayRate || dayRate.rate_cents === null) {
            status = "PARAMETER_MISSING";
            note = `Nedostaje satnica za izostanak na ${day.work_date}.`;
            parameterMissing += 1;
          } else {
            const pct = applied.SICK_PAY_PCT
              ? (applied.SICK_PAY_PCT as { value: number }).value
              : 100;
            amount = scaleCents(dayRate.rate_cents, workdayHours, pct / 100);
          }
        }
        if (status !== "OK") {
          anyMissing = true;
          amount = 0n;
        }
        await insertLine({
          workerId: worker.worker_id,
          componentCode,
          hours: 0,
          days,
          rateCents: null,
          amountCents: status === "OK" ? amount : null,
          status: status === "OK" ? "OK" : "PARAMETER_MISSING",
          note,
          ordinal,
          sources: [
            {
              sourceType: "WORKDAY",
              sourceId: day.workday_id,
              workDate: day.work_date,
              hours: 0,
              days,
              amountCents: status === "OK" ? amount : null,
              appliedParameters: applied,
            },
          ],
        });
        if (status === "OK") {
          grossTotal += amount;
          workerEarnings += amount;
        }
      }

      // ---- terenski dodatak: dan rada na projektu van sjedišta firme
      const fieldDays = await client.query<{ work_date: string; workday_id: string; site_place: string }>(
        `SELECT DISTINCT d.work_date::text, d.id AS workday_id, p.site_place
           FROM public.workdays d
           JOIN public.work_entries e
             ON e.company_id = d.company_id AND e.workday_id = d.id
            AND e.kind = 'WORK' AND e.resolution_state = 'ACTIVE'
           JOIN public.projects p ON p.company_id = e.company_id AND p.id = e.project_id
          WHERE d.company_id = $1 AND d.worker_id = $2
            AND d.work_date BETWEEN $3::date AND $4::date
            AND d.approval_status IN ('FOREMAN_CONFIRMED', 'LOCKED')
            AND p.site_place IS NOT NULL AND btrim(p.site_place) <> ''
            AND ($5::text IS NULL OR lower(btrim(p.site_place)) <> lower(btrim($5::text)))`,
        [actor.companyId, worker.worker_id, bounds.start, bounds.end, companyCity],
      );
      if (fieldDays.rows.length > 0) {
        const component = componentByCode.get("TERENSKI");
        const parameter = await parameterOn(client, actor.companyId, "FIELD_ALLOWANCE_PER_DAY", bounds.start);
        if (component) {
          ordinal += 1;
          const days = fieldDays.rows.length;
          if (!parameter) {
            parameterMissing += 1;
            anyMissing = true;
            await insertLine({
              workerId: worker.worker_id,
              componentCode: "TERENSKI",
              hours: 0,
              days,
              rateCents: null,
              amountCents: null,
              status: "PARAMETER_MISSING",
              note: `Nedostaje parametar FIELD_ALLOWANCE_PER_DAY (dani na terenu: ${days}).`,
              ordinal,
              sources: fieldDays.rows.map((row) => ({
                sourceType: "WORKDAY" as const,
                sourceId: row.workday_id,
                workDate: row.work_date,
                hours: 0,
                days: 1,
                amountCents: null,
                appliedParameters: {},
              })),
            });
          } else {
            const perDay = BigInt(Math.round(parameter.value));
            const amount = perDay * BigInt(days);
            await insertLine({
              workerId: worker.worker_id,
              componentCode: "TERENSKI",
              hours: 0,
              days,
              rateCents: perDay,
              amountCents: amount,
              status: "OK",
              note: `Terenski dodatak: ${days} dan(a) van sjedišta firme.`,
              ordinal,
              sources: fieldDays.rows.map((row) => ({
                sourceType: "WORKDAY" as const,
                sourceId: row.workday_id,
                workDate: row.work_date,
                hours: 0,
                days: 1,
                amountCents: perDay,
                appliedParameters: {
                  FIELD_ALLOWANCE_PER_DAY: {
                    value: parameter.value,
                    unit: parameter.unit,
                    valid_from: parameter.validFrom,
                  },
                },
              })),
            });
            grossTotal += amount;
            workerEarnings += amount;
          }
        }
      }

      // Each valued correction is a separate, traceable earning adjustment.
      for (const correction of corrections.rows) {
        if (correction.worker_id !== worker.worker_id || correction.delta_amount_cents === null) continue;
        const amount=BigInt(correction.delta_amount_cents);
        ordinal += 1;
        await insertLine({
          workerId:worker.worker_id,componentCode:"KOREKCIJA",hours:0,days:0,rateCents:null,
          amountCents:amount,status:"OK",note:correction.reason,ordinal,
          sources:[{sourceType:"CORRECTION",sourceId:correction.id,workDate:correction.work_date,
            hours:0,days:0,amountCents:amount,appliedParameters:{delta_hours:correction.delta_hours}}],
        });
        grossTotal += amount;
        workerEarnings += amount;
        await client.query(`UPDATE public.pay_corrections SET status='APPLIED',applied_run_id=$3,applied_at=clock_timestamp()
          WHERE company_id=$1 AND id=$2`,[actor.companyId,correction.id,runId]);
      }

      // ---- akontacije i pozajmice: odbici, nikad ispod nule
      const advances = await client.query<{
        id: string;
        kind: string;
        remaining_cents: string;
        installment_cents: string | null;
        issued_on: string;
      }>(
        `SELECT id, kind, remaining_cents::text, installment_cents::text, issued_on::text
           FROM public.worker_advances
          WHERE company_id = $1 AND worker_id = $2 AND remaining_cents > 0
          ORDER BY id COLLATE "C" FOR UPDATE`,
        [actor.companyId, worker.worker_id],
      );

      // Latest revisions in other open periods reserve debt; the row lock serializes reservations.
      const reservations = await client.query<{source_id:string; cents:string}>(
        `SELECT s.source_id,sum(-s.amount_cents)::text AS cents FROM public.payroll_line_sources s
         JOIN public.payroll_run_lines l ON l.company_id=s.company_id AND l.id=s.line_id
         JOIN public.payroll_runs r ON r.company_id=l.company_id AND r.id=l.run_id
         JOIN public.pay_periods p ON p.company_id=r.company_id AND p.id=r.period_id
         WHERE s.company_id=$1 AND s.source_type='ADVANCE' AND l.worker_id=$2
           AND p.id <> $3 AND p.status <> 'LOCKED'
           AND r.id=(SELECT id FROM public.payroll_runs WHERE company_id=$1 AND period_id=p.id ORDER BY revision DESC LIMIT 1)
         GROUP BY s.source_id`,[actor.companyId,worker.worker_id,periodId]);
      const reserved = new Map(reservations.rows.map(row=>[row.source_id,BigInt(row.cents)]));

      /*
       * Odbici se mjere prema zaradi TOG radnika. Zajednički zbir firme bi značio da radnik sa
       * velikom zaradom „dozvoljava“ veći odbitak drugome — a to nije njegov dug.
       */
      let deductable = workerEarnings > 0n ? workerEarnings : 0n;
      for (const advance of advances.rows.sort((a,b)=>a.issued_on.localeCompare(b.issued_on) || a.id.localeCompare(b.id))) {
        const available = BigInt(advance.remaining_cents) - (reserved.get(advance.id) ?? 0n);
        const wanted = installmentFor({...advance,remaining_cents:(available > 0n ? available : 0n).toString()}, bounds);
        if (wanted <= 0n) continue;
        /* Odbici ne smiju dati negativan obračun: naplati se do nule, ostatak prelazi dalje. */
        const taken = wanted <= deductable ? wanted : deductable;
        if (taken <= 0n) continue;
        deductable -= taken;
        ordinal += 1;
        const isAdvance = advance.kind === "ADVANCE";
        await insertLine({
          workerId: worker.worker_id,
          componentCode: isAdvance ? "AKONTACIJA" : "POZAJMICA",
          hours: 0,
          days: 0,
          rateCents: null,
          // Odbici su NEGATIVNI u ledgeru linija: zbir zarada + odbitaka = neto bez doprinosa.
          amountCents: -taken,
          status: "OK",
          note:
            taken === wanted
              ? `${isAdvance ? "Akontacija" : "Rata pozajmice"} izdata ${advance.issued_on}.`
              : `${isAdvance ? "Akontacija" : "Rata pozajmice"}: naplaćeno do nule, ostatak prelazi u naredni mjesec.`,
          ordinal,
          sources: [
            {
              sourceType: "ADVANCE",
              sourceId: advance.id,
              workDate: null,
              hours: 0,
              days: 0,
              amountCents: -taken,
              appliedParameters: { requested_cents: wanted.toString(), remaining_cents: advance.remaining_cents },
            },
          ],
        });
      }
    }

    /* ---- trošak rada (§5.14) ----------------------------------------------------------------
     * Knjiži se JEDNA knjiga po danu i projektu, kroz postojeći `bookWorkdayCost` (Modul 5), a ne
     * novim putem: `cost_entries` već ima idempotenciju po izvoru (`WORKDAY` + `workday_id:project`),
     * pa ponovni izračun ne duplira trošak — samo preskoči postojeći red.
     *
     * Zašto tek sada, a ne pri potvrdi dana: potvrda dana knjiži trošak sa satnicom TOG dana. Ako
     * satnica tada nije postojala, red je `PENDING` (bez cijene) i obračun ga popunjava. Ako je
     * dan potvrđen prije nego je satnica unesena, bez ovog koraka trošak bi zauvijek ostao
     * „nepoznat“, iako obračun satnicu ima.
     *
     * Greška knjiženja prekida čitavu transakciju; samo idempotentno postojeći ili
     * poslovno neprimjenjivi izvori broje se kao preskočeni.
     */
    let costWritten = 0;
    let costSkipped = 0;
    for (const worker of workers.values()) {
      for (const day of worker.days) {
        if (day.day_kind !== "WORK") continue;
        const outcome = await bookWorkdayCost(client, {
          companyId: actor.companyId,
          actorId: actor.userId,
          workdayId: day.workday_id,
        });
        costWritten += outcome.posted + outcome.pending;
        costSkipped += outcome.skipped;
      }
    }

    // ---- period → CALCULATED
    await client.query(
      `UPDATE public.pay_periods
          SET status = 'CALCULATED', calculated_at = clock_timestamp(), calculated_by = $3,
              updated_at = clock_timestamp()
        WHERE company_id = $1 AND id = $2`,
      [actor.companyId, periodId, actor.userId],
    );

    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "payroll.calculated",
      entityType: "pay_period",
      entityId: periodId,
      metadata: {
        revision,
        workerCount: workers.size,
        lineCount,
        rateMissing,
        parameterMissing,
      },
      retentionClass: "FINANCIAL",
    });

    return {
      period_id: periodId,
      revision,
      status: "CALCULATED" as const,
      worker_count: workers.size,
      line_count: lineCount,
      rate_missing: rateMissing,
      parameter_missing: parameterMissing,
      gross_cents: anyMissing ? null : grossTotal.toString(),
      cost_entries_written: costWritten,
      cost_entries_skipped: costSkipped,
    };
  });
}

/**
 * `satnica × sati × množilac`, zaokruženo na cent (pola naviše). Satnica je u centima, sati su
 * decimalni (3 decimale), pa se računa u hiljaditim dijelovima da ne bi float odlučivao o centu.
 */
export function scaleCents(rateCents: bigint, hours: number, multiplier: number): bigint {
  const hoursMilli = BigInt(Math.round(hours * 1000));
  const multiplierMilli = BigInt(Math.round(multiplier * 1000));
  const product = rateCents * hoursMilli * multiplierMilli; // cent × 1/1000 h × 1/1000
  const divisor = 1_000_000n;
  return (product + divisor / 2n) / divisor;
}

/* ============================================================ odobrenje i zaključavanje */

/**
 * `CALCULATED → APPROVED` (§1.1/3): odbija se ako postoji `RATE_MISSING`, `PARAMETER_MISSING`,
 * otvoren sukob ili nepotvrđen dan. Sve provjere su iste kao „Spremnost“ na ekranu — ekran nije
 * kapija, ali mora pokazati isti razlog koji bi odobrenje odbilo.
 *
 * `SELF_APPROVAL_FORBIDDEN` (§1.8/27): niko ne odobrava obračun u kojem je sam. Računovođa koji
 * je ujedno i radnik u firmi ne potpisuje svoj mjesec — to nije nepovjerenje, nego kontrola.
 */
export async function approvePeriod(
  pool: Pool,
  actor: PayrollActor,
  periodId: string,
): Promise<PayrollResult<{ period_id: string; status: "APPROVED"; revision: number }>> {
  if (!actor.system && !can(actor.roles, "payroll.approve")) {
    return { code: "FORBIDDEN", message: "Nemate pravo odobrenja obračuna." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const period = await client.query<{ id: string; year: number; month: number; status: string }>(
      "SELECT id, year, month, status FROM public.pay_periods WHERE company_id = $1 AND id = $2 FOR UPDATE",
      [actor.companyId, periodId],
    );
    const found = period.rows[0];
    if (!found) return { code: "NOT_FOUND", message: "Period ne postoji." } as PayrollError;
    if (found.status !== "CALCULATED") {
      return {
        code: "CONFLICT",
        message:
          found.status === "OPEN"
            ? "Period nije izračunat; prvo izračunajte obračun."
            : found.status === "APPROVED"
              ? "Period je već odobren."
              : "Period je zaključan.",
      } as PayrollError;
    }

    /*
     * Samoodobravanje: `approved_by` ne smije biti radnik iz TOG obračuna. Provjera ide preko
     * `workers.user_id` — nalog bez radničkog zapisa nije u obračunu, pa nije ni „sam“.
     */
    const selfLine = await client.query(
      `SELECT 1 FROM public.payroll_run_lines l
         JOIN public.payroll_runs r ON r.company_id = l.company_id AND r.id = l.run_id
         JOIN public.workers w ON w.company_id = l.company_id AND w.id = l.worker_id
        WHERE l.company_id = $1 AND r.period_id = $2 AND w.user_id = $3
        LIMIT 1`,
      [actor.companyId, periodId, actor.userId],
    );
    if ((selfLine.rowCount ?? 0) > 0) {
      return {
        code: "SELF_APPROVAL_FORBIDDEN",
        message: "Ne možete odobriti obračun u kojem ste i sami radnik.",
      } as PayrollError;
    }

    const bounds = periodBounds(found.year, found.month);
    const blockers = await periodBlockers(client, actor.companyId, periodId, bounds);
    const hard = blockers;
    if (hard.length > 0) {
      return {
        code: "PERIOD_NOT_READY",
        message: "Period nije spreman za odobrenje.",
        detail: { blockers: hard },
      } as PayrollError;
    }

    const revisionRow = await client.query<{ revision: number }>(
      `SELECT revision FROM public.payroll_runs
        WHERE company_id = $1 AND period_id = $2 ORDER BY revision DESC LIMIT 1`,
      [actor.companyId, periodId],
    );
    const revision = Number(revisionRow.rows[0]?.revision ?? 0);
    await client.query(
      `UPDATE public.payroll_runs SET status = 'APPROVED'
        WHERE company_id = $1 AND period_id = $2 AND revision = $3`,
      [actor.companyId, periodId, revision],
    );
    await client.query(
      `UPDATE public.pay_periods
          SET status = 'APPROVED', approved_at = clock_timestamp(), approved_by = $3,
              updated_at = clock_timestamp()
        WHERE company_id = $1 AND id = $2`,
      [actor.companyId, periodId, actor.userId],
    );
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "payroll.approved",
      entityType: "pay_period",
      entityId: periodId,
      metadata: { revision, year: found.year, month: found.month },
      retentionClass: "FINANCIAL",
    });
    return { period_id: periodId, status: "APPROVED" as const, revision };
  });
}

/** `APPROVED → LOCKED` — isplaćeno. Poslije ovoga obračun se ne mijenja, samo korekcije. */
export async function lockPeriod(
  pool: Pool,
  actor: PayrollActor,
  periodId: string,
): Promise<PayrollResult<{ period_id: string; status: "LOCKED" }>> {
  if (!actor.system && !can(actor.roles, "payroll.approve")) {
    return { code: "FORBIDDEN", message: "Nemate pravo zaključavanja obračuna." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const period = await client.query<{ id: string; year: number; month: number; status: string }>(
      "SELECT id, year, month, status FROM public.pay_periods WHERE company_id = $1 AND id = $2 FOR UPDATE",
      [actor.companyId, periodId],
    );
    const found = period.rows[0];
    if (!found) return { code: "NOT_FOUND", message: "Period ne postoji." } as PayrollError;
    if (found.status === "LOCKED") {
      return { code: "PAYROLL_ALREADY_LOCKED", message: "Period je već zaključan." } as PayrollError;
    }
    if (found.status !== "APPROVED") {
      return {
        code: "CONFLICT",
        message: "Zaključiti se može samo odobren period.",
      } as PayrollError;
    }
    // Approval is not a permanent waiver: reject a missing run/rate/parameter
    // or newly opened day/conflict before the irreversible transition.
    const blockers = await periodBlockers(client, actor.companyId, periodId, periodBounds(found.year, found.month));
    if (blockers.length) return {code:"PERIOD_NOT_READY", message:"Period nije spreman za zaključavanje.", detail:{blockers}} as PayrollError;
    // Only the latest revision becomes a repayment. The period and all debt rows stay locked
    // until the status change commits; lock in the same worker/id order as calculation.
    const allocations=await client.query<{id:string;worker_id:string;cents:string}>(
      `SELECT s.source_id AS id,l.worker_id,sum(-s.amount_cents)::text AS cents
       FROM public.payroll_line_sources s
       JOIN public.payroll_run_lines l ON l.company_id=s.company_id AND l.id=s.line_id
       WHERE s.company_id=$1 AND s.source_type='ADVANCE' AND l.run_id=(
         SELECT id FROM public.payroll_runs WHERE company_id=$1 AND period_id=$2 ORDER BY revision DESC LIMIT 1
       ) GROUP BY s.source_id,l.worker_id ORDER BY l.worker_id COLLATE "C",s.source_id COLLATE "C"`,[actor.companyId,periodId]);
    for (const allocation of allocations.rows) {
      const advance=await client.query<{remaining_cents:string}>(
        `SELECT remaining_cents::text FROM public.worker_advances
         WHERE company_id=$1 AND id=$2 AND worker_id=$3 FOR UPDATE`,
        [actor.companyId,allocation.id,allocation.worker_id]);
      if (!advance.rows[0] || BigInt(allocation.cents) < 0n || BigInt(advance.rows[0].remaining_cents) < BigInt(allocation.cents))
        return {code:"CONFLICT",message:"Stanje akontacije se promijenilo; obračun nije moguće zaključati."} as PayrollError;
    }
    for (const allocation of allocations.rows) await client.query(
      `UPDATE public.worker_advances SET remaining_cents=remaining_cents-$3::bigint,updated_at=clock_timestamp()
       WHERE company_id=$1 AND id=$2`,[actor.companyId,allocation.id,allocation.cents]);
    await client.query(
      `UPDATE public.pay_periods
          SET status = 'LOCKED', locked_at = clock_timestamp(), locked_by = $3,
              updated_at = clock_timestamp()
        WHERE company_id = $1 AND id = $2`,
      [actor.companyId, periodId, actor.userId],
    );
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "payroll.locked",
      entityType: "pay_period",
      entityId: periodId,
      metadata: { year: found.year, month: found.month },
      retentionClass: "FINANCIAL",
    });
    return { period_id: periodId, status: "LOCKED" as const };
  });
}

/* ============================================================ linije i raspis */

export type PayrollLineDto = {
  id: string;
  run_id: string;
  worker_id: string;
  worker_name: string;
  component_code: string;
  component_name: string;
  kind: "EARNING" | "DEDUCTION";
  hours: number;
  days: number;
  rate_cents: number | null;
  amount_cents: number | null;
  currency_code: string | null;
  status: "OK" | "RATE_MISSING" | "PARAMETER_MISSING";
  calc_note: string | null;
};

export async function listLines(
  pool: Pool,
  actor: PayrollActor,
  periodId: string,
  filters: { workerId?: string; component?: string } = {},
): Promise<
  PayrollResult<{
    run_id: string | null;
    revision: number | null;
    lines: PayrollLineDto[];
    totals: {
      earnings_cents: number | null;
      deductions_cents: number | null;
      missing_workers: number;
      currency_code: string | null;
    };
  }>
> {
  if (!actor.system && !can(actor.roles, "payroll.view")) {
    return { code: "FORBIDDEN", message: "Nemate pravo pregleda obračuna." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const run = await client.query<{ id: string; revision: number }>(
      `SELECT id, revision FROM public.payroll_runs
        WHERE company_id = $1 AND period_id = $2 ORDER BY revision DESC LIMIT 1`,
      [actor.companyId, periodId],
    );
    const runId = run.rows[0]?.id ?? null;
    if (!runId) {
      return {
        run_id: null,
        revision: null,
        lines: [],
        totals: {
          earnings_cents: null,
          deductions_cents: null,
          missing_workers: 0,
          currency_code: null,
        },
      };
    }

    const rows = await client.query<PayrollLineDto & { amount_cents: string | null }>(
      `SELECT l.id, l.run_id, l.worker_id,
              (w.first_name || ' ' || w.last_name) AS worker_name,
              l.component_code, COALESCE(c.name, l.component_code) AS component_name,
              CASE WHEN l.component_code = 'KOREKCIJA' THEN 'EARNING'
                ELSE COALESCE(c.kind, CASE WHEN l.amount_cents < 0 THEN 'DEDUCTION' ELSE 'EARNING' END) END AS kind,
              l.hours::float8 AS hours, l.days::float8 AS days,
              l.rate_cents::bigint AS rate_cents,
              l.amount_cents::text, l.currency_code, l.status, l.calc_note
         FROM public.payroll_run_lines l
         JOIN public.workers w ON w.company_id = l.company_id AND w.id = l.worker_id
         LEFT JOIN public.payroll_components c
           ON c.company_id = l.company_id AND c.code = l.component_code
        WHERE l.company_id = $1 AND l.run_id = $2
          AND ($3::text IS NULL OR l.worker_id = $3::text)
          AND ($4::text IS NULL OR l.component_code = $4::text)
        ORDER BY w.last_name, w.first_name, l.ordinal`,
      [actor.companyId, runId, filters.workerId ?? null, filters.component ?? null],
    );

    const lines: PayrollLineDto[] = rows.rows.map((row) => ({
      ...row,
      rate_cents: row.rate_cents === null ? null : Number(row.rate_cents),
      amount_cents: row.amount_cents === null ? null : Number(row.amount_cents),
    }));

    let earnings: number | null = null;
    let deductions: number | null = null;
    let currency: string | null = null;
    let missingWorkers = 0;
    const missing = new Set<string>();
    for (const line of lines) {
      if (line.status !== "OK") {
        missing.add(line.worker_id);
        continue;
      }
      if (line.amount_cents === null) continue;
      currency ??= line.currency_code;
      if (line.kind === "EARNING") earnings = (earnings ?? 0) + line.amount_cents;
      else deductions = (deductions ?? 0) + line.amount_cents;
    }
    /* Djelimičan zbir je laž: ako ijedna linija nema iznos, bruto osnova je `null`, a ne zbir
       „ostalih“. Ekran tada pokazuje razlog, ne broj koji izgleda tačno. */
    if (missing.size > 0) {
      missingWorkers = missing.size;
      earnings = null;
    }

    return {
      run_id: runId,
      revision: Number(run.rows[0]!.revision),
      lines,
      totals: {
        earnings_cents: earnings,
        deductions_cents: deductions,
        missing_workers: missingWorkers,
        currency_code: currency,
      },
    };
  });
}

/** Jedan red raspisa: odakle sat/dan/iznos linije dolazi. `unknown` bi natjerao pozivaoce na
 *  cast, pa bi tipizacija bila samo dekoracija — zato je izvor eksplicitan tip. */
export type PayrollLineSourceDto = {
  id: string;
  source_type: string;
  source_id: string;
  work_date: string | null;
  hours: number;
  days: number;
  amount_cents: number | null;
  applied_parameters: Record<string, unknown>;
  note: string | null;
};

export async function listLineSources(
  pool: Pool,
  actor: PayrollActor,
  lineId: string,
): Promise<PayrollResult<{ line: PayrollLineDto; sources: PayrollLineSourceDto[]; source_hours: number }>> {
  if (!actor.system && !can(actor.roles, "payroll.view")) {
    return { code: "FORBIDDEN", message: "Nemate pravo pregleda obračuna." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const line = await client.query<PayrollLineDto & { amount_cents: string | null; hours: string }>(
      `SELECT l.id, l.run_id, l.worker_id,
              (w.first_name || ' ' || w.last_name) AS worker_name,
              l.component_code, COALESCE(c.name, l.component_code) AS component_name,
              CASE WHEN l.component_code = 'KOREKCIJA' THEN 'EARNING'
                ELSE COALESCE(c.kind, CASE WHEN l.amount_cents < 0 THEN 'DEDUCTION' ELSE 'EARNING' END) END AS kind,
              l.hours::float8 AS hours, l.days::float8 AS days,
              l.rate_cents::bigint AS rate_cents, l.amount_cents::text, l.currency_code,
              l.status, l.calc_note
         FROM public.payroll_run_lines l
         JOIN public.workers w ON w.company_id = l.company_id AND w.id = l.worker_id
         LEFT JOIN public.payroll_components c
           ON c.company_id = l.company_id AND c.code = l.component_code
        WHERE l.company_id = $1 AND l.id = $2`,
      [actor.companyId, lineId],
    );
    const found = line.rows[0];
    if (!found) return { code: "NOT_FOUND", message: "Linija obračuna ne postoji." } as PayrollError;

    const sources = await client.query<Omit<PayrollLineSourceDto, "amount_cents"> & { amount_cents: string | null }>(
      `SELECT id, source_type, source_id, work_date::text, hours::float8 AS hours,
              days::float8 AS days, amount_cents::text, applied_parameters, note
         FROM public.payroll_line_sources
        WHERE company_id = $1 AND line_id = $2
        ORDER BY work_date NULLS FIRST, source_id`,
      [actor.companyId, lineId],
    );

    const mapped = sources.rows.map((row) => ({
      ...row,
      amount_cents: row.amount_cents === null ? null : Number(row.amount_cents),
    }));
    const sourceHours = mapped.reduce((sum, row) => sum + row.hours, 0);

    return {
      line: {
        ...found,
        rate_cents: found.rate_cents === null ? null : Number(found.rate_cents),
        amount_cents: found.amount_cents === null ? null : Number(found.amount_cents),
      },
      sources: mapped,
      source_hours: sourceHours,
    };
  });
}

/* ============================================================ akontacije i pozajmice */

export type WorkerAdvanceRow = {
  id: string;
  worker_id: string;
  kind: "ADVANCE" | "LOAN";
  amount_cents: number;
  currency_code: string;
  issued_on: string;
  installment_cents: number | null;
  remaining_cents: number;
  note: string | null;
};

export async function listAdvances(
  pool: Pool,
  actor: PayrollActor,
  workerId: string,
): Promise<PayrollResult<{ advances: WorkerAdvanceRow[] }>> {
  if (!actor.system && !can(actor.roles, "payroll.view")) {
    return { code: "FORBIDDEN", message: "Nemate pravo pregleda akontacija." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const rows = await client.query<{
      id: string;
      worker_id: string;
      kind: "ADVANCE" | "LOAN";
      amount_cents: string;
      currency_code: string;
      issued_on: string;
      installment_cents: string | null;
      remaining_cents: string;
      note: string | null;
    }>(
      `SELECT id, worker_id, kind, amount_cents::text, currency_code, issued_on::text,
              installment_cents::text, remaining_cents::text, note
         FROM public.worker_advances
        WHERE company_id = $1 AND worker_id = $2
        ORDER BY issued_on DESC, created_at DESC`,
      [actor.companyId, workerId],
    );
    return {
      advances: rows.rows.map((row) => ({
        ...row,
        amount_cents: Number(row.amount_cents),
        installment_cents: row.installment_cents === null ? null : Number(row.installment_cents),
        remaining_cents: Number(row.remaining_cents),
      })),
    };
  });
}

export async function createAdvance(
  pool: Pool,
  actor: PayrollActor,
  input: {
    workerId: string;
    kind: "ADVANCE" | "LOAN";
    amount: string;
    issuedOn: string;
    installment?: string | null;
    note?: string;
  },
): Promise<PayrollResult<WorkerAdvanceRow>> {
  if (!actor.system && !can(actor.roles, "payroll.manage")) {
    return { code: "FORBIDDEN", message: "Nemate pravo izdavanja akontacija." };
  }
  const cents = money(input.amount, "BAM").cents;
  if (cents <= 0n) {
    return { code: "VALIDATION_FAILED", message: "Iznos mora biti veći od nule." };
  }
  if (input.kind === "LOAN" && !input.installment) {
    return {
      code: "VALIDATION_FAILED",
      message: "Pozajmica traži ratu; bez rate se nikad ne bi odbila.",
    };
  }
  const installment = input.installment ? money(input.installment, "BAM").cents : null;
  if (installment !== null && (installment <= 0n || installment > cents)) {
    return {
      code: "VALIDATION_FAILED",
      message: "Rata mora biti veća od nule i ne veća od iznosa.",
    };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const id = newId("adv");
    const inserted = await client.query<WorkerAdvanceRow>(
      `INSERT INTO public.worker_advances
         (id, company_id, worker_id, kind, amount_cents, issued_on, installment_cents,
          remaining_cents, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6::date, $7, $5, $8, $9)
       RETURNING id, worker_id, kind, amount_cents::bigint AS amount_cents, currency_code,
                 issued_on::text, installment_cents::bigint AS installment_cents,
                 remaining_cents::bigint AS remaining_cents, note`,
      [
        id,
        actor.companyId,
        input.workerId,
        input.kind,
        cents.toString(),
        input.issuedOn,
        installment === null ? null : installment.toString(),
        input.note ?? null,
        actor.userId,
      ],
    ).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("worker_advances_worker_fk")) return "NO_WORKER" as const;
      if (message.includes("worker_advances_loan_installment_check")) return "LOAN" as const;
      throw error;
    });
    if (inserted === "NO_WORKER") {
      return { code: "NOT_FOUND", message: "Radnik ne postoji u firmi." } as PayrollError;
    }
    if (inserted === "LOAN") {
      return { code: "VALIDATION_FAILED", message: "Pozajmica traži ratu." } as PayrollError;
    }
    const row = inserted.rows[0]!;
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "payroll.advance_created",
      entityType: "worker_advance",
      entityId: id,
      metadata: { workerId: input.workerId, kind: input.kind, amountCents: cents.toString() },
      retentionClass: "FINANCIAL",
    });
    return row;
  });
}

/* ============================================================ korekcije */

export type PayCorrectionRow = {
  id: string;
  period_id: string;
  target_period_id: string;
  workday_id: string | null;
  payroll_line_id: string | null;
  delta_hours: number;
  delta_amount_cents: number | null;
  reason: string;
  status: "OPEN" | "APPLIED";
  created_at: string;
};

export async function listCorrections(
  pool: Pool,
  actor: PayrollActor,
  filters: { periodId?: string; workerId?: string; status?: "OPEN" | "APPLIED" } = {},
): Promise<PayrollResult<{ corrections: PayCorrectionRow[] }>> {
  if (!actor.system && !can(actor.roles, "payroll.view")) {
    return { code: "FORBIDDEN", message: "Nemate pravo pregleda korekcija." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const rows = await client.query<{
      id: string;
      period_id: string;
      target_period_id: string;
      workday_id: string | null;
      payroll_line_id: string | null;
      delta_hours: number;
      delta_amount_cents: string | null;
      reason: string;
      status: "OPEN" | "APPLIED";
      created_at: string;
    }>(
      `SELECT c.id, c.period_id, c.target_period_id, c.workday_id, c.payroll_line_id,
              c.delta_hours::float8 AS delta_hours, c.delta_amount_cents::text, c.reason, c.status,
              c.created_at::text
         FROM public.pay_corrections c
         LEFT JOIN public.workdays d ON d.company_id=c.company_id AND d.id=c.workday_id
         LEFT JOIN public.payroll_run_lines l ON l.company_id=c.company_id AND l.id=c.payroll_line_id
        WHERE c.company_id = $1
          AND ($2::text IS NULL OR c.period_id = $2::text)
          AND ($3::text IS NULL OR c.status = $3::text)
          AND ($4::text IS NULL OR COALESCE(d.worker_id,l.worker_id) = $4)
        ORDER BY c.created_at DESC`,
      [actor.companyId, filters.periodId ?? null, filters.status ?? null, filters.workerId ?? null],
    );
    return {
      corrections: rows.rows.map((row) => ({
        ...row,
        delta_amount_cents: row.delta_amount_cents === null ? null : Number(row.delta_amount_cents),
      })),
    };
  });
}

/** Record a reviewed monetary difference, never overwrite an already confirmed value. */
export async function confirmCorrectionValue(
  pool:Pool,actor:PayrollActor,input:{correctionId:string;amount:string;explanation:string},
):Promise<PayrollResult<{id:string;amount_cents:string}>> {
  if (!actor.system && !can(actor.roles,"payroll.manage")) return {code:"FORBIDDEN",message:"Nemate pravo potvrde korekcije."};
  const explanation=input.explanation.trim();
  if (explanation.length < 10 || explanation.length > 500 || !/^-?\d{1,10}\.\d{2}$/.test(input.amount))
    return {code:"VALIDATION_FAILED",message:"Navedite iznos sa dvije decimale i obrazloženje od najmanje 10 znakova."};
  let cents:bigint;
  try {cents=money(input.amount,"BAM").cents;} catch {return {code:"VALIDATION_FAILED",message:"Neispravan iznos."};}
  return withCompany(pool,toCompanyId(actor.companyId),async client=>{
    const ref=await client.query<{target_period_id:string}>("SELECT target_period_id FROM public.pay_corrections WHERE company_id=$1 AND id=$2",[actor.companyId,input.correctionId]);
    if(!ref.rows[0]) return {code:"NOT_FOUND",message:"Korekcija ne postoji."} as PayrollError;
    // Identical lock order to calculate/approve/lock: target period, then correction.
    const period=await client.query<{status:string}>("SELECT status FROM public.pay_periods WHERE company_id=$1 AND id=$2 FOR UPDATE",[actor.companyId,ref.rows[0].target_period_id]);
    const correction=await client.query<{status:string;delta_amount_cents:string|null}>("SELECT status,delta_amount_cents::text FROM public.pay_corrections WHERE company_id=$1 AND id=$2 FOR UPDATE",[actor.companyId,input.correctionId]);
    const row=correction.rows[0];
    if(!row || !period.rows[0]) return {code:"NOT_FOUND",message:"Korekcija ne postoji."} as PayrollError;
    if(row.delta_amount_cents !== null && BigInt(row.delta_amount_cents) === cents)
      return {id:input.correctionId,amount_cents:cents.toString()};
    if(row.status!=="OPEN" || row.delta_amount_cents!==null || !["OPEN","CALCULATED"].includes(period.rows[0].status))
      return {code:"CONFLICT",message:"Iznos je već potvrđen ili je period zatvoren za izmjene."} as PayrollError;
    await client.query("UPDATE public.pay_corrections SET delta_amount_cents=$3 WHERE company_id=$1 AND id=$2",[actor.companyId,input.correctionId,cents.toString()]);
    await writeAudit(client,{companyId:actor.companyId,actorId:actor.userId,actorEmail:null,
      action:"payroll.correction_valued",entityType:"pay_correction",entityId:input.correctionId,
      metadata:{amountCents:cents.toString(),explanation,targetPeriodId:ref.rows[0].target_period_id},retentionClass:"FINANCIAL"});
    return {id:input.correctionId,amount_cents:cents.toString()};
  });
}

/* ============================================================ Moj obračun */

/**
 * Vlastiti obračun (`payroll.own.view`, §1.8/28).
 *
 * Radnik vidi SVOJE dane i sate uvijek, a iznose linija tek kad je period `APPROVED`/`LOCKED` —
 * dotad obračun nije konačan i pokazivanje iznosa bilo bi obećanje koje se mijenja. Radnik se
 * veže preko `workers.user_id`; tuđi ID se ne prima ni kad ga neko pošalje.
 */
export async function getMyPayroll(
  pool: Pool,
  actor: PayrollActor,
  input: { year: number; month: number },
): Promise<
  PayrollResult<{
    period: { year: number; month: number; status: string };
    worker: { id: string; name: string };
    days: Array<{
      work_date: string;
      day_kind: string;
      status: string;
      total_hours: number;
      categories: CategoryHours;
    }>;
    totals: { total_hours: number; categories: CategoryHours };
    lines: PayrollLineDto[] | null;
    lines_available_reason: string | null;
  }>
> {
  if (!actor.system && !can(actor.roles, "payroll.own.view")) {
    return { code: "FORBIDDEN", message: "Nemate pravo pregleda svog obračuna." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const worker = await client.query<{ id: string; name: string }>(
      `SELECT id, (first_name || ' ' || last_name) AS name
         FROM public.workers
        WHERE company_id = $1 AND user_id = $2
        LIMIT 1`,
      [actor.companyId, actor.userId],
    );
    const me = worker.rows[0];
    if (!me) {
      return {
        code: "NOT_FOUND",
        message: "Vaš nalog nije povezan sa zapisom radnika.",
      } as PayrollError;
    }

    const period = await client.query<{ id: string | null; status: string }>(
      `SELECT id, status FROM public.pay_periods
        WHERE company_id = $1 AND year = $2 AND month = $3`,
      [actor.companyId, input.year, input.month],
    );
    const periodId = period.rows[0]?.id ?? null;
    const periodStatus = period.rows[0]?.status ?? "OPEN";

    const bounds = periodBounds(input.year, input.month);
    const rules = await loadRules(client, actor.companyId);
    const days = await client.query<{
      work_date: string;
      day_kind: string;
      approval_status: string;
      hours: string;
      night_hours: string;
      is_sunday: boolean;
      is_holiday: boolean;
    }>(
      `SELECT d.work_date::text, d.day_kind, d.approval_status,
              COALESCE((
                SELECT sum(extract(epoch FROM (e.ended_at - e.started_at))) / 3600.0
                  FROM public.work_entries e
                 WHERE e.company_id = d.company_id AND e.workday_id = d.id
                   AND e.kind = 'WORK' AND e.end_state = 'KNOWN_END'
                   AND e.resolution_state = 'ACTIVE'
              ), 0)::numeric(10,3)::text AS hours,
              '0'::text AS night_hours,
              EXISTS (
                SELECT 1 FROM public.company_holidays h
                 WHERE h.company_id = d.company_id AND h.holiday_date = d.work_date AND h.is_paid
              ) AS is_holiday,
              EXTRACT(DOW FROM d.work_date) = 0 AS is_sunday
         FROM public.workdays d
        WHERE d.company_id = $1 AND d.worker_id = $2
          AND d.work_date BETWEEN $3::date AND $4::date
        ORDER BY d.work_date`,
      [actor.companyId, me.id, bounds.start, bounds.end],
    );

    const totals: CategoryHours = { HOLIDAY: 0, SUNDAY: 0, NIGHT: 0, OVERTIME: 0, REGULAR: 0 };
    const mappedDays = days.rows.map((row) => {
      const total = Number(row.hours);
      /* Radnik vidi sate po danu i vrsti dana. Puna klasifikacija (noćni/prekovremeni po minuti)
         traži segmente; ovdje je dovoljan zbir po danu, jer je to ono što radnik provjerava —
         a detaljna podjela dolazi iz obračuna kad je period odobren. */
      const categories: CategoryHours =
        row.day_kind !== "WORK"
          ? { HOLIDAY: 0, SUNDAY: 0, NIGHT: 0, OVERTIME: 0, REGULAR: 0 }
          : row.is_holiday
            ? { HOLIDAY: total, SUNDAY: 0, NIGHT: 0, OVERTIME: 0, REGULAR: 0 }
            : row.is_sunday
              ? { HOLIDAY: 0, SUNDAY: total, NIGHT: 0, OVERTIME: 0, REGULAR: 0 }
              : {
                  HOLIDAY: 0,
                  SUNDAY: 0,
                  NIGHT: 0,
                  OVERTIME: Math.max(0, total - rules.overtimeDailyThreshold),
                  REGULAR: Math.min(total, rules.overtimeDailyThreshold),
                };
      for (const key of Object.keys(totals) as (keyof CategoryHours)[]) totals[key] += categories[key];
      return {
        work_date: row.work_date,
        day_kind: row.day_kind,
        status: row.approval_status,
        total_hours: total,
        categories,
      };
    });
    const totalHoursValue = mappedDays.reduce((sum, day) => sum + day.total_hours, 0);

    const linesVisible = periodStatus === "APPROVED" || periodStatus === "LOCKED";
    let lines: PayrollLineDto[] | null = null;
    let reason: string | null = null;
    if (!linesVisible) {
      reason =
        periodStatus === "OPEN"
          ? "Period još nije izračunat."
          : "Iznosi su vidljivi kad računovodstvo odobri obračun.";
    } else if (periodId) {
      /*
       * Radnik ima `payroll.own.view`, a NE `payroll.view` (§1.8/28–29): iznose svog obračuna
       * smije vidjeti, tuđe nikad. Zato se `listLines` poziva sa `system: true` — dozvola je
       * već provjerena gore — a filter `workerId` je ono što drži granicu: upit vraća isključivo
       * linije TOG radnika. Bez ovoga bi radnik dobio `lines: null` uz poruku „nema prava“,
       * iako mu spec izričito daje pravo na svoj obračun.
       */
      const result = await listLines(
        pool,
        { ...actor, system: true },
        periodId,
        { workerId: me.id },
      );
      if (!isPayrollError(result)) lines = result.lines;
    }

    return {
      period: { year: input.year, month: input.month, status: periodStatus },
      worker: me,
      days: mappedDays,
      totals: { total_hours: totalHoursValue, categories: totals },
      lines,
      lines_available_reason: reason,
    };
  });
}
