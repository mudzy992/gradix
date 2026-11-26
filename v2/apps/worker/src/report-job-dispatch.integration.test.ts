import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client, Pool } from "pg";
import PgBoss from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dispatchReportJobs, REPORT_JOB_QUEUE } from "./report-job-dispatch";

const adminUrl=process.env.DATABASE_ADMIN_URL, appUrl=process.env.DATABASE_URL;
const run=adminUrl && appUrl ? describe : describe.skip;
const name=`report_dispatch_${process.pid}_${Date.now()}`;
const rootUrl=new URL(adminUrl ?? "postgresql://localhost/postgres"); rootUrl.pathname="/postgres";
const dbUrl=new URL(rootUrl); dbUrl.pathname=`/${name}`;
const runtimeUrl=new URL(appUrl ?? "postgresql://localhost/postgres"); runtimeUrl.pathname=`/${name}`;
const migrations=fileURLToPath(new URL("../../../packages/db/migrations",import.meta.url));

run("report jobs — outbox relay", () => {
  const root=new Client(rootUrl.toString()), admin=new Client(dbUrl.toString());
  const app=new Pool({connectionString:runtimeUrl.toString()});
  beforeAll(async () => {
    await root.connect(); await root.query(`CREATE DATABASE ${name}`); await admin.connect();
    await admin.query(readFileSync(fileURLToPath(new URL("../../../packages/db/bootstrap/roles.sql",import.meta.url)),"utf8"));
    for (const dir of readdirSync(migrations).sort()) await admin.query(readFileSync(`${migrations}/${dir}/migration.sql`,"utf8"));
    await admin.query(readFileSync(fileURLToPath(new URL("../../../packages/db/bootstrap/grants.sql",import.meta.url)),"utf8"));
    await admin.query("INSERT INTO public.companies(id,name,slug,is_active) VALUES ('a','A','dispatch-a',true),('b','B','dispatch-b',true),('off','C','dispatch-off',false)");
    await admin.query(`INSERT INTO public.report_jobs(id,company_id,kind,report_key,format,period_from,period_to)
      VALUES ('job-a','a','REPORT','HSE','PDF','2026-01-01','2026-01-31'),
      ('job-b','b','REPORT','HSE','PDF','2026-01-01','2026-01-31'),
      ('job-off','off','REPORT','HSE','PDF','2026-01-01','2026-01-31')`);
  },120_000);
  afterAll(async () => { await app.end(); await admin.end(); await root.query(`DROP DATABASE IF EXISTS ${name}`); await root.end(); });
  it("nakon greške queue ponavlja slanje, deduplicira i obrađuje samo aktivne firme", async () => {
    const boss=new PgBoss({connectionString:dbUrl.toString(),schema:"pgboss"}); await boss.start();
    try {
      await boss.createQueue(REPORT_JOB_QUEUE);
      const send=(...args: Parameters<typeof dispatchReportJobs>[1] extends (...args: infer P) => unknown ? P : never) => boss.send(...args);
      let attempts=0;
      await expect(dispatchReportJobs(app,async (...args)=>{
        attempts++;
        if (attempts === 2) throw new Error("queue unavailable");
        return send(...args);
      })).rejects.toThrow("queue unavailable");
      expect(await dispatchReportJobs(app,send)).toEqual({companies:2,examined:2,sent:1});
      expect(await dispatchReportJobs(app,send)).toEqual({companies:2,examined:2,sent:0});
      const rows=await admin.query("SELECT data FROM pgboss.job WHERE name=$1 ORDER BY data->>'companyId'",[REPORT_JOB_QUEUE]);
      expect(rows.rows).toEqual([{data:{companyId:"a",jobId:"job-a"}},{data:{companyId:"b",jobId:"job-b"}}]);
      const saved=await admin.query("SELECT status FROM public.report_jobs ORDER BY id");
      expect(saved.rows).toEqual([{status:"QUEUED"},{status:"QUEUED"},{status:"QUEUED"}]);
    } finally { await boss.stop(); }
  },30_000);
});
