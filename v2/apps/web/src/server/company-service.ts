/**
 * Postavke firme i praznici (spec 01 §1.1, §2.1, §2.2).
 *
 * Pravila koja ovaj modul drži:
 *   - `slug` se NE mijenja (identitet tenanta); naziv se mijenja slobodno;
 *   - valuta i zona se mijenjaju samo ovdje i uz audit — nikad „usput“ u drugoj ruti;
 *   - promjena NE prepisuje historijske zapise: iznosi nose svoju valutu, datumi svoju zonu;
 *   - noćni prozor i prag prekovremenog su OBAVEZNO oba ili nijedan (polovičan prozor je
 *     greška u podacima koja se poslije teško primijeti u obračunu).
 */
import { money, toAmountString, type Currency } from "@gradix/domain";
import type { Pool } from "pg";
import { withCompany, type CompanyId } from "@gradix/db";
import type { CompanySettings, CompanySettingsPatch, CompanyHoliday, CompanyHolidayInput } from "@gradix/contracts";
import { writeAudit, ipHash } from "./audit";

/** Kolone koje PATCH smije dodirnuti → ime u bazi. Zatvoren spisak: nema dinamičkog SQL-a. */
const SETTING_COLUMNS = {
  name: "name",
  legalName: "legal_name",
  taxId: "tax_id",
  vatId: "vat_id",
  vatRegistered: "vat_registered",
  address: "address",
  city: "city",
  postalCode: "postal_code",
  country: "country",
  phone: "phone",
  email: "email",
  web: "web",
  iban: "iban",
  bankName: "bank_name",
  logoObjectKey: "logo_object_key",
  weekStart: "week_start",
  workdayHours: "workday_hours",
  overtimeDailyThreshold: "overtime_daily_threshold",
  nightFrom: "night_from",
  nightTo: "night_to",
  holidayPaid: "holiday_paid",
  approvalThresholdCurrency: "approval_threshold_currency",
} as const;

type CompanyRow = {
  id: string;
  name: string;
  slug: string;
  legal_name: string | null;
  tax_id: string | null;
  vat_id: string | null;
  vat_registered: boolean;
  address: string | null;
  city: string | null;
  postal_code: string | null;
  country: string;
  phone: string | null;
  email: string | null;
  web: string | null;
  iban: string | null;
  bank_name: string | null;
  logo_object_key: string | null;
  currency: string;
  locale: string;
  timezone: string;
  week_start: string;
  workday_hours: string;
  overtime_daily_threshold: string;
  night_from: string | null;
  night_to: string | null;
  holiday_paid: boolean;
  approval_threshold_cents: string | null;
  approval_threshold_currency: string | null;
  is_active: boolean;
  settings_updated_at: Date | null;
};

function mapCompany(row: CompanyRow): CompanySettings {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    legalName: row.legal_name,
    taxId: row.tax_id,
    vatId: row.vat_id,
    vatRegistered: row.vat_registered,
    address: row.address,
    city: row.city,
    postalCode: row.postal_code,
    country: row.country,
    phone: row.phone,
    email: row.email,
    web: row.web,
    iban: row.iban,
    bankName: row.bank_name,
    logoObjectKey: row.logo_object_key,
    currency: row.currency,
    locale: row.locale,
    timezone: row.timezone,
    weekStart: row.week_start === "SUN" ? "SUN" : "MON",
    workdayHours: Number(row.workday_hours),
    overtimeDailyThreshold: Number(row.overtime_daily_threshold),
    nightFrom: row.night_from ? row.night_from.slice(0, 5) : null,
    nightTo: row.night_to ? row.night_to.slice(0, 5) : null,
    holidayPaid: row.holiday_paid,
    approvalThreshold:
      row.approval_threshold_cents === null
        ? null
        : toAmountString({ cents: BigInt(row.approval_threshold_cents), currency: (row.approval_threshold_currency ?? row.currency) as never }),
    approvalThresholdCurrency: row.approval_threshold_currency,
    isActive: row.is_active,
    settingsUpdatedAt: row.settings_updated_at ? row.settings_updated_at.toISOString() : null,
  };
}

const SELECT_COMPANY = `SELECT id, name, slug, legal_name, tax_id, vat_id, vat_registered,
       address, city, postal_code, country, phone, email, web, iban, bank_name,
       logo_object_key, currency, locale, timezone, week_start, workday_hours,
       overtime_daily_threshold, night_from::text AS night_from, night_to::text AS night_to,
       holiday_paid, approval_threshold_cents::text AS approval_threshold_cents,
       approval_threshold_currency, is_active, settings_updated_at
  FROM companies WHERE id = $1`;

export async function getCompanySettings(pool: Pool, companyId: CompanyId): Promise<CompanySettings | null> {
  return withCompany(pool, companyId, async (client) => {
    const result = await client.query<CompanyRow>(SELECT_COMPANY, [companyId]);
    const row = result.rows[0];
    return row ? mapCompany(row) : null;
  });
}

export type SettingsFailure = { code: "VALIDATION_FAILED" | "NOT_FOUND"; message: string };

/**
 * Izmjena postavki. `before`/`after` u auditu sadrže SAMO promijenjena polja — ne cijeli
 * red: audit treba odgovoriti „šta se promijenilo“, a ne arhivirati kopiju firme.
 */
export async function updateCompanySettings(
  pool: Pool,
  ctx: { userId: string; companyId: CompanyId; actorEmail: string | null; roles: readonly string[]; ip?: string },
  patch: CompanySettingsPatch,
): Promise<{ ok: true; company: CompanySettings } | SettingsFailure> {
  return withCompany(pool, ctx.companyId, async (client) => {
    const current = await client.query<CompanyRow>(SELECT_COMPANY, [ctx.companyId]);
    const before = current.rows[0];
    if (!before) return { code: "NOT_FOUND" as const, message: "Firma nije pronađena." };

    // Noćni prozor: oba ili nijedan. Provjera ide prije SQL-a da poruka bude razumljiva.
    const nextNightFrom = patch.nightFrom === undefined ? before.night_from : patch.nightFrom;
    const nextNightTo = patch.nightTo === undefined ? before.night_to : patch.nightTo;
    if ((nextNightFrom === null) !== (nextNightTo === null)) {
      return {
        code: "VALIDATION_FAILED" as const,
        message: "Noćni rad traži i početak i kraj (ili ostavite oba prazna).",
      };
    }
    if (
      patch.approvalThreshold === null &&
      patch.approvalThresholdCurrency !== null &&
      patch.approvalThresholdCurrency !== undefined
    ) {
      return { code: "VALIDATION_FAILED" as const, message: "Bez praga ne ostaje ni valuta praga." };
    }

    const sets: string[] = [];
    const params: unknown[] = [ctx.companyId];
    const changed: string[] = [];
    const beforeValues: Record<string, unknown> = {};
    const afterValues: Record<string, unknown> = {};

    for (const [key, column] of Object.entries(SETTING_COLUMNS)) {
      const typedKey = key as keyof CompanySettingsPatch;
      if (patch[typedKey] === undefined) continue;
      params.push(patch[typedKey] === "" ? null : patch[typedKey]);
      sets.push(`${column} = $${params.length}`);
      changed.push(key);
      afterValues[key] = patch[typedKey] === "" ? null : patch[typedKey];
    }

    if (patch.approvalThreshold !== undefined) {
      if (patch.approvalThreshold === null || patch.approvalThreshold === "") {
        params.push(null);
        sets.push(`approval_threshold_cents = $${params.length}`);
      } else {
        // Novac ide kroz `Money` (BigInt centi), nikad `Number` — zaokruživanje je jedno.
        const threshold = money(
          patch.approvalThreshold,
          (patch.approvalThresholdCurrency ?? before.approval_threshold_currency ?? before.currency) as Currency,
        );
        params.push(threshold.cents.toString());
        sets.push(`approval_threshold_cents = $${params.length}`);
      }
      changed.push("approvalThreshold");
      afterValues.approvalThreshold = patch.approvalThreshold;
    }

    if (sets.length === 0) {
      return { ok: true as const, company: mapCompany(before) };
    }

    params.push(ctx.userId);
    const updated = await client.query<CompanyRow>(
      `UPDATE companies SET ${sets.join(", ")}, settings_updated_at = now(), settings_updated_by = $${params.length}
        WHERE id = $1
        RETURNING id, name, slug, legal_name, tax_id, vat_id, vat_registered, address, city,
                  postal_code, country, phone, email, web, iban, bank_name, logo_object_key,
                  currency, locale, timezone, week_start, workday_hours, overtime_daily_threshold,
                  night_from::text AS night_from, night_to::text AS night_to, holiday_paid,
                  approval_threshold_cents::text AS approval_threshold_cents,
                  approval_threshold_currency, is_active, settings_updated_at`,
      params,
    );
    const row = updated.rows[0]!;

    for (const key of changed) {
      const column = SETTING_COLUMNS[key as keyof typeof SETTING_COLUMNS];
      beforeValues[key] = column in before ? (before as unknown as Record<string, unknown>)[column] : null;
    }

    await writeAudit(client, {
      companyId: ctx.companyId,
      actorId: ctx.userId,
      actorEmail: ctx.actorEmail,
      actorRole: ctx.roles[0] ?? null,
      action: "company.settings_updated",
      entityType: "company",
      entityId: ctx.companyId,
      metadata: { before: beforeValues, after: afterValues, changed },
      ipHash: ctx.ip ? ipHash(ctx.ip) : null,
    });

    return { ok: true as const, company: mapCompany(row) };
  });
}

/* ------------------------------------------------------------------ praznici */

type HolidayRow = {
  id: string;
  holiday_date: Date | string;
  name: string;
  is_paid: boolean;
  is_working: boolean;
};

function isoDate(value: Date | string): string {
  if (value instanceof Date) {
    // `date` kolona dolazi kao Date u lokalnoj zoni; format iz UTC dijelova je stabilan.
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

function mapHoliday(row: HolidayRow): CompanyHoliday {
  return {
    id: row.id,
    date: isoDate(row.holiday_date),
    name: row.name,
    isPaid: row.is_paid,
    isWorking: row.is_working,
  };
}

export async function listHolidays(
  pool: Pool,
  companyId: CompanyId,
  year: number,
): Promise<CompanyHoliday[]> {
  return withCompany(pool, companyId, async (client) => {
    const result = await client.query<HolidayRow>(
      `SELECT id, holiday_date, name, is_paid, is_working
         FROM company_holidays
        WHERE company_id = $1
          AND holiday_date >= make_date($2, 1, 1)
          AND holiday_date <= make_date($2, 12, 31)
        ORDER BY holiday_date`,
      [companyId, year],
    );
    return result.rows.map(mapHoliday);
  });
}

export async function createHoliday(
  pool: Pool,
  ctx: { userId: string; companyId: CompanyId; actorEmail: string | null; roles: readonly string[]; ip?: string },
  input: CompanyHolidayInput,
): Promise<{ ok: true; holiday: CompanyHoliday } | { code: "CONFLICT"; message: string }> {
  return withCompany(pool, ctx.companyId, async (client) => {
    const existing = await client.query<{ id: string }>(
      "SELECT id FROM company_holidays WHERE company_id = $1 AND holiday_date = $2",
      [ctx.companyId, input.date],
    );
    if (existing.rows[0]) {
      return { code: "CONFLICT" as const, message: "Na taj datum već postoji zapis." };
    }
    const inserted = await client.query<HolidayRow>(
      `INSERT INTO company_holidays (id, company_id, holiday_date, name, is_paid, is_working)
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5)
       RETURNING id, holiday_date, name, is_paid, is_working`,
      [ctx.companyId, input.date, input.name.trim(), input.isPaid, input.isWorking],
    );
    const row = inserted.rows[0]!;
    await writeAudit(client, {
      companyId: ctx.companyId,
      actorId: ctx.userId,
      actorEmail: ctx.actorEmail,
      actorRole: ctx.roles[0] ?? null,
      action: "company.holiday_created",
      entityType: "company_holiday",
      entityId: row.id,
      metadata: { after: { date: input.date, name: input.name, isWorking: input.isWorking } },
      ipHash: ctx.ip ? ipHash(ctx.ip) : null,
    });
    return { ok: true as const, holiday: mapHoliday(row) };
  });
}

export async function updateHoliday(
  pool: Pool,
  ctx: { userId: string; companyId: CompanyId; actorEmail: string | null; roles: readonly string[]; ip?: string },
  holidayId: string,
  input: Partial<CompanyHolidayInput>,
): Promise<{ ok: true; holiday: CompanyHoliday } | { code: "NOT_FOUND"; message: string }> {
  return withCompany(pool, ctx.companyId, async (client) => {
    const existing = await client.query<HolidayRow>(
      "SELECT id, holiday_date, name, is_paid, is_working FROM company_holidays WHERE id = $1 AND company_id = $2",
      [holidayId, ctx.companyId],
    );
    const current = existing.rows[0];
    if (!current) return { code: "NOT_FOUND" as const, message: "Praznik nije pronađen." };

    const updated = await client.query<HolidayRow>(
      `UPDATE company_holidays
          SET holiday_date = $3, name = $4, is_paid = $5, is_working = $6, updated_at = now()
        WHERE id = $1 AND company_id = $2
        RETURNING id, holiday_date, name, is_paid, is_working`,
      [
        holidayId,
        ctx.companyId,
        input.date ?? isoDate(current.holiday_date),
        input.name?.trim() ?? current.name,
        input.isPaid ?? current.is_paid,
        input.isWorking ?? current.is_working,
      ],
    );
    const row = updated.rows[0]!;
    await writeAudit(client, {
      companyId: ctx.companyId,
      actorId: ctx.userId,
      actorEmail: ctx.actorEmail,
      actorRole: ctx.roles[0] ?? null,
      action: "company.holiday_updated",
      entityType: "company_holiday",
      entityId: holidayId,
      metadata: {
        before: { date: isoDate(current.holiday_date), name: current.name, isWorking: current.is_working },
        after: { date: isoDate(row.holiday_date), name: row.name, isWorking: row.is_working },
        changed: Object.keys(input),
      },
      ipHash: ctx.ip ? ipHash(ctx.ip) : null,
    });
    return { ok: true as const, holiday: mapHoliday(row) };
  });
}

export async function deleteHoliday(
  pool: Pool,
  ctx: { userId: string; companyId: CompanyId; actorEmail: string | null; roles: readonly string[]; ip?: string },
  holidayId: string,
): Promise<{ ok: true; deleted: boolean }> {
  return withCompany(pool, ctx.companyId, async (client) => {
    const result = await client.query<{ id: string; holiday_date: Date | string; name: string }>(
      "DELETE FROM company_holidays WHERE id = $1 AND company_id = $2 RETURNING id, holiday_date, name",
      [holidayId, ctx.companyId],
    );
    const row = result.rows[0];
    if (!row) return { ok: true as const, deleted: false };
    await writeAudit(client, {
      companyId: ctx.companyId,
      actorId: ctx.userId,
      actorEmail: ctx.actorEmail,
      actorRole: ctx.roles[0] ?? null,
      action: "company.holiday_deleted",
      entityType: "company_holiday",
      entityId: holidayId,
      metadata: { before: { date: isoDate(row.holiday_date), name: row.name } },
      ipHash: ctx.ip ? ipHash(ctx.ip) : null,
    });
    return { ok: true as const, deleted: true };
  });
}
