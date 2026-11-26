import { Pool } from "pg";
import { NextRequest } from "next/server";
import { GET as getPartners, POST as postPartner } from "@/app/api/partners/route";
import { PATCH as patchPartner } from "@/app/api/partners/[id]/route";
import { ACCESS_COOKIE, issueAccessToken } from "./session";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyId, withCompany } from "@gradix/db";
import { partnerRoles } from "./partner-role-service";
import { createPartner, listPartners, updatePartner } from "./partner-service";
import { PartnerCreateInput, PartnerPatchInput, PartnersResponse } from "@gradix/contracts";
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
  let cookie = "";
  beforeAll(async () => {
    await admin.query("INSERT INTO companies (id, name, slug) VALUES ($1,'A',$1), ($2,'B',$2)", [a, b]);
    await admin.query("INSERT INTO users (id, email, first_name, last_name, password_hash, must_change_password) VALUES ($1,$2,'A','A','x',false)", [user, `${user}@test.example`]);
    await withCompany(admin, companyId(a), async (client) => {
      await client.query("INSERT INTO partners (id, company_id, code, name, kind) VALUES ($1,$2,'A','A','VENDOR')", [partner, a]);
      await client.query(`INSERT INTO memberships(id,company_id,user_id,roles,scope) VALUES ($1,$2,$3,ARRAY['OWNER']::"Role"[],'COMPANY')`,[`mem_${suffix}`,a,user]);
      await client.query("INSERT INTO sessions(id,company_id,user_id,token_hash,expires_at) VALUES ($1,$2,$3,$4,now()+interval '1 day')",[`ses_${suffix}`,a,user,`hash_${suffix}`]);
    });
    cookie = `${ACCESS_COOKIE}=${issueAccessToken({sub:user,sid:`ses_${suffix}`,companyId:a})}`;
  });
  afterAll(async () => {
    await withCompany(admin, companyId(a), async (client) => {
      await client.query("DELETE FROM partner_roles WHERE company_id = $1", [a]);
      await client.query("DELETE FROM partners WHERE company_id = $1", [a]);
      await client.query("DELETE FROM sessions WHERE company_id = $1", [a]);
      await client.query("DELETE FROM memberships WHERE company_id = $1", [a]);
    });
    await admin.query("DELETE FROM companies WHERE id = ANY($1)", [[a, b]]);
    await admin.query("DELETE FROM users WHERE id = $1", [user]);
    await app.end();
    await admin.end();
  });

  it("primarna vrsta SUBCONTRACTOR radi kroz kreiranje, izmjenu i ugovor liste", async () => {
    const input = { code: `SUB_${suffix}`, name: "Izvođač", kind: "SUBCONTRACTOR" as const };
    expect(PartnerCreateInput.safeParse(input).success).toBe(true);
    expect(PartnerPatchInput.safeParse({kind:"SUBCONTRACTOR"}).success).toBe(true);
    const created = await createPartner(app, owner, input);
    expect(created.outcome).toBe("OK");
    if (created.outcome !== "OK") return;
    expect((await updatePartner(app, owner, created.id, {kind:"VENDOR"})).outcome).toBe("OK");
    expect((await updatePartner(app, owner, created.id, {kind:"SUBCONTRACTOR"})).outcome).toBe("OK");
    const partners = await listPartners(app, owner);
    expect(PartnersResponse.safeParse({ partners }).success).toBe(true);
    expect(partners.find((p) => p.id === created.id)?.kind).toBe("SUBCONTRACTOR");
    const roles = await partnerRoles(app, owner, created.id);
    expect(roles.outcome).toBe("OK");
    if (roles.outcome === "OK") expect(roles.roles).toContainEqual({role:"SUBCONTRACTOR",isActive:true,primary:true});
  });
  it("partners POST/PATCH/GET prihvataju primarnu vrstu i validan odgovor", async () => {
    const headers = {cookie,"content-type":"application/json"};
    const created = await postPartner(new NextRequest("http://t/api/partners", {method:"POST",headers,body:JSON.stringify({code:`API_${suffix}`,name:"Partner API",kind:"SUBCONTRACTOR"})}));
    expect(created.status).toBe(200);
    const body = await created.json() as { data: {id: string} };
    const changed = await patchPartner(new NextRequest("http://t/api/partners/id", {method:"PATCH",headers,body:JSON.stringify({kind:"VENDOR"})}), {params:Promise.resolve({id:body.data.id})});
    expect(changed.status).toBe(200);
    const changedBack = await patchPartner(new NextRequest("http://t/api/partners/id", {method:"PATCH",headers,body:JSON.stringify({kind:"SUBCONTRACTOR"})}), {params:Promise.resolve({id:body.data.id})});
    expect(changedBack.status).toBe(200);
    const list = await getPartners(new NextRequest("http://t/api/partners", {headers:{cookie}}));
    expect(list.status).toBe(200);
    const data = await list.json() as {data: unknown};
    expect(PartnersResponse.safeParse(data.data).success).toBe(true);
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
