import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyId, withCompany } from "@gradix/db";
import { partnerRoles } from "./partner-role-service";
import type { Role } from "./permissions";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const appUrl = process.env.DATABASE_URL;
const describeDb = adminUrl && appUrl ? describe : describe.skip;
const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const a = `f10a_${suffix}`;
const b = `f10b_${suffix}`;
const user = `u10_${suffix}`;
const partner = `p10_${suffix}`;
const owner = { companyId: a, userId: user, roles: ["OWNER"] as Role[] };

describeDb("F10 partner roles service", () => {
  const admin = new Pool({ connectionString: adminUrl });
  const app = new Pool({ connectionString: appUrl });
  beforeAll(async () => {
    await admin.query("INSERT INTO companies (id, name, slug) VALUES ($1,'A',$1), ($2,'B',$2)", [a, b]);
    await admin.query("INSERT INTO users (id, email, first_name, last_name, password_hash) VALUES ($1,$2,'A','A','x')", [user, `${user}@test.example`]);
    await withCompany(admin, companyId(a), async (client) => {
      await client.query("INSERT INTO partners (id, company_id, code, name, kind) VALUES ($1,$2,'A','A','VENDOR')", [partner, a]);
    });
  });
  afterAll(async () => {
    await withCompany(admin, companyId(a), async (client) => {
      await client.query("DELETE FROM partner_roles WHERE company_id = $1", [a]);
      await client.query("DELETE FROM partners WHERE company_id = $1", [a]);
    });
    await admin.query("DELETE FROM companies WHERE id = ANY($1)", [[a, b]]);
    await admin.query("DELETE FROM users WHERE id = $1", [user]);
    await app.end();
    await admin.end();
  });

  it("dodaje, deaktivira i reaktivira dodatnu ulogu, uz audit", async () => {
    const created = await partnerRoles(app, owner, partner, { role: "SUBCONTRACTOR", isActive: true, mustExist: false });
    expect(created.outcome).toBe("OK");
    if (created.outcome !== "OK") throw new Error("Uloga nije dodana");
    expect(created.roles).toContainEqual({ role: "SUBCONTRACTOR", isActive: true, primary: false });
    const deactivated = await partnerRoles(app, owner, partner, { role: "SUBCONTRACTOR", isActive: false, mustExist: true });
    expect(deactivated.outcome).toBe("OK");
    const reactivated = await partnerRoles(app, owner, partner, { role: "SUBCONTRACTOR", isActive: true, mustExist: false });
    expect(reactivated.outcome).toBe("OK");
    const audit = await withCompany(admin, companyId(a), (client) => client.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_events WHERE company_id = $1 AND entity_id = $2 AND action = 'partner.role_changed'", [a, partner],
    ));
    expect(audit.rows[0]?.n).toBe("3");
  });
  it("ne dopušta deaktiviranje primarne uloge niti izmjenu nepostojeće", async () => {
    expect((await partnerRoles(app, owner, partner, { role: "VENDOR", isActive: false, mustExist: true })).outcome).toBe("CONFLICT");
    expect((await partnerRoles(app, owner, partner, { role: "CLIENT", isActive: false, mustExist: true })).outcome).toBe("NOT_FOUND");
  });
  it("odbijaju se druga firma i neovlaštena uloga, čak i sa admin konekcijom", async () => {
    expect((await partnerRoles(admin, { ...owner, companyId: b }, partner)).outcome).toBe("NOT_FOUND");
    expect((await partnerRoles(app, { ...owner, roles: ["ACCOUNTANT"] }, partner)).outcome).toBe("FORBIDDEN");
  });
});
