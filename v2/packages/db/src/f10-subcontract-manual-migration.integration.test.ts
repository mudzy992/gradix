import { readdirSync,readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { describe,expect,it } from "vitest";
const adminUrl=process.env.DATABASE_ADMIN_URL;
const describeDb=adminUrl ? describe : describe.skip;
const migrations=fileURLToPath(new URL("../migrations",import.meta.url));
const target="20261127130000_f10_subcontract_manual";
describeDb("F10A-3 upgrade",()=>{
  it("čuva postojeći ledger i uvodi tenant zaštite bez DELETE prava",async()=>{
    const name=`f10_sub_${process.pid}_${Date.now()}`,url=new URL(adminUrl!); url.pathname="/postgres";
    const root=new Client(url.toString()); await root.connect(); await root.query(`CREATE DATABASE ${name}`); url.pathname=`/${name}`; const db=new Client(url.toString());
    try {
      await db.connect(); await db.query(readFileSync(fileURLToPath(new URL("../bootstrap/roles.sql",import.meta.url)),"utf8"));
      for(const dir of readdirSync(migrations).sort().filter(d=>d<target)) await db.query(readFileSync(`${migrations}/${dir}/migration.sql`,"utf8"));
      await db.query("INSERT INTO companies(id,name,slug) VALUES ('a','A','sub-upgrade-a'),('b','B','sub-upgrade-b')");
      await db.query("INSERT INTO users(id,email,first_name,last_name,password_hash) VALUES ('u','sub-upgrade@test.example','A','B','x')");
      await db.query("INSERT INTO projects(id,company_id,code,name) VALUES ('p','a','P','P')");
      await db.query("INSERT INTO cost_categories(id,company_id,code,name) VALUES ('cat','a','C','C')");
      await db.query("INSERT INTO cost_entries(id,company_id,project_id,category_id,source_type,source_id,occurred_on,amount_cents,currency_code,booked_by) VALUES ('cost','a','p','cat','MANUAL','old',current_date,100,'BAM','u')");
      await db.query(readFileSync(`${migrations}/${target}/migration.sql`,"utf8"));
      await db.query(readFileSync(fileURLToPath(new URL("../bootstrap/grants.sql",import.meta.url)),"utf8"));
      expect((await db.query("SELECT amount_cents::text,client_generated_id FROM cost_entries WHERE id='cost'")).rows[0]).toEqual({amount_cents:"100",client_generated_id:null});
      expect((await db.query("SELECT manual_cost_approval_threshold_cents::text AS threshold FROM companies ORDER BY id")).rows).toEqual([{threshold:"50000"},{threshold:"50000"}]);
      const controls=await db.query<{name:string;rls:boolean;del:boolean}>(`SELECT c.relname AS name,c.relrowsecurity AND c.relforcerowsecurity AS rls,has_table_privilege('gradix_app',c.oid,'DELETE') AS del
        FROM pg_class c WHERE c.oid=ANY(ARRAY['public.subcontractor_contracts'::regclass,'public.subcontractor_contract_amendments'::regclass,'public.subcontractor_statements'::regclass,'public.subcontractor_statement_items'::regclass,'public.manual_cost_requests'::regclass]) ORDER BY c.relname`);
      expect(controls.rows).toHaveLength(5); expect(controls.rows.every(x=>x.rls && !x.del)).toBe(true);
    } finally {await db.end(); await root.query(`DROP DATABASE IF EXISTS ${name}`); await root.end();}
  },120_000);
});
