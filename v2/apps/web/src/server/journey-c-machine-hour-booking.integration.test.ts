/** Journey C: one machine-hour log books one project cost, and a second book does not. */
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyId, withCompany } from "@gradix/db";
import { computeCostAmount, computeHoursFromInterval } from "@gradix/domain";
import { createMachineWorkLog } from "./machine-work-log-service";
import { bookProjectCosts } from "./project-cost-service";

const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = appUrl && adminUrl ? describe : describe.skip;
const RUN = randomUUID().replace(/-/g, "").slice(0, 10);
const CO = `cmp_jc_${RUN}`;
const OTHER = `cmp_jcx_${RUN}`;
const STARTED = "2026-11-18T07:00:00.000Z";
const ENDED = "2026-11-18T15:00:00.000Z";
const RATE_CENTS = 2500n;
const owner = { userId: `usr_jc_own_${RUN}`, companyId: CO, roles: ["OWNER"] as const };
const other = { userId: `usr_jc_oth_${RUN}`, companyId: OTHER, roles: ["OWNER"] as const };
const workerId = `wrk_jc_${RUN}`;
const machineId = `mch_jc_${RUN}`;
const projectId = `prj_jc_${RUN}`;
const otherProjectId = `prj_jc_x_${RUN}`;

describeDb("journey C machine-hour booking", () => {
  const dbAdmin = new Pool({ connectionString: adminUrl, max: 2 });
  const dbApp = new Pool({ connectionString: appUrl, max: 2 });
  let logId = "";

  beforeAll(async () => {
    await dbAdmin.query(
      `INSERT INTO public.companies (id, name, slug) VALUES ($1, 'JC', $2), ($3, 'JCX', $4)`,
      [CO, `jc-${RUN}`, OTHER, `jcx-${RUN}`],
    );
    await dbAdmin.query(
      `INSERT INTO public.users (id, email, password_hash, first_name, last_name, must_change_password)
       VALUES ($1, $2, 'x', 'O', 'A', false), ($3, $4, 'x', 'O', 'B', false)`,
      [owner.userId, `own-${RUN}@test.example`, other.userId, `oth-${RUN}@test.example`],
    );
    await dbAdmin.query(
      `INSERT INTO public.workers (id, company_id, first_name, last_name, hired_at)
       VALUES ($1, $2, 'Amar', 'Hadzic', '2024-01-01')`,
      [workerId, CO],
    );
    await dbAdmin.query(
      `INSERT INTO public.projects (id, company_id, code, name)
       VALUES ($1, $2, $3, 'Most'), ($4, $2, $5, 'Drugi')`,
      [projectId, CO, `JC-${RUN}`, otherProjectId, `JX-${RUN}`],
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
       VALUES ($1, $2, $3, $4, 'BAM', '2026-01-01', true,
               'Testna scena: ravna stopa jer mašina nema komponenti.', $5, $5)`,
      [`mcr_jc_${RUN}`, CO, machineId, RATE_CENTS.toString(), owner.userId],
    );
  }, 60_000);

  afterAll(async () => {
    for (const company of [CO, OTHER]) {
      await dbAdmin.query("DELETE FROM public.project_cost_entries WHERE company_id = $1", [company]);
      await dbAdmin.query("DELETE FROM public.machine_cost_rate_snapshots WHERE company_id = $1", [company]);
      await dbAdmin.query("DELETE FROM public.machine_cost_rates WHERE company_id = $1", [company]);
      await dbAdmin.query("DELETE FROM public.machine_work_logs WHERE company_id = $1", [company]);
      await dbAdmin.query("DELETE FROM public.machines WHERE company_id = $1", [company]);
      await dbAdmin.query("DELETE FROM public.projects WHERE company_id = $1", [company]);
      await dbAdmin.query("DELETE FROM public.workers WHERE company_id = $1", [company]);
    }
    await dbAdmin.query("DELETE FROM public.users WHERE email LIKE $1", [`%-${RUN}@test.example`]);
    await dbAdmin.query("DELETE FROM public.companies WHERE id = ANY($1::text[])", [[CO, OTHER]]);
    await dbAdmin.end();
    await dbApp.end();
  }, 60_000);

  it("knjiženje istog MACHINE_WORK_LOG ostavlja jedan project_cost_entries red", async () => {
    const created = await createMachineWorkLog(dbApp, owner, {
      machineId,
      workerId,
      projectId,
      startedAt: STARTED,
      endedAt: ENDED,
      mode: "WORK",
    });
    expect(created.outcome).toBe("OK");
    if (created.outcome !== "OK") return;
    logId = created.id;
    const hours = computeHoursFromInterval(new Date(STARTED), new Date(ENDED));
    const amount = computeCostAmount(hours, RATE_CENTS, "BAM");
    const first = await bookProjectCosts(dbApp, owner, { workLogIds: [logId] });
    expect(first).toMatchObject({ outcome: "OK", booked: 1, skippedExisting: 0 });
    const second = await bookProjectCosts(dbApp, owner, { workLogIds: [logId] });
    expect(second).toMatchObject({ outcome: "OK", booked: 0, skippedExisting: 1 });
    const stored = await withCompany(dbApp, companyId(CO), (client) => client.query<{
      n: string;
      source_id: string;
      project_id: string;
      company_id: string;
      hours: string;
      amount_cents: string;
      rate_cents: string;
      source_type: string;
    }>(
      `SELECT count(*) OVER ()::text AS n, source_id, project_id, company_id,
              hours::text, amount_cents::text, rate_cents::text, source_type
         FROM public.project_cost_entries
        WHERE company_id = $1 AND source_type = 'MACHINE_WORK_LOG' AND source_id = $2`,
      [CO, logId],
    ));
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]).toMatchObject({
      n: "1",
      source_id: logId,
      project_id: projectId,
      company_id: CO,
      hours: hours.toFixed(3),
      amount_cents: amount.cents.toString(),
      rate_cents: RATE_CENTS.toString(),
      source_type: "MACHINE_WORK_LOG",
    });
    const logs = await withCompany(dbApp, companyId(CO), (client) => client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.machine_work_logs WHERE company_id = $1 AND id = $2`,
      [CO, logId],
    ));
    expect(logs.rows[0]?.n).toBe("1");
    const unrelated = await withCompany(dbApp, companyId(CO), (client) => client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.project_cost_entries WHERE company_id = $1 AND project_id = $2`,
      [CO, otherProjectId],
    ));
    expect(unrelated.rows[0]?.n).toBe("0");
    const foreignLogs = await withCompany(dbApp, companyId(OTHER), (client) => client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.machine_work_logs
        WHERE company_id = $1 AND id = $2`,
      [CO, logId],
    ));
    const foreignCosts = await withCompany(dbApp, companyId(OTHER), (client) => client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.project_cost_entries
        WHERE company_id = $1 AND source_id = $2`,
      [CO, logId],
    ));
    expect(foreignLogs.rows[0]?.n).toBe("0");
    expect(foreignCosts.rows[0]?.n).toBe("0");
    const foreignBook = await bookProjectCosts(dbApp, other, { workLogIds: [logId] });
    expect(foreignBook).toMatchObject({ outcome: "VALIDATION_FAILED", code: "EMPTY" });
    const stillOne = await withCompany(dbApp, companyId(CO), (client) => client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.project_cost_entries
        WHERE company_id = $1 AND source_id = $2`,
      [CO, logId],
    ));
    expect(stillOne.rows[0]?.n).toBe("1");
  });
});
