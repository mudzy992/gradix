import type { Pool, PoolClient } from "pg";
import { companyId, withCompany } from "@gradix/db";

type JobRow = {
  id: string; report_key: string; format: "PDF" | "XLSX";
  from: string; to: string; status: "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "DEAD";
  created_at: Date; completed_at: Date | null; last_error: string | null;
};
const columns = `id,report_key,format,period_from::text AS "from",period_to::text AS "to",status,created_at,completed_at,last_error`;
const SAFE_ERRORS = new Set([
  "Pravo pristupa izvještaju više nije dostupno.",
  "Izvještaj prelazi trenutno dozvoljenu veličinu.",
  "Izvještaj sadrži neusaglašene valute.",
  "Izvještaj nije moguće generisati. Pokušajte ponovo ili kontaktirajte podršku.",
]);
function toPublic(row: JobRow) {
  return { id: row.id, key: row.report_key, format: row.format.toLowerCase() as "pdf" | "xlsx",
    from: row.from, to: row.to, status: row.status, createdAt: row.created_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
    error: row.status === "FAILED" || row.status === "DEAD"
      ? (row.last_error && SAFE_ERRORS.has(row.last_error) ? row.last_error : "Izvještaj nije moguće generisati.") : null };
}
async function read(client: PoolClient, company: string, user: string, id: string | null) {
  const rows = await client.query<JobRow>(
    `SELECT ${columns} FROM public.report_jobs
      WHERE company_id=$1 AND requested_by=$2 AND kind='REPORT' AND ($3::text IS NULL OR id=$3)
      ORDER BY created_at DESC,id DESC LIMIT 100`, [company,user,id]);
  return rows.rows.map(toPublic);
}
/** RLS AND ownership: neither another tenant's jobs nor another requester's are visible. */
export function listReportJobs(pool: Pool, company: string, user: string) {
  return withCompany(pool, companyId(company), client => read(client, company, user, null));
}
export async function getReportJob(pool: Pool, company: string, user: string, id: string) {
  const rows = await withCompany(pool, companyId(company), client => read(client, company, user, id));
  return rows[0] ?? null;
}
