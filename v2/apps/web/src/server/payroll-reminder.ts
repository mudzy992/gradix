/**
 * Podsjetnik računovodstvu: „period nije zaključan“ (F6, spec 07 §4 — `/pregled`).
 *
 * Pravilo: poslije 5. u mjesecu prethodni mjesec MORA biti `LOCKED`. Do tada je otvoren period
 * normalno stanje (sati još pristižu sa terena), pa podsjetnik prije 5. ne postoji — inače bi
 * upozorenje svakog 1. u mjesecu bilo šum koji se nauči ignorisati.
 *
 * Zašto se računa iz `pay_periods`, a ne iz `workdays`: nedostatak reda u `pay_periods` je
 * JEDNAKO važan kao otvoren period — mjesec koji nikad nije ni otvoren nije zaključan. Zato
 * funkcija vraća i `period_missing`.
 */
import type { Pool } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import { can } from "./permissions";

export type PayrollReminder = {
  /** Mjesec na koji se podsjetnik odnosi (prethodni mjesec). */
  year: number;
  month: number;
  status: "MISSING" | "OPEN" | "CALCULATED" | "APPROVED";
  /** Dan u mjesecu poslije kojeg se podsjetnik pali. */
  due_day: number;
  message: string;
};

const DUE_DAY = 5;

/** Prvi dan prethodnog mjeseca u odnosu na `today` (YYYY-MM-DD). */
export function previousMonth(today: string): { year: number; month: number } {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

/** Je li podsjetnik aktivan? Samo od 6. u mjesecu (5. je još rok, ne prekršaj). */
export function reminderDue(today: string): boolean {
  return Number(today.slice(8, 10)) > DUE_DAY;
}

export async function payrollReminder(
  pool: Pool,
  actor: { userId: string; companyId: string; roles: readonly string[] },
): Promise<PayrollReminder | null> {
  if (!can(actor.roles, "payroll.view")) return null;

  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const todayRow = await client.query<{ today: string }>(
      `SELECT (clock_timestamp() AT TIME ZONE c.timezone)::date::text AS today
         FROM public.companies c WHERE c.id = $1`,
      [actor.companyId],
    );
    const today = todayRow.rows[0]?.today;
    if (!today || !reminderDue(today)) return null;

    const target = previousMonth(today);
    const period = await client.query<{ status: string }>(
      `SELECT status FROM public.pay_periods
        WHERE company_id = $1 AND year = $2 AND month = $3`,
      [actor.companyId, target.year, target.month],
    );
    type AnyStatus = PayrollReminder["status"] | "LOCKED";
    const status: AnyStatus = (period.rows[0]?.status ?? "MISSING") as AnyStatus;
    if (status === "LOCKED") return null;

    const label = `${String(target.month).padStart(2, "0")}/${target.year}`;
    const message =
      status === "MISSING"
        ? `Period ${label} nije ni otvoren.`
        : status === "APPROVED"
          ? `Period ${label} je odobren, ali nije zaključan — isplata nije potvrđena.`
          : `Period ${label} nije zaključan (${status === "OPEN" ? "nije izračunat" : "nije odobren"}).`;

    return {
      year: target.year,
      month: target.month,
      status: status as PayrollReminder["status"],
      due_day: DUE_DAY,
      message,
    };
  });
}
