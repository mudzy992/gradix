import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client, Pool } from "pg";
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
  it("postojeći poslovi obrađuju svaku firmu unutar vlastitog tenant konteksta", async () => {
    for (const id of ["worker-a", "worker-b"]) {
      expect(await scanBudgetThresholds(app, { logger, onlyCompanyId: id })).toMatchObject({ companiesScanned: 1, projectsChecked: 1 });
      expect(await scanReminders(app, { logger, onlyCompanyId: id, force: true })).toMatchObject({ companiesScanned: 1 });
    }
    expect(await scanBudgetThresholds(app, { logger, onlyCompanyId: "worker-off" })).toMatchObject({ companiesScanned: 0 });
  });
});
