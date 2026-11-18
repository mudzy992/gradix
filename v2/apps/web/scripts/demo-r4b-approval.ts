/**
 * R4b E2E sidro: jedan SUBMITTED dan bez OPEN sukoba/segmenta u šefovom R3 opsegu.
 * Idempotentno (briše prethodni PREFIX red). Sintetički podaci.
 */
import { Pool } from "pg";
import { companyId, withCompany } from "@gradix/db";

const PREFIX = "demo_r4b_";
const COMPANY = "cmp_demo";
const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!appUrl || !adminUrl) throw new Error("DATABASE_URL i DATABASE_ADMIN_URL su obavezni.");

const admin = new Pool({ connectionString: adminUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 2 });

try {
  await withCompany(app, companyId(COMPANY), async (client) => {
    await client.query("DELETE FROM public.work_entries WHERE company_id = $1 AND id LIKE $2", [COMPANY, `${PREFIX}%`]);
    await client.query("DELETE FROM public.workdays WHERE company_id = $1 AND id LIKE $2", [COMPANY, `${PREFIX}%`]);

    const sef = await client.query<{ user_id: string; worker_id: string }>(
      `SELECT u.id AS user_id, w.id AS worker_id
         FROM public.users u
         JOIN public.workers w ON w.user_id = u.id AND w.company_id = $1
        WHERE u.email = 'sef@demo.test'`,
      [COMPANY],
    );
    if (!sef.rows[0]) throw new Error("Nedostaje sef@demo.test / povezani radnik.");

    const peer = await client.query<{ id: string }>(
      `SELECT ta.worker_id AS id
         FROM public.project_assignments va
         JOIN public.project_assignments ta
           ON ta.company_id = va.company_id AND ta.project_id = va.project_id
          AND ta.worker_id <> va.worker_id AND ta.voided_at IS NULL
         JOIN public.workers w ON w.company_id = ta.company_id AND w.id = ta.worker_id
        WHERE va.company_id = $1 AND va.worker_id = $2 AND va.voided_at IS NULL
          AND w.user_id IS NULL
        LIMIT 1`,
      [COMPANY, sef.rows[0].worker_id],
    );
    if (!peer.rows[0]) throw new Error("Nema radnika u šefovom opsegu za R4b sidro.");

    const project = await client.query<{ id: string }>(
      `SELECT project_id AS id FROM public.project_assignments
        WHERE company_id = $1 AND worker_id = $2 AND voided_at IS NULL LIMIT 1`,
      [COMPANY, peer.rows[0].id],
    );
    const day = await client.query<{ d: string }>(
      `SELECT (CURRENT_DATE - ($1::int + n))::text AS d
         FROM generate_series(0, 40) AS n
        WHERE NOT EXISTS (
          SELECT 1 FROM public.workdays
           WHERE company_id = $2 AND worker_id = $3 AND work_date = (CURRENT_DATE - ($1::int + n))
        )
        LIMIT 1`,
      [3, COMPANY, peer.rows[0].id],
    );
    if (!day.rows[0]) throw new Error("Nema slobodnog datuma za R4b sidro.");

    const wd = `${PREFIX}wd_ok`;
    const we = `${PREFIX}we_ok`;
    await client.query(
      `INSERT INTO public.workdays (id, company_id, worker_id, work_date, status, approval_status, created_by, updated_by)
       VALUES ($1, $2, $3, $4::date, 'SUBMITTED', 'SUBMITTED', $5, $5)`,
      [wd, COMPANY, peer.rows[0].id, day.rows[0].d, sef.rows[0].user_id],
    );
    await client.query(
      `INSERT INTO public.work_entries
         (id, company_id, workday_id, worker_id, kind, started_at, ended_at, end_state, project_id, created_by, updated_by)
       VALUES ($1, $2, $3, $4, 'WORK', ($5 || 'T08:00:00+01:00')::timestamptz,
               ($5 || 'T16:00:00+01:00')::timestamptz, 'KNOWN_END', $6, $7, $7)`,
      [we, COMPANY, wd, peer.rows[0].id, day.rows[0].d, project.rows[0]?.id ?? null, sef.rows[0].user_id],
    );
    console.log(`R4b sidro: ${wd} ${day.rows[0].d} worker=${peer.rows[0].id}`);
  });
} finally {
  await admin.end();
  await app.end();
}
