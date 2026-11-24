/**
 * Modul 4 — servis radnika: kartica, osjetljiva polja, cijene, dopust, zaduženja, šabloni OZO,
 * historija, „Radnik odlazi" i masovne izmjene.
 *
 * Tri granice koje servis čuva:
 *
 *  1. **Osjetljivo se ne šalje, ne skriva.** `sensitive` je `null` kad korisnik nema pravo —
 *     nikad prazan objekat, jer bi prazan objekat izgledao kao „nema podataka".
 *  2. **Cijena se ne mijenja, cijena se zatvara.** Novi iznos = novi red sa `validFrom`; stari
 *     red dobija `validTo`. Zato nema `UPDATE amount_cents` — baza to i trigerom brani.
 *  3. **Zaduženje se ne briše.** Povrat je `returned_at`, otpis je `condition = 'DAMAGED'` +
 *     razlog u historiji. Brisanje bi izbrisalo odgovornost radnika za opremu.
 *
 * Sve pod `withCompany`; svaki upit nosi `company_id` u WHERE (B1).
 */
import type { Pool, PoolClient } from "pg";
import { withCompany } from "@gradix/db";
import type { CompanyId } from "@gradix/db";
import { safeTimezone } from "@gradix/domain";
import { writeAudit } from "./audit";
// `import type` je obavezan: `workday-timer-service` je veliki modul, a ovdje se koriste samo tipovi.
import type { ServiceActor, ServiceResult } from "./workday-timer-service";

export type { ServiceActor, ServiceResult };

const SENSITIVE_FIELDS = [
  "birthDate",
  "address",
  "bloodType",
  "emergencyContactName",
  "emergencyContactPhone",
] as const;

const COLUMN_FOR: Record<string, string> = {
  middleName: "middle_name",
  birthDate: "birth_date",
  address: "address",
  educationLevel: "education_level",
  profession: "profession",
  drivingCategories: "driving_categories",
  bloodType: "blood_type",
  shoeSize: "shoe_size",
  clothingSize: "clothing_size",
  emergencyContactName: "emergency_contact_name",
  emergencyContactPhone: "emergency_contact_phone",
  photoObjectKey: "photo_object_key",
  notes: "notes",
};

/**
 * Poslovni datum firme — JEDNO mjesto gdje se „danas“ pretvara u datum za cijene.
 *
 * Bez ovoga bi cijena koja počinje „danas“ na serveru u UTC-u mogla biti jučerašnja za firmu
 * čiji je dan već odmakao, pa bi `current` pokazivao pogrešan red.
 */
export async function businessToday(pool: Pool, companyId: string): Promise<string> {
  return withCompany(pool, companyId as CompanyId, async (client) => {
    const result = await client.query<{ timezone: string | null }>(
      "SELECT timezone FROM companies WHERE id = $1",
      [companyId],
    );
    const timezone = safeTimezone(result.rows[0]?.timezone);
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  });
}

function dateOnly(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

// ---------------------------------------------------------------------------
// Kartica radnika
// ---------------------------------------------------------------------------

export type WorkerProfileView = {
  id: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  phone: string | null;
  email: string | null;
  jobTitle: string | null;
  engagement: string;
  hiredAt: string;
  endedAt: string | null;
  team: string | null;
  supervisorId: string | null;
  supervisorName: string | null;
  userId: string | null;
  isActive: boolean;
  educationLevel: string | null;
  profession: string | null;
  drivingCategories: string[];
  shoeSize: number | null;
  clothingSize: string | null;
  photoObjectKey: string | null;
  notes: string | null;
  sensitive: {
    birthDate: string | null;
    address: string | null;
    bloodType: string | null;
    emergencyContactName: string | null;
    emergencyContactPhone: string | null;
  } | null;
};

export async function getWorkerProfile(
  pool: Pool,
  actor: ServiceActor,
  workerId: string,
  options: { canSeeSensitive: boolean },
): Promise<ServiceResult<{ worker: WorkerProfileView }>> {
  return withCompany(pool, actor.companyId, (client) => loadProfile(client, actor, workerId, options));
}

/**
 * Čitanje kartice NAD VEĆ OTKVORENIM KLIJENTOM.
 *
 * Namjerno prima `client`, ne `pool`: poziv unutar iste transakcije mora vidjeti nekomitovane
 * izmjene. `withCompany` na `pool` bi uzeo drugu konekciju, koja te izmjene još ne vidi.
 */
async function loadProfile(
  client: PoolClient,
  actor: ServiceActor,
  workerId: string,
  options: { canSeeSensitive: boolean },
): Promise<ServiceResult<{ worker: WorkerProfileView }>> {
  {
    const rows = await client.query(
      `SELECT w.*, (s.first_name || ' ' || s.last_name) AS supervisor_name
         FROM workers w
         LEFT JOIN workers s ON s.company_id = w.company_id AND s.id = w.supervisor_id
        WHERE w.company_id = $1 AND w.id = $2`,
      [actor.companyId, workerId],
    );
    const row = rows.rows[0] as Record<string, unknown> | undefined;
    if (!row) {
      return { ok: false as const, status: 404, code: "NOT_FOUND", message: "Radnik ne postoji." };
    }

    const worker: WorkerProfileView = {
      id: row.id as string,
      firstName: row.first_name as string,
      middleName: (row.middle_name as string | null) ?? null,
      lastName: row.last_name as string,
      phone: (row.phone as string | null) ?? null,
      email: (row.email as string | null) ?? null,
      jobTitle: (row.job_title as string | null) ?? null,
      engagement: row.engagement as string,
      hiredAt: dateOnly(row.hired_at)!,
      endedAt: dateOnly(row.ended_at),
      team: (row.team as string | null) ?? null,
      supervisorId: (row.supervisor_id as string | null) ?? null,
      supervisorName: (row.supervisor_name as string | null) ?? null,
      userId: (row.user_id as string | null) ?? null,
      isActive: row.is_active as boolean,
      educationLevel: (row.education_level as string | null) ?? null,
      profession: (row.profession as string | null) ?? null,
      drivingCategories: (row.driving_categories as string[] | null) ?? [],
      shoeSize: row.shoe_size === null ? null : Number(row.shoe_size),
      clothingSize: (row.clothing_size as string | null) ?? null,
      photoObjectKey: (row.photo_object_key as string | null) ?? null,
      notes: (row.notes as string | null) ?? null,
      // `null`, ne prazan objekat: korisnik bez prava ne smije ni znati da polja postoje.
      sensitive: options.canSeeSensitive
        ? {
            birthDate: dateOnly(row.birth_date),
            address: (row.address as string | null) ?? null,
            bloodType: (row.blood_type as string | null) ?? null,
            emergencyContactName: (row.emergency_contact_name as string | null) ?? null,
            emergencyContactPhone: (row.emergency_contact_phone as string | null) ?? null,
          }
        : null,
    };

    if (options.canSeeSensitive) {
      // ACCESS trag: čitanje osjetljivih podataka se pamti, ne samo izmjena (spec 01 §1.9.42).
      await writeAudit(client, {
        companyId: actor.companyId,
        actorId: actor.userId,
        actorEmail: null,
        action: "worker.sensitive_viewed",
        entityType: "worker",
        entityId: workerId,
        metadata: { fields: SENSITIVE_FIELDS },
      });
    }

    return { ok: true as const, worker };
  }
}

/**
 * Izmjena kartice. Osjetljiva polja traže `reason` — bez razloga izmjena nije objašnjiva,
 * a `worker_history` je čitljiva linija koju ured i radnik zajedno gledaju.
 */
export async function patchWorkerProfile(
  pool: Pool,
  actor: ServiceActor,
  workerId: string,
  patch: Record<string, unknown>,
  options: { canEditSensitive: boolean },
): Promise<ServiceResult<{ worker: WorkerProfileView }>> {
  const reason = typeof patch.reason === "string" ? patch.reason.trim() : "";
  const fields = Object.keys(patch).filter((key) => key !== "reason");
  if (fields.length === 0) {
    return { ok: false as const, status: 400, code: "VALIDATION_FAILED", message: "Nema polja za izmjenu." };
  }

  const touchesSensitive = fields.some((field) => (SENSITIVE_FIELDS as readonly string[]).includes(field));
  if (touchesSensitive && !options.canEditSensitive) {
    return {
      ok: false as const,
      status: 403,
      code: "WORKER_SENSITIVE_FORBIDDEN",
      message: "Osjetljiva polja radnika mijenja samo vlasnik ili administrator.",
    };
  }
  if (touchesSensitive && !reason) {
    return {
      ok: false as const,
      status: 400,
      code: "VALIDATION_FAILED",
      message: "Izmjena osjetljivog podatka traži razlog.",
    };
  }

  return withCompany(pool, actor.companyId, async (client) => {
    const before = await client.query<Record<string, unknown>>(
      "SELECT * FROM workers WHERE company_id = $1 AND id = $2",
      [actor.companyId, workerId],
    );
    const previous = before.rows[0];
    if (!previous) {
      return { ok: false as const, status: 404, code: "NOT_FOUND", message: "Radnik ne postoji." };
    }

    const sets: string[] = [];
    const values: unknown[] = [actor.companyId, workerId];
    for (const field of fields) {
      const column = COLUMN_FOR[field];
      if (!column) continue;
      values.push(patch[field] ?? null);
      sets.push(`${column} = $${values.length}`);
    }
    if (sets.length === 0) {
      return { ok: false as const, status: 400, code: "VALIDATION_FAILED", message: "Nema polja za izmjenu." };
    }
    // Bez `actor.userId` u parametrima: polje `updated_at` se puni u bazi, a višak parametara
    // `pg` odbija. Ko je mijenjao piše `worker_history` i `audit_events`, ne sam red.
    await client.query(
      `UPDATE workers SET ${sets.join(", ")}, updated_at = clock_timestamp()
        WHERE company_id = $1 AND id = $2`,
      values,
    );

    // Historija: samo stvarno promijenjena polja, sa starom i novom vrijednošću.
    for (const field of fields) {
      const column = COLUMN_FOR[field];
      if (!column) continue;
      const oldValue = previous[column];
      const newValue = patch[field] ?? null;
      if (String(oldValue ?? "") === String(newValue ?? "")) continue;
      await client.query(
        `INSERT INTO worker_history (id, company_id, worker_id, field, old_value, new_value, changed_by, reason)
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7)`,
        [
          actor.companyId,
          workerId,
          field,
          oldValue === null || oldValue === undefined ? null : String(Array.isArray(oldValue) ? oldValue.join(",") : oldValue),
          newValue === null ? null : String(newValue),
          actor.userId,
          reason || null,
        ],
      );
    }

    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "worker.profile_changed",
      entityType: "worker",
      entityId: workerId,
      metadata: { fields, sensitive: touchesSensitive, reason: reason || null },
    });

    return loadProfile(client, actor, workerId, { canSeeSensitive: options.canEditSensitive });
  });
}

// ---------------------------------------------------------------------------
// Cijene rada
// ---------------------------------------------------------------------------

export type RateRow = {
  id: string;
  kind: string;
  amountCents: string | null;
  currencyCode: string | null;
  coefficient: string | null;
  validFrom: string;
  validTo: string | null;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
};

function mapRate(row: Record<string, unknown>): RateRow {
  return {
    id: row.id as string,
    kind: row.rate_kind as string,
    amountCents: row.amount_cents === null ? null : String(row.amount_cents),
    currencyCode: (row.currency_code as string | null) ?? null,
    coefficient: row.coefficient === null ? null : String(row.coefficient),
    validFrom: dateOnly(row.valid_from)!,
    validTo: dateOnly(row.valid_to),
    note: (row.note as string | null) ?? null,
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

export async function listRates(
  pool: Pool,
  actor: ServiceActor,
  workerId: string,
  today: string,
): Promise<ServiceResult<{ rates: RateRow[]; current: RateRow | null }>> {
  return withCompany(pool, actor.companyId, (client) => loadRates(client, actor, workerId, today));
}

async function loadRates(
  client: PoolClient,
  actor: ServiceActor,
  workerId: string,
  today: string,
): Promise<ServiceResult<{ rates: RateRow[]; current: RateRow | null }>> {
  {
    const rows = await client.query(
      `SELECT * FROM worker_rates
        WHERE company_id = $1 AND worker_id = $2
        ORDER BY valid_from DESC, created_at DESC`,
      [actor.companyId, workerId],
    );
    const rates = rows.rows.map(mapRate);
    // „Važi danas" se računa na današnji datum, ne na zadnji red — buduća cijena nije aktuelna.
    const current =
      rates.find((rate) => rate.validFrom <= today && (rate.validTo === null || rate.validTo >= today)) ?? null;
    return { ok: true as const, rates, current };
  }
}

/**
 * Nova cijena. Postojeća cijena istog `rate_kind` se zatvara dan prije nove (`valid_to`),
 * pa `EXCLUDE` ograničenje u bazi nikad ne puca za normalan tok rada.
 */
export async function addRate(
  pool: Pool,
  actor: ServiceActor,
  workerId: string,
  input: {
    kind: string;
    amountCents?: number | null;
    currencyCode?: string | null;
    coefficient?: number | null;
    validFrom: string;
    note?: string | null;
  },
): Promise<ServiceResult<{ rate: RateRow }>> {
  if (input.kind === "COEFFICIENT" && input.coefficient == null) {
    return {
      ok: false as const,
      status: 400,
      code: "VALIDATION_FAILED",
      message: "Koeficijent traži vrijednost koeficijenta.",
    };
  }
  if (input.kind !== "COEFFICIENT" && input.amountCents == null) {
    return { ok: false as const, status: 400, code: "VALIDATION_FAILED", message: "Cijena traži iznos." };
  }

  return withCompany(pool, actor.companyId, async (client) => {
    const existing = await client.query<{ id: string; valid_from: string }>(
      `SELECT id, valid_from::text AS valid_from FROM worker_rates
        WHERE company_id = $1 AND worker_id = $2 AND rate_kind = $3 AND valid_to IS NULL`,
      [actor.companyId, workerId, input.kind],
    );
    const open = existing.rows[0];
    if (open && dateOnly(open.valid_from)! >= input.validFrom) {
      return {
        ok: false as const,
        status: 409,
        code: "RATE_OVERLAP",
        message: `Cijena tog tipa već važi od ${dateOnly(open.valid_from)}. Novi period mora početi poslije nje.`,
      };
    }

    if (open) {
      const dayBefore = new Date(`${input.validFrom}T00:00:00.000Z`);
      dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
      await client.query(
        `UPDATE worker_rates SET valid_to = $3
          WHERE company_id = $1 AND id = $2`,
        [actor.companyId, open.id, dayBefore.toISOString().slice(0, 10)],
      );
    }

    const inserted = await client.query(
      `INSERT INTO worker_rates
         (id, company_id, worker_id, rate_kind, amount_cents, currency_code, coefficient, valid_from, note, created_by)
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        actor.companyId,
        workerId,
        input.kind,
        input.kind === "COEFFICIENT" ? null : input.amountCents,
        input.kind === "COEFFICIENT" ? null : (input.currencyCode ?? "BAM"),
        input.kind === "COEFFICIENT" ? input.coefficient : null,
        input.validFrom,
        input.note ?? null,
        actor.userId,
      ],
    );

    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "worker.rate_opened",
      entityType: "worker_rate",
      entityId: mapRate(inserted.rows[0]!).id,
      metadata: { workerId, kind: input.kind, validFrom: input.validFrom },
    });

    return { ok: true as const, rate: mapRate(inserted.rows[0]!) };
  });
}

export async function closeRate(
  pool: Pool,
  actor: ServiceActor,
  workerId: string,
  rateId: string,
  validTo: string,
): Promise<ServiceResult<{ rate: RateRow }>> {
  return withCompany(pool, actor.companyId, async (client) => {
    const rows = await client.query<Record<string, unknown>>(
      "SELECT * FROM worker_rates WHERE company_id = $1 AND id = $2 AND worker_id = $3",
      [actor.companyId, rateId, workerId],
    );
    const rate = rows.rows[0];
    if (!rate) {
      return { ok: false as const, status: 404, code: "NOT_FOUND", message: "Cijena ne postoji." };
    }
    if (dateOnly(rate.valid_from)! > validTo) {
      return {
        ok: false as const,
        status: 400,
        code: "VALIDATION_FAILED",
        message: "Kraj važenja ne može biti prije početka.",
      };
    }
    const updated = await client.query(
      `UPDATE worker_rates SET valid_to = $3 WHERE company_id = $1 AND id = $2 RETURNING *`,
      [actor.companyId, rateId, validTo],
    );
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "worker.rate_closed",
      entityType: "worker_rate",
      entityId: rateId,
      metadata: { workerId, validTo },
    });
    return { ok: true as const, rate: mapRate(updated.rows[0]!) };
  });
}

// ---------------------------------------------------------------------------
// Dopust
// ---------------------------------------------------------------------------

/**
 * Saldo = `days_entitled + days_carryover − VACATION dani` (spec 04 §1.4.19).
 *
 * Korišteni dani se BROJE iz radnih dana, ne čuvaju kao brojač: brojač bi se razišao sa
 * stvarnim danima čim se neki dan ispravi, a saldo je taj koji mora biti tačan.
 */
export async function workerLeave(
  pool: Pool,
  actor: ServiceActor,
  workerId: string,
): Promise<
  ServiceResult<{
    workerId: string;
    years: {
      year: number;
      daysEntitled: string;
      daysCarryover: string;
      daysUsed: number;
      balance: number;
      usedDates: string[];
      note: string | null;
    }[];
  }>
> {
  return withCompany(pool, actor.companyId, (client) => loadLeave(client, actor, workerId));
}

async function loadLeave(
  client: PoolClient,
  actor: ServiceActor,
  workerId: string,
): Promise<
  ServiceResult<{
    workerId: string;
    years: {
      year: number;
      daysEntitled: string;
      daysCarryover: string;
      daysUsed: number;
      balance: number;
      usedDates: string[];
      note: string | null;
    }[];
  }>
> {
  {
    const entitlements = await client.query<Record<string, unknown>>(
      `SELECT * FROM worker_leave_entitlements
        WHERE company_id = $1 AND worker_id = $2
        ORDER BY year DESC`,
      [actor.companyId, workerId],
    );
    const vacation = await client.query<{ work_date: string; yr: number }>(
      `SELECT work_date::text AS work_date, EXTRACT(YEAR FROM work_date)::int AS yr
         FROM workdays
        WHERE company_id = $1 AND worker_id = $2 AND day_kind = 'VACATION'
        ORDER BY work_date`,
      [actor.companyId, workerId],
    );

    const years = entitlements.rows.map((row) => {
      const year = Number(row.year);
      const usedDates = vacation.rows.filter((day) => day.yr === year).map((day) => day.work_date);
      const entitled = Number(row.days_entitled);
      const carryover = Number(row.days_carryover);
      return {
        year,
        daysEntitled: String(row.days_entitled),
        daysCarryover: String(row.days_carryover),
        daysUsed: usedDates.length,
        balance: Number((entitled + carryover - usedDates.length).toFixed(2)),
        usedDates,
        note: (row.note as string | null) ?? null,
      };
    });

    // Godina u kojoj ima korištenja a nema prava: prikazuje se sa nulom, jer bi skrivanje
    // sakrilo da je radnik uzeo dopust koji mu nije odobren.
    const known = new Set(years.map((year) => year.year));
    for (const day of vacation.rows) {
      if (known.has(day.yr)) continue;
      known.add(day.yr);
      const usedDates = vacation.rows.filter((entry) => entry.yr === day.yr).map((entry) => entry.work_date);
      years.push({
        year: day.yr,
        daysEntitled: "0",
        daysCarryover: "0",
        daysUsed: usedDates.length,
        balance: -usedDates.length,
        usedDates,
        note: null,
      });
    }
    years.sort((a, b) => b.year - a.year);

    return { ok: true as const, workerId, years };
  }
}

export async function setLeaveEntitlement(
  pool: Pool,
  actor: ServiceActor,
  workerId: string,
  input: { year: number; daysEntitled: number; daysCarryover?: number; note?: string | null },
): Promise<ServiceResult<{ years: Awaited<ReturnType<typeof workerLeave>> extends never ? never : unknown }>> {
  return withCompany(pool, actor.companyId, async (client) => {
    await client.query(
      `INSERT INTO worker_leave_entitlements
         (id, company_id, worker_id, year, days_entitled, days_carryover, note, created_by)
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (company_id, worker_id, year) DO UPDATE
         SET days_entitled = EXCLUDED.days_entitled,
             days_carryover = EXCLUDED.days_carryover,
             note = EXCLUDED.note,
             updated_at = clock_timestamp()`,
      [actor.companyId, workerId, input.year, input.daysEntitled, input.daysCarryover ?? 0, input.note ?? null, actor.userId],
    );
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "worker.leave_changed",
      entityType: "worker_leave",
      entityId: workerId,
      metadata: { year: input.year, daysEntitled: input.daysEntitled, daysCarryover: input.daysCarryover ?? 0 },
    });
    const after = await loadLeave(client, actor, workerId);
    if (!after.ok) return after;
    return { ok: true as const, years: after.years };
  });
}

// ---------------------------------------------------------------------------
// Zaduženja
// ---------------------------------------------------------------------------

export type IssuanceRow = {
  id: string;
  itemKind: string;
  itemName: string;
  size: string | null;
  serialNo: string | null;
  quantity: string;
  issuedAt: string;
  returnedAt: string | null;
  condition: string;
  note: string | null;
  issuedBy: string | null;
  returnedTo: string | null;
  stockItemId: string | null;
};

function mapIssuance(row: Record<string, unknown>): IssuanceRow {
  return {
    id: row.id as string,
    itemKind: row.item_kind as string,
    itemName: row.item_name as string,
    size: (row.size as string | null) ?? null,
    serialNo: (row.serial_no as string | null) ?? null,
    quantity: String(row.quantity),
    issuedAt: dateOnly(row.issued_at)!,
    returnedAt: dateOnly(row.returned_at),
    condition: row.condition as string,
    note: (row.note as string | null) ?? null,
    issuedBy: (row.issued_by as string | null) ?? null,
    returnedTo: (row.returned_to as string | null) ?? null,
    stockItemId: (row.stock_item_id as string | null) ?? null,
  };
}

export async function listIssuances(
  pool: Pool,
  actor: ServiceActor,
  workerId: string,
  includeReturned: boolean,
): Promise<ServiceResult<{ issuances: IssuanceRow[]; activeCount: number }>> {
  return withCompany(pool, actor.companyId, (client) =>
    loadIssuances(client, actor, workerId, includeReturned),
  );
}

async function loadIssuances(
  client: PoolClient,
  actor: ServiceActor,
  workerId: string,
  includeReturned: boolean,
): Promise<ServiceResult<{ issuances: IssuanceRow[]; activeCount: number }>> {
  {
    const rows = await client.query(
      `SELECT * FROM worker_issuances
        WHERE company_id = $1 AND worker_id = $2
          AND ($3::boolean OR returned_at IS NULL)
        ORDER BY issued_at DESC, created_at DESC`,
      [actor.companyId, workerId, includeReturned],
    );
    const issuances = rows.rows.map(mapIssuance);
    return {
      ok: true as const,
      issuances,
      activeCount: issuances.filter((row) => row.returnedAt === null).length,
    };
  }
}

/**
 * Izdavanje. Sa `templateId` izdaje cijeli OZO set iz šablona radnog mjesta jednim klikom
 * (spec 04 §1.5.21) — jedan red po stavci, jer se poslije vraćaju pojedinačno.
 */
export async function addIssuance(
  pool: Pool,
  actor: ServiceActor,
  workerId: string,
  input: {
    itemKind: string;
    itemName?: string;
    size?: string | null;
    serialNo?: string | null;
    quantity?: number;
    issuedAt: string;
    condition?: string;
    note?: string | null;
    templateId?: string | null;
  },
): Promise<ServiceResult<{ issuances: IssuanceRow[]; activeCount: number }>> {
  return withCompany(pool, actor.companyId, async (client) => {
    const items: { itemName: string; quantity: number; size: string | null }[] = [];

    if (input.templateId) {
      const template = await client.query<{ items: unknown }>(
        "SELECT items FROM ppe_templates WHERE company_id = $1 AND id = $2",
        [actor.companyId, input.templateId],
      );
      const raw = template.rows[0]?.items;
      if (!Array.isArray(raw)) {
        return { ok: false as const, status: 404, code: "NOT_FOUND", message: "Šablon OZO ne postoji." };
      }
      for (const entry of raw as { name?: string; quantity?: number; sizeRequired?: boolean }[]) {
        if (!entry?.name) continue;
        items.push({
          itemName: entry.name,
          quantity: Number(entry.quantity ?? 1),
          // Veličina se traži samo gdje je šablon traži; inače ide ono što je upisano.
          size: entry.sizeRequired ? (input.size ?? null) : null,
        });
      }
      if (items.length === 0) {
        return {
          ok: false as const,
          status: 400,
          code: "VALIDATION_FAILED",
          message: "Šablon nema nijednu stavku.",
        };
      }
    } else {
      if (!input.itemName?.trim()) {
        return { ok: false as const, status: 400, code: "VALIDATION_FAILED", message: "Naziv stavke je obavezan." };
      }
      items.push({ itemName: input.itemName.trim(), quantity: input.quantity ?? 1, size: input.size ?? null });
    }

    const ids: string[] = [];
    for (const item of items) {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO worker_issuances
           (id, company_id, worker_id, item_kind, item_name, size, serial_no, quantity, issued_at, condition, note, issued_by)
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [
          actor.companyId,
          workerId,
          input.itemKind,
          item.itemName,
          item.size,
          input.serialNo ?? null,
          item.quantity,
          input.issuedAt,
          input.condition ?? "NEW",
          input.note ?? null,
          actor.userId,
        ],
      );
      ids.push(inserted.rows[0]!.id);
    }

    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "worker.issuance_created",
      entityType: "worker_issuance",
      entityId: ids[0]!,
      metadata: { workerId, count: ids.length, templateId: input.templateId ?? null, itemKind: input.itemKind },
    });

    const after = await loadIssuances(client, actor, workerId, true);
    if (!after.ok) return after;
    return { ok: true as const, issuances: after.issuances, activeCount: after.activeCount };
  });
}

export async function returnIssuance(
  pool: Pool,
  actor: ServiceActor,
  workerId: string,
  issuanceId: string,
  input: { returnedAt: string; condition?: string; note?: string | null },
): Promise<ServiceResult<{ issuances: IssuanceRow[]; activeCount: number }>> {
  return withCompany(pool, actor.companyId, async (client) => {
    const rows = await client.query<Record<string, unknown>>(
      "SELECT * FROM worker_issuances WHERE company_id = $1 AND id = $2 AND worker_id = $3",
      [actor.companyId, issuanceId, workerId],
    );
    const issuance = rows.rows[0];
    if (!issuance) {
      return { ok: false as const, status: 404, code: "NOT_FOUND", message: "Zaduženje ne postoji." };
    }
    if (issuance.returned_at) {
      return {
        ok: false as const,
        status: 409,
        code: "CONFLICT",
        message: "To zaduženje je već vraćeno.",
      };
    }
    if (dateOnly(issuance.issued_at)! > input.returnedAt) {
      return {
        ok: false as const,
        status: 400,
        code: "VALIDATION_FAILED",
        message: "Datum vraćanja ne može biti prije datuma izdavanja.",
      };
    }

    await client.query(
      `UPDATE worker_issuances
          SET returned_at = $3, condition = COALESCE($4, condition), note = COALESCE($5, note),
              returned_to = $6, updated_at = clock_timestamp()
        WHERE company_id = $1 AND id = $2`,
      [actor.companyId, issuanceId, input.returnedAt, input.condition ?? null, input.note ?? null, actor.userId],
    );

    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "worker.issuance_returned",
      entityType: "worker_issuance",
      entityId: issuanceId,
      metadata: { workerId, condition: input.condition ?? issuance.condition },
    });

    const after = await loadIssuances(client, actor, workerId, true);
    if (!after.ok) return after;
    return { ok: true as const, issuances: after.issuances, activeCount: after.activeCount };
  });
}

// ---------------------------------------------------------------------------
// Šabloni OZO
// ---------------------------------------------------------------------------

export type PpeTemplateRow = {
  id: string;
  jobTitle: string;
  items: { name: string; quantity?: number; sizeRequired?: boolean }[];
};

export async function listPpeTemplates(
  pool: Pool,
  actor: ServiceActor,
): Promise<ServiceResult<{ templates: PpeTemplateRow[] }>> {
  return withCompany(pool, actor.companyId, async (client) => {
    const rows = await client.query<{ id: string; job_title: string; items: unknown }>(
      `SELECT id, job_title, items FROM ppe_templates
        WHERE company_id = $1 ORDER BY job_title`,
      [actor.companyId],
    );
    return {
      ok: true as const,
      templates: rows.rows.map((row) => ({
        id: row.id,
        jobTitle: row.job_title,
        items: Array.isArray(row.items) ? (row.items as PpeTemplateRow["items"]) : [],
      })),
    };
  });
}

export async function upsertPpeTemplate(
  pool: Pool,
  actor: ServiceActor,
  input: { id?: string; jobTitle: string; items: { name: string; quantity?: number; sizeRequired?: boolean }[] },
): Promise<ServiceResult<{ template: PpeTemplateRow }>> {
  return withCompany(pool, actor.companyId, async (client) => {
    // Jedan šablon po radnom mjestu: `ON CONFLICT` po `(company_id, job_title)`.
    const row = await client.query<{ id: string; job_title: string; items: unknown }>(
      `INSERT INTO ppe_templates (id, company_id, job_title, items, created_by)
       VALUES (gen_random_uuid()::text, $1, $2, $3::jsonb, $4)
       ON CONFLICT (company_id, job_title) DO UPDATE
         SET items = EXCLUDED.items, updated_at = clock_timestamp()
       RETURNING id, job_title, items`,
      [actor.companyId, input.jobTitle, JSON.stringify(input.items), actor.userId],
    );
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "worker.ppe_template_changed",
      entityType: "ppe_template",
      entityId: row.rows[0]!.id,
      metadata: { jobTitle: input.jobTitle, items: input.items.length },
    });
    return {
      ok: true as const,
      template: {
        id: row.rows[0]!.id,
        jobTitle: row.rows[0]!.job_title,
        items: row.rows[0]!.items as PpeTemplateRow["items"],
      },
    };
  });
}

export async function deletePpeTemplate(
  pool: Pool,
  actor: ServiceActor,
  templateId: string,
): Promise<ServiceResult<{ deleted: true }>> {
  return withCompany(pool, actor.companyId, async (client) => {
    const deleted = await client.query(
      "DELETE FROM ppe_templates WHERE company_id = $1 AND id = $2",
      [actor.companyId, templateId],
    );
    if ((deleted.rowCount ?? 0) === 0) {
      return { ok: false as const, status: 404, code: "NOT_FOUND", message: "Šablon ne postoji." };
    }
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "worker.ppe_template_changed",
      entityType: "ppe_template",
      entityId: templateId,
      metadata: { deleted: true },
    });
    return { ok: true as const, deleted: true as const };
  });
}

// ---------------------------------------------------------------------------
// „Radnik odlazi" — jedna transakcija (spec 04 §1.6.24)
// ---------------------------------------------------------------------------

/**
 * Atomsko razduženje radnika koji odlazi.
 *
 * Redoslijed nije kozmetika: prvo se razdužuje oprema (jer je to materijalna odgovornost),
 * pa se gase dodjele, pa sesije, pa se radnik deaktivira. Ako bilo koji korak padne, pada sve —
 * radnik koji je „polovično otišao" (bez sesija ali sa zaduženom opremom) je najgori ishod.
 *
 * Zaduženja koja se NE vrate moraju biti izričito otpisana (`writtenOff`), sa razlogom. Servis
 * ne pretpostavlja otpis: oprema koja nedostaje je pitanje za ured, ne tišina u bazi.
 */
export async function offboardWorker(
  pool: Pool,
  actor: ServiceActor,
  workerId: string,
  input: {
    endedAt: string;
    reason: string;
    writtenOff?: { issuanceId: string; reason: string }[];
    keepUserAccount?: boolean;
  },
): Promise<
  ServiceResult<{
    workerId: string;
    deactivatedAssignments: number;
    revokedSessions: number;
    returnedIssuances: number;
    writtenOffIssuances: number;
    closedObligations: number;
    retentionStartedFor: number;
  }>
> {
  return withCompany(pool, actor.companyId, async (client) => {
    const workerRow = await client.query<{ id: string; user_id: string | null; ended_at: string | null }>(
      "SELECT id, user_id, ended_at::text AS ended_at FROM workers WHERE company_id = $1 AND id = $2",
      [actor.companyId, workerId],
    );
    const worker = workerRow.rows[0];
    if (!worker) {
      return { ok: false as const, status: 404, code: "NOT_FOUND", message: "Radnik ne postoji." };
    }
    if (worker.ended_at) {
      return {
        ok: false as const,
        status: 409,
        code: "CONFLICT",
        message: `Radnik je već razdužen (${dateOnly(worker.ended_at)}).`,
      };
    }

    const active = await client.query<{ id: string; item_name: string }>(
      `SELECT id, item_name FROM worker_issuances
        WHERE company_id = $1 AND worker_id = $2 AND returned_at IS NULL`,
      [actor.companyId, workerId],
    );
    const writtenOffIds = new Set((input.writtenOff ?? []).map((entry) => entry.issuanceId));
    const unaccounted = active.rows.filter((row) => !writtenOffIds.has(row.id));
    if (unaccounted.length > 0) {
      return {
        ok: false as const,
        status: 409,
        code: "WORKER_HAS_ACTIVE_ISSUANCES",
        message: `Radnik ima ${unaccounted.length} nerazduženih stavki (${unaccounted
          .map((row) => row.item_name)
          .join(", ")}). Vratite ih ili otpišite sa razlogom.`,
      };
    }

    // (a) vraćena oprema: povrat ureda na datum odlaska
    const returned = await client.query(
      `UPDATE worker_issuances
          SET returned_at = $3, returned_to = $4, updated_at = clock_timestamp()
        WHERE company_id = $1 AND worker_id = $2 AND returned_at IS NULL
          AND NOT (id = ANY($5::text[]))
        RETURNING id`,
      [actor.companyId, workerId, input.endedAt, actor.userId, [...writtenOffIds]],
    );

    // (b) otpisana oprema: ostaje zadužena, mijenja se stanje na `DAMAGED` uz razlog
    let writtenOff = 0;
    for (const entry of input.writtenOff ?? []) {
      const updated = await client.query(
        `UPDATE worker_issuances
            SET condition = 'DAMAGED', note = COALESCE(note || E'\n', '') || $4, updated_at = clock_timestamp()
          WHERE company_id = $1 AND worker_id = $2 AND id = $3 AND returned_at IS NULL`,
        [actor.companyId, workerId, entry.issuanceId, `Otpisano pri odlasku: ${entry.reason}`],
      );
      writtenOff += updated.rowCount ?? 0;
      await client.query(
        `INSERT INTO worker_history (id, company_id, worker_id, field, old_value, new_value, changed_by, reason)
         VALUES (gen_random_uuid()::text, $1, $2, 'issuance.writeOff', NULL, $3, $4, $5)`,
        [actor.companyId, workerId, entry.issuanceId, actor.userId, entry.reason],
      );
    }

    // (c) dodjele: gaze se na dan odlaska, ne brišu — historija gradilišta ostaje
    const assignments = await client.query(
      `UPDATE project_assignments
          SET voided_at = clock_timestamp(), voided_by = $4, void_reason = $5
        WHERE company_id = $1 AND worker_id = $2 AND voided_at IS NULL
          AND (to_date IS NULL OR to_date > $3::date)`,
      [actor.companyId, workerId, input.endedAt, actor.userId, `Radnik odlazi: ${input.reason}`],
    );

    // (d) sesije: radnik koji je otišao ne smije ostati prijavljen ni na jednom telefonu
    let revokedSessions = 0;
    if (worker.user_id && !input.keepUserAccount) {
      const sessions = await client.query(
        `UPDATE sessions SET revoked_at = clock_timestamp()
          WHERE company_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
        [actor.companyId, worker.user_id],
      );
      revokedSessions = sessions.rowCount ?? 0;
      await client.query(
        `UPDATE users SET is_active = false, updated_at = clock_timestamp()
          WHERE company_id = $1 AND id = $2`,
        [actor.companyId, worker.user_id],
      );
    }

    // (e) obaveze vezane za radnika: više nemaju koga da štite
    const obligations = await client.query(
      `UPDATE obligations
          SET superseded_by = 'worker_offboard', review_state = 'rejected', updated_at = clock_timestamp()
        WHERE company_id = $1 AND worker_id = $2 AND superseded_by IS NULL`,
      [actor.companyId, workerId],
    );

    // (f) sam radnik
    await client.query(
      `UPDATE workers SET ended_at = $3::date, is_active = false, updated_at = clock_timestamp()
        WHERE company_id = $1 AND id = $2`,
      [actor.companyId, workerId, input.endedAt],
    );
    await client.query(
      `INSERT INTO worker_history (id, company_id, worker_id, field, old_value, new_value, changed_by, reason)
       VALUES (gen_random_uuid()::text, $1, $2, 'endedAt', NULL, $3, $4, $5)`,
      [actor.companyId, workerId, input.endedAt, actor.userId, input.reason],
    );

    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "worker.offboarded",
      entityType: "worker",
      entityId: workerId,
      metadata: {
        endedAt: input.endedAt,
        reason: input.reason,
        returned: returned.rowCount ?? 0,
        writtenOff,
        revokedSessions,
      },
    });

    return {
      ok: true as const,
      workerId,
      deactivatedAssignments: assignments.rowCount ?? 0,
      revokedSessions,
      returnedIssuances: returned.rowCount ?? 0,
      writtenOffIssuances: writtenOff,
      closedObligations: obligations.rowCount ?? 0,
      // Retencija: lični podaci ostaju do isteka roka; 0 znači „ništa nije novo započeto".
      retentionStartedFor: 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Masovne izmjene (spec 04 §1.8)
// ---------------------------------------------------------------------------

/**
 * Jedna transakcija za sve radnike; preskočeni se vraćaju sa razlogom.
 *
 * Namjerno NIJE „sve ili ništa": masovna izmjena nad 200 radnika obično ima par njih koji ne
 * prolaze (npr. neaktivan), i tada je korisnije primijeniti na ostale i reći koga je preskočio
 * nego odbiti cijelu operaciju zbog jednog reda.
 */
export async function bulkWorkers(
  pool: Pool,
  actor: ServiceActor,
  input:
    | { action: "changeTeam"; workerIds: string[]; team: string | null }
    | { action: "changeSupervisor"; workerIds: string[]; supervisorId: string | null }
    | {
        action: "newRate";
        workerIds: string[];
        rate: {
          kind: string;
          amountCents?: number | null;
          currencyCode?: string | null;
          coefficient?: number | null;
          validFrom: string;
          note?: string | null;
        };
      },
): Promise<ServiceResult<{ updated: number; skipped: { workerId: string; workerName: string; reason: string }[] }>> {
  return withCompany(pool, actor.companyId, async (client) => {
    const skipped: { workerId: string; workerName: string; reason: string }[] = [];
    let updated = 0;
    const today = input.action === "newRate" ? input.rate.validFrom : new Date().toISOString().slice(0, 10);

    for (const workerId of input.workerIds) {
      const found = await client.query<{ name: string; is_active: boolean }>(
        `SELECT (first_name || ' ' || last_name) AS name, is_active FROM workers
          WHERE company_id = $1 AND id = $2`,
        [actor.companyId, workerId],
      );
      const worker = found.rows[0];
      if (!worker) {
        skipped.push({ workerId, workerName: workerId, reason: "Radnik ne postoji u firmi." });
        continue;
      }
      if (!worker.is_active) {
        skipped.push({ workerId, workerName: worker.name, reason: "Radnik nije aktivan." });
        continue;
      }

      if (input.action === "changeTeam") {
        await client.query(
          "UPDATE workers SET team = $3, updated_at = clock_timestamp() WHERE company_id = $1 AND id = $2",
          [actor.companyId, workerId, input.team],
        );
        updated += 1;
        continue;
      }

      if (input.action === "changeSupervisor") {
        if (input.supervisorId) {
          // Nadređeni mora biti aktivan radnik ISte firme — inače bi dodjela pokazivala u prazno.
          const supervisor = await client.query(
            "SELECT 1 FROM workers WHERE company_id = $1 AND id = $2 AND is_active",
            [actor.companyId, input.supervisorId],
          );
          if ((supervisor.rowCount ?? 0) === 0) {
            skipped.push({ workerId, workerName: worker.name, reason: "Nadređeni nije aktivan radnik." });
            continue;
          }
          if (input.supervisorId === workerId) {
            skipped.push({ workerId, workerName: worker.name, reason: "Radnik ne može biti sam sebi nadređen." });
            continue;
          }
        }
        await client.query(
          "UPDATE workers SET supervisor_id = $3, updated_at = clock_timestamp() WHERE company_id = $1 AND id = $2",
          [actor.companyId, workerId, input.supervisorId],
        );
        updated += 1;
        continue;
      }

      // newRate: ista logika kao `addRate`, ali unutar ove transakcije (jedan prolaz, jedan audit).
      const open = await client.query<{ id: string; valid_from: string }>(
        `SELECT id, valid_from::text AS valid_from FROM worker_rates
          WHERE company_id = $1 AND worker_id = $2 AND rate_kind = $3 AND valid_to IS NULL`,
        [actor.companyId, workerId, input.rate.kind],
      );
      const existing = open.rows[0];
      if (existing && dateOnly(existing.valid_from)! >= input.rate.validFrom) {
        skipped.push({
          workerId,
          workerName: worker.name,
          reason: `Cijena tog tipa već važi od ${dateOnly(existing.valid_from)}.`,
        });
        continue;
      }
      if (existing) {
        const dayBefore = new Date(`${input.rate.validFrom}T00:00:00.000Z`);
        dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
        await client.query(
          "UPDATE worker_rates SET valid_to = $3 WHERE company_id = $1 AND id = $2",
          [actor.companyId, existing.id, dayBefore.toISOString().slice(0, 10)],
        );
      }
      await client.query(
        `INSERT INTO worker_rates
           (id, company_id, worker_id, rate_kind, amount_cents, currency_code, coefficient, valid_from, note, created_by)
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          actor.companyId,
          workerId,
          input.rate.kind,
          input.rate.kind === "COEFFICIENT" ? null : (input.rate.amountCents ?? null),
          input.rate.kind === "COEFFICIENT" ? null : (input.rate.currencyCode ?? "BAM"),
          input.rate.kind === "COEFFICIENT" ? (input.rate.coefficient ?? null) : null,
          input.rate.validFrom,
          input.rate.note ?? null,
          actor.userId,
        ],
      );
      updated += 1;
    }

    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "worker.bulk_changed",
      entityType: "worker",
      entityId: input.workerIds[0] ?? "bulk",
      metadata: { action: input.action, requested: input.workerIds.length, updated, skipped: skipped.length, on: today },
    });

    return { ok: true as const, updated, skipped };
  });
}

// ---------------------------------------------------------------------------
// Historija
// ---------------------------------------------------------------------------

export async function workerHistory(
  pool: Pool,
  actor: ServiceActor,
  workerId: string,
): Promise<
  ServiceResult<{
    entries: {
      id: string;
      field: string;
      oldValue: string | null;
      newValue: string | null;
      changedAt: string;
      changedBy: string | null;
      changedByName: string | null;
      reason: string | null;
    }[];
  }>
> {
  return withCompany(pool, actor.companyId, async (client) => {
    const rows = await client.query<Record<string, unknown>>(
      `SELECT h.id, h.field, h.old_value, h.new_value, h.changed_at, h.changed_by, h.reason,
              (u.first_name || ' ' || u.last_name) AS changed_by_name
         FROM worker_history h
         LEFT JOIN users u ON u.id = h.changed_by
        WHERE h.company_id = $1 AND h.worker_id = $2
        ORDER BY h.changed_at DESC, h.id DESC`,
      [actor.companyId, workerId],
    );
    return {
      ok: true as const,
      entries: rows.rows.map((row) => ({
        id: row.id as string,
        field: row.field as string,
        oldValue: (row.old_value as string | null) ?? null,
        newValue: (row.new_value as string | null) ?? null,
        changedAt: (row.changed_at as Date).toISOString(),
        changedBy: (row.changed_by as string | null) ?? null,
        changedByName: (row.changed_by_name as string | null) ?? null,
        reason: (row.reason as string | null) ?? null,
      })),
    };
  });
}
