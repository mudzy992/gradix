import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client, Pool } from "pg";
import { companyId, withCompany } from "@gradix/db";
import { dashboardAssignedProjects } from "./dashboard-scope";
import { listWorkdaysForReview, resolveViewerWorkerId } from "./workday-review";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadDataHealth, listDataHealth } from "./data-health";
import type { HealthKey } from "./data-health-queries";
import { DASHBOARD_ACTIONS, loadDashboardActions } from "./dashboard-actions";
import { loadDashboardActionList } from "./dashboard-action-lists";
import { listMachineFaults } from "./machine-fault-service";
import { listServiceOrders } from "./service-order-service";
import { listTenders } from "./tender-service";
import { globalSearch } from "./global-search";
import { loadProjectCostReport } from "./report-project-costs";
import { loadHseReport } from "./report-hse";
import { loadDeadlinesReport } from "./report-deadlines";
import { loadTendersReport } from "./report-tenders";
import { loadMachinesReport } from "./report-machines";
import { machineUtilization } from "./machine-utilization-service";
import { hseStats } from "./hse-service";
import { renderReportPdf, renderReportXlsx } from "./report-render";
import ExcelJS from "exceljs";

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
      VALUES ('dh-ia','dh-a','dh-pa','NEAR_MISS','MINOR',now(),'Skela primjer incidenta','dh-u','dh-u'),('dh-ib','dh-b','dh-pb','NEAR_MISS','MINOR',now(),'Skela drugi incident','dh-u','dh-u')`);
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
  it("filtrirane liste dijele predikate i opseg s panelom, bez curenja i bez pristupa drugih rola", async () => {
    for (const scopedActor of [actor, {...actor,scope:"PROJECTS",projectIds:["dh-pa"]}, {...actor,scope:"SELF",projectIds:null}]) {
      const health=await loadDataHealth(app,scopedActor);
      for (const key of ["projects_without_budget","machines_without_rate","workers_without_rate","warehouses_without_minimum","incidents_without_actions"] as HealthKey[]) {
        const list=await listDataHealth(app,scopedActor,key,1);
        expect(list?.rows.length).toBe(health?.items.find(item=>item.key===key)?.count ?? 0);
        expect(list?.rows.every(row=>!row.id.endsWith("b"))).toBe(true);
      }
    }
    expect(await listDataHealth(app,{...actor,roles:["PROJECT_MANAGER"]},"workers_without_rate",1)).toBeNull();
    expect((await listDataHealth(app,actor,"projects_without_budget",-2))?.page).toBe(1);
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
  it("paginirane akcione liste dijele brojače, role i tenant scope", async () => {
    await admin.query(`INSERT INTO public.purchase_requests(id,company_id,project_id,justification,status,total_estimated_cents,currency_code,created_by)
      VALUES ('dh-pr1','dh-a','dh-pa','Tražena skela','SUBMITTED',100,'BAM','dh-u'),('dh-pr2','dh-a','dh-pa2','Drugi projekt','SUBMITTED',100,'BAM','dh-u'),('dh-prb','dh-b','dh-pb','Druga firma','SUBMITTED',100,'BAM','dh-u')`);
    const cases=[actor,{...actor,scope:"PROJECTS",projectIds:["dh-pa"]},
      {...actor,roles:["PROJECT_MANAGER"]},{...actor,roles:["SITE_SUPERVISOR"]},
      {...actor,roles:["ACCOUNTANT"]},{...actor,roles:["MECHANIC"],scope:"SELF"}];
    for (const scoped of cases) {
      const dashboard=await loadDashboardActions(app,scoped);
      for (const def of DASHBOARD_ACTIONS.filter(x=>x.href.startsWith("/ured/akcije?"))) {
        const list=await loadDashboardActionList(app,scoped,def.key,1);
        const expected=dashboard?.items.find(item=>item.key===def.key);
        if (!list) { expect(expected).toBeUndefined(); continue; }
        expect(list.items.length,`${scoped.roles[0]} ${def.key}`).toBe(expected?.count ?? 0);
        expect(list.items.every(item=>!item.id.endsWith("b"))).toBe(true);
      }
      const plans=await loadDashboardActionList(app,scoped,"preventive_due",1);
      if (plans) expect(plans.items.length).toBe(dashboard?.items.find(x=>x.key==="preventive_due")?.count ?? 0);
    }
    expect(await loadDashboardActionList(app,{...actor,roles:["PROJECT_MANAGER"]},"purchases_for_approval",1)).toBeNull();
    expect(await loadDashboardActionList(app,{...actor,roles:["WORKER"]},"risky_projects",1)).toBeNull();
    expect(await loadDashboardActionList(app,actor,"unknown",1)).toBeNull();
    const limited=await loadDashboardActionList(app,{...actor,scope:"PROJECTS",projectIds:["dh-pa"]},"purchases_for_approval",1);
    expect(limited?.items.map(x=>x.id)).toEqual(["dh-pr1"]);
    await admin.query(`INSERT INTO public.purchase_requests(id,company_id,project_id,justification,status,total_estimated_cents,currency_code,created_by)
      SELECT 'dh-page-' || n,'dh-a','dh-pa','Zahtjev ' || n,'SUBMITTED',100,'BAM','dh-u' FROM generate_series(1,101) n`);
    const first=await loadDashboardActionList(app,actor,"purchases_for_approval",1);
    const second=await loadDashboardActionList(app,actor,"purchases_for_approval",2);
    expect(first?.items).toHaveLength(100); expect(first?.hasNext).toBe(true);
    expect(second?.items).toHaveLength(3); expect(second?.hasNext).toBe(false);
    expect(new Set([...first!.items,...second!.items].map(x=>x.id)).size).toBe(103);
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

  it("PM finansije i OWNER top stope koriste ekranove definicije i čuvaju scope", async () => {
    await admin.query(`INSERT INTO public.cost_entries(id,company_id,project_id,category_id,source_type,source_id,occurred_on,amount_cents,currency_code,booked_by)
      VALUES ('dh-cost','dh-a','dh-pa','dh-ca','MANUAL','dh-cost',CURRENT_DATE,30,'BAM','dh-u')`);
    await admin.query(`INSERT INTO public.project_phases(id,company_id,project_id,code,name,weight,progress_pct,created_by,updated_by)
      VALUES ('dh-phase','dh-a','dh-pa','P','Faza',1,40,'dh-u','dh-u')`);
    await admin.query(`INSERT INTO public.machines(id,company_id,code,name,category_id) VALUES
      ('dh-m2','dh-a','M2','Druga','dh-a_cat_excavator'),('dh-m3','dh-a','M3','Treća','dh-a_cat_excavator'),
      ('dh-m4','dh-a','M4','Četvrta','dh-a_cat_excavator')`);
    await admin.query(`INSERT INTO public.machine_cost_components(id,company_id,machine_id,component,amount_cents,currency_code,basis,valid_from,created_by) VALUES
      ('dh-c2','dh-a','dh-m2','FUEL',300,'BAM','PER_HOUR',CURRENT_DATE-1,'dh-u'),
      ('dh-c3','dh-a','dh-m3','FUEL',400,'BAM','PER_HOUR',CURRENT_DATE-1,'dh-u'),
      ('dh-c4','dh-a','dh-m4','FUEL',200,'BAM','PER_HOUR',CURRENT_DATE-1,'dh-u'),
      ('dh-cb','dh-b','dh-mb','FUEL',900,'BAM','PER_HOUR',CURRENT_DATE-1,'dh-u')`);
    await admin.query(`INSERT INTO public.project_assignments(id,company_id,project_id,machine_id,from_date,created_by)
      VALUES ('dh-mach-ass','dh-a','dh-pa','dh-ma','2020-01-01','dh-u')`);
    const pm=await loadDashboardActions(app,{...actor,roles:["PROJECT_MANAGER"]});
    expect(pm?.projectFinancials).toEqual([expect.objectContaining({projectId:"dh-pa",budget:"1.00",actual:"0.30",progressPercent:40,budgetUsedPercent:30})]);
    expect(pm?.topMachines).toEqual([]);
    const owner=await loadDashboardActions(app,actor);
    expect(owner?.topMachines.map(m=>m.machineId)).toEqual(["dh-m3","dh-m2","dh-m4"]);
    expect(owner?.topMachines.map(m=>m.rate)).toEqual(["4.00","3.00","2.00"]);
    expect(owner?.projectFinancials).toEqual([]);
    const restricted=await loadDashboardActions(app,{...actor,scope:"PROJECTS",projectIds:["dh-pa"]});
    expect(restricted?.topMachines.map(m=>m.machineId)).toEqual(["dh-ma"]);
    expect((await loadDashboardActions(app,{...actor,scope:"SELF"}))?.topMachines).toEqual([]);
  });

  it("periodni trošak projekta koristi isti ledger, PDF/XLSX i ne širi projektni opseg", async () => {
    const filters = { from: "2000-01-01", to: "2100-12-31", projectId: "dh-pa" };
    const pm = { ...actor, roles: ["PROJECT_MANAGER" as const], scope: "PROJECTS" as const, projectIds: ["dh-pa"] };
    const doc = await loadProjectCostReport(app, pm, filters, new Date("2026-11-01T12:00:00Z"));
    expect(doc.rows).toEqual([["P", "A", "0.30", "BAM"]]);
    const pdf = Buffer.from(renderReportPdf(doc)).toString("latin1");
    expect(pdf).toContain("0.30"); expect(pdf).toContain("dh-u");
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await renderReportXlsx(doc) as never);
    const sheet = workbook.getWorksheet("Izvještaj")!;
    expect(sheet.getCell("C4").value).toBe("0.30");
    expect(sheet.getCell("D4").value).toBe("BAM");
    expect((await loadProjectCostReport(app, {...pm, projectIds: ["dh-pa2"]}, filters)).rows).toEqual([]);
    expect((await loadProjectCostReport(app, {...pm, companyId: "dh-b", scope: "COMPANY", projectIds: null}, filters)).rows).toEqual([]);
    expect((await loadProjectCostReport(app, pm, {...filters, from: "2000-01-01", to: "2000-12-31"})).rows[0]?.[2]).toBe("0.00");
    await expect(loadProjectCostReport(app, {...pm, roles: ["WORKER"]}, filters)).rejects.toThrow("REPORT_FORBIDDEN");
  });

  it("iskorištenost mašine koristi isti servis i ne miješa rad drugih projekata", async () => {
    await admin.query("UPDATE public.workers SET team='Sjever' WHERE id='dh-wa'");
    await admin.query(`INSERT INTO public.machine_work_logs(id,company_id,machine_id,worker_id,project_id,started_at,ended_at,mode,created_by,updated_by) VALUES
      ('dh-ml1','dh-a','dh-ma','dh-wa','dh-pa','2026-11-10T08:00:00Z','2026-11-10T10:00:00Z','WORK','dh-u','dh-u'),
      ('dh-ml2','dh-a','dh-ma','dh-wa','dh-pa2','2026-11-10T11:00:00Z','2026-11-10T15:00:00Z','WORK','dh-u','dh-u')`);
    await admin.query(`INSERT INTO public.cost_entries
      (id,company_id,project_id,category_id,source_type,source_id,machine_id,occurred_on,amount_cents,currency_code,status,booked_by) VALUES
      ('dh-mc1','dh-a','dh-pa','dh-ca','MACHINE_WORK_LOG','dh-ml1','dh-ma','2026-11-10',1250,'BAM','POSTED','dh-u'),
      ('dh-mc2','dh-a','dh-pa2','dh-ca','MACHINE_WORK_LOG','dh-ml2','dh-ma','2026-11-10',9999,'BAM','POSTED','dh-u'),
      ('dh-mc3','dh-a','dh-pa','dh-ca','FUEL_ENTRY','dh-fuel-pending','dh-ma','2026-11-10',NULL,NULL,'PENDING','dh-u'),
      ('dh-mc4','dh-a','dh-pa','dh-ca','SERVICE_ORDER','dh-foreign-currency','dh-ma','2026-11-10',200,'EUR','POSTED','dh-u'),
      ('dh-mc6','dh-a','dh-pa','dh-ca','MANUAL','dh-outside-period','dh-ma','2026-10-31',40000,'BAM','POSTED','dh-u')`);
    const pm={...actor,roles:["PROJECT_MANAGER" as const],scope:"PROJECTS" as const,projectIds:["dh-pa"]};
    const filters={from:"2026-11-01",to:"2026-11-30",projectId:"dh-pa",team:"Sjever"};
    const screen=await machineUtilization(app,pm,"dh-ma",filters.from,filters.to,{...filters,projectIds:pm.projectIds});
    expect(screen?.work_hours).toBe(2);
    const doc=await loadMachinesReport(app,pm,filters,new Date("2026-11-30T12:00:00Z"));
    expect(doc.rows).toHaveLength(1); expect(doc.rows[0]?.[2]).toBe("2");
    expect(doc.columns).toContain("Knjizeni trosak masine (svi timovi)");
    expect(doc.rows[0]?.[10]).toBe("12.50 BAM; 2.00 EUR"); expect(doc.rows[0]?.[11]).toBe("1");
    expect(Buffer.from(renderReportPdf(doc)).toString("latin1")).toContain("12.50 BAM; 2.00 EUR");
    expect(Buffer.from(renderReportPdf(doc)).toString("latin1")).toContain("Rad h: 2");
    const wb=new ExcelJS.Workbook(); await wb.xlsx.load(await renderReportXlsx(doc) as never);
    expect(wb.getWorksheet("Izvještaj")!.getCell("C4").value).toBe("2");
    expect(wb.getWorksheet("Izvještaj")!.getCell("K4").value).toBe("12.50 BAM; 2.00 EUR");
    const supervisor=await loadMachinesReport(app,{...pm,roles:["SITE_SUPERVISOR"]},filters);
    expect(supervisor.columns).not.toContain("Knjizeni trosak masine (svi timovi)");
    expect(JSON.stringify(supervisor)).not.toContain("12.50");
    const noTeam=await loadMachinesReport(app,pm,{from:filters.from,to:filters.to,projectId:filters.projectId});
    expect(noTeam.rows[0]?.[10]).toBe("12.50 BAM; 2.00 EUR");
    expect((await loadMachinesReport(app,{...pm,projectIds:["dh-pa2"]},filters)).rows).toEqual([]);
    expect((await loadMachinesReport(app,{...pm,companyId:"dh-b",scope:"COMPANY",projectIds:null},filters)).rows).toEqual([]);
    expect((await loadMachinesReport(app,pm,{...filters,team:"Jug"})).rows).toEqual([]);
  });

  it("HSE izvještaj dijeli statistiku ekrana i ograničava incidente, obuke i mjere na projekat", async () => {
    await admin.query(`INSERT INTO public.hse_incidents(id,company_id,project_id,kind,severity,occurred_at,description,created_by,updated_by)
      VALUES ('dh-i2','dh-a','dh-pa2','ACCIDENT','MINOR',now(),'Drugi projekat','dh-u','dh-u')`);
    await admin.query(`INSERT INTO public.hse_actions(id,company_id,incident_id,description,responsible_worker_id,due_on,created_by)
      VALUES ('dh-action2','dh-a','dh-i2','Mjera drugi projekat','dh-wa',CURRENT_DATE,'dh-u')`);
    await admin.query(`INSERT INTO public.hse_trainings(id,company_id,project_id,kind,title,held_at,created_by)
      VALUES ('dh-training1','dh-a','dh-pa','TOOLBOX','Obuka jedan',now(),'dh-u'),
             ('dh-training2','dh-a','dh-pa2','TOOLBOX','Obuka dva',now(),'dh-u')`);
    await admin.query(`INSERT INTO public.hse_inspections(id,company_id,project_id,kind,inspected_at,result,created_by)
      VALUES ('dh-insp2','dh-a','dh-pa2','INTERNAL',now(),'PROHIBITION','dh-u')`);
    const pm = { ...actor, roles: ["PROJECT_MANAGER" as const], scope: "PROJECTS" as const, projectIds: ["dh-pa"] };
    const filters = { from: "2000-01-01", to: "2100-12-31", projectId: "dh-pa" };
    const stats = await hseStats(app, pm, filters);
    expect(stats.incidents).toBe(1); expect(stats.actions.open).toBe(1);
    expect(stats.trainings.count).toBe(1); expect(stats.activeProhibition).toBeNull();
    const doc = await loadHseReport(app, pm, filters, new Date("2026-11-01T12:00:00Z"));
    expect(doc.rows).toHaveLength(1);
    expect(doc.rows[0]).toEqual(["A",String(stats.workedHours),"1","NEAR_MISS: 1","MINOR: 1","1","0","—","1","0","—","1","1","0","NE"]);
    expect(Buffer.from(renderReportPdf(doc)).toString("latin1")).toContain("NEAR_MISS: 1");
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await renderReportXlsx(doc) as never);
    expect(wb.getWorksheet("Izvještaj")!.getCell("D4").value).toBe("NEAR_MISS: 1");
    expect((await loadHseReport(app, {...pm, projectIds: ["dh-pa2"]}, filters)).rows).toEqual([]);
    expect((await loadHseReport(app, {...pm, companyId: "dh-b", scope: "COMPANY", projectIds: null}, filters)).rows).toEqual([]);
  });

  it("pretraga čuva firmu, projektni opseg, dozvole, osjetljiva polja i doslovne znakove", async () => {
    await admin.query("UPDATE public.projects SET name=CASE id WHEN 'dh-pa' THEN 'Most skela' WHEN 'dh-pa2' THEN 'Skela skrivena' ELSE 'Skela druga firma' END WHERE id IN ('dh-pa','dh-pa2','dh-pb')");
    await admin.query("UPDATE public.workers SET first_name='Skela',last_name='Radnik' WHERE id IN ('dh-wa','dh-wb')");
    await admin.query("UPDATE public.machines SET name='Skela mašina' WHERE id IN ('dh-ma','dh-mb')");
    await admin.query(`INSERT INTO public.partners(id,company_id,code,name,kind) VALUES
      ('dh-partner-a','dh-a','V','Skela dobavljač','VENDOR'),('dh-partner-b','dh-b','V','Skela tuđa','VENDOR')`);
    await admin.query(`INSERT INTO public.tenders(id,company_id,title,partner_id,submitted_value_cents,currency_code,status,created_by,updated_by)
      VALUES ('dh-tender','dh-a','Skela tender','dh-partner-a',100,'BAM','OPPORTUNITY','dh-u','dh-u')`);
    await admin.query(`INSERT INTO public.purchase_invoices(id,company_id,partner_id,invoice_number,invoice_date,amount_cents,currency_code,project_id,created_by)
      VALUES ('dh-inv','dh-a','dh-partner-a','Skela račun',CURRENT_DATE,100,'BAM','dh-pa','dh-u')`);
    await admin.query(`INSERT INTO public.attachments(id,company_id,entity_type,entity_id,object_key,file_name,content_type,size_bytes,sha256,status,uploaded_at)
      VALUES ('dh-doc-a','dh-a','PROJECT','dh-pa','obj-a','Skela.pdf','application/pdf',1,repeat('a',64),'ready',now()),
      ('dh-doc-b','dh-b','PROJECT','dh-pb','obj-b','Skela privatno.pdf','application/pdf',1,repeat('b',64),'ready',now())`);
    await admin.query("UPDATE public.project_tasks SET title='Skela zadatak' WHERE id IN ('dh-ta','dh-ta2','dh-tb')");
    await admin.query("UPDATE public.service_orders SET description='Skela servis' WHERE id='dh-so'");
    await admin.query(`INSERT INTO public.obligation_types(id,company_id,code,label,entity_kind) VALUES
      ('dh-ot-a','dh-a','SKELA','Skela obaveza','PROJECT'),('dh-ot-b','dh-b','SKELA','Skela strana','PROJECT')`);
    await admin.query(`INSERT INTO public.obligations(id,company_id,type_id,project_id,expires_at) VALUES
      ('dh-ob-a','dh-a','dh-ot-a','dh-pa',CURRENT_DATE),('dh-ob-a2','dh-a','dh-ot-a','dh-pa2',CURRENT_DATE),('dh-ob-b','dh-b','dh-ot-b','dh-pb',CURRENT_DATE)`);
    const full=await globalSearch(app,actor,"skela");
    expect(new Set(full.map(x=>x.type))).toEqual(new Set(["PROJECT","WORKER","MACHINE","PARTNER","TENDER","DOCUMENT","INVOICE","TASK","OBLIGATION","SERVICE_ORDER"]));
    expect(JSON.stringify(full)).not.toContain("druga firma"); expect(JSON.stringify(full)).not.toContain("privatno");
    const pm=await globalSearch(app,{...actor,roles:["PROJECT_MANAGER"],scope:"PROJECTS",projectIds:["dh-pa"]},"skela");
    expect(pm.filter(x=>x.type==="PROJECT").map(x=>x.title)).toEqual(["P — Most skela"]);
    expect(pm.some(x=>x.type==="PARTNER" || x.type==="TENDER")).toBe(false);
    expect(pm.some(x=>x.type==="DOCUMENT")).toBe(true);
    expect(pm.filter(x=>x.type==="OBLIGATION")).toHaveLength(1);
    expect(pm.filter(x=>x.type==="TASK")).toHaveLength(1);
    const pmIncidents=await globalSearch(app,{...actor,roles:["PROJECT_MANAGER"],scope:"PROJECTS",projectIds:["dh-pa"]},"NEAR_MISS");
    expect(pmIncidents.filter(x=>x.type==="INCIDENT")).toHaveLength(1);
    expect(pm.find(x=>x.type==="PROJECT")?.href).toBe("/ured/projekti/dh-pa");
    const otherScope=await globalSearch(app,{...actor,roles:["PROJECT_MANAGER"],scope:"PROJECTS",projectIds:["dh-pa2"]},"skela");
    expect(otherScope.filter(x=>x.type==="OBLIGATION")).toHaveLength(1);
    const otherIncidents=await globalSearch(app,{...actor,roles:["PROJECT_MANAGER"],scope:"PROJECTS",projectIds:["dh-pa2"]},"NEAR_MISS");
    expect(otherIncidents.filter(x=>x.type==="INCIDENT")).toHaveLength(0);
    expect(otherScope.filter(x=>x.type==="DOCUMENT")).toHaveLength(0);
    const mechanic=await globalSearch(app,{...actor,roles:["MECHANIC"],scope:"SELF"},"skela");
    expect(mechanic.filter(x=>x.type==="SERVICE_ORDER")).toHaveLength(1);
    const mechanicIncidents=await globalSearch(app,{...actor,roles:["MECHANIC"],scope:"SELF"},"NEAR_MISS");
    expect(mechanicIncidents.filter(x=>x.type==="INCIDENT")).toHaveLength(0);
    expect(mechanic.filter(x=>x.type==="OBLIGATION")).toHaveLength(0);
    const supervisor=await globalSearch(app,{...actor,roles:["SITE_SUPERVISOR"],scope:"PROJECTS",projectIds:["dh-pa"]},"skela");
    expect(supervisor.some(x=>x.type==="DOCUMENT" || x.type==="INVOICE")).toBe(false);
    expect(JSON.stringify(supervisor)).not.toContain("skrivena");
    const worker=await globalSearch(app,{...actor,roles:["WORKER"],scope:"SELF"},"skela");
    expect(worker.map(x=>x.type)).toEqual(["PROJECT"]);
    expect(await globalSearch(app,actor,"%_")).toEqual([]);
    expect(full.every(x=>x.href.startsWith("/ured/") && Object.keys(x).sort().join(",")==="href,title,type")).toBe(true);
  });

  it("rokovi koriste stanje liste, period i projektni opseg bez izvoza priloga i napomena", async () => {
    const pm = { ...actor, roles: ["PROJECT_MANAGER" as const], scope: "PROJECTS" as const, projectIds: ["dh-pa"] };
    const filters = { from: "2000-01-01", to: "2100-12-31" };
    const doc = await loadDeadlinesReport(app, pm, filters, new Date("2026-11-01T12:00:00Z"));
    expect(doc.rows).toHaveLength(1);
    expect(doc.rows[0]).toEqual(["Skela obaveza", "PROJECT", "Most skela", expect.any(String), "", expect.any(String)]);
    expect(Buffer.from(renderReportPdf(doc)).toString("latin1")).toContain("Skela obaveza");
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await renderReportXlsx(doc) as never);
    expect(wb.getWorksheet("Izvještaj")!.getCell("C4").value).toBe("Most skela");
    expect((await loadDeadlinesReport(app, pm, {...filters, projectId: "dh-pa2"})).rows).toEqual([]);
    expect((await loadDeadlinesReport(app, {...pm, projectIds: []}, filters)).rows).toEqual([]);
    const other = await loadDeadlinesReport(app, {...pm, companyId: "dh-b", scope: "COMPANY", projectIds: null}, filters);
    expect(other.rows.every(row => row[0] !== "Skela obaveza")).toBe(true);
  });

  it("tender izvještaj koristi checklistu i ishod te skriva maržu bez posebne dozvole", async () => {
    await admin.query("UPDATE public.tenders SET markup_pct=17.5 WHERE id='dh-tender'");
    await admin.query(`INSERT INTO public.tender_checklist_items(id,company_id,tender_id,code,label,guarantee_type,valid_until,amount_cents,created_by,updated_by)
      VALUES ('dh-guarantee','dh-a','dh-tender','BID','Ponuda','BID','2099-01-01',2500,'dh-u','dh-u')`);
    await admin.query(`INSERT INTO public.tender_outcomes(id,company_id,tender_id,result,lost_reason,recorded_by)
      VALUES ('dh-result','dh-a','dh-tender','LOST','PRICE','dh-u')`);
    const owner = {...actor,roles:["OWNER" as const],scope:"COMPANY" as const};
    const filters = {from:"2000-01-01",to:"2100-12-31"};
    const doc = await loadTendersReport(app, owner, filters, new Date("2026-11-01T12:00:00Z"));
    expect(doc.rows).toHaveLength(1); expect(doc.rows[0]?.[0]).toBe("Skela tender");
    expect(doc.rows[0]?.[6]).toBe("LOST"); expect(doc.rows[0]?.[8]).toContain("25.00");
    expect(doc.rows[0]?.[9]).toBe("17.50");
    expect(Buffer.from(renderReportPdf(doc)).toString("latin1")).toContain("Skela tender");
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await renderReportXlsx(doc) as never);
    expect(wb.getWorksheet("Izvještaj")!.getCell("J4").value).toBe("17.50");
    const accountant = await loadTendersReport(app, {...owner, roles:["ACCOUNTANT"]}, filters);
    expect(accountant.columns).not.toContain("Marza %"); expect(JSON.stringify(accountant)).not.toContain("17.50");
    expect((await loadTendersReport(app, {...owner, scope:"PROJECTS", projectIds:["dh-pa"]}, filters)).rows).toEqual([]);
    expect((await loadTendersReport(app, {...owner, companyId:"dh-b"}, filters)).rows).toEqual([]);
  });

  it("filteri kvarova, servisa i tendera vraćaju iste stavke kao dashboard",async()=>{
    await admin.query(`INSERT INTO public.work_entries(id,company_id,workday_id,worker_id,kind,started_at,ended_at,end_state,project_id,created_by,updated_by)
      VALUES ('dh-entry','dh-a','dh-da','dh-wa','WORK','2026-01-01 08:00+00','2026-01-01 16:00+00','KNOWN_END','dh-pa','dh-u','dh-u')`);
    const pmDays=await loadDashboardActions(app,{...actor,roles:["PROJECT_MANAGER"]});
    const days=await withCompany(app,companyId("dh-a"),async client=>listWorkdaysForReview(client,"dh-a",
      {kind:"assignments",viewerWorkerId:await resolveViewerWorkerId(client,"dh-a","dh-u")},200,
      {unconfirmed:true,projectIds:await dashboardAssignedProjects(client,{...actor,roles:["PROJECT_MANAGER"]})}));
    expect(pmDays?.items.find(x=>x.key==="unconfirmed_days")?.count).toBe(days.length);
    expect(days.map(x=>x.id)).toEqual(["dh-da"]);
    await admin.query(`INSERT INTO public.machine_faults(id,company_id,machine_id,project_id,reported_at,title,priority,status,created_by,updated_by)
      VALUES ('dh-f1','dh-a','dh-ma','dh-pa',now(),'Kvar moj','HIGH','OPEN','dh-u','dh-u'),('dh-f2','dh-a','dh-ma','dh-pa2',now(),'Kvar tuđi','HIGH','OPEN','dh-u','dh-u')`);
    const supervisor={...actor,roles:["SITE_SUPERVISOR"]};
    const faults=await listMachineFaults(app,supervisor,{openAssignedProjectIds:["dh-pa"]});
    expect(faults.map(x=>x.id)).toEqual(["dh-f1"]);
    expect((await loadDashboardActions(app,supervisor))?.items.find(x=>x.key==="open_machine_faults")?.count).toBe(faults.length);
    const mechanic={...actor,roles:["MECHANIC"]};
    const waiting=await listServiceOrders(app,mechanic,{dashboardMine:"waiting",dashboardProjectIds:null});
    expect(waiting.map(x=>x.id)).toEqual(["dh-so"]);
    expect((await loadDashboardActions(app,{...mechanic,scope:"SELF"}))?.items.find(x=>x.key==="waiting_parts")?.count).toBe(waiting.length);
    await admin.query("INSERT INTO public.partners(id,company_id,code,name,kind) VALUES ('dh-tp','dh-a','TP','Partner','CLIENT')");
    await admin.query(`INSERT INTO public.tenders(id,company_id,title,partner_id,submitted_value_cents,currency_code,status,deadline_at,created_by,updated_by) VALUES
      ('dh-tnd1','dh-a','Za sedmicu','dh-tp',100,'BAM','OPPORTUNITY',now()+interval '7 days','dh-u','dh-u'),
      ('dh-tnd2','dh-a','Kasnije','dh-tp',100,'BAM','OPPORTUNITY',now()+interval '15 days','dh-u','dh-u')`);
    const pm={...actor,roles:["PROJECT_MANAGER"] as const};
    const tenders=await listTenders(app,{...pm,roles:["PROJECT_MANAGER"]},{dueIn14Days:true});
    expect(tenders.map(x=>x.id)).toEqual(["dh-tnd1"]);
    expect((await loadDashboardActions(app,pm))?.items.find(x=>x.key==="tender_deadlines")?.count).toBe(tenders.length);
  });

});
