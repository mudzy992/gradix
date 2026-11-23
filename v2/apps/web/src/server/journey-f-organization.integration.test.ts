import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyId, withCompany } from "@gradix/db";
import { GET as auditRoute } from "@/app/api/audit/route";
import { POST as projectsRoute } from "@/app/api/projects/route";
import { POST as inviteRoute } from "@/app/api/users/invitations/route";
import { acceptInvitation, issueInvitation } from "./access-service";
import { changeMembership, listAudit } from "./rbac-service";
import { ACCESS_COOKIE, issueAccessToken } from "./session";

const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = appUrl && adminUrl ? describe : describe.skip;
const RUN = randomUUID().replace(/-/g, "").slice(0, 10);
const CO = `cmp_jf_${RUN}`;
const OTHER = `cmp_jfx_${RUN}`;
const ownerId = `usr_jf_own_${RUN}`;
const workerUserId = `usr_jf_wrk_${RUN}`;
const otherId = `usr_jf_oth_${RUN}`;
const email = `jf-${RUN}@test.example`;
const owner = { userId: ownerId, roles: ["OWNER"] };
const PASSWORD = "Lozinka1234";

describeDb("journey F organization", () => {
  const dbAdmin = new Pool({ connectionString: adminUrl, max: 2 });
  const dbApp = new Pool({ connectionString: appUrl, max: 4 });

  beforeAll(async () => {
    await dbAdmin.query(
      `INSERT INTO public.companies (id, name, slug) VALUES ($1, 'JF', $2), ($3, 'JFX', $4)`,
      [CO, `jf-${RUN}`, OTHER, `jfx-${RUN}`],
    );
    await dbAdmin.query(
      `INSERT INTO public.users (id, email, password_hash, first_name, last_name, must_change_password)
       VALUES ($1,$2,'x','O','A',false), ($3,$4,'x','R','W',false), ($5,$6,'x','O','B',false)`,
      [ownerId, `own-${RUN}@test.example`, workerUserId, `wrk-${RUN}@test.example`, otherId, `oth-${RUN}@test.example`],
    );
    for (const [user, company, role] of [
      [ownerId, CO, "OWNER"], [workerUserId, CO, "WORKER"], [otherId, OTHER, "OWNER"],
    ] as const) {
      await dbAdmin.query(
        `INSERT INTO public.memberships (id, user_id, company_id, roles, scope)
         VALUES ($1, $2, $3, ARRAY[$4]::"Role"[], 'COMPANY')`,
        [`mem_${user}`, user, company, role],
      );
      await dbAdmin.query(
        `INSERT INTO public.sessions (id, company_id, user_id, token_hash, expires_at)
         VALUES ($1, $2, $3, $4, clock_timestamp() + interval '1 day')`,
        [`ses_${user}`, company, user, `hash_${user}`],
      );
    }
  }, 60_000);

  afterAll(async () => {
    await dbAdmin.end();
    await dbApp.end();
  });

  const count = async (company: string, sql: string, params: unknown[]) => {
    const result = await withCompany(dbApp, companyId(company), (client) =>
      client.query<{ n: string }>(sql, params));
    return result.rows[0]?.n;
  };
  const cookieFor = (userId: string, company: string) =>
    `${ACCESS_COOKIE}=${issueAccessToken({ sub: userId, sid: `ses_${userId}`, companyId: company })}`;

  it("pozivnica, promjena role, zabrana i audit ostaju jedan lanac", async () => {
    const workerCookie = cookieFor(workerUserId, CO);
    const deniedInvite = await inviteRoute(new NextRequest("http://t/api/users/invitations", {
      method: "POST", headers: { cookie: workerCookie, "content-type": "application/json" },
      body: JSON.stringify({ email, roles: ["WORKER"], scope: "SELF" }),
    }));
    expect(deniedInvite.status).toBe(403);
    const badEmail = await issueInvitation(dbApp, companyId(CO), owner, {
      email: "nije-email", roles: ["WORKER"], scope: "SELF", baseUrl: "http://t",
    });
    expect("code" in badEmail && badEmail.code).toBe("VALIDATION_FAILED");
    expect(await count(CO, "SELECT count(*)::text AS n FROM public.invitations WHERE company_id = $1", [CO])).toBe("0");

    const first = await issueInvitation(dbApp, companyId(CO), owner, {
      email, roles: ["WORKER"], scope: "SELF", baseUrl: "http://t",
    });
    expect("token" in first).toBe(true);
    if (!("token" in first)) return;
    const second = await issueInvitation(dbApp, companyId(CO), owner, {
      email, roles: ["WORKER"], scope: "SELF", baseUrl: "http://t",
    });
    expect("token" in second).toBe(true);
    if (!("token" in second)) return;
    expect(await count(CO, `SELECT count(*)::text AS n FROM public.invitations
      WHERE company_id = $1 AND lower(email) = $2 AND revoked_at IS NOT NULL`, [CO, email])).toBe("1");
    expect(await count(CO, `SELECT count(*)::text AS n FROM public.invitations
      WHERE company_id = $1 AND lower(email) = $2 AND used_at IS NULL AND revoked_at IS NULL`, [CO, email])).toBe("1");

    const weak = await acceptInvitation(dbApp, second.token, { firstName: "Novi", lastName: "Clan", password: "kratka" });
    expect("code" in weak && weak.code).toBe("VALIDATION_FAILED");
    expect(await count(CO, `SELECT count(*)::text AS n FROM public.invitations
      WHERE company_id = $1 AND id = $2 AND used_at IS NULL`, [CO, second.id])).toBe("1");
    const accepted = await acceptInvitation(dbApp, second.token, { firstName: "Novi", lastName: "Clan", password: PASSWORD });
    expect("userId" in accepted).toBe(true);
    if (!("userId" in accepted)) return;
    const again = await acceptInvitation(dbApp, second.token, { firstName: "Novi", lastName: "Clan", password: PASSWORD });
    expect("code" in again && again.code).toBe("LINK_INVALID");
    expect(await count(CO, `SELECT count(*)::text AS n FROM public.users WHERE lower(email) = $1`, [email])).toBe("1");
    expect(await count(CO, `SELECT roles::text AS n FROM public.memberships
      WHERE company_id = $1 AND user_id = $2`, [CO, accepted.userId])).toBe("{WORKER}");

    await dbAdmin.query(
      `INSERT INTO public.sessions (id, company_id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, clock_timestamp() + interval '1 day')`,
      [`ses_${accepted.userId}`, CO, accepted.userId, `hash_${accepted.userId}`],
    );
    const memberCookie = cookieFor(accepted.userId, CO);
    const deniedAudit = await auditRoute(new NextRequest("http://t/api/audit?entityType=user", { headers: { cookie: memberCookie } }));
    expect(deniedAudit.status).toBe(403);
    const selfChange = await changeMembership(dbApp, companyId(CO), { userId: accepted.userId, roles: ["WORKER"] }, accepted.userId, { roles: ["ADMIN"], scope: "COMPANY" });
    expect("code" in selfChange && selfChange.code).toBe("FORBIDDEN");
    expect(await count(CO, `SELECT roles::text AS n FROM public.memberships WHERE company_id = $1 AND user_id = $2`, [CO, accepted.userId])).toBe("{WORKER}");

    const empty = await changeMembership(dbApp, companyId(CO), owner, accepted.userId, { roles: [], scope: "SELF" });
    expect("code" in empty && empty.code).toBe("VALIDATION_FAILED");
    const changed = await changeMembership(dbApp, companyId(CO), owner, accepted.userId, { roles: ["ACCOUNTANT"], scope: "COMPANY" });
    expect("after" in changed && changed.after.roles).toEqual(["ACCOUNTANT"]);
    const sameScope = await changeMembership(dbApp, companyId(CO), owner, accepted.userId, { roles: ["ACCOUNTANT"], scope: "PROJECTS" });
    expect("code" in sameScope && sameScope.code).toBe("VALIDATION_FAILED");
    expect(await count(CO, `SELECT scope AS n FROM public.memberships WHERE company_id = $1 AND user_id = $2`, [CO, accepted.userId])).toBe("COMPANY");
    const own = await changeMembership(dbApp, companyId(CO), owner, ownerId, { roles: ["ADMIN"], scope: "COMPANY" });
    expect("code" in own && own.code).toBe("FORBIDDEN");
    expect(await count(CO, `SELECT roles::text AS n FROM public.memberships WHERE company_id = $1 AND user_id = $2`, [CO, ownerId])).toBe("{OWNER}");

    const deniedProject = await projectsRoute(new NextRequest("http://t/api/projects", {
      method: "POST", headers: { cookie: memberCookie, "content-type": "application/json" },
      body: JSON.stringify({ code: `JF-${RUN}`, name: "Most" }),
    }));
    expect(deniedProject.status).toBe(403);
    expect(await count(CO, "SELECT count(*)::text AS n FROM public.projects WHERE company_id = $1", [CO])).toBe("0");
    const foreign = await changeMembership(dbApp, companyId(OTHER), { userId: otherId, roles: ["OWNER"] }, accepted.userId, { roles: ["ADMIN"], scope: "COMPANY" });
    expect("code" in foreign && foreign.code).toBe("NOT_FOUND");
    expect(await count(CO, `SELECT roles::text AS n FROM public.memberships WHERE company_id = $1 AND user_id = $2`, [CO, accepted.userId])).toBe("{ACCOUNTANT}");

    const trail = await listAudit(dbApp, companyId(CO), { entityId: accepted.userId });
    expect("rows" in trail).toBe(true);
    if (!("rows" in trail)) return;
    expect(trail.rows.map((row) => row.action).sort()).toEqual(["invitation.accepted", "user.membership_changed"]);
    expect(trail.rows.every((row) => row.entityId === accepted.userId)).toBe(true);
    const ownerAudit = await auditRoute(new NextRequest("http://t/api/audit?entityType=user", { headers: { cookie: cookieFor(ownerId, CO) } }));
    expect(ownerAudit.status).toBe(200);
    const ownerBody = await ownerAudit.json() as { data: { rows: { action: string; entityId: string }[] } };
    expect(ownerBody.data.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "user.membership_changed", entityId: accepted.userId }),
    ]));
    const foreignTrail = await listAudit(dbApp, companyId(OTHER), { entityId: accepted.userId });
    expect("rows" in foreignTrail && foreignTrail.rows).toEqual([]);
    expect(await count(OTHER, `SELECT count(*)::text AS n FROM public.audit_events WHERE company_id = $1 AND entity_id = $2`, [CO, accepted.userId])).toBe("0");
    expect(await count(OTHER, `SELECT count(*)::text AS n FROM public.memberships WHERE company_id = $1 AND user_id = $2`, [CO, accepted.userId])).toBe("0");
  });
});
