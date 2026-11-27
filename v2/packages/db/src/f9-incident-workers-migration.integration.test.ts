import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

const adminUrl=process.env.DATABASE_ADMIN_URL;
const describeDb=adminUrl ? describe : describe.skip;
const migrations=fileURLToPath(new URL("../migrations",import.meta.url));
const target="20261126110000_f9_incident_workers";

describeDb("F9 migracija učesnika incidenta na postojećoj bazi",()=>{
  it("popunjava nedostajuće objekte, čuva postojeće redove i može se ponoviti",async()=>{
    const name=`f9_iw_${process.pid}_${Date.now()}`;
    const url=new URL(adminUrl!); url.pathname="/postgres";
    const root=new Client(url.toString()); await root.connect(); await root.query(`CREATE DATABASE ${name}`);
    url.pathname=`/${name}`; const db=new Client(url.toString());
    try {
      await db.connect();
      await db.query(readFileSync(fileURLToPath(new URL("../bootstrap/roles.sql",import.meta.url)),"utf8"));
      for(const dir of readdirSync(migrations).sort().filter(d=>d<target)) await db.query(readFileSync(`${migrations}/${dir}/migration.sql`,"utf8"));
      await db.query("INSERT INTO companies(id,name,slug) VALUES ('a','A','f9-workers-a'),('b','B','f9-workers-b')");
      await db.query("INSERT INTO users(id,email,first_name,last_name,password_hash) VALUES ('u','f9-workers@test.example','A','B','x')");
      await db.query("INSERT INTO workers(id,company_id,first_name,last_name,hired_at) VALUES ('w1','a','A','A','2020-01-01'),('w2','a','B','B','2020-01-01')");
      await db.query(`INSERT INTO hse_incidents(id,company_id,kind,severity,occurred_at,description,injured_worker_id,created_by,updated_by)
        VALUES ('i1','a','ACCIDENT','MINOR',now(),'Incident 1','w1','u','u'),('i2','a','ACCIDENT','MINOR',now(),'Incident 2','w2','u','u')`);
      // Ranija verzija tabele već sadrži vezu, ali nema sve nove kolone i zaštite.
      await db.query("CREATE TABLE public.hse_incident_workers (id TEXT PRIMARY KEY,company_id TEXT NOT NULL,incident_id TEXT NOT NULL,worker_id TEXT NOT NULL)");
      await db.query("INSERT INTO hse_incident_workers VALUES ('existing','a','i1','w1')");
      const sql=readFileSync(`${migrations}/${target}/migration.sql`,"utf8");
      await db.query(sql); await db.query(sql);
      const rows=await db.query<{id:string;incident_id:string;injured:boolean}>("SELECT id,incident_id,injured FROM hse_incident_workers ORDER BY incident_id");
      expect(rows.rows).toHaveLength(2);
      expect(rows.rows[0]).toEqual({id:"existing",incident_id:"i1",injured:false});
      expect(rows.rows[1]).toMatchObject({incident_id:"i2",injured:true});
      const guard=await db.query<{rls:boolean;forced:boolean;policy:number;trigger:number}>(`SELECT c.relrowsecurity rls,c.relforcerowsecurity forced,
        (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname='hse_incident_workers_tenant_isolation') policy,
        (SELECT count(*)::int FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname='hse_incident_workers_guard' AND NOT t.tgisinternal) trigger
        FROM pg_class c WHERE c.oid='public.hse_incident_workers'::regclass`);
      expect(guard.rows[0]).toEqual({rls:true,forced:true,policy:1,trigger:1});
    } finally { await db.end(); await root.query(`DROP DATABASE IF EXISTS ${name}`); await root.end(); }
  },120_000);
});
