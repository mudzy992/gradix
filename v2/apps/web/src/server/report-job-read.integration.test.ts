import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client, Pool } from "pg";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getReportJob, listReportJobs } from "./report-job-read";
import { createReportJob } from "./report-job-create";
import { resolveReportJobActor } from "./report-job-actor";
import { companyId, withCompany } from "@gradix/db";
import { guard } from "./guard";
import { getVerifiedPool } from "./db";
import { GET, POST } from "../app/api/report-jobs/route";
import { GET as GET_ID } from "../app/api/report-jobs/[id]/route";

vi.mock("./guard", () => ({guard:vi.fn()}));
vi.mock("./db", () => ({getVerifiedPool:vi.fn()}));
const adminUrl=process.env.DATABASE_ADMIN_URL, appUrl=process.env.DATABASE_URL;
const run=adminUrl && appUrl ? describe : describe.skip;
const name=`report_jobs_${process.pid}_${Date.now()}`;
const rootUrl=new URL(adminUrl ?? "postgresql://localhost/postgres"); rootUrl.pathname="/postgres";
const dbUrl=new URL(rootUrl); dbUrl.pathname=`/${name}`;
const runtimeUrl=new URL(appUrl ?? "postgresql://localhost/postgres"); runtimeUrl.pathname=`/${name}`;
const migrations=fileURLToPath(new URL("../../../../packages/db/migrations",import.meta.url));

run("report jobs — vlasništvo i tenant izolacija", () => {
  const root=new Client(rootUrl.toString()), admin=new Client(dbUrl.toString());
  const app=new Pool({connectionString:runtimeUrl.toString()});
  beforeAll(async () => {
    await root.connect(); await root.query(`CREATE DATABASE ${name}`); await admin.connect();
    await admin.query(readFileSync(fileURLToPath(new URL("../../../../packages/db/bootstrap/roles.sql",import.meta.url)),"utf8"));
    for (const dir of readdirSync(migrations).sort()) await admin.query(readFileSync(`${migrations}/${dir}/migration.sql`,"utf8"));
    await admin.query(readFileSync(fileURLToPath(new URL("../../../../packages/db/bootstrap/grants.sql",import.meta.url)),"utf8"));
    await admin.query("INSERT INTO public.companies(id,name,slug) VALUES ('rj-a','A','rj-a'),('rj-b','B','rj-b')");
    await admin.query(`INSERT INTO public.users(id,email,first_name,last_name,password_hash) VALUES
      ('rj-u','rj-u@example.test','A','B','x'),('rj-v','rj-v@example.test','A','B','x')`);
    await admin.query("INSERT INTO public.projects(id,company_id,code,name) VALUES ('rj-pa','rj-a','A','A'),('rj-pb','rj-b','B','B')");
    await admin.query(`INSERT INTO public.report_jobs(id,company_id,requested_by,kind,report_key,format,period_from,period_to,params)
      VALUES ('rj-own','rj-a','rj-u','REPORT','HSE','PDF','2026-01-01','2026-01-31','{"private":"secret"}'),
      ('rj-other','rj-a','rj-v','REPORT','FUEL','XLSX','2026-01-01','2026-01-31','{}'),
      ('rj-tenant','rj-b','rj-u','REPORT','TENDERS','PDF','2026-01-01','2026-01-31','{}')`);
    vi.mocked(getVerifiedPool).mockResolvedValue(app);
    vi.mocked(guard).mockResolvedValue({ok:true,ctx:{userId:"rj-u",companyId:"rj-a",roles:["OWNER"]}} as never);
  },120_000);
  afterAll(async () => { await app.end(); await admin.end(); await root.query(`DROP DATABASE IF EXISTS ${name}`); await root.end(); });

  it("lista i detalj ne izlažu drugog naručioca, drugu firmu ni interne parametre", async () => {
    expect(await listReportJobs(app,"rj-a","rj-u")).toEqual([expect.objectContaining({id:"rj-own",key:"HSE",status:"QUEUED"})]);
    expect(await getReportJob(app,"rj-a","rj-u","rj-other")).toBeNull();
    expect(await getReportJob(app,"rj-a","rj-u","rj-tenant")).toBeNull();
    expect(JSON.stringify(await getReportJob(app,"rj-a","rj-u","rj-own"))).not.toContain("secret");
    const list=await GET(new NextRequest("http://localhost/api/report-jobs"));
    expect((await list.json()).data.jobs).toHaveLength(1);
    const other=await GET_ID(new NextRequest("http://localhost/api/report-jobs/rj-other"),{params:Promise.resolve({id:"rj-other"})});
    expect(other.status).toBe(404);
    const nul=await GET_ID(new NextRequest("http://localhost/api/report-jobs/x"),{params:Promise.resolve({id:"x\u0000"})});
    expect(nul.status).toBe(400);
  });
  it("kreiranje priprema trajni red sa sigurnim snapshotom i provjerava izvore i scope", async () => {
    const actor={companyId:"rj-a",userId:"rj-u",roles:["PROJECT_MANAGER"],scope:"PROJECTS" as const,projectIds:["rj-pa"]};
    const input={key:"PROJECT_COSTS" as const,format:"pdf" as const,from:"2026-01-01",to:"2026-01-31",projectId:"rj-pa"};
    expect(await createReportJob(app,{...actor,roles:["WORKER"]},input)).toMatchObject({ok:false,code:"FORBIDDEN"});
    expect(await createReportJob(app,actor,{...input,projectId:"rj-pb"})).toMatchObject({ok:false,code:"FORBIDDEN"});
    expect(await createReportJob(app,actor,{...input,to:"2026-02-30"})).toMatchObject({ok:false,code:"VALIDATION_FAILED"});
    expect(await createReportJob(app,actor,{...input,team:"Sjever"})).toMatchObject({ok:false,code:"VALIDATION_FAILED"});
    expect(await createReportJob(app,{...actor,scope:"COMPANY",projectIds:null},{...input,projectId:"rj-pb"}))
      .toMatchObject({ok:false,code:"VALIDATION_FAILED"});
    const result=await createReportJob(app,actor,input);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("job was not created");
    const row=await admin.query("SELECT company_id,status,params FROM public.report_jobs WHERE id=$1",[result.id]);
    expect(row.rows[0]).toMatchObject({company_id:"rj-a",status:"QUEUED",params:{projectId:"rj-pa",requestedScope:"PROJECTS",
      requestedProjectIds:["rj-pa"],requestedRoles:["PROJECT_MANAGER"]}});
    expect(await getReportJob(app,"rj-b","rj-u",result.id)).toBeNull();
    expect(await getReportJob(app,"rj-a","rj-v",result.id)).toBeNull();
  });
  it("obrađivač ponovo provjerava članstvo i dodjele, nikad ne širi prava naručioca", async () => {
    await admin.query("UPDATE public.users SET must_change_password=false WHERE id='rj-u'");
    await admin.query(`INSERT INTO public.memberships(id,company_id,user_id,roles,scope) VALUES
      ('rj-m','rj-a','rj-u',ARRAY['PROJECT_MANAGER']::"Role"[],'PROJECTS')`);
    await admin.query("INSERT INTO public.workers(id,company_id,user_id,first_name,last_name,hired_at) VALUES ('rj-w','rj-a','rj-u','A','B','2020-01-01')");
    await admin.query("INSERT INTO public.project_assignments(id,company_id,project_id,worker_id,from_date,created_by) VALUES ('rj-as','rj-a','rj-pa','rj-w','2020-01-01','rj-u')");
    const params={projectId:"rj-pa",requestedRoles:["PROJECT_MANAGER"],requestedScope:"PROJECTS",requestedProjectIds:["rj-pa"]};
    const resolve=()=>withCompany(app,companyId("rj-a"),client=>resolveReportJobActor(client,"rj-a","rj-u","PROJECT_COSTS",params));
    expect(await resolve()).toMatchObject({roles:["PROJECT_MANAGER"],scope:"PROJECTS",projectIds:["rj-pa"]});
    expect(await withCompany(app,companyId("rj-b"),client=>resolveReportJobActor(client,"rj-a","rj-u","PROJECT_COSTS",params))).toBeNull();
    await admin.query(`UPDATE public.memberships SET roles=ARRAY['OWNER']::"Role"[] WHERE id='rj-m'`);
    expect(await resolve()).toBeNull();
    await admin.query(`UPDATE public.memberships SET roles=ARRAY['PROJECT_MANAGER']::"Role"[] WHERE id='rj-m'`);
    await admin.query("UPDATE public.project_assignments SET voided_at=now(),voided_by='rj-u',void_reason='Ukidanje dodjele' WHERE id='rj-as'");
    expect(await resolve()).toBeNull();
    await admin.query("UPDATE public.memberships SET is_active=false WHERE id='rj-m'");
    expect(await resolve()).toBeNull();
  });
  it("POST dodatno zahtijeva export.data", async () => {
    vi.mocked(guard).mockResolvedValueOnce({ok:true,ctx:{userId:"rj-u",companyId:"rj-a",roles:["WORKER"]}} as never);
    const request=new NextRequest("http://localhost/api/report-jobs",{method:"POST",body:JSON.stringify({
      key:"HSE",format:"pdf",from:"2026-01-01",to:"2026-01-31",
    })});
    expect((await POST(request)).status).toBe(403);
    expect(await listReportJobs(app,"rj-a","rj-u")).toHaveLength(2);
  });
  it("POST ostaje zatvoren dok nema workera — ne stvara izgubljen posao", async () => {
    const body={key:"HSE",format:"pdf",from:"2026-01-01",to:"2026-01-31"};
    const request=new NextRequest("http://localhost/api/report-jobs",{method:"POST",body:JSON.stringify(body)});
    expect((await POST(request)).status).toBe(409);
    expect(await listReportJobs(app,"rj-a","rj-u")).toHaveLength(2);
    const invalid=new NextRequest("http://localhost/api/report-jobs",{method:"POST",body:JSON.stringify({...body,team:"x\u0000"})});
    expect((await POST(invalid)).status).toBe(400);
  });
});
