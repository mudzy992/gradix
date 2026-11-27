import type { Pool } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import { listActiveCompanyIds } from "./company-ids";

export const REPORT_JOB_QUEUE = "report_jobs";
type Send = (name: string, data: {companyId: string; jobId: string},
  options: {singletonKey: string; singletonSeconds: number}) => Promise<string | null>;

/**
 * Outbox relay. A committed QUEUED row is the source of truth, not the return value of send.
 * Repeated scans recover a crash before/during delivery even when the boss database is separate.
 * Delivery may be duplicated: the eventual handler MUST lock and claim the row idempotently.
 * Payload contains only identifiers. The handler locks each report row before processing.
 */
export async function dispatchReportJobs(pool: Pool, send: Send, options: {onlyCompanyId?: string; limit?: number} = {}) {
  const result={companies:0,examined:0,sent:0};
  const limit=Math.min(Math.max(options.limit ?? 100,1),1000);
  for (const companyId of await listActiveCompanyIds(pool,options.onlyCompanyId)) {
    const jobs=await withCompany(pool,toCompanyId(companyId),async client => {
      const rows=await client.query<{id:string}>(`SELECT id FROM public.report_jobs
        WHERE company_id=$1 AND kind='REPORT' AND status='QUEUED'
        ORDER BY coalesce(last_dispatched_at,created_at),created_at,id LIMIT $2`,[companyId,limit]);
      return rows.rows;
    });
    result.companies++;
    for (const job of jobs) {
      result.examined++;
      const queued=await send(REPORT_JOB_QUEUE,{companyId,jobId:job.id},
        {singletonKey:`${companyId}:${job.id}`,singletonSeconds:60});
      if (queued) result.sent++;
      // Rotate even on pg-boss dedupe: it means a recent delivery already exists. If the
      // process crashes before this update the row remains eligible, so delivery is retried.
      await withCompany(pool,toCompanyId(companyId),async client=>{
        await client.query(`UPDATE public.report_jobs SET last_dispatched_at=clock_timestamp()
          WHERE company_id=$1 AND id=$2 AND kind='REPORT' AND status='QUEUED'`,[companyId,job.id]);
      });
    }
  }
  return result;
}
