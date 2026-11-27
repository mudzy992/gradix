import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const adminUrl=process.env.DATABASE_ADMIN_URL;
const describeDb=adminUrl ? describe : describe.skip;
const target="20261201120000_sweep2b_advance_reservations";
const migrations=fileURLToPath(new URL("../migrations",import.meta.url));
const suffix=`${process.pid}_${Date.now()}`;
const database=`sweep2b_${suffix}`;
const role=`sweep2b_owner_${suffix}`;
const rootUrl=new URL(adminUrl ?? "postgresql://localhost/postgres"); rootUrl.pathname="/postgres";
const isolated=new URL(rootUrl); isolated.pathname=`/${database}`;

describeDb("Sweep 2B migracija rezervacija akontacija",()=>{
  const root=new Client(rootUrl.toString());
  const db=new Client(isolated.toString());
  beforeAll(async()=>{
    await root.connect(); await root.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
    await root.query(`CREATE DATABASE ${database}`); await db.connect();
    await db.query(readFileSync(fileURLToPath(new URL("../bootstrap/roles.sql",import.meta.url)),"utf8"));
    for(const dir of readdirSync(migrations).sort().filter(name=>name<target))
      await db.query(readFileSync(`${migrations}/${dir}/migration.sql`,"utf8"));
    await db.query("INSERT INTO public.companies(id,name,slug) VALUES('a','A','s2ba'),('b','B','s2bb')");
    await db.query("INSERT INTO public.users(id,email,first_name,last_name,password_hash) VALUES('u','s2b@test.example','A','B','x')");
    for(const c of ["a","b"]) {
      await db.query("INSERT INTO public.workers(id,company_id,first_name,last_name,hired_at) VALUES($1,$2,'A','B','2020-01-01')",[`w${c}`,c]);
      await db.query("INSERT INTO public.worker_advances(id,company_id,worker_id,kind,amount_cents,remaining_cents,issued_on,created_by) VALUES($1,$2,$3,'ADVANCE',10000,5000,'2026-01-01','u')",[`adv${c}`,c,`w${c}`]);
      await db.query("INSERT INTO public.pay_periods(id,company_id,year,month,status,calculated_at,calculated_by) VALUES($1,$2,2026,3,'CALCULATED',now(),'u')",[`p${c}`,c]);
    }
    await db.query("INSERT INTO public.pay_periods(id,company_id,year,month,status,calculated_at,calculated_by,locked_at,locked_by) VALUES('paid','b',2026,2,'LOCKED',now(),'u',now(),'u')");
    for(const [run,co,period,rev,amount] of [["ra1","a","pa",1,2000],["ra2","a","pa",2,3000],["rb1","b","pb",1,3000],["paidrun","b","paid",1,2000]] as const) {
      await db.query("INSERT INTO public.payroll_runs(id,company_id,period_id,revision,computed_by) VALUES($1,$2,$3,$4,'u')",[run,co,period,rev]);
      await db.query("INSERT INTO public.payroll_run_lines(id,company_id,run_id,worker_id,component_code,amount_cents,currency_code) VALUES($1,$2,$3,$4,'AKONTACIJA',$5,'BAM')",[`l${run}`,co,run,`w${co}`,-amount]);
      await db.query("INSERT INTO public.payroll_line_sources(id,company_id,line_id,source_type,source_id,amount_cents) VALUES($1,$2,$3,'ADVANCE',$4,$5)",[`s${run}`,co,`l${run}`,`adv${co}`,-amount]);
    }
    await db.query(`GRANT USAGE ON SCHEMA public TO ${role};
      GRANT SELECT ON public.schema_migrations TO ${role};
      GRANT SELECT,UPDATE ON public.pay_periods,public.payroll_runs,public.payroll_run_lines,public.payroll_line_sources,public.worker_advances TO ${role};`);
    await db.query(`SET ROLE ${role}`);
    try {
      await expect(db.query(readFileSync(`${migrations}/${target}/migration.sql`,"utf8"))).rejects.toThrow("ADVANCE_MIGRATION_REQUIRES_BYPASSRLS");
      await db.query("ROLLBACK");
    } finally {await db.query("RESET ROLE");}
    const unchanged=await db.query("SELECT remaining_cents::text FROM public.worker_advances ORDER BY id");
    expect(unchanged.rows.map(r=>r.remaining_cents)).toEqual(["5000","5000"]);
    await db.query("UPDATE public.worker_advances SET remaining_cents=6000 WHERE id='adva'");
    await expect(db.query(readFileSync(`${migrations}/${target}/migration.sql`,"utf8"))).rejects.toThrow("ADVANCE_LEGACY_BALANCE_INCONSISTENT");
    await db.query("ROLLBACK");
    expect((await db.query("SELECT remaining_cents::text FROM public.worker_advances WHERE id='advb'")).rows[0].remaining_cents).toBe("5000");
    await db.query("UPDATE public.worker_advances SET remaining_cents=5000 WHERE id='adva'");
    await db.query(readFileSync(`${migrations}/${target}/migration.sql`,"utf8"));
  },120_000);
  afterAll(async()=>{
    await db.end(); await root.query(`DROP DATABASE IF EXISTS ${database}`); await root.query(`DROP ROLE IF EXISTS ${role}`); await root.end();
  });
  it("vraća sve stare neplaćene revizije za svaku firmu, a zaključane odbitke ostavlja netaknute",async()=>{
    const result=await db.query("SELECT id,remaining_cents::text FROM public.worker_advances ORDER BY id");
    expect(result.rows).toEqual([{id:"adva",remaining_cents:"10000"},{id:"advb",remaining_cents:"8000"}]);
    await db.query(readFileSync(`${migrations}/${target}/migration.sql`,"utf8"));
    expect((await db.query("SELECT id,remaining_cents::text FROM public.worker_advances ORDER BY id")).rows).toEqual(result.rows);
  });
});
