import type { Pool, PoolClient } from "pg";
import { companyId, withCompany, withCompanyTransactionContext } from "@gradix/db";
import { isReportKey } from "@gradix/domain";
import { resolveReportJobActor } from "./report-job-actor";
import { loadReport } from "./report-service";
import { renderReportPdf, renderReportXlsx } from "./report-render";
import { notify } from "./notification-service";
import { NOTIFICATION_HREFS } from "./notification-hrefs";
import { can, PERMISSION_KEYS } from "./permissions";

type StoredReport = {attachmentId:string};
/** The adapter must persist and confirm a REPORT_JOB attachment before returning. */
export type ReportStore = (input: {client:PoolClient;companyId:string;jobId:string;userId:string;
  format:"PDF"|"XLSX";bytes:Uint8Array}) => Promise<StoredReport>;
type Job = { id:string;report_key:string;format:string;requested_by:string | null;params:unknown;
  from:string;to:string;status:string };

/**
 * One row lock serializes duplicate deliveries. Readers run under one tenant transaction;
 * errors roll it back and a separate transaction marks a still-QUEUED row failed safely.
 * The server-generated attachment adapter persists a pending marker before S3 upload.
 */
export async function executeReportJob(pool: Pool, company: string, jobId: string, store: ReportStore): Promise<"DONE"|"FAILED"|"IGNORED"> {
  try {
    return await withCompanyTransactionContext(pool,companyId(company),async client=>{
      const rows=await client.query<Job>(`SELECT id,report_key,format,requested_by,params,status,
        period_from::text AS "from",period_to::text AS "to" FROM public.report_jobs
        WHERE company_id=$1 AND id=$2 AND kind='REPORT' FOR UPDATE`,[company,jobId]);
      const job=rows.rows[0];
      if (!job || job.status !== "QUEUED") return "IGNORED";
      if (!job.requested_by || !isReportKey(job.report_key) || (job.format !== "PDF" && job.format !== "XLSX"))
        throw new Error("REPORT_REQUEST_INVALID");
      const actor=await resolveReportJobActor(client,company,job.requested_by,job.report_key,job.params);
      if (!actor) throw new Error("REPORT_FORBIDDEN");
      const params=job.params as Record<string,unknown>;
      if ((params.projectId != null && typeof params.projectId !== "string") ||
          (params.team != null && typeof params.team !== "string")) throw new Error("REPORT_REQUEST_INVALID");
      const filters={from:job.from,to:job.to,
        ...(typeof params.projectId === "string" ? {projectId:params.projectId} : {}),
        ...(typeof params.team === "string" ? {team:params.team} : {})};
      const doc=await loadReport(pool,{...actor,roles:[...actor.roles]},job.report_key,filters);
      const bytes=job.format === "PDF" ? renderReportPdf(doc) : await renderReportXlsx(doc);
      const stored=await store({client,companyId:company,jobId,userId:job.requested_by,format:job.format,bytes});
      const contentType=job.format === "PDF" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      const attachment=await client.query(`SELECT 1 FROM public.attachments WHERE company_id=$1 AND id=$2
        AND entity_type='REPORT_JOB' AND entity_id=$3 AND created_by=$4 AND status='ready' AND content_type=$5`,
      [company,stored.attachmentId,jobId,job.requested_by,contentType]);
      if (!attachment.rowCount) throw new Error("REPORT_ATTACHMENT_INVALID");
      const updated=await client.query(`UPDATE public.report_jobs SET status='DONE',completed_at=clock_timestamp(),
        attachment_id=$3,attempts=attempts+1,last_error=NULL,
        params=params || jsonb_build_object('generatedAccess',$4::jsonb)
        WHERE company_id=$1 AND id=$2 AND status='QUEUED'`,
      [company,jobId,stored.attachmentId,JSON.stringify({roles:actor.roles,scope:actor.scope,projectIds:actor.projectIds,
        permissions:PERMISSION_KEYS.filter(permission=>can(actor.roles,permission))})]);
      if (updated.rowCount !== 1) throw new Error("REPORT_STATE_CHANGED");
      const notice=await notify(client,company,{kind:"report.ready",userId:job.requested_by,
        title:"Izvještaj je spreman",body:"Završena je obrada vašeg izvještaja.",
        href:NOTIFICATION_HREFS.reportJobReady,sourceType:"report_job",sourceId:jobId,dedupeKey:`report-job:${jobId}`});
      if (notice.outcome === "VALIDATION_FAILED") throw new Error("REPORT_NOTICE_INVALID");
      return "DONE";
    });
  } catch (error) {
    const code=error instanceof Error ? error.message : "";
    const message=code === "REPORT_FORBIDDEN" ? "Pravo pristupa izvještaju više nije dostupno." :
      code === "REPORT_TOO_LARGE" ? "Izvještaj prelazi trenutno dozvoljenu veličinu." :
      code === "REPORT_MIXED_CURRENCY" ? "Izvještaj sadrži neusaglašene valute." :
      "Izvještaj nije moguće generisati. Pokušajte ponovo ili kontaktirajte podršku.";
    await withCompany(pool,companyId(company),async client=>{
      await client.query(`UPDATE public.report_jobs SET status='FAILED',last_error=$3,attempts=attempts+1
        WHERE company_id=$1 AND id=$2 AND kind='REPORT' AND status='QUEUED'`,[company,jobId,message]);
    });
    return "FAILED";
  }
}
