/**
 * F4 (Modul 5 §1.5.22) — potvrda fotografije kritičnog nalaza i iskorištenost/MTBF/MTTR.
 *
 * Dvije stvari koje ovdje žive:
 *
 *  1. **Fotografija prije potvrde.** Kritična `FAIL` stavka traži dokaz. Potvrda se upisuje samo
 *     kad na pregledu POSTOJI potvrđen prilog (`status = 'ready'`). Bez provjere bi „potvrdi"
 *     moglo proći bez ijedne slike, a to je upravo ono što pravilo treba da spriječi.
 *  2. **Iskorištenost se RAČUNA, ne čuva** (spec 05 §1.2.7). Jedna definicija u domeni
 *     (`utilization`), ovdje samo upiti. Dvije kolone — primarna `WORK/(WORK+IDLE+BREAKDOWN)` i
 *     sekundarna `WORK/kalendarski radni sati`. MTBF/MTTR su isto izvedeni iz `machine_faults`,
 *     ne tabele: tabela bi se razišla sa kvarovima pri svakoj ispravci.
 */
import type { Pool, PoolClient } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import { utilization, type WorkLogMode } from "@gradix/domain";
import { writeAudit } from "./audit";
import { can, type Role } from "./permissions";

export type CheckActor = { userId: string; companyId: string; roles: readonly Role[] };

export type ValidationOutcome =
  | { outcome: "OK"; id: string }
  | { outcome: "FORBIDDEN"; code: string; message?: string }
  | { outcome: "VALIDATION_FAILED"; code: string; message: string }
  | { outcome: "CONFLICT"; code: string; message: string };

/**
 * Potvrda fotografije kritičnog nalaza.
 *
 * Idempotentno: druga potvrda samo vraća OK (ne mijenja vrijeme prve). Zašto: terenska aplikacija
 * ponavlja zahtjev kad nema potvrde prijema, pa bi „već potvrđeno" izgledalo kao greška koja
 * čovjeka navodi da slika ponovo — a vrijeme dokaza bi se pomjerilo.
 */
export async function confirmDailyCheckPhoto(
  pool: Pool,
  actor: CheckActor,
  checkId: string,
): Promise<ValidationOutcome> {
  if (!can(actor.roles, "machines.check.create")) return { outcome: "FORBIDDEN", code: "ROLE" };
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const check = await client.query<{
      id: string;
      photo_required: boolean;
      photo_confirmed_at: string | null;
    }>(
      `SELECT id, photo_required, photo_confirmed_at::text
         FROM public.machine_daily_checks
        WHERE company_id = $1 AND id = $2`,
      [actor.companyId, checkId],
    );
    if (!check.rows[0]) {
      return { outcome: "VALIDATION_FAILED", code: "NOT_FOUND", message: "Pregled nije pronađen." };
    }
    if (!check.rows[0].photo_required) {
      return {
        outcome: "CONFLICT",
        code: "PHOTO_NOT_REQUIRED",
        message: "Taj pregled nema kritičan nalaz, pa ne traži fotografiju.",
      };
    }
    if (check.rows[0].photo_confirmed_at) {
      return { outcome: "OK", id: checkId };
    }

    // Dokaz mora STVARNO postojati u bucketu: `ready`, ne `pending` (upload nije dovršen).
    const photo = await client.query<{ id: string }>(
      `SELECT id FROM public.attachments
        WHERE company_id = $1 AND entity_type = 'MACHINE_DAILY_CHECK'
          AND entity_id = $2 AND status = 'ready'
        ORDER BY created_at
        LIMIT 1`,
      [actor.companyId, checkId],
    );
    if (!photo.rows[0]) {
      return {
        outcome: "CONFLICT",
        code: "PHOTO_REQUIRED",
        message: "Kritičan nalaz traži fotografiju — priloži je prije potvrde.",
      };
    }

    await client.query(
      `UPDATE public.machine_daily_checks
          SET photo_confirmed_at = clock_timestamp(),
              photo_confirmed_by = $3,
              version = version + 1,
              updated_by = $3,
              updated_at = clock_timestamp()
        WHERE company_id = $1 AND id = $2`,
      [actor.companyId, checkId, actor.userId],
    );
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "machine.check.photo_confirmed",
      entityType: "machine_daily_check",
      entityId: checkId,
      metadata: { attachmentId: photo.rows[0].id },
    });
    return { outcome: "OK", id: checkId };
  });
}

/* ================================================================ iskorištenost */

export type UtilizationView = {
  machine_id: string;
  from: string;
  to: string;
  utilization_pct: number | null;
  calendar_utilization_pct: number | null;
  work_hours: number;
  idle_hours: number;
  breakdown_hours: number;
  calendar_hours: number;
  fault_count: number;
  downtime_minutes: number;
  mtbf_hours: number | null;
  mttr_hours: number | null;
};

/**
 * Kalendarski radni sati perioda.
 *
 * `workday_hours` iz postavki firme × broj radnih dana. Praznici i prenesene radne subote iz
 * Modula 1 ulaze kroz `company_holidays`: dan sa `is_working = true` je radni i kad je subota,
 * a praznik (`is_paid`/neradni) oduzima dan. Bez toga bi nazivnik sekundarne kolone bio pogrešan
 * u svakom mjesecu sa praznikom — a to je većina mjeseci.
 */
async function calendarHours(
  client: PoolClient,
  companyId: string,
  from: string,
  to: string,
): Promise<number> {
  const settings = await client.query<{ workday_hours: string; week_start: string }>(
    "SELECT workday_hours::text, week_start FROM public.companies WHERE id = $1",
    [companyId],
  );
  const hoursPerDay = Number(settings.rows[0]?.workday_hours ?? 8);
  const holidays = await client.query<{ date: string; is_working: boolean }>(
    `SELECT to_char(holiday_date, 'YYYY-MM-DD') AS date, is_working
       FROM public.company_holidays
      WHERE company_id = $1 AND holiday_date BETWEEN $2::date AND $3::date`,
    [companyId, from, to],
  );
  const byDate = new Map(holidays.rows.map((row) => [row.date, row.is_working]));

  let workingDays = 0;
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  for (let day = start; day <= end; day = new Date(day.getTime() + 86_400_000)) {
    const iso = day.toISOString().slice(0, 10);
    const holidayFlag = byDate.get(iso);
    if (holidayFlag === true) {
      workingDays += 1; // prenesena radna subota
      continue;
    }
    if (holidayFlag === false) continue; // praznik / neradni dan
    const weekday = day.getUTCDay(); // 0 = nedjelja
    if (weekday !== 0 && weekday !== 6) workingDays += 1;
  }
  return Number((workingDays * hoursPerDay).toFixed(2));
}

/**
 * Iskorištenost + pouzdanost za mašinu u periodu.
 *
 * MTBF = vrijeme rada / broj kvarova; MTTR = zastoji / broj kvarova. Kad kvarova nema, oba su
 * `null` — „beskonačno pouzdana" nije brojka koju treba prikazati kao nulu ili kao izmišljen
 * veliki broj.
 */
export async function machineUtilization(
  pool: Pool,
  actor: { userId: string; companyId: string; roles: readonly Role[] },
  machineId: string,
  from: string,
  to: string,
): Promise<UtilizationView | null> {
  if (!can(actor.roles, "equipment.view")) return null;
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const machine = await client.query<{ id: string }>(
      "SELECT id FROM public.machines WHERE company_id = $1 AND id = $2",
      [actor.companyId, machineId],
    );
    if (!machine.rows[0]) return null;

    const logs = await client.query<{ mode: string; hours: string }>(
      `SELECT mode, sum(EXTRACT(EPOCH FROM (ended_at - started_at)) / 3600)::text AS hours
         FROM public.machine_work_logs
        WHERE company_id = $1 AND machine_id = $2
          AND started_at >= $3::timestamptz AND ended_at <= ($4::timestamptz + interval '1 day')
        GROUP BY mode`,
      [actor.companyId, machineId, `${from}T00:00:00Z`, `${to}T00:00:00Z`],
    );
    const rows = logs.rows.map((row) => ({
      mode: row.mode as WorkLogMode,
      hours: Number(row.hours),
    }));
    const calendar = await calendarHours(client, actor.companyId, from, to);
    const result = utilization(rows, calendar);

    const faults = await client.query<{
      count: string;
      downtime: string | null;
    }>(
      `SELECT count(*)::text AS count, COALESCE(sum(downtime_minutes), 0)::text AS downtime
         FROM public.machine_faults
        WHERE company_id = $1 AND machine_id = $2
          AND reported_at >= $3::timestamptz AND reported_at <= ($4::timestamptz + interval '1 day')`,
      [actor.companyId, machineId, `${from}T00:00:00Z`, `${to}T00:00:00Z`],
    );
    const faultCount = Number(faults.rows[0]?.count ?? 0);
    const downtimeMinutes = Number(faults.rows[0]?.downtime ?? 0);
    const workHours = result.workHours;
    return {
      machine_id: machineId,
      from,
      to,
      utilization_pct: result.utilizationPct,
      calendar_utilization_pct: result.calendarUtilizationPct,
      work_hours: result.workHours,
      idle_hours: result.idleHours,
      breakdown_hours: result.breakdownHours,
      calendar_hours: calendar,
      fault_count: faultCount,
      downtime_minutes: downtimeMinutes,
      // Bez kvarova nema MTBF/MTTR — `null`, ne nula (nula bi izgledala kao „odmah se pokvario").
      mtbf_hours: faultCount > 0 ? Number((workHours / faultCount).toFixed(2)) : null,
      mttr_hours: faultCount > 0 ? Number(((downtimeMinutes / 60) / faultCount).toFixed(2)) : null,
    };
  });
}
