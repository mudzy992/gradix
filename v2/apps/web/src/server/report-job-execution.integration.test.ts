import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { REPORT_DEFINITIONS, type ReportKey } from "@gradix/domain";
import { createReportJob } from "./report-job-create";
import { executeReportJob, type ReportStore } from "./report-job-execution";
import { createReportAttachmentStore } from "./report-job-attachment-service";
import { reportJobDownload } from "./report-job-download";
import { type HeadObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";

const adminUrl=process.env.DATABASE_ADMIN_URL, appUrl=process.env.DATABASE_URL;
const run=adminUrl && appUrl ? describe : describe.skip;
const name=`report_run_${process.pid}_${Date.now()}`;
const rootUrl=new URL(adminUrl ?? "postgresql://localhost/postgres"); rootUrl.pathname="/postgres";
const dbUrl=new URL(rootUrl); dbUrl.pathname=`/${name}`;
const runtimeUrl=new URL(appUrl ?? "postgresql://localhost/postgres"); runtimeUrl.pathname=`/${name}`;
const migrations=fileURLToPath(new URL("../../../../packages/db/migrations",import.meta.url));

run("izvršavanje report joba u tenant transakciji", () => {
  const root=new Client(rootUrl.toString()), admin=new Client(dbUrl.toString());
  const app=new Pool({connectionString:runtimeUrl.toString(),max:5});
  const actor={companyId:"a",userId:"u",roles:["OWNER"],scope:"COMPANY" as const,projectIds:null};
  let uploads=0;
  const store:ReportStore=async ({client,companyId,jobId,userId,format,bytes})=>{
    uploads++;
    expect(Buffer.from(bytes).subarray(0,format === "PDF" ? 5 : 2).toString()).toBe(format === "PDF" ? "%PDF-" : "PK");
    const id=`att_${randomUUID()}`;
    await client.query(`INSERT INTO public.attachments(id,company_id,entity_type,entity_id,object_key,file_name,
      content_type,size_bytes,sha256,status,uploaded_at,created_by)
      VALUES ($1,$2,'REPORT_JOB',$3,$4,'report',$5,$6,$7,'ready',now(),$8)`,[id,companyId,jobId,`fake/${id}`,
      format === "PDF" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes.length,createHash("sha256").update(bytes).digest("hex"),userId]);
    return {attachmentId:id};
  };
  beforeAll(async () => {
    await root.connect(); await root.query(`CREATE DATABASE ${name}`); await admin.connect();
    await admin.query(readFileSync(fileURLToPath(new URL("../../../../packages/db/bootstrap/roles.sql",import.meta.url)),"utf8"));
    for (const dir of readdirSync(migrations).sort()) await admin.query(readFileSync(`${migrations}/${dir}/migration.sql`,"utf8"));
    await admin.query(readFileSync(fileURLToPath(new URL("../../../../packages/db/bootstrap/grants.sql",import.meta.url)),"utf8"));
    await admin.query("INSERT INTO public.companies(id,name,slug) VALUES ('a','A','run-a'),('b','B','run-b')");
    await admin.query("INSERT INTO public.users(id,email,first_name,last_name,password_hash,must_change_password) VALUES ('u','run@example.test','A','B','x',false)");
    await admin.query(`INSERT INTO public.memberships(id,company_id,user_id,roles,scope) VALUES ('m','a','u',ARRAY['OWNER']::"Role"[],'COMPANY')`);
    await admin.query("INSERT INTO public.projects(id,company_id,code,name) VALUES ('p','a','P','P'),('pb','b','PB','PB')");
  },120_000);
  afterAll(async () => { await app.end(); await admin.end(); await root.query(`DROP DATABASE IF EXISTS ${name}`); await root.end(); });
  it("sedam izvora u oba formata, duple isporuke i obavještenja", async () => {
    for (const key of Object.keys(REPORT_DEFINITIONS) as ReportKey[]) {
      for (const format of ["pdf","xlsx"] as const) {
        const result=await createReportJob(app,actor,{key,format,from:"2026-01-01",to:"2026-01-31"});
        if (!result.ok) throw new Error("cannot create fixture");
        expect(await executeReportJob(app,"b",result.id,store)).toBe("IGNORED");
        expect(await Promise.all([executeReportJob(app,"a",result.id,store),executeReportJob(app,"a",result.id,store)]))
          .toEqual(expect.arrayContaining(["DONE","IGNORED"]));
        const job=await admin.query("SELECT status,attachment_id,params->'generatedAccess' AS access FROM public.report_jobs WHERE id=$1",[result.id]);
        expect(job.rows[0]).toMatchObject({status:"DONE",attachment_id:expect.any(String),access:{roles:["OWNER"],scope:"COMPANY",projectIds:null}});
        const notice=await admin.query(`SELECT n.href,n.user_id,d.status FROM public.notifications n JOIN public.notification_deliveries d
          ON d.notification_id=n.id AND d.channel='IN_APP' WHERE n.company_id='a' AND n.dedupe_key=$1`,[`report-job:${result.id}`]);
        expect(notice.rows).toEqual([{href:"/pregled",user_id:"u",status:"SENT"}]);
      }
    }
    expect(uploads).toBe(14);
  },60_000);
  it("S3 adapter prvo bilježi pending, potvrđuje veličinu i uvezuje gotov prilog", async () => {
    const objects=new Map<string,{body:Uint8Array;type:string}>();
    let wrongSize=false;
    const s3={send:async (command:PutObjectCommand | HeadObjectCommand)=>{
      if (command instanceof PutObjectCommand) {
        const input=command.input;
        const pending=await admin.query("SELECT status FROM public.attachments WHERE company_id='a' AND object_key=$1",[input.Key]);
        expect(pending.rows).toEqual([{status:"pending"}]);
        objects.set(input.Key!,{body:input.Body as Uint8Array,type:input.ContentType!}); return {};
      }
      const object=objects.get(command.input.Key!); if (!object) throw new Error("missing");
      return {ContentLength:object.body.length + (wrongSize ? 1 : 0),ContentType:object.type};
    }} as unknown as S3Client;
    const actualStore=createReportAttachmentStore(app,{client:s3,bucket:"reports"});
    const input={key:"HSE" as const,format:"xlsx" as const,from:"2026-01-01",to:"2026-01-31"};
    const first=await createReportJob(app,actor,input); if (!first.ok) throw new Error("fixture");
    expect(await executeReportJob(app,"a",first.id,actualStore)).toBe("DONE");
    const saved=await admin.query(`SELECT a.status,a.content_type,a.object_key FROM public.report_jobs r JOIN public.attachments a
      ON a.company_id=r.company_id AND a.id=r.attachment_id WHERE r.company_id='a' AND r.id=$1`,[first.id]);
    expect(saved.rows[0]).toMatchObject({status:"ready",content_type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
    expect(objects.has(saved.rows[0].object_key)).toBe(true);
    wrongSize=true;
    const second=await createReportJob(app,actor,input); if (!second.ok) throw new Error("fixture");
    expect(await executeReportJob(app,"a",second.id,actualStore)).toBe("FAILED");
    const pending=await admin.query("SELECT status FROM public.attachments WHERE company_id='a' AND entity_type='REPORT_JOB' AND entity_id=$1",[second.id]);
    expect(pending.rows).toEqual([{status:"pending"}]);
  });
  it("download nakon promjene prava i firme ostaje zatvoren", async () => {
    const first=await createReportJob(app,actor,{key:"HSE",format:"pdf",from:"2026-01-01",to:"2026-01-31"});
    if (!first.ok) throw new Error("fixture");
    expect(await executeReportJob(app,"a",first.id,store)).toBe("DONE");
    vi.stubEnv("MINIO_ENDPOINT","http://localhost:9000"); vi.stubEnv("MINIO_PUBLIC_ENDPOINT","http://localhost:9000");
    vi.stubEnv("MINIO_ACCESS_KEY","testkey"); vi.stubEnv("MINIO_SECRET_KEY","testsecret");
    try {
      expect(await reportJobDownload(app,"b","u",first.id)).toMatchObject({code:"NOT_FOUND"});
      expect(await reportJobDownload(app,"a","not-owner",first.id)).toMatchObject({code:"NOT_FOUND"});
      const link=await reportJobDownload(app,"a","u",first.id);
      expect(link).toMatchObject({url:expect.stringContaining("X-Amz-Signature="),expiresAt:expect.any(String)});
      await admin.query(`UPDATE public.memberships SET roles=ARRAY['PROJECT_MANAGER']::"Role"[] WHERE id='m'`);
      expect(await reportJobDownload(app,"a","u",first.id)).toMatchObject({code:"NOT_FOUND"});
      await admin.query(`UPDATE public.memberships SET roles=ARRAY['OWNER']::"Role"[],scope='PROJECTS' WHERE id='m'`);
      expect(await reportJobDownload(app,"a","u",first.id)).toMatchObject({code:"NOT_FOUND"});
      await admin.query("UPDATE public.memberships SET scope='COMPANY' WHERE id='m'");
      await admin.query("UPDATE public.users SET is_active=false WHERE id='u'");
      expect(await reportJobDownload(app,"a","u",first.id)).toMatchObject({code:"NOT_FOUND"});
      await admin.query("UPDATE public.users SET is_active=true WHERE id='u'");
      await admin.query("UPDATE public.report_jobs SET params=params || '{\"generatedAccess\":null}'::jsonb WHERE id=$1",[first.id]);
      expect(await reportJobDownload(app,"a","u",first.id)).toMatchObject({code:"NOT_FOUND"});
    } finally { vi.unstubAllEnvs(); }
  });
  it("download odbija opozvanu projektnu dodjelu", async () => {
    await admin.query("INSERT INTO public.users(id,email,first_name,last_name,password_hash,must_change_password) VALUES ('pm','pmrun@example.test','P','M','x',false)");
    await admin.query(`INSERT INTO public.memberships(id,company_id,user_id,roles,scope) VALUES ('pm-m','a','pm',ARRAY['PROJECT_MANAGER']::"Role"[],'PROJECTS')`);
    await admin.query("INSERT INTO public.workers(id,company_id,user_id,first_name,last_name,hired_at) VALUES ('pm-w','a','pm','P','M','2020-01-01')");
    await admin.query("INSERT INTO public.project_assignments(id,company_id,project_id,worker_id,from_date,created_by) VALUES ('pm-as','a','p','pm-w','2020-01-01','pm')");
    const pm={companyId:"a",userId:"pm",roles:["PROJECT_MANAGER"],scope:"PROJECTS" as const,projectIds:["p"]};
    const job=await createReportJob(app,pm,{key:"PROJECT_COSTS",format:"pdf",from:"2026-01-01",to:"2026-01-31",projectId:"p"});
    if (!job.ok) throw new Error("fixture");
    expect(await executeReportJob(app,"a",job.id,store)).toBe("DONE");
    vi.stubEnv("MINIO_ENDPOINT","http://localhost:9000"); vi.stubEnv("MINIO_PUBLIC_ENDPOINT","http://localhost:9000");
    vi.stubEnv("MINIO_ACCESS_KEY","testkey"); vi.stubEnv("MINIO_SECRET_KEY","testsecret");
    try {
      expect(await reportJobDownload(app,"a","pm",job.id)).toMatchObject({url:expect.any(String)});
      await admin.query("UPDATE public.project_assignments SET voided_at=now(),voided_by='pm',void_reason='Završena dodjela' WHERE id='pm-as'");
      expect(await reportJobDownload(app,"a","pm",job.id)).toMatchObject({code:"NOT_FOUND"});
    } finally {vi.unstubAllEnvs();}
  });
  it("promijenjena prava i greške adaptera ne cure niti se stvaraju DONE i obavještenje", async () => {
    const input={key:"HSE" as const,format:"pdf" as const,from:"2026-01-01",to:"2026-01-31"};
    const first=await createReportJob(app,actor,input); if (!first.ok) throw new Error("fixture");
    await admin.query("UPDATE public.memberships SET is_active=false WHERE id='m'");
    expect(await executeReportJob(app,"a",first.id,store)).toBe("FAILED");
    await admin.query("UPDATE public.memberships SET is_active=true WHERE id='m'");
    const second=await createReportJob(app,actor,input); if (!second.ok) throw new Error("fixture");
    expect(await executeReportJob(app,"a",second.id,async()=>{throw new Error("secret internal database detail");})).toBe("FAILED");
    const result=await admin.query("SELECT status,last_error,attachment_id FROM public.report_jobs WHERE id=$1",[second.id]);
    expect(result.rows[0]).toMatchObject({status:"FAILED",attachment_id:null});
    expect(result.rows[0].last_error).not.toContain("secret");
    expect((await admin.query("SELECT 1 FROM public.notifications WHERE company_id='a' AND dedupe_key=$1",[`report-job:${second.id}`])).rowCount).toBe(0);
  });
});
