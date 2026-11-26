import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client, Pool } from "pg";
import PgBoss from "pg-boss";
import { queueHealth } from "../../web/src/server/queue-health";
import { grantQueueHealthRead } from "./queue-health-grants";
import { runScheduledReports } from "./reports-scheduled";
import { deliverNotifications } from "./notifications-deliver";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listActiveCompanyIds } from "./company-ids";
import { scanBudgetThresholds } from "./budget-thresholds";
import { scanReminders } from "./reminders-scan";
import { refreshDailyRollups } from "./rollup-nightly";
import { purgeAttachments } from "./attachments-purge";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const appUrl = process.env.DATABASE_URL;
const describeDb = adminUrl && appUrl ? describe : describe.skip;
const migrations = fileURLToPath(new URL("../../../packages/db/migrations", import.meta.url));
const database = `f11_worker_${process.pid}_${Date.now()}`;
const rootUrl = new URL(adminUrl ?? "postgresql://localhost/postgres"); rootUrl.pathname = "/postgres";
const dbUrl = new URL(rootUrl); dbUrl.pathname = `/${database}`;
const runtimeUrl = new URL(appUrl ?? "postgresql://localhost/postgres"); runtimeUrl.pathname = `/${database}`;
const logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

describeDb("worker enumeracija pod RLS", () => {
  const root = new Client(rootUrl.toString());
  const admin = new Client(dbUrl.toString());
  const app = new Pool({ connectionString: runtimeUrl.toString(), max: 2 });
  beforeAll(async () => {
    await root.connect(); await root.query(`CREATE DATABASE ${database}`); await admin.connect();
    await admin.query(readFileSync(fileURLToPath(new URL("../../../packages/db/bootstrap/roles.sql", import.meta.url)), "utf8"));
    for (const dir of readdirSync(migrations).sort()) await admin.query(readFileSync(`${migrations}/${dir}/migration.sql`, "utf8"));
    await admin.query(readFileSync(fileURLToPath(new URL("../../../packages/db/bootstrap/grants.sql", import.meta.url)), "utf8"));
    await admin.query("INSERT INTO public.companies(id,name,slug,is_active) VALUES ('worker-a','A','worker-a',true),('worker-b','B','worker-b',true),('worker-off','C','worker-off',false)");
    await admin.query("INSERT INTO public.projects(id,company_id,code,name) VALUES ('p-a','worker-a','P','A'),('p-b','worker-b','P','B')");
    await admin.query("INSERT INTO public.users(id,email,first_name,last_name,password_hash) VALUES ('u','worker-rollup@example.test','A','B','x')");
    await admin.query("INSERT INTO public.cost_categories(id,company_id,code,name) VALUES ('ca','worker-a','CA','A'),('cb','worker-b','CB','B')");
    await admin.query("INSERT INTO public.cost_entries(id,company_id,project_id,category_id,source_type,source_id,occurred_on,amount_cents,currency_code,booked_by) VALUES ('cost-a','worker-a','p-a','ca','MANUAL','a','2026-11-01',100,'BAM','u'),('cost-b','worker-b','p-b','cb','MANUAL','b','2026-11-01',250,'BAM','u')");
    await admin.query("INSERT INTO public.workers(id,company_id,first_name,last_name,hired_at) VALUES ('w','worker-a','A','B','2020-01-01')");
    await admin.query("INSERT INTO public.machines(id,company_id,code,name,category_id) VALUES ('m','worker-a','M','Mašina','worker-a_cat_excavator')");
    await admin.query(`INSERT INTO public.machine_work_logs(id,company_id,machine_id,worker_id,project_id,started_at,ended_at,mode,created_by,updated_by)
      VALUES ('log','worker-a','m','w','p-a','2026-11-01T08:00:00Z','2026-11-01T10:00:00Z','WORK','u','u')`);
    await admin.query(`INSERT INTO public.fuel_entries(id,company_id,machine_id,driver_worker_id,project_id,filled_at,liters,amount_cents,currency_code,created_by,updated_by)
      VALUES ('fuel','worker-a','m','w','p-a','2026-11-01T12:00:00Z',12,500,'BAM','u','u')`);
  }, 120_000);
  afterAll(async () => { await app.end(); await admin.end(); await root.query(`DROP DATABASE IF EXISTS ${database}`); await root.end(); });
  it("vraća samo aktivne ID-jeve; van konteksta nema pristupa registru ni projektima", async () => {
    expect(await listActiveCompanyIds(app)).toEqual(["worker-a", "worker-b"]);
    expect((await app.query("SELECT id FROM public.companies")).rows).toEqual([]);
    expect((await app.query("SELECT id FROM public.projects")).rows).toEqual([]);
    const client = await app.connect();
    try {
      await client.query("BEGIN"); await client.query("SELECT set_config('app.company_id','worker-a',true)");
      expect((await client.query("SELECT id FROM public.projects ORDER BY id")).rows).toEqual([{ id: "p-a" }]);
      await client.query("COMMIT");
    } finally { client.release(); }
    expect((await app.query("SELECT id FROM public.projects")).rows).toEqual([]);
  });
  it("rollup čita ledger po firmi, zamjenjuje agregat i ne duplira rezultate pri retryju", async () => {
    expect(await refreshDailyRollups(app, { logger })).toEqual({ companies: 2, rows: 2 });
    expect(await refreshDailyRollups(app, { logger })).toEqual({ companies: 2, rows: 2 });
    const rows = await admin.query("SELECT company_id,project_id,rollup_date::text,cost_cents::text,machine_hours::text,fuel_liters::text FROM public.daily_rollups ORDER BY company_id");
    expect(rows.rows).toEqual([
      {company_id:"worker-a",project_id:"p-a",rollup_date:"2026-11-01",cost_cents:"100",machine_hours:"2.000",fuel_liters:"12.000"},
      {company_id:"worker-b",project_id:"p-b",rollup_date:"2026-11-01",cost_cents:"250",machine_hours:"0.000",fuel_liters:"0.000"},
    ]);
    await admin.query("INSERT INTO public.cost_entries(id,company_id,project_id,category_id,source_type,source_id,occurred_on,amount_cents,currency_code,booked_by) VALUES ('extra','worker-a','p-a','ca','MANUAL','extra','2026-11-01',30,'BAM','u')");
    await refreshDailyRollups(app, { logger, onlyCompanyId:"worker-a" });
    expect((await admin.query("SELECT cost_cents::text FROM public.daily_rollups WHERE company_id='worker-a' AND project_id='p-a'")).rows[0]).toEqual({cost_cents:"130"});
  });
  it("retencija obrađuje pending prilog pod app rolom, bez DELETE granta i s retryjem", async () => {
    await admin.query(`INSERT INTO public.attachments(id,company_id,entity_type,entity_id,object_key,file_name,content_type,size_bytes,sha256,status,created_at)
      VALUES ('stale','worker-a','TENDER','t','stale-key','x.pdf','application/pdf',10,repeat('a',64),'pending',now()-interval '2 days')`);
    await expect(purgeAttachments(app, {logger, onlyCompanyId:"worker-a", removeObject:async()=>{throw new Error("offline");}})).rejects.toThrow("ATTACHMENTS_COMPANY_FAILED");
    expect((await admin.query("SELECT status FROM public.attachments WHERE id='stale'")).rows[0]).toEqual({status:"pending"});
    const removed:string[]=[];
    expect(await purgeAttachments(app, {logger, onlyCompanyId:"worker-a", removeObject:async key=>{removed.push(key);}})).toMatchObject({staleDropped:1});
    expect(removed).toEqual(["stale-key"]);
    expect((await admin.query("SELECT status FROM public.attachments WHERE id='stale'")).rows[0]).toEqual({status:"deleted"});
    expect(await purgeAttachments(app, {logger, onlyCompanyId:"worker-a", removeObject:async()=>undefined})).toMatchObject({staleDropped:0});
  });
  it("mjesečni izvještaj je opcionalan, bez SMTP je blokiran, poslije šalje jednom", async () => {
    const now = new Date("2026-12-03T10:00:00Z");
    expect(await runScheduledReports(app,{logger,now,send:null})).toMatchObject({companies:0,blocked:0});
    await admin.query("UPDATE public.companies SET monthly_report_enabled=true,monthly_report_recipients=ARRAY['owner@example.test'] WHERE id='worker-a'");
    expect(await runScheduledReports(app,{logger,now,send:null,onlyCompanyId:"worker-a"})).toMatchObject({blocked:1});
    expect(await runScheduledReports(app,{logger,now,send:null,onlyCompanyId:"worker-a"})).toMatchObject({blocked:1});
    const statuses=await admin.query("SELECT channel,status FROM public.notification_deliveries WHERE company_id='worker-a' ORDER BY channel");
    expect(statuses.rows).toEqual([{channel:"EMAIL",status:"BLOCKED_NO_PROVIDER"},{channel:"IN_APP",status:"SENT"}]);
    let delivered=0;
    const send=async (mail:{pdf:Buffer;recipients:string[]})=>{delivered++;expect(mail.pdf.subarray(0,8).toString()).toBe("%PDF-1.4");expect(mail.pdf.toString()).toContain("Knjizeni trosak: 1.30 BAM");expect(mail.pdf.toString()).not.toContain("Knjizeni trosak: 2.50 BAM");expect(mail.recipients).toEqual(["owner@example.test"]);};
    expect(await runScheduledReports(app,{logger,now,send,onlyCompanyId:"worker-a"})).toMatchObject({sent:1});
    expect(await runScheduledReports(app,{logger,now,send,onlyCompanyId:"worker-a"})).toMatchObject({duplicate:1});
    expect(delivered).toBe(1);
    const jobs=await admin.query("SELECT company_id,period_from::text,period_to::text,status FROM public.report_jobs");
    expect(jobs.rows).toEqual([{company_id:"worker-a",period_from:"2026-11-01",period_to:"2026-11-30",status:"DONE"}]);
  });
  it("SMTP pokušaj se evidentira prije slanja; konkurentni prolaz i greška ne šalju ponovo", async () => {
    const now = new Date("2027-01-03T10:00:00Z");
    let started!: () => void, release!: () => void;
    const sending = new Promise<void>(resolve => { started = resolve; });
    const waiting = new Promise<void>(resolve => { release = resolve; });
    let calls = 0;
    const send = async () => { calls++; started(); await waiting; throw new Error("SMTP ishod nepoznat"); };
    const first = runScheduledReports(app,{logger,now,send,onlyCompanyId:"worker-a"});
    await sending;
    try {
      expect(await runScheduledReports(app,{logger,now,send,onlyCompanyId:"worker-a"})).toMatchObject({indeterminate:1});
      await deliverNotifications(app,{companyId:"worker-a",logger,env:{SMTP_HOST:"smtp",SMTP_FROM:"a@example.test"}});
      const row=await admin.query(`SELECT d.status,d.attempts FROM public.notification_deliveries d
        JOIN public.notifications n ON n.id=d.notification_id WHERE n.company_id='worker-a'
          AND n.dedupe_key='monthly-report:2026-12-01' AND d.channel='EMAIL'`);
      expect(row.rows).toEqual([{status:"PENDING",attempts:1}]);
    } finally { release(); }
    expect(await first).toMatchObject({failed:1});
    expect(await runScheduledReports(app,{logger,now,send,onlyCompanyId:"worker-a"})).toMatchObject({indeterminate:1});
    expect(calls).toBe(1);
  });
  it("queue health prikazuje raspored i poslove bez pristupa payloadu", async () => {
    expect(await queueHealth(app)).toMatchObject({available:false,jobs:[]});
    const boss = new PgBoss({connectionString:dbUrl.toString(),schema:"pgboss"});
    await boss.start();
    try {
      await boss.createQueue("rollup.nightly");
      await boss.createQueue("reports.scheduled");
      await boss.schedule("reports.scheduled","0 * * * *");
      await boss.schedule("rollup.nightly","0 2 * * *");
      await boss.send("rollup.nightly",{secret:"privatno"});
      await grantQueueHealthRead(boss.getDb());
      const health=await queueHealth(app);
      expect(health.available).toBe(true);
      expect(health.jobs).toContainEqual(expect.objectContaining({name:"rollup.nightly",cron:"0 2 * * *",created:1}));
      expect(health.jobs).toContainEqual(expect.objectContaining({name:"reports.scheduled",cron:"0 * * * *"}));
      await expect(app.query("SELECT data FROM pgboss.job")).rejects.toMatchObject({code:"42501"});
    } finally { await boss.stop(); }
  }, 30_000);
  it("postojeći poslovi obrađuju svaku firmu unutar vlastitog tenant konteksta", async () => {
    for (const id of ["worker-a", "worker-b"]) {
      expect(await scanBudgetThresholds(app, { logger, onlyCompanyId: id })).toMatchObject({ companiesScanned: 1, projectsChecked: 1 });
      expect(await scanReminders(app, { logger, onlyCompanyId: id, force: true })).toMatchObject({ companiesScanned: 1 });
    }
    expect(await scanBudgetThresholds(app, { logger, onlyCompanyId: "worker-off" })).toMatchObject({ companiesScanned: 0 });
  });
});
