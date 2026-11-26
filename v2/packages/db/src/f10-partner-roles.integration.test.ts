import { Pool } from "pg";
import { describe, expect, it } from "vitest";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = adminUrl ? describe : describe.skip;

describeDb("F10 uloge partnera (PostgreSQL)", () => {
  it("održava primarnu i dodatne uloge, primjenjuje RLS i odbija tuđe veze", async () => {
    const pool = new Pool({ connectionString: adminUrl, max: 1 });
    const client = await pool.connect();
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const a = `f10_a_${suffix}`;
    const b = `f10_b_${suffix}`;
    const pa = `pa_${suffix}`;
    const pb = `pb_${suffix}`;
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO companies (id, name, slug) VALUES ($1,'A',$1),($2,'B',$2)", [a, b]);
      await client.query("SET LOCAL ROLE gradix_app");
      await client.query("SELECT set_config('app.company_id',$1,true)", [a]);
      await client.query("INSERT INTO partners (id, company_id, code, name, kind) VALUES ($1,$2,'A','A','VENDOR')", [pa, a]);
      await client.query("INSERT INTO partner_roles (id, company_id, partner_id, role) VALUES ($1,$2,$3,'SUBCONTRACTOR')", [`r_${suffix}`, a, pa]);
      const roles = await client.query<{ role: string }>("SELECT role FROM partner_roles WHERE partner_id = $1 ORDER BY role", [pa]);
      expect(roles.rows.map((row) => row.role)).toEqual(["SUBCONTRACTOR", "VENDOR"]);
      await client.query("SAVEPOINT expected_failure");
      await expect(client.query("UPDATE partner_roles SET is_active = false WHERE partner_id = $1 AND role = 'VENDOR'", [pa])).rejects.toThrow("PARTNER_PRIMARY_ROLE_REQUIRED");
      await client.query("ROLLBACK TO SAVEPOINT expected_failure");
      await client.query("UPDATE partners SET kind = 'SERVICE' WHERE id = $1", [pa]);
      await client.query("UPDATE partner_roles SET is_active = false WHERE partner_id = $1 AND role = 'VENDOR'", [pa]);
      await client.query("UPDATE partners SET kind = 'VENDOR' WHERE id = $1", [pa]);
      const primary = await client.query<{ is_active: boolean }>("SELECT is_active FROM partner_roles WHERE partner_id = $1 AND role = 'VENDOR'", [pa]);
      expect(primary.rows[0]?.is_active).toBe(true);
      await client.query("SELECT set_config('app.company_id',$1,true)", [b]);
      expect((await client.query("SELECT * FROM partner_roles WHERE partner_id = $1", [pa])).rowCount).toBe(0);
      await client.query("INSERT INTO partners (id, company_id, code, name, kind) VALUES ($1,$2,'B','B','CLIENT')", [pb, b]);
      await client.query("SAVEPOINT expected_failure");
      await expect(client.query("INSERT INTO partner_roles (id, company_id, partner_id, role) VALUES ($1,$2,$3,'SERVICE')", [`cross_${suffix}`, b, pa])).rejects.toThrow();
      await client.query("ROLLBACK TO SAVEPOINT expected_failure");
      await client.query("SAVEPOINT expected_failure");
      await expect(client.query("DELETE FROM partner_roles WHERE partner_id = $1", [pb])).rejects.toThrow();
      await client.query("ROLLBACK TO SAVEPOINT expected_failure");
    } finally {
      await client.query("ROLLBACK");
      client.release();
      await pool.end();
    }
  });
});
