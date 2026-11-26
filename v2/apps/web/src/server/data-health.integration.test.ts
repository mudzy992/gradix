import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadDataHealth } from "./data-health";
import { loadDashboardActions } from "./dashboard-actions";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const appUrl = process.env.DATABASE_URL;
const describeDb = adminUrl && appUrl ? describe : describe.skip;
const migrations = fileURLToPath(new URL("../../../../packages/db/migrations", import.meta.url));
const database = `f11_health_${process.pid}_${Date.now()}`;
const rootUrl = new URL(adminUrl ?? "postgresql://localhost/postgres"); rootUrl.pathname="/postgres";
const dbUrl = new URL(rootUrl); dbUrl.pathname=`/${database}`;
const runtimeUrl = new URL(appUrl ?? "postgresql://localhost/postgres"); runtimeUrl.pathname=`/${database}`;

describeDb("data health pod stvarnim RLS-om", () => {
  const root = new Client(rootUrl.toString());
  const admin = new Client(dbUrl.toString());
  const app = new Pool({ connectionString:runtimeUrl.toString() });
  const actor = {userId:"dh-u",companyId:"dh-a",roles:["OWNER"],scope:"COMPANY",projectIds:null};
  beforeAll(async () => {
    await root.connect(); await root.query(`CREATE DATABASE ${database}`); await admin.connect();
    await admin.query(readFileSync(fileURLToPath(new URL("../../../../packages/db/bootstrap/roles.sql", import.meta.url)),"utf8"));
    for (const dir of readdirSync(migrations).sort()) await admin.query(readFileSync(`${migrations}/${dir}/migration.sql`,"utf8"));
    await admin.query(readFileSync(fileURLToPath(new URL("../../../../packages/db/bootstrap/grants.sql", import.meta.url)),"utf8"));
    await admin.query("INSERT INTO public.companies(id,name,slug) VALUES ('dh-a','A','dh-a'),('dh-b','B','dh-b')");
    await admin.query("INSERT INTO public.users(id,email,first_name,last_name,password_hash) VALUES ('dh-u','dh@example.test','A','B','x')");
    await admin.query("INSERT INTO public.projects(id,company_id,code,name) VALUES ('dh-pa','dh-a','P','A'),('dh-pa2','dh-a','Q','A2'),('dh-pb','dh-b','P','B')");
    await admin.query("INSERT INTO public.workers(id,company_id,first_name,last_name,hired_at) VALUES ('dh-wa','dh-a','A','B','2020-01-01'),('dh-wb','dh-b','A','B','2020-01-01')");
    await admin.query("INSERT INTO public.machines(id,company_id,code,name,category_id) VALUES ('dh-ma','dh-a','M','M','dh-a_cat_excavator'),('dh-mb','dh-b','M','M','dh-b_cat_excavator')");
    await admin.query("INSERT INTO public.warehouses(id,company_id,code,name,kind,project_id) VALUES ('dh-ha','dh-a','S','S','SITE','dh-pa'),('dh-hb','dh-b','S','S','SITE','dh-pb')");
    await admin.query("INSERT INTO public.workdays(id,company_id,worker_id,work_date,status,created_by,updated_by) VALUES ('dh-da','dh-a','dh-wa','2026-01-01','SUBMITTED','dh-u','dh-u'),('dh-db','dh-b','dh-wb','2026-01-01','SUBMITTED','dh-u','dh-u')");
    await admin.query(`INSERT INTO public.hse_incidents(id,company_id,project_id,kind,severity,occurred_at,description,created_by,updated_by)
      VALUES ('dh-ia','dh-a','dh-pa','NEAR_MISS','MINOR',now(),'Primjer incidenta','dh-u','dh-u'),('dh-ib','dh-b','dh-pb','NEAR_MISS','MINOR',now(),'Drugi incident','dh-u','dh-u')`);
  }, 120_000);
  afterAll(async () => { await app.end(); await admin.end(); await root.query(`DROP DATABASE IF EXISTS ${database}`); await root.end(); });
  it("vraća samo stanje firme, šest validnih kategorija i ne otkriva drugu firmu", async () => {
    const result=await loadDataHealth(app,actor);
    expect(result?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({key:"unconfirmed_days",count:1}),
      expect.objectContaining({key:"projects_without_budget",count:2}),
      expect.objectContaining({key:"machines_without_rate",count:1}),
      expect.objectContaining({key:"workers_without_rate",count:1}),
      expect.objectContaining({key:"warehouses_without_minimum",count:2}),
      expect.objectContaining({key:"incidents_without_actions",count:1}),
    ]));
    expect(result?.items).toHaveLength(6);
    const other=await loadDataHealth(app,{...actor,companyId:"dh-b"});
    expect(other?.items.find(x=>x.key==="projects_without_budget")?.count).toBe(1);
  });
  it("dashboard bira role, dodijeljene projekte i vlastite naloge bez tenant curenja", async () => {
    await admin.query("UPDATE public.workers SET user_id='dh-u' WHERE id='dh-wa'");
    await admin.query(`INSERT INTO public.project_assignments(id,company_id,project_id,worker_id,from_date,created_by)
      VALUES ('dh-as','dh-a','dh-pa','dh-wa','2020-01-01','dh-u')`);
    await admin.query(`INSERT INTO public.project_tasks(id,company_id,project_id,title,due_on,created_by,updated_by)
      VALUES ('dh-ta','dh-a','dh-pa','A',CURRENT_DATE-1,'dh-u','dh-u'),('dh-ta2','dh-a','dh-pa2','A2',CURRENT_DATE-1,'dh-u','dh-u'),('dh-tb','dh-b','dh-pb','B',CURRENT_DATE-1,'dh-u','dh-u')`);
    await admin.query(`INSERT INTO public.service_orders(id,company_id,machine_id,opened_at,status,description,created_by,assigned_mechanic_worker_id)
      VALUES ('dh-so','dh-a','dh-ma',now(),'WAITING_PARTS','Primjer','dh-u','dh-wa')`);
    await admin.query(`INSERT INTO public.maintenance_plans(id,company_id,machine_id,name,basis,interval_value,next_due_at,created_by,updated_by)
      VALUES ('dh-plan','dh-a','dh-ma','Servis','DAYS',30,CURRENT_DATE-1,'dh-u','dh-u'),('dh-plan-b','dh-b','dh-mb','Servis B','DAYS',30,CURRENT_DATE-1,'dh-u','dh-u')`);
    await admin.query("INSERT INTO public.pay_periods(id,company_id,year,month) VALUES ('dh-pay','dh-a',2026,1),('dh-pay2','dh-b',2026,1)");
    const owner=await loadDashboardActions(app,actor);
    expect(owner?.items.every(x=>x.role==="OWNER" && x.count>0)).toBe(true);
    const pm=await loadDashboardActions(app,{...actor,roles:["PROJECT_MANAGER"]});
    expect(pm?.items.find(x=>x.key==="overdue_tasks")?.count).toBe(1);
    expect(pm?.items.every(x=>x.role==="PROJECT_MANAGER")).toBe(true);
    const supervisor=await loadDashboardActions(app,{...actor,roles:["SITE_SUPERVISOR"]});
    expect(supervisor?.items.find(x=>x.key==="open_tasks")?.count).toBe(1);
    const accountant=await loadDashboardActions(app,{...actor,roles:["ACCOUNTANT"]});
    expect(accountant?.items.find(x=>x.key==="payroll_periods")?.count).toBe(1);
    const mechanic=await loadDashboardActions(app,{...actor,roles:["MECHANIC"],scope:"SELF"});
    expect(mechanic?.items.find(x=>x.key==="waiting_parts")?.count).toBe(1);
    expect(mechanic?.items.find(x=>x.key==="preventive_due")?.count).toBe(1);
    expect(mechanic?.items.every(x=>x.role==="MECHANIC")).toBe(true);
    expect(await loadDashboardActions(app,{...actor,roles:["WORKER"]})).toBeNull();
    const restricted=await loadDashboardActions(app,{...actor,roles:["PROJECT_MANAGER"],scope:"PROJECTS",projectIds:["dh-pa2"]});
    expect(restricted?.items.find(x=>x.key==="overdue_tasks")?.count).toBe(1);
    expect((await loadDashboardActions(app,{...actor,roles:["PROJECT_MANAGER"],scope:"SELF"}))?.items).toEqual([]);
  });
  it("PROJECTS isključuje nedodijeljene i globalne podatke, SELF je prazan", async () => {
    const scoped=await loadDataHealth(app,{...actor,scope:"PROJECTS",projectIds:["dh-pa"]});
    expect(scoped?.items.map(x=>x.key).sort()).toEqual(["incidents_without_actions","projects_without_budget","warehouses_without_minimum"]);
    expect(await loadDataHealth(app,{...actor,scope:"SELF",projectIds:null})).toEqual({items:[]});
    expect(await loadDataHealth(app,{...actor,roles:["PROJECT_MANAGER"]})).toBeNull();
  });
  it("zabilježeni budžet, satnica, stopa, minimum i mjera uklanjaju odgovarajuće nedostatke", async () => {
    await admin.query("INSERT INTO public.cost_categories(id,company_id,code,name) VALUES ('dh-ca','dh-a','C','C')");
    await admin.query(`INSERT INTO public.project_budget_lines(id,company_id,project_id,category_id,amount_cents,currency_code,valid_from,created_by)
      VALUES ('dh-budget','dh-a','dh-pa','dh-ca',100,'BAM',CURRENT_DATE,'dh-u')`);
    await admin.query(`INSERT INTO public.machine_cost_components(id,company_id,machine_id,component,amount_cents,currency_code,basis,valid_from,created_by)
      VALUES ('dh-comp','dh-a','dh-ma','FUEL',100,'BAM','PER_HOUR',CURRENT_DATE-1,'dh-u')`);
    await admin.query(`INSERT INTO public.worker_rates(id,company_id,worker_id,rate_kind,amount_cents,currency_code,valid_from,created_by)
      VALUES ('dh-rate','dh-a','dh-wa','HOURLY',100,'BAM',CURRENT_DATE-1,'dh-u')`);
    await admin.query(`INSERT INTO public.stock_items(id,company_id,code,name,created_by,updated_by) VALUES ('dh-item','dh-a','I','I','dh-u','dh-u')`);
    await admin.query(`INSERT INTO public.stock_item_levels(id,company_id,item_id,warehouse_id,min_quantity)
      SELECT 'dh-lvl-'||id,company_id,'dh-item',id,1 FROM public.warehouses WHERE company_id='dh-a'`);
    await admin.query(`INSERT INTO public.hse_actions(id,company_id,incident_id,description,responsible_worker_id,due_on,created_by)
      VALUES ('dh-action','dh-a','dh-ia','Popraviti opasnost','dh-wa',CURRENT_DATE,'dh-u')`);
    const result=await loadDataHealth(app,actor);
    expect(result?.items.find(x=>x.key==="projects_without_budget")?.count).toBe(1);
    expect(result?.items.map(x=>x.key)).not.toContain("machines_without_rate");
    expect(result?.items.map(x=>x.key)).not.toContain("workers_without_rate");
    expect(result?.items.map(x=>x.key)).not.toContain("warehouses_without_minimum");
    expect(result?.items.map(x=>x.key)).not.toContain("incidents_without_actions");
  });

});
