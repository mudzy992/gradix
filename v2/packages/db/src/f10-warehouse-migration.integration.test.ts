import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = adminUrl ? describe : describe.skip;
const migrations = fileURLToPath(new URL("../migrations", import.meta.url));
const target = "20261127110000_f10_warehouse_ledger";
const database = `f10_wh_mig_${process.pid}_${Date.now()}`;
const admin = new URL(adminUrl ?? "postgresql://localhost/postgres");
admin.pathname = "/postgres";
const isolated = new URL(admin.toString());
isolated.pathname = `/${database}`;

describeDb("F10A-1 migracija naslijeđene cisterne i F8 zaliha", () => {
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
    await db.query("INSERT INTO companies(id,name,slug) VALUES ('a','A','f10-mig-a'),('b','B','f10-mig-b')");
    await db.query("INSERT INTO users(id,email,first_name,last_name,password_hash) VALUES ('u','f10-mig@test.example','A','B','x')");
    await db.query("INSERT INTO stock_items(id,company_id,code,name,unit,min_quantity,created_by,updated_by) VALUES ('item','a','part','Part','kom',2,'u','u')");
    await db.query("INSERT INTO stock_movements(id,company_id,item_id,kind,quantity,occurred_on,created_by) VALUES ('m1','a','item','IN',10,current_date,'u'),('m2','a','item','COUNT',4,current_date,'u')");
    // Nema članstva ni historijskog autora cisterne u firmi B.
    await db.query("INSERT INTO fuel_tanks(id,company_id,name,capacity_l,current_l) VALUES ('t1','a','Tank',500,200),('t2','b','Tank bez autora',200,150)");
    await db.query("INSERT INTO workers(id,company_id,first_name,last_name,hired_at) VALUES ('worker','a','A','B','2020-01-01')");
    await db.query("INSERT INTO machines(id,company_id,code,name,category_id) VALUES ('machine','a','M','M','a_cat_excavator')");
    await db.query(`INSERT INTO fuel_entries(id,company_id,machine_id,driver_worker_id,filled_at,liters,amount_cents,currency_code,created_by,updated_by,tank_id)
      VALUES ('fuel-old','a','machine','worker',now(),80,1000,'BAM','u','u','t1')`);
    await db.query(readFileSync(`${migrations}/${target}/migration.sql`, "utf8"));
    // Tekući grants.sql prati najnoviju šemu, pa nadograđujemo i preostale migracije.
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
  it("staro stanje prenosi jednom, bez ponavljanja historijskog izlaza i bez paralelne kolone", async () => {
    const rows = await db.query<{ id: string; saldo: string }>(`SELECT t.id,sum(s.quantity)::text AS saldo
      FROM public.fuel_tanks t JOIN public.stock_movements s ON s.company_id=t.company_id AND s.warehouse_id=t.warehouse_id
      WHERE s.source_type='TANK_OPENING' GROUP BY t.id ORDER BY t.id`);
    expect(rows.rows).toEqual([{ id:"t1",saldo:"200.000" },{ id:"t2",saldo:"150.000" }]);
    const columns = await db.query("SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='fuel_tanks' AND column_name='current_l'");
    expect(columns.rowCount).toBe(0);
  });
  it("centralno čuva F8 stanje i minimum te razlikuje historijski ignorisani COUNT", async () => {
    const rows = await db.query<{ kind: string; legacy_ignored: boolean; warehouse_kind: string }>(`SELECT m.kind,m.legacy_ignored,w.kind AS warehouse_kind
      FROM public.stock_movements m JOIN public.warehouses w ON w.company_id=m.company_id AND w.id=m.warehouse_id
      WHERE m.id IN ('m1','m2') ORDER BY m.id`);
    expect(rows.rows).toEqual([{kind:"IN",legacy_ignored:false,warehouse_kind:"CENTRAL"},{kind:"COUNT",legacy_ignored:true,warehouse_kind:"CENTRAL"}]);
    const level = await db.query<{ min_quantity: string }>("SELECT min_quantity::text FROM public.stock_item_levels WHERE company_id='a' AND item_id='item'");
    expect(level.rows[0]?.min_quantity).toBe("2.000");
  });
  it("RLS izoluje firme i migracija je evidentirana", async () => {
    await db.query("BEGIN");
    try {
      await db.query("SET LOCAL ROLE gradix_app");
      await db.query("SELECT set_config('app.company_id','a',true)");
      const seen = await db.query<{ n: number }>("SELECT count(*)::int n FROM public.warehouses");
      expect(seen.rows[0]?.n).toBe(2);
    } finally { await db.query("ROLLBACK"); }
    const row = await db.query<{ n: number }>("SELECT count(*)::int n FROM public.schema_migrations WHERE name=$1", [target]);
    expect(row.rows[0]?.n).toBe(1);
  });
});
