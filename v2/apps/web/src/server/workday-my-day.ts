/**
 * „Moj dan“ — jedan upit koji telefon otvara pri pokretanju (spec 03 §1.1.1).
 *
 * Odgovor mora odgovoriti na tri pitanja odjednom, jer mobilna aplikacija radi i bez mreže i
 * ne smije praviti tri kruga da bi znala šta da prikaže:
 *
 *  1. Šta je danas (i koji je timer aktivan)?
 *  2. Ima li dan koji je ostao otvoren — i to ne samo juče, nego bilo koji stariji dan, jer
 *     radnik može biti nedjeljama bez telefona?
 *  3. Na koje projekte danas može da počne rad?
 *
 * Zaboravljen dan se traži NAPRIJED (od najstarijeg otvorenog), ne unazad: ako ih je više,
 * radnik prvo rješava najstariji, inače bi najnoviji vječito prekrivao starije.
 */
import type { Pool, PoolClient } from "pg";
import { withCompany } from "@gradix/db";
import { safeTimezone } from "@gradix/domain";
import type { z } from "zod";
import type { MyDayResponse } from "@gradix/contracts";
import {
  assignmentsForWorker,
  blockersFor,
  myDayForWorker,
  type ServiceActor,
  type ServiceResult,
} from "./workday-timer-service";

/** Tip odgovora je izveden iz ŠEME, ne napisan rukom — inače bi se prikaz i ugovor razišli. */
type MyDay = z.infer<typeof MyDayResponse>;

export async function myDay(
  pool: Pool,
  actor: ServiceActor,
  now = new Date(),
): Promise<ServiceResult<{ day: MyDay }>> {
  return withCompany(pool, actor.companyId, async (client: PoolClient) => {
    const settings = await client.query<{
      timezone: string | null;
      forgotten_day_hours: number;
      rounding_minutes: number;
      rounding_mode: string;
    }>(
      `SELECT timezone, forgotten_day_hours, rounding_minutes, rounding_mode
         FROM companies WHERE id = $1`,
      [actor.companyId],
    );
    const policy = settings.rows[0];
    if (!policy) {
      return { ok: false as const, status: 404, code: "NOT_FOUND", message: "Firma ne postoji." };
    }

    const worker = await client.query<{ id: string }>(
      "SELECT id FROM workers WHERE company_id = $1 AND user_id = $2 AND is_active",
      [actor.companyId, actor.userId],
    );
    const workerId = worker.rows[0]?.id;
    if (!workerId) {
      /*
       * Nalog bez radničkog zapisa (npr. računovođa) nema „svoj dan“. Vraća se prazan odgovor,
       * a ne greška: ekran „Moj dan“ tada samo nema šta da prikaže, i to je tačno stanje.
       */
      return {
        ok: true as const,
        day: {
          today: null,
          forgotten: null,
          assignments: [],
          forgottenThresholdHours: Number(policy.forgotten_day_hours),
          roundingMinutes: Number(policy.rounding_minutes),
          roundingMode: (policy.rounding_mode as MyDay["roundingMode"]) ?? "NEAREST",
        },
      };
    }

    const timezone = safeTimezone(policy.timezone);
    const todayDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);

    const today = await myDayForWorker(client, actor.companyId, workerId, todayDate, now);

    // Najstariji otvoren dan PRIJE danas — njega radnik prvo mora da zatvori.
    const openPast = await client.query<{ workday_id: string; work_date: string }>(
      `SELECT e.workday_id, d.work_date::text AS work_date
         FROM work_entries e
         JOIN workdays d ON d.company_id = e.company_id AND d.id = e.workday_id
        WHERE e.company_id = $1 AND e.worker_id = $2
          AND e.end_state = 'OPEN' AND d.work_date < $3::date
        ORDER BY d.work_date ASC
        LIMIT 1`,
      [actor.companyId, workerId, todayDate],
    );
    const forgottenRow = openPast.rows[0];
    const forgotten = forgottenRow
      ? await myDayForWorker(client, actor.companyId, workerId, forgottenRow.work_date, now)
      : null;

    const { assignments } = await assignmentsForWorker(client, actor.companyId, workerId);
    await blockersFor(client, actor.companyId, workerId);

    return {
      ok: true as const,
      day: {
        today,
        forgotten,
        assignments,
        forgottenThresholdHours: Number(policy.forgotten_day_hours),
        roundingMinutes: Number(policy.rounding_minutes),
        roundingMode: (policy.rounding_mode as MyDay["roundingMode"]) ?? "NEAREST",
      },
    };
  });
}
