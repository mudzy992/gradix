/**
 * Stanje reda poslova za `/api/health/queue`.
 *
 * Čita pg-boss šemu SAMO ako postoji: u razvoju worker možda nikad nije pokrenut, a health
 * ekran tada mora reći „worker nije pokrenut“, ne srušiti se.
 *
 * Tri broja koja nešto znače:
 *   - `active`    — poslovi koji se izvršavaju SADA (ako raste i ne pada, worker visi);
 *   - `stuck`     — poslovi stariji od `expireInMinutes` koji još nisu gotovi;
 *   - `lastPingAt`— zadnji uspješan `ping.health`; ako je stariji od 30 min, red ne radi.
 */
import type { Pool } from "pg";

export type QueueHealth = {
  /** `false` = pg-boss šema ne postoji → worker nikad nije pokrenut nad ovom bazom. */
  available: boolean;
  active: number;
  created: number;
  retry: number;
  failed: number;
  completed: number;
  /** Poslovi koji su prekoračili `expireInMinutes`. */
  stuck: number;
  lastPingAt: string | null;
  /** `true` kad canarinac nije prošao duže od 30 min. */
  stale: boolean;
  jobs: Array<{ name: string; cron: string | null; timezone: string | null; active: number; created: number;
    retry: number; failed: number; lastCompletedAt: string | null }>;
};

export async function queueHealth(pool: Pool): Promise<QueueHealth> {
  const schema = await pool.query<{ exists: boolean }>(
    "SELECT coalesce((SELECT has_schema_privilege(current_user,n.oid,'USAGE') AND has_column_privilege(current_user,to_regclass('pgboss.job'),'state','SELECT') AND has_column_privilege(current_user,to_regclass('pgboss.schedule'),'cron','SELECT') FROM pg_namespace n WHERE n.nspname='pgboss'),false) AS exists",
  );
  if (schema.rows[0]?.exists !== true) {
    return { available: false, active: 0, created: 0, retry: 0, failed: 0, completed: 0, stuck: 0, lastPingAt: null, stale: true, jobs: [] };
  }

  const counts = await pool.query<Record<string, number>>(
    `SELECT
       count(*) FILTER (WHERE state = 'active')::int AS active,
       count(*) FILTER (WHERE state = 'created')::int AS created,
       count(*) FILTER (WHERE state = 'retry')::int AS retry,
       count(*) FILTER (WHERE state = 'failed')::int AS failed,
       count(*) FILTER (WHERE state = 'completed')::int AS completed,
       count(*) FILTER (WHERE state = 'active' AND started_on < now() - interval '15 minutes')::int AS stuck
     FROM pgboss.job`,
  );

  const ping = await pool.query<{ last_ping: Date | null }>(
    `SELECT max(completed_on) AS last_ping
       FROM pgboss.job
      WHERE name = 'ping.health' AND state = 'completed'`,
  );

  const jobs = await pool.query<{ name: string; cron: string | null; timezone: string | null; active: number;
    created: number; retry: number; failed: number; last_completed: Date | null }>(
    `SELECT coalesce(s.name,j.name) AS name, s.cron, s.timezone, coalesce(j.active,0)::int AS active,
      coalesce(j.created,0)::int AS created, coalesce(j.retry,0)::int AS retry, coalesce(j.failed,0)::int AS failed,
      j.last_completed FROM pgboss.schedule s FULL JOIN (
        SELECT name,count(*) FILTER (WHERE state='active')::int AS active,
          count(*) FILTER (WHERE state='created')::int AS created,count(*) FILTER (WHERE state='retry')::int AS retry,
          count(*) FILTER (WHERE state='failed')::int AS failed,max(completed_on) FILTER (WHERE state='completed') AS last_completed
        FROM pgboss.job GROUP BY name
      ) j ON j.name=s.name ORDER BY name`,
  );
  const lastPing = ping.rows[0]?.last_ping ?? null;
  const row = counts.rows[0] ?? {};
  return {
    available: true,
    active: Number(row.active ?? 0),
    created: Number(row.created ?? 0),
    retry: Number(row.retry ?? 0),
    failed: Number(row.failed ?? 0),
    completed: Number(row.completed ?? 0),
    stuck: Number(row.stuck ?? 0),
    lastPingAt: lastPing ? new Date(lastPing).toISOString() : null,
    stale: !lastPing || Date.now() - new Date(lastPing).getTime() > 30 * 60_000,
    jobs: jobs.rows.map(job => ({ name:job.name, cron:job.cron, timezone:job.timezone, active:job.active,
      created:job.created, retry:job.retry, failed:job.failed,
      lastCompletedAt:job.last_completed ? new Date(job.last_completed).toISOString() : null })),
  };
}
