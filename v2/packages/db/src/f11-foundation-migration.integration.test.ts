import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = adminUrl ? describe : describe.skip;
const migrations = fileURLToPath(new URL("../migrations", import.meta.url));
const target = "20261128100000_f11_search_reports_foundation";
const database = `f11_foundation_${process.pid}_${Date.now()}`;
const admin = new URL(adminUrl ?? "postgresql://localhost/postgres");
admin.pathname = "/postgres";
const isolated = new URL(admin.toString());
isolated.pathname = `/${database}`;

describeDb("F11 temeljna migracija", () => {
  const root = new Client(admin.toString());
  const db = new Client(isolated.toString());
  beforeAll(async () => {
    await root.connect();
    await root.query(`CREATE DATABASE ${database}`);
    await db.connect();
    await db.query(readFileSync(fileURLToPath(new URL("../bootstrap/roles.sql", import.meta.url)), "utf8"));
    for (const dir of readdirSync(migrations).sort().filter((name) => name < target)) {
      await db.query(readFileSync(`${migrations}/${dir}/migration.sql`, "utf8"));
    }
    await db.query("INSERT INTO public.companies(id,name,slug) VALUES ('a','A','f11-mig-a'),('b','B','f11-mig-b')");
    await db.query("INSERT INTO public.projects(id,company_id,code,name) VALUES ('pa','a','P-A','Most'),('pb','b','P-B','Drugi')");
    await db.query("INSERT INTO public.daily_rollups(id,company_id,rollup_date,hours_total,cost_cents) VALUES ('old','a','2026-11-01',2,20)");
    await db.query("INSERT INTO public.report_jobs(id,company_id,kind,period_from,period_to) VALUES ('old-report','a','COST_EXPORT','2026-11-01','2026-11-30')");
    await db.query(readFileSync(`${migrations}/${target}/migration.sql`, "utf8"));
    for (const dir of readdirSync(migrations).sort().filter((name) => name > target)) {
      await db.query(readFileSync(`${migrations}/${dir}/migration.sql`, "utf8"));
    }
    await db.query(readFileSync(fileURLToPath(new URL("../bootstrap/grants.sql", import.meta.url)), "utf8"));
  }, 120_000);
  afterAll(async () => {
    await db.end();
    await root.query(`DROP DATABASE IF EXISTS ${database}`);
    await root.end();
  });
  it("zadržava prethodne zbirne redove i omogućava projektni neto negativan trošak", async () => {
    const row = await db.query("SELECT project_id,hours_total::text,cost_cents::text FROM public.daily_rollups WHERE id='old'");
    expect(row.rows[0]).toEqual({ project_id: null, hours_total: "2.000", cost_cents: "20" });
    await db.query("INSERT INTO public.daily_rollups(id,company_id,project_id,rollup_date,cost_cents) VALUES ('new','a','pa','2026-11-01',-5)");
    await expect(db.query("INSERT INTO public.daily_rollups(id,company_id,project_id,rollup_date) VALUES ('duplicate','a','pa','2026-11-01')")).rejects.toMatchObject({ code: "23505" });
    await expect(db.query("INSERT INTO public.daily_rollups(id,company_id,project_id,rollup_date) VALUES ('foreign-project','a','pb','2026-11-01')")).rejects.toMatchObject({ code: "23503" });
    const report = await db.query("SELECT report_key,format,params FROM public.report_jobs WHERE id='old-report'");
    expect(report.rows[0]).toEqual({ report_key: null, format: null, params: {} });
    await db.query("INSERT INTO public.report_jobs(id,company_id,kind,report_key,format,dedupe_key,period_from,period_to) VALUES ('new-report','a','REPORT','HSE','XLSX','hse:one','2026-11-01','2026-11-30')");
    await expect(db.query("INSERT INTO public.report_jobs(id,company_id,kind,report_key,format,period_from,period_to) VALUES ('invalid-report','a','REPORT','OTHER','PDF','2026-11-01','2026-11-30')")).rejects.toMatchObject({ code: "23514" });
    await expect(db.query("INSERT INTO public.report_jobs(id,company_id,kind,report_key,format,dedupe_key,period_from,period_to) VALUES ('duplicate-report','a','REPORT','HSE','XLSX','hse:one','2026-11-01','2026-11-30')")).rejects.toMatchObject({ code: "23505" });
  });
  it("aktivira trigram indekse, FORCE RLS i zadržava granicu firme", async () => {
    const indexes = await db.query<{ n: number }>("SELECT count(*)::int n FROM pg_indexes WHERE schemaname='public' AND indexname LIKE '%search%trgm_idx'");
    // Four more indexes were added for tasks, obligations, service orders and incidents.
    expect(indexes.rows[0]?.n).toBe(16);
    const extra = await db.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname = ANY($1::text[]) ORDER BY indexname",
      [["project_tasks_search_title_trgm_idx", "obligation_types_search_label_trgm_idx",
        "service_orders_search_description_trgm_idx", "hse_incidents_search_kind_trgm_idx"]],
    );
    expect(extra.rows).toHaveLength(4);
    const rls = await db.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>("SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid IN ('public.report_jobs'::regclass,'public.daily_rollups'::regclass) ORDER BY relname");
    expect(rls.rows).toEqual([{relname:"daily_rollups",relrowsecurity:true,relforcerowsecurity:true},{relname:"report_jobs",relrowsecurity:true,relforcerowsecurity:true}]);
    await db.query("BEGIN");
    try {
      await db.query("SET LOCAL ROLE gradix_app");
      await db.query("SELECT set_config('app.company_id','b',true)");
      const rows = await db.query("SELECT id FROM public.daily_rollups UNION ALL SELECT id FROM public.report_jobs");
      expect(rows.rows).toEqual([]);
    } finally { await db.query("ROLLBACK"); }
  });
});
