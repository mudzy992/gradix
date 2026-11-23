import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyId, withCompany } from "@gradix/db";
import { POST as createObligationRoute } from "@/app/api/obligations/route";
import {
  createObligation,
  isServiceError,
  listObligations,
  renewObligation,
} from "./obligation-service";
import { ACCESS_COOKIE, issueAccessToken } from "./session";

const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = appUrl && adminUrl ? describe : describe.skip;
const RUN = randomUUID().replace(/-/g, "").slice(0, 10);
const CO = `cmp_jd_${RUN}`;
const OTHER = `cmp_jdx_${RUN}`;
const ownerId = `usr_jd_own_${RUN}`;
const workerUserId = `usr_jd_wrk_${RUN}`;
const otherId = `usr_jd_oth_${RUN}`;
const workerId = `wrk_jd_${RUN}`;
const owner = { userId: ownerId, roles: ["OWNER"] };
const EXPIRED = "2026-01-01";
const RENEWED = "2027-06-01";

describeDb("journey D documents", () => {
  const dbAdmin = new Pool({ connectionString: adminUrl, max: 2 });
  const dbApp = new Pool({ connectionString: appUrl, max: 4 });

  beforeAll(async () => {
    await dbAdmin.query(
      `INSERT INTO public.companies (id, name, slug) VALUES ($1, 'JD', $2), ($3, 'JDX', $4)`,
      [CO, `jd-${RUN}`, OTHER, `jdx-${RUN}`],
    );
    await dbAdmin.query(
      `INSERT INTO public.users (id, email, password_hash, first_name, last_name, must_change_password)
       VALUES ($1,$2,'x','O','A',false), ($3,$4,'x','R','W',false), ($5,$6,'x','O','B',false)`,
      [ownerId, `own-${RUN}@test.example`, workerUserId, `wrk-${RUN}@test.example`, otherId, `oth-${RUN}@test.example`],
    );
    for (const [user, company, role, scope] of [
      [ownerId, CO, "OWNER", "COMPANY"], [workerUserId, CO, "WORKER", "SELF"], [otherId, OTHER, "OWNER", "COMPANY"],
    ] as const) {
      await dbAdmin.query(
        `INSERT INTO public.memberships (id, user_id, company_id, roles, scope)
         VALUES ($1, $2, $3, ARRAY[$4]::"Role"[], $5)`,
        [`mem_${user}`, user, company, role, scope],
      );
    }
    await dbAdmin.query(
      `INSERT INTO public.workers (id, company_id, user_id, first_name, last_name, hired_at)
       VALUES ($1, $2, $3, 'Radnik', 'D', '2024-01-01')`,
      [workerId, CO, workerUserId],
    );
    await dbAdmin.query(
      `INSERT INTO public.sessions (id, company_id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, clock_timestamp() + interval '1 day')`,
      [`ses_jd_${RUN}`, CO, workerUserId, `hash_jd_${RUN}`],
    );
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

  it("istekla obaveza se obnavlja novom verzijom i stari rok ostaje", async () => {
    const cookie = `${ACCESS_COOKIE}=${issueAccessToken({
      sub: workerUserId, sid: `ses_jd_${RUN}`, companyId: CO,
    })}`;
    const denied = await createObligationRoute(new NextRequest("http://t/api/obligations", {
      method: "POST", headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ typeId: `${CO}_obt_driving`, workerId, issuedAt: "2025-01-01", expiresAt: EXPIRED }),
    }));
    expect(denied.status).toBe(403);
    expect(await count(CO, "SELECT count(*)::text AS n FROM public.obligations WHERE company_id = $1", [CO])).toBe("0");

    const early = await renewObligation(dbApp, companyId(CO), owner, `obl_missing_${RUN}`, { expiresAt: RENEWED });
    expect(isServiceError(early) && early.code).toBe("NOT_FOUND");
    const wrongKind = await createObligation(dbApp, companyId(CO), owner, {
      typeId: `${CO}_obt_registration`, workerId, issuedAt: "2025-01-01", expiresAt: EXPIRED,
    });
    expect(isServiceError(wrongKind) && wrongKind.code).toBe("VALIDATION_FAILED");
    const both = await createObligation(dbApp, companyId(CO), owner, {
      typeId: `${CO}_obt_driving`, workerId, machineId: `mch_${RUN}`, issuedAt: "2025-01-01", expiresAt: EXPIRED,
    });
    expect(isServiceError(both) && both.code).toBe("VALIDATION_FAILED");
    expect(await count(CO, "SELECT count(*)::text AS n FROM public.obligations WHERE company_id = $1", [CO])).toBe("0");

    const created = await createObligation(dbApp, companyId(CO), owner, {
      typeId: `${CO}_obt_driving`, workerId, number: "DL-1", issuer: "MUP",
      issuedAt: "2025-01-01", expiresAt: EXPIRED,
    });
    expect(isServiceError(created)).toBe(false);
    if (isServiceError(created)) return;
    expect(created.obligation).toMatchObject({
      workerId, expiresAt: EXPIRED, currentVersion: 1, state: "expired",
    });
    const listed = await listObligations(dbApp, companyId(CO), { workerId }, { scope: "COMPANY" });
    expect(listed.obligations).toEqual([expect.objectContaining({ id: created.obligation.id, state: "expired" })]);
    const same = await renewObligation(dbApp, companyId(CO), owner, created.obligation.id, { expiresAt: EXPIRED });
    expect(isServiceError(same) && same.code).toBe("CONFLICT");
    expect(await count(CO, `SELECT count(*)::text AS n FROM public.obligation_versions
      WHERE company_id = $1 AND obligation_id = $2`, [CO, created.obligation.id])).toBe("1");

    const renewed = await renewObligation(dbApp, companyId(CO), owner, created.obligation.id, {
      number: "DL-2", issuer: "MUP", issuedAt: "2026-11-01", expiresAt: RENEWED,
    });
    expect(isServiceError(renewed)).toBe(false);
    if (isServiceError(renewed)) return;
    expect(renewed.obligation).toMatchObject({ expiresAt: RENEWED, currentVersion: 2, state: "valid" });
    expect(renewed.versions).toHaveLength(2);
    const repeat = await renewObligation(dbApp, companyId(CO), owner, created.obligation.id, { expiresAt: RENEWED });
    expect(isServiceError(repeat) && repeat.code).toBe("CONFLICT");
    const foreign = await renewObligation(dbApp, companyId(OTHER), { userId: otherId, roles: ["OWNER"] }, created.obligation.id, { expiresAt: "2028-01-01" });
    expect(isServiceError(foreign) && foreign.code).toBe("NOT_FOUND");

    const versions = await withCompany(dbApp, companyId(CO), (client) => client.query<{ version: string; expires_at: string }>(
      `SELECT version::text, expires_at::text FROM public.obligation_versions
        WHERE company_id = $1 AND obligation_id = $2 ORDER BY version`,
      [CO, created.obligation.id],
    ));
    expect(versions.rows).toEqual([
      { version: "1", expires_at: EXPIRED },
      { version: "2", expires_at: RENEWED },
    ]);
    expect(await count(CO, `SELECT current_version::text AS n FROM public.obligations
      WHERE company_id = $1 AND id = $2 AND worker_id = $3 AND expires_at = $4::date AND superseded_by IS NULL`,
      [CO, created.obligation.id, workerId, RENEWED])).toBe("2");
    expect(await count(CO, `SELECT count(*)::text AS n FROM public.audit_events
      WHERE company_id = $1 AND entity_id = $2 AND action = 'obligation.created'`, [CO, created.obligation.id])).toBe("1");
    expect(await count(CO, `SELECT count(*)::text AS n FROM public.audit_events
      WHERE company_id = $1 AND entity_id = $2 AND action = 'obligation.renewed'`, [CO, created.obligation.id])).toBe("1");
    const own = await listObligations(dbApp, companyId(CO), {}, { scope: "SELF", userId: workerUserId });
    expect(own.obligations.map((row) => row.id)).toEqual([created.obligation.id]);
    const hidden = await listObligations(dbApp, companyId(CO), {}, { scope: "SELF", userId: ownerId });
    expect(hidden.obligations).toEqual([]);
    expect(await count(OTHER, `SELECT count(*)::text AS n FROM public.obligations WHERE company_id = $1 AND id = $2`, [CO, created.obligation.id])).toBe("0");
    expect(await count(OTHER, `SELECT count(*)::text AS n FROM public.obligation_versions WHERE company_id = $1 AND obligation_id = $2`, [CO, created.obligation.id])).toBe("0");
    const otherList = await listObligations(dbApp, companyId(OTHER), {}, { scope: "COMPANY" });
    expect(otherList.obligations).toEqual([]);
  });
});
