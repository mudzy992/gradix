import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = adminUrl ? describe : describe.skip;

describeDb("F10A-2 nabavka i pravila ledgera", () => {
  it("ima FORCE RLS, usklađene grantove i izdvojen tenant", async () => {
    const db = new Client(adminUrl);
    await db.connect();
    const id = `pur_${randomUUID().replace(/-/g, "")}`;
    try {
      await db.query("BEGIN");
      await db.query("INSERT INTO companies(id,name,slug) VALUES ($1,'Firma',$1)",[id]);
      await db.query("INSERT INTO users(id,email,first_name,last_name,password_hash) VALUES ($1,$2,'A','B','x')",[id,`${id}@test.example`]);
      await db.query("SET LOCAL ROLE gradix_app");
      await db.query("SELECT set_config('app.company_id',$1,true)",[id]);
      await db.query(`INSERT INTO purchase_requests(id,company_id,justification,total_estimated_cents,currency_code,created_by)
        VALUES ($1,$1,'Potrebno',100,'BAM',$1)`,[id]);
      expect((await db.query("SELECT * FROM purchase_requests WHERE company_id=$1",[id])).rowCount).toBe(1);
      await db.query("SELECT set_config('app.company_id','other',true)");
      expect((await db.query("SELECT * FROM purchase_requests WHERE company_id=$1",[id])).rowCount).toBe(0);
      const grants = await db.query<{del:boolean; forced:boolean}>(`SELECT has_table_privilege('gradix_app','public.purchase_requests','DELETE') del,
        (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='public.purchase_requests'::regclass) forced`);
      expect(grants.rows[0]).toEqual({del:false,forced:true});
    } finally { await db.query("ROLLBACK"); await db.end(); }
  });

  it("broj računa je jedinstven po dobavljaču i firmi", async () => {
    const db = new Client(adminUrl); await db.connect();
    const id=`inv_${randomUUID().replace(/-/g, "")}`;
    try {
      await db.query("BEGIN");
      await db.query("INSERT INTO companies(id,name,slug) VALUES ($1,'Firma',$1)",[id]);
      await db.query("INSERT INTO users(id,email,first_name,last_name,password_hash) VALUES ($1,$2,'A','B','x')",[id,`${id}@test.example`]);
      await db.query("INSERT INTO partners(id,company_id,code,name,kind) VALUES ($1,$1,'D','Dobavljač','VENDOR')",[id]);
      await db.query(`INSERT INTO purchase_invoices(id,company_id,partner_id,invoice_number,invoice_date,amount_cents,currency_code,created_by)
        VALUES ($1,$1,$1,'RAČ-1',current_date,100,'BAM',$1)`,[id]);
      await db.query("SAVEPOINT dup");
      await expect(db.query(`INSERT INTO purchase_invoices(id,company_id,partner_id,invoice_number,invoice_date,amount_cents,currency_code,created_by)
        VALUES ($2,$1,$1,'RAČ-1',current_date,100,'BAM',$1)`,[id,`${id}_2`])).rejects.toThrow(/unique/i);
      await db.query("ROLLBACK TO SAVEPOINT dup");
    } finally { await db.query("ROLLBACK"); await db.end(); }
  });

  it("režija je dopuštena samo za nabavku; običan negativni trošak nije", async () => {
    const db = new Client(adminUrl); await db.connect();
    const id=`cost_${randomUUID().replace(/-/g, "")}`;
    try {
      await db.query("BEGIN");
      await db.query("INSERT INTO companies(id,name,slug) VALUES ($1,'Firma',$1)",[id]);
      await db.query("INSERT INTO users(id,email,first_name,last_name,password_hash) VALUES ($1,$2,'A','B','x')",[id,`${id}@test.example`]);
      await db.query("INSERT INTO cost_categories(id,company_id,code,name) VALUES ($1,$1,'TEST','Test')",[id]);
      await db.query(`INSERT INTO cost_entries(id,company_id,category_id,source_type,source_id,occurred_on,amount_cents,currency_code,booked_by,entry_kind)
        VALUES ($1,$1,$1,'PURCHASE','issue',current_date,100,'BAM',$1,'OVERHEAD')`,[id]);
      await db.query("SAVEPOINT neg");
      await expect(db.query(`INSERT INTO cost_entries(id,company_id,category_id,source_type,source_id,occurred_on,amount_cents,currency_code,booked_by,entry_kind)
        VALUES ($2,$1,$1,'PURCHASE','fake',current_date,-100,'BAM',$1,'OVERHEAD')`,[id,`${id}_2`])).rejects.toThrow(/cost_entries_amount_check/);
      await db.query("ROLLBACK TO SAVEPOINT neg");
      await db.query("SAVEPOINT change_kind");
      await expect(db.query("UPDATE cost_entries SET entry_kind='CHARGE' WHERE company_id=$1 AND id=$1",[id])).rejects.toThrow("COST_ENTRY_IMMUTABLE");
      await db.query("ROLLBACK TO SAVEPOINT change_kind");
    } finally { await db.query("ROLLBACK"); await db.end(); }
  });
});
