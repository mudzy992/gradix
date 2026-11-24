import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyId, withCompany } from "@gradix/db";
import { computeCostAmount, computeHoursFromInterval, toAmountString } from "@gradix/domain";
import { POST as createProjectRoute } from "@/app/api/projects/route";
import { createMachineWorkLog } from "./machine-work-log-service";
import { createManualCost } from "./cost-entry-service";
import { createAssignment, createProject, isServiceError } from "./project-service";
import { buildPregled } from "./pregled-service";
import { SyncPushAccessError, pushR4SyncItems } from "./r4-sync-service";
import { ACCESS_COOKIE, issueAccessToken } from "./session";
import { confirmWorkday } from "./workday-approval";
import { decideWeek, lockWeek } from "./workday-week-actions";
import { weekStartFromWorkDate } from "./workday-week";
import type { Role } from "./permissions";
const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = appUrl && adminUrl ? describe : describe.skip;
const RUN = randomUUID().replace(/-/g, "").slice(0, 10);
const CO = `cmp_ja_${RUN}`;
const OTHER = `cmp_jax_${RUN}`;
const DATE = "2026-11-18";
const WEEK = weekStartFromWorkDate(DATE);
const STARTED = "2026-11-18T07:00:00.000Z";
const ENDED = "2026-11-18T15:00:00.000Z";
const RATE = 2500n;
const ownerId = `usr_ja_own_${RUN}`;
const workerUserId = `usr_ja_wrk_${RUN}`;
const foremanUserId = `usr_ja_ss_${RUN}`;
const accountantId = `usr_ja_ac_${RUN}`;
const otherId = `usr_ja_oth_${RUN}`;
const workerId = `wrk_ja_${RUN}`;
const foremanWorkerId = `wrk_ja_ss_${RUN}`;
const machineId = `mch_ja_${RUN}`;
const office = { userId: ownerId, roles: ["OWNER"] as Role[], scope: "COMPANY" as const, projectIds: null };
const foreman = { userId: foremanUserId, companyId: companyId(CO), roles: ["SITE_SUPERVISOR"] as Role[] };
const ownerAct = { userId: ownerId, companyId: CO, roles: ["OWNER"] as Role[] };
const workerAct = { userId: workerUserId, companyId: CO, roles: ["WORKER"] as Role[] };
const accountant = { userId: accountantId, companyId: CO, roles: ["ACCOUNTANT"] as Role[] };
const otherAct = { userId: otherId, companyId: OTHER, roles: ["OWNER"] as Role[], scope: "COMPANY" as const, projectIds: null };

describeDb("journey A project lifecycle", () => {
  const dbAdmin = new Pool({ connectionString: adminUrl, max: 2 });
  const dbApp = new Pool({ connectionString: appUrl, max: 4 });

  beforeAll(async () => {
    await dbAdmin.query(
      `INSERT INTO public.companies (id, name, slug) VALUES ($1, 'JA', $2), ($3, 'JAX', $4)`,
      [CO, `ja-${RUN}`, OTHER, `jax-${RUN}`],
    );
    await dbAdmin.query(
      `INSERT INTO public.users (id, email, password_hash, first_name, last_name, must_change_password)
       VALUES ($1,$2,'x','O','A',false),($3,$4,'x','R','W',false),($5,$6,'x','S','S',false),
              ($7,$8,'x','A','C',false),($9,$10,'x','O','B',false)`,
      [ownerId, `own-${RUN}@test.example`, workerUserId, `wrk-${RUN}@test.example`,
        foremanUserId, `ss-${RUN}@test.example`, accountantId, `ac-${RUN}@test.example`,
        otherId, `oth-${RUN}@test.example`],
    );
    for (const [user, company, role] of [
      [ownerId, CO, "OWNER"], [workerUserId, CO, "WORKER"], [foremanUserId, CO, "SITE_SUPERVISOR"],
      [accountantId, CO, "ACCOUNTANT"], [otherId, OTHER, "OWNER"],
    ] as const) {
      await dbAdmin.query(
        `INSERT INTO public.memberships (id, user_id, company_id, roles, scope)
         VALUES ($1, $2, $3, ARRAY[$4]::"Role"[], 'COMPANY')`,
        [`mem_${user}`, user, company, role],
      );
    }
    await dbAdmin.query(
      `INSERT INTO public.workers (id, company_id, user_id, first_name, last_name, hired_at)
       VALUES ($1,$2,$3,'Radnik','A','2024-01-01'), ($4,$2,$5,'Sef','A','2024-01-01')`,
      [workerId, CO, workerUserId, foremanWorkerId, foremanUserId],
    );
    await dbAdmin.query(
      `INSERT INTO public.machines (id, company_id, code, name, category_id)
       VALUES ($1, $2, $3, 'Bager', $2 || '_cat_excavator')`,
      [machineId, CO, `BAG-${RUN}`],
    );
    await dbAdmin.query(
      `INSERT INTO public.machine_cost_rates
         (id, company_id, machine_id, amount_cents, currency_code, valid_from,
          is_manual, reason, created_by, updated_by)
       VALUES ($1,$2,$3,$4,'BAM','2026-01-01',true,
               'Testna scena: ravna stopa jer mašina nema komponenti.',$5,$5)`,
      [`mcr_ja_${RUN}`, CO, machineId, RATE.toString(), ownerId],
    );
    await dbAdmin.query(
      `INSERT INTO public.sessions (id, company_id, user_id, token_hash, expires_at)
       VALUES ($1,$2,$3,$4, clock_timestamp() + interval '1 day')`,
      [`ses_ja_${RUN}`, CO, workerUserId, `hash_ja_${RUN}`],
    );
  }, 60_000);

  afterAll(async () => {
    await dbAdmin.end();
    await dbApp.end();
  });

  const rows = async (company: string, sql: string, params: unknown[]) => {
    const result = await withCompany(dbApp, companyId(company), (client) =>
      client.query<{ n: string }>(sql, params));
    return result.rows[0]?.n;
  };

  it("projekat, dodjela, rad, odobrenje, knjiženje i pregled ostaju jedan lanac", async () => {
    const cookie = `${ACCESS_COOKIE}=${issueAccessToken({
      sub: workerUserId, sid: `ses_ja_${RUN}`, companyId: CO,
    })}`;
    const denied = await createProjectRoute(new NextRequest("http://t/api/projects", {
      method: "POST", headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ code: `JA-${RUN}`, name: "Most" }),
    }));
    expect(denied.status).toBe(403);
    expect(await rows(CO, "SELECT count(*)::text AS n FROM public.projects WHERE company_id = $1", [CO])).toBe("0");

    const blank = await createProject(dbApp, companyId(CO), office, { code: `JA-${RUN}`, name: " " });
    expect(isServiceError(blank) && blank.code).toBe("VALIDATION_FAILED");
    const created = await createProject(dbApp, companyId(CO), office, { code: `ja-${RUN}`, name: "Most" });
    expect(isServiceError(created)).toBe(false);
    if (isServiceError(created)) return;
    const duplicate = await createProject(dbApp, companyId(CO), office, { code: `JA-${RUN}`, name: "Drugi" });
    expect(isServiceError(duplicate) && duplicate.code).toBe("CONFLICT");
    expect(await rows(CO, `SELECT count(*)::text AS n FROM public.projects WHERE company_id = $1 AND id = $2`, [CO, created.id])).toBe("1");
    expect(await rows(CO, `SELECT count(*)::text AS n FROM public.audit_events
      WHERE company_id = $1 AND action = 'project.created' AND entity_id = $2`, [CO, created.id])).toBe("1");

    const foreignAssign = await createAssignment(dbApp, companyId(OTHER), otherAct, created.id, { workerId, fromDate: "2026-11-01" });
    expect(isServiceError(foreignAssign) && foreignAssign.code).toBe("NOT_FOUND");
    const missing = await createAssignment(dbApp, companyId(CO), office, created.id, { workerId: `wrk_missing_${RUN}`, fromDate: "2026-11-01" });
    expect(isServiceError(missing) && missing.code).toBe("NOT_FOUND");
    const both = await createAssignment(dbApp, companyId(CO), office, created.id, { workerId, machineId, fromDate: "2026-11-01" });
    expect(isServiceError(both) && both.code).toBe("VALIDATION_FAILED");
    const workerAssignment = await createAssignment(dbApp, companyId(CO), office, created.id, { workerId, fromDate: "2026-11-01" });
    const foremanAssignment = await createAssignment(dbApp, companyId(CO), office, created.id, { workerId: foremanWorkerId, fromDate: "2026-11-01" });
    const machineAssignment = await createAssignment(dbApp, companyId(CO), office, created.id, { machineId, fromDate: "2026-11-01" });
    expect(isServiceError(workerAssignment) || isServiceError(foremanAssignment) || isServiceError(machineAssignment)).toBe(false);
    const overlap = await createAssignment(dbApp, companyId(CO), office, created.id, { workerId, fromDate: "2026-11-10" });
    expect(isServiceError(overlap) && overlap.code).toBe("CONFLICT");
    expect(await rows(CO, `SELECT count(*)::text AS n FROM public.project_assignments
      WHERE company_id = $1 AND project_id = $2 AND voided_at IS NULL`, [CO, created.id])).toBe("3");

    await expect(pushR4SyncItems(dbApp, { ...ownerAct, companyId: companyId(CO) }, [{
      localId: randomUUID(), entityType: "work_entry", workerId, workdayId: randomUUID(), workEntryId: randomUUID(),
      deviceSentAt: new Date().toISOString(),
      entry: { kind: "WORK", startedAt: STARTED, endedAt: ENDED, endState: "KNOWN_END", projectId: created.id, machineId: null, note: null },
    }])).rejects.toBeInstanceOf(SyncPushAccessError);
    expect(await rows(CO, "SELECT count(*)::text AS n FROM public.work_entries WHERE company_id = $1", [CO])).toBe("0");

    const workdayId = randomUUID();
    const pushed = await pushR4SyncItems(dbApp, foreman, [{
      localId: randomUUID(), entityType: "work_entry", workerId, workdayId, workEntryId: randomUUID(),
      deviceSentAt: new Date().toISOString(),
      entry: { kind: "WORK", startedAt: STARTED, endedAt: ENDED, endState: "KNOWN_END", projectId: created.id, machineId: null, note: null },
    }]);
    expect(pushed[0]?.status).toBe("APPLIED");
    const version = await withCompany(dbApp, companyId(CO), (client) => client.query<{ n: string }>(
      `SELECT header_version::text AS n FROM public.workdays WHERE company_id = $1 AND id = $2`, [CO, workdayId]));
    const submitted = await pushR4SyncItems(dbApp, foreman, [{
      localId: randomUUID(), entityType: "workday", workerId, workdayId,
      baseVersion: Number(version.rows[0]?.n), deviceSentAt: new Date().toISOString(), status: "SUBMITTED",
    }]);
    expect(submitted[0]?.status).toBe("APPLIED");
    expect(await confirmWorkday(dbApp, workerAct, workdayId)).toMatchObject({ outcome: "FORBIDDEN" });
    expect(await lockWeek(dbApp, ownerAct, WEEK)).toMatchObject({ outcome: "NOT_FOUND" });
    expect(await rows(CO, `SELECT approval_status AS n FROM public.workdays WHERE company_id = $1 AND id = $2`, [CO, workdayId])).toBe("SUBMITTED");
    expect(await confirmWorkday(dbApp, { ...ownerAct, roles: ["SITE_SUPERVISOR"] as Role[] }, workdayId)).toMatchObject({ outcome: "FORBIDDEN", code: "SCOPE" });
    expect(await confirmWorkday(dbApp, { userId: foremanUserId, companyId: CO, roles: ["SITE_SUPERVISOR"] as Role[] }, workdayId))
      .toMatchObject({ outcome: "OK", status: "FOREMAN_CONFIRMED" });
    expect(await decideWeek(dbApp, accountant, { weekStart: WEEK, decision: "APPROVE" })).toMatchObject({ outcome: "FORBIDDEN" });
    expect(await decideWeek(dbApp, ownerAct, { weekStart: WEEK, decision: "APPROVE" })).toMatchObject({ outcome: "OK", status: "WEEK_APPROVED" });
    expect(await lockWeek(dbApp, ownerAct, WEEK)).toMatchObject({ outcome: "OK", status: "LOCKED" });
    expect(await lockWeek(dbApp, ownerAct, WEEK)).toMatchObject({ outcome: "VALIDATION_FAILED", code: "NOT_APPROVED" });
    expect(await rows(CO, `SELECT status AS n FROM public.work_week_approvals WHERE company_id = $1 AND week_start = $2::date`, [CO, WEEK])).toBe("LOCKED");

    /*
     * F5: računovođa ne knjiži trošak (nema `projects.costs.book`), a saldiranje više nije dugme —
     * sat mašine u `WORK` režimu knjiži trošak sam, u transakciji u kojoj nastaje.
     */
    expect(
      await createManualCost(dbApp, accountant, {
        projectId: created.id,
        categoryId: "nepostoji",
        occurredOn: DATE,
        amount: "10.00",
      }),
    ).toMatchObject({ outcome: "FORBIDDEN" });
    const log = await createMachineWorkLog(dbApp, ownerAct, { machineId, workerId, projectId: created.id, startedAt: STARTED, endedAt: ENDED, mode: "WORK" });
    expect(log.outcome).toBe("OK");
    if (log.outcome !== "OK") return;
    const hours = computeHoursFromInterval(new Date(STARTED), new Date(ENDED));
    const amount = computeCostAmount(hours, RATE, "BAM");
    // Trošak postoji BEZ ijednog dodatnog poziva: knjiženje je posljedica upisa sata.
    expect(await rows(CO, `SELECT count(*)::text AS n FROM public.cost_entries
      WHERE company_id = $1 AND source_type = 'MACHINE_WORK_LOG' AND source_id = $2 AND project_id = $3`, [CO, log.id, created.id])).toBe("1");
    expect(await rows(OTHER, `SELECT count(*)::text AS n FROM public.projects WHERE company_id = $1 AND id = $2`, [CO, created.id])).toBe("0");
    expect(await rows(OTHER, `SELECT count(*)::text AS n FROM public.workdays WHERE company_id = $1 AND id = $2`, [CO, workdayId])).toBe("0");
    expect(await rows(OTHER, `SELECT count(*)::text AS n FROM public.cost_entries WHERE company_id = $1 AND source_id = $2`, [CO, log.id])).toBe("0");
    expect(await buildPregled(dbApp, companyId(CO), { ...workerAct, scope: "SELF", projectIds: [] })).toBeNull();
    const overview = await buildPregled(dbApp, companyId(CO), { ...ownerAct, scope: "COMPANY", projectIds: [] });
    expect(overview?.dashboard).toMatchObject({
      activeProjects: 1,
      hoursInPeriod: hours.toFixed(3),
      bookedCostsAmount: toAmountString(amount),
      bookedCostsCurrency: "BAM",
    });
    const foreignOverview = await buildPregled(dbApp, companyId(OTHER), { ...otherAct, scope: "COMPANY", projectIds: [] });
    expect(foreignOverview?.dashboard).toMatchObject({ activeProjects: 0, hoursInPeriod: "0.000", bookedCostsAmount: "0.00" });
  });
});
