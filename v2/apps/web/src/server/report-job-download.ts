import type { Pool } from "pg";
import { companyId, withCompany } from "@gradix/db";
import { isReportKey } from "@gradix/domain";
import { resolveReportJobActor } from "./report-job-actor";
import { coversGeneratedAccess, parseGeneratedAccess } from "./report-job-permissions";
import { attachmentDownloadUrl } from "./attachment-service";
import { writeAudit } from "./audit";

/** Only the requester can download, and only while every right used by the file remains. */
export async function reportJobDownload(pool:Pool, company:string, user:string, jobId:string) {
  const authorized=await withCompany(pool,companyId(company),async client=>{
    const result=await client.query<{report_key:string;params:unknown;attachment_id:string}>(
      `SELECT r.report_key,r.params,r.attachment_id FROM public.report_jobs r
        JOIN public.attachments a ON a.company_id=r.company_id AND a.id=r.attachment_id
       WHERE r.company_id=$1 AND r.id=$2 AND r.requested_by=$3 AND r.kind='REPORT' AND r.status='DONE'
         AND a.entity_type='REPORT_JOB' AND a.entity_id=r.id AND a.status='ready' AND a.created_by=$3`,
      [company,jobId,user]);
    const row=result.rows[0];
    if (!row || !isReportKey(row.report_key) || !row.params || typeof row.params !== "object" || Array.isArray(row.params)) return null;
    const actor=await resolveReportJobActor(client,company,user,row.report_key,row.params);
    const generated=parseGeneratedAccess((row.params as Record<string,unknown>).generatedAccess);
    if (!actor || !generated || !coversGeneratedAccess(generated,actor)) return null;
    await writeAudit(client,{companyId:company,actorId:user,actorEmail:null,action:"report.exported",
      entityType:"report_job",entityId:jobId,retentionClass:"ACCESS",metadata:{attachmentId:row.attachment_id}});
    return row.attachment_id;
  });
  if (!authorized) return {code:"NOT_FOUND" as const,message:"Izvještaj nije dostupan."};
  return attachmentDownloadUrl(pool,company,authorized);
}
