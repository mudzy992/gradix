import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client, Pool } from "pg";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getReportJob, listReportJobs } from "./report-job-read";
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
  it("POST dodatno zahtijeva export.data", async () => {
    vi.mocked(guard).mockResolvedValueOnce({ok:true,ctx:{userId:"rj-u",companyId:"rj-a",roles:["WORKER"]}} as never);
    const request=new NextRequest("http://localhost/api/report-jobs",{method:"POST",body:JSON.stringify({
      key:"HSE",format:"pdf",from:"2026-01-01",to:"2026-01-31",
    })});
    expect((await POST(request)).status).toBe(403);
    expect(await listReportJobs(app,"rj-a","rj-u")).toHaveLength(1);
  });
  it("POST ostaje zatvoren dok nema workera — ne stvara izgubljen posao", async () => {
    const body={key:"HSE",format:"pdf",from:"2026-01-01",to:"2026-01-31"};
    const request=new NextRequest("http://localhost/api/report-jobs",{method:"POST",body:JSON.stringify(body)});
    expect((await POST(request)).status).toBe(409);
    expect(await listReportJobs(app,"rj-a","rj-u")).toHaveLength(1);
    const invalid=new NextRequest("http://localhost/api/report-jobs",{method:"POST",body:JSON.stringify({...body,team:"x\u0000"})});
    expect((await POST(invalid)).status).toBe(400);
  });
});
