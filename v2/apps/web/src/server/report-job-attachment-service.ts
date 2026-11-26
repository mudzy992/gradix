import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { companyId, setTenant } from "@gradix/db";
import { HeadObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import type { ReportStore } from "./report-job-execution";

const XLSX="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAX_REPORT_BYTES=100 * 1024 * 1024;
type Storage={client:S3Client;bucket:string};

/**
 * Server-only attachment lifecycle. A pending DB row is committed BEFORE S3 upload, so even
 * a crash after PUT leaves a discoverable object for the existing 24h pending purge. The
 * caller's locked job transaction confirms the attachment and job atomically afterwards.
 */
export function createReportAttachmentStore(pool:Pool, storage:Storage): ReportStore {
  return async ({client,companyId:company,jobId,userId,format,bytes})=>{
    const header=Buffer.from(bytes.subarray(0,5));
    if (!bytes.length || bytes.length > MAX_REPORT_BYTES ||
      (format === "PDF" ? header.toString() !== "%PDF-" : !header.subarray(0,4).equals(Buffer.from([0x50,0x4b,0x03,0x04]))))
      throw new Error("REPORT_ATTACHMENT_INVALID");
    const sha=createHash("sha256").update(bytes).digest("hex");
    const contentType=format === "PDF" ? "application/pdf" : XLSX;
    const proposed=`att_${randomUUID()}`;
    const key=`gx2/${company}/report-job/${jobId}/${proposed}`;
    // Deliberately a separate explicit transaction, not withCompany: the job transaction's
    // row lock must stay open, while this pending marker must survive its rollback/crash.
    const pending=await pool.connect();
    let id:string, objectKey:string;
    try {
      await pending.query("BEGIN"); await setTenant(pending,companyId(company));
      await pending.query(`INSERT INTO public.attachments
        (id,company_id,entity_type,entity_id,object_key,file_name,content_type,size_bytes,sha256,status,created_by)
        VALUES ($1,$2,'REPORT_JOB',$3,$4,$5,$6,$7,$8,'pending',$9)
        ON CONFLICT (company_id,entity_type,entity_id,sha256) DO NOTHING`,
      [proposed,company,jobId,key,`izvjestaj.${format.toLowerCase()}`,contentType,bytes.length,sha,userId]);
      const found=await pending.query<{id:string;object_key:string;status:string;size_bytes:string;content_type:string;created_by:string}>(
        `SELECT id,object_key,status,size_bytes,content_type,created_by FROM public.attachments
          WHERE company_id=$1 AND entity_type='REPORT_JOB' AND entity_id=$2 AND sha256=$3 FOR UPDATE`,[company,jobId,sha]);
      const row=found.rows[0];
      if (!row || row.status !== "pending" || Number(row.size_bytes) !== bytes.length || row.content_type !== contentType || row.created_by !== userId)
        throw new Error("REPORT_ATTACHMENT_CONFLICT");
      id=row.id; objectKey=row.object_key;
      await pending.query("COMMIT");
    } catch(error) { await pending.query("ROLLBACK").catch(()=>undefined); throw error; }
    finally { pending.release(); }
    await storage.client.send(new PutObjectCommand({Bucket:storage.bucket,Key:objectKey,Body:bytes,ContentType:contentType}));
    const head=await storage.client.send(new HeadObjectCommand({Bucket:storage.bucket,Key:objectKey}));
    if (head.ContentLength !== bytes.length || head.ContentType !== contentType) throw new Error("REPORT_ATTACHMENT_MISMATCH");
    const updated=await client.query(`UPDATE public.attachments SET status='ready',uploaded_at=clock_timestamp()
      WHERE company_id=$1 AND id=$2 AND entity_type='REPORT_JOB' AND entity_id=$3 AND status='pending'`,[company,id,jobId]);
    if (updated.rowCount !== 1) throw new Error("REPORT_ATTACHMENT_CONFLICT");
    return {attachmentId:id};
  };
}
