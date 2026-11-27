/**
 * R4b E2E sidro: jedan SUBMITTED dan bez OPEN sukoba/segmenta u šefovom R3 opsegu.
 * Administratorska naredba (DATABASE_ADMIN_URL) — kao demo-pregled/demo-sukobi.
 */
import { Pool } from "pg";
import { companyId, withCompany } from "@gradix/db";

const PREFIX = "demo_r4b_";
const COMPANY = "cmp_demo";
const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) throw new Error("DATABASE_ADMIN_URL je obavezan.");

const pool = new Pool({ connectionString: adminUrl, max: 2 });

try {
  await withCompany(pool, companyId(COMPANY), async (client) => {
    // Approval/revise E2E zaključa sedmicu. Bez ovoga drugi prolaz ostane na
    // „Sedmica zaključana“ i ne vidi „Potvrdi dan“, iako sidro opet postoji.
    await client.query(
      `DELETE FROM public.workday_revisions
        WHERE company_id = $1 AND workday_id LIKE $2`,
      [COMPANY, `${PREFIX}%`],
    );
    await client.query("DELETE FROM public.work_entries WHERE company_id = $1 AND id LIKE $2", [COMPANY, `${PREFIX}%`]);
    await client.query("DELETE FROM public.workdays WHERE company_id = $1 AND id LIKE $2", [COMPANY, `${PREFIX}%`]);
    await client.query("DELETE FROM public.work_week_approvals WHERE company_id = $1", [COMPANY]);
    await client.query(
      `UPDATE public.workdays
          SET approval_status = 'SUBMITTED', updated_at = clock_timestamp()
        WHERE company_id = $1 AND approval_status <> 'SUBMITTED'`,
      [COMPANY],
    );

    const sef = await client.query<{ user_id: string; worker_id: string }>(
      `SELECT u.id AS user_id, w.id AS worker_id
         FROM public.users u
         JOIN public.workers w ON w.user_id = u.id AND w.company_id = $1
        WHERE u.email = 'sef@demo.test'`,
      [COMPANY],
    );
    if (!sef.rows[0]) throw new Error("Nedostaje sef@demo.test / povezani radnik.");

    const peers = await client.query<{ id: string }>(
      `SELECT ta.worker_id AS id
         FROM public.project_assignments va
         JOIN public.project_assignments ta
           ON ta.company_id = va.company_id AND ta.project_id = va.project_id
          AND ta.worker_id <> va.worker_id AND ta.voided_at IS NULL
         JOIN public.workers w ON w.company_id = ta.company_id AND w.id = ta.worker_id
        WHERE va.company_id = $1 AND va.worker_id = $2 AND va.voided_at IS NULL
          AND w.user_id IS NULL
        GROUP BY ta.worker_id
        LIMIT 2`,
      [COMPANY, sef.rows[0].worker_id],
    );
    if (peers.rows.length < 1) throw new Error("Nema radnika u šefovom opsegu za R4b sidro.");

    const insertClean = async (suffix: string, workerId: string, offset: number) => {
      const project = await client.query<{ id: string }>(
        `SELECT project_id AS id FROM public.project_assignments
          WHERE company_id = $1 AND worker_id = $2 AND voided_at IS NULL LIMIT 1`,
        [COMPANY, workerId],
      );
      const day = await client.query<{ d: string }>(
        `SELECT (CURRENT_DATE - ($1::int + n))::text AS d
           FROM generate_series(0, 40) AS n
          WHERE NOT EXISTS (
            SELECT 1 FROM public.workdays
             WHERE company_id = $2 AND worker_id = $3 AND work_date = (CURRENT_DATE - ($1::int + n))
          )
          LIMIT 1`,
        [offset, COMPANY, workerId],
      );
      if (!day.rows[0]) throw new Error(`Nema slobodnog datuma za R4b sidro ${suffix}.`);
      const wd = `${PREFIX}wd_${suffix}`;
      const we = `${PREFIX}we_${suffix}`;
      await client.query(
        `INSERT INTO public.workdays (id, company_id, worker_id, work_date, status, approval_status, created_by, updated_by)
         VALUES ($1, $2, $3, $4::date, 'SUBMITTED', 'SUBMITTED', $5, $5)`,
        [wd, COMPANY, workerId, day.rows[0].d, sef.rows[0].user_id],
      );
      await client.query(
        `INSERT INTO public.work_entries
           (id, company_id, workday_id, worker_id, kind, started_at, ended_at, end_state, project_id, created_by, updated_by)
         VALUES ($1, $2, $3, $4, 'WORK', ($5 || 'T08:00:00+01:00')::timestamptz,
                 ($5 || 'T16:00:00+01:00')::timestamptz, 'KNOWN_END', $6, $7, $7)`,
        [we, COMPANY, wd, workerId, day.rows[0].d, project.rows[0]?.id ?? null, sef.rows[0].user_id],
      );
      console.log(`R4b sidro: ${wd} ${day.rows[0].d} worker=${workerId}`);
    };

    // Dvije sedmice: approval i revise E2E ne dijele WEEK_CLOSED nakon zaključavanja.
    await insertClean("ok", peers.rows[0]!.id, 3);
    await insertClean("ok2", (peers.rows[1] ?? peers.rows[0])!.id, 10);
  });
} finally {
  await pool.end();
}
