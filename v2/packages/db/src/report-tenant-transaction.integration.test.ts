import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyId, withCompany, withCompanyTransactionContext } from "./tenant";

const adminUrl=process.env.DATABASE_ADMIN_URL, appUrl=process.env.DATABASE_URL;
const run=adminUrl && appUrl ? describe : describe.skip;
const name=`report_tenant_${process.pid}_${Date.now()}`;
const rootUrl=new URL(adminUrl ?? "postgresql://localhost/postgres"); rootUrl.pathname="/postgres";
const dbUrl=new URL(rootUrl); dbUrl.pathname=`/${name}`;
const runtimeUrl=new URL(appUrl ?? "postgresql://localhost/postgres"); runtimeUrl.pathname=`/${name}`;
const migrations=fileURLToPath(new URL("../migrations",import.meta.url));

run("tenant transakcija report workera", () => {
  const root=new Client(rootUrl.toString()), admin=new Client(dbUrl.toString());
  const app=new Pool({connectionString:runtimeUrl.toString(),max:4});
  const other=new Pool({connectionString:runtimeUrl.toString()});
  beforeAll(async () => {
    await root.connect(); await root.query(`CREATE DATABASE ${name}`); await admin.connect();
    await admin.query(readFileSync(fileURLToPath(new URL("../bootstrap/roles.sql",import.meta.url)),"utf8"));
    for (const dir of readdirSync(migrations).sort()) await admin.query(readFileSync(`${migrations}/${dir}/migration.sql`,"utf8"));
    await admin.query(readFileSync(fileURLToPath(new URL("../bootstrap/grants.sql",import.meta.url)),"utf8"));
    await admin.query("INSERT INTO public.companies(id,name,slug) VALUES ('a','A','report-tx-a'),('b','B','report-tx-b')");
    await admin.query("INSERT INTO public.projects(id,company_id,code,name) VALUES ('pa','a','A','A'),('pb','b','B','B')");
  },120_000);
  afterAll(async () => { await app.end(); await other.end(); await admin.end(); await root.query(`DROP DATABASE IF EXISTS ${name}`); await root.end(); });

  it("dijeli istu transakciju i vraća sve promjene pri grešci", async () => {
    await expect(withCompanyTransactionContext(app,companyId("a"),async outer=>{
      await outer.query("UPDATE public.projects SET name='izmjena' WHERE company_id='a' AND id='pa'");
      const nested=await withCompany(app,companyId("a"),async client=>{
        expect(client).toBe(outer);
        return client.query("SELECT id,name FROM public.projects ORDER BY id");
      });
      expect(nested.rows).toEqual([{id:"pa",name:"izmjena"}]);
      throw new Error("rollback");
    })).rejects.toThrow("rollback");
    expect((await admin.query("SELECT name FROM public.projects WHERE id='pa'")).rows[0]).toEqual({name:"A"});
  });
  it("ne dozvoljava drugu firmu, pool ni ponovnu upotrebu oslobođene konekcije", async () => {
    let resume!:()=>void; const wait=new Promise<void>(resolve=>{resume=resolve;});
    let later!:Promise<unknown>;
    await withCompanyTransactionContext(app,companyId("a"),async ()=>{
      await expect(withCompany(app,companyId("b"),async()=>null)).rejects.toThrow("INVALID_COMPANY_TRANSACTION_CONTEXT");
      await expect(withCompany(other,companyId("a"),async()=>null)).rejects.toThrow("INVALID_COMPANY_TRANSACTION_CONTEXT");
      await expect(withCompany(app,companyId("a"),async()=>null,{savepoint:true})).rejects.toThrow("INVALID_COMPANY_TRANSACTION_CONTEXT");
      later=wait.then(()=>withCompany(app,companyId("a"),async()=>null));
    });
    resume(); await expect(later).rejects.toThrow("INVALID_COMPANY_TRANSACTION_CONTEXT");
    const [a,b]=await Promise.all(["a","b"].map(id=>withCompanyTransactionContext(app,companyId(id),async()=>
      withCompany(app,companyId(id),client=>client.query("SELECT id FROM public.projects ORDER BY id")))));
    expect(a?.rows).toEqual([{id:"pa"}]); expect(b?.rows).toEqual([{id:"pb"}]);
  });
});
