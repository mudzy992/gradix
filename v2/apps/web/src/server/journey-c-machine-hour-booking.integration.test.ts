/**
 * Journey C: jedan sat mašine = jedan trošak na projektu, i to BEZ ručnog dugmeta.
 *
 * F5 je promijenio mehanizam: `bookProjectCosts()` više ne postoji, a trošak nastaje u
 * transakciji koja upisuje sat. Test zato provjerava ono što je važnije od poziva: da ponovni
 * prolaz ne pravi drugi red i da tuđa firma ne vidi ni sat ni trošak.
 */
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyId, withCompany } from "@gradix/db";
import { computeCostAmount, computeHoursFromInterval } from "@gradix/domain";
import { createMachineWorkLog } from "./machine-work-log-service";
import { bookMachineWorkLogCostInCompany } from "./cost-entry-service";

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
      /*
       * Trošak se ne briše (ledger je append-only i triger brani DELETE). Za čišćenje testa
       * koristi se `session_replication_role = replica`: isključuje KORISNIČKE trigere, pa
       * teardown ne mora da stornira red po red.
       */
      const client = await dbAdmin.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL session_replication_role = replica");
        await client.query("DELETE FROM public.cost_entries WHERE company_id = $1", [company]);
        await client.query("COMMIT");
      } finally {
        client.release();
      }
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

  it("isti MACHINE_WORK_LOG ostavlja jedan red u ledgeru, i poslije ponovnog prolaza", async () => {
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

    /*
     * Trošak je već tu — servis ga je knjižio u istoj transakciji. Ponovni prolaz (posao, retry,
     * dvostruki klik) mora ostati `skipped`: djelimični unikat po izvoru je jedina odbrana od
     * duplog troška i ona je u bazi, ne u kodu.
     */
    const again = await bookMachineWorkLogCostInCompany(dbApp, {
      companyId: CO,
      actorId: owner.userId,
      workLogId: logId,
    });
    expect(again).toMatchObject({ posted: 0, skipped: 1 });

    const stored = await withCompany(dbApp, companyId(CO), (client) => client.query<{
      n: string;
      source_id: string;
      project_id: string;
      company_id: string;
      quantity: string;
      amount_cents: string;
      source_type: string;
      status: string;
    }>(
      `SELECT count(*) OVER ()::text AS n, source_id, project_id, company_id,
              quantity::text, amount_cents::text, source_type, status
         FROM public.cost_entries
        WHERE company_id = $1 AND source_type = 'MACHINE_WORK_LOG' AND source_id = $2`,
      [CO, logId],
    ));
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]).toMatchObject({
      n: "1",
      source_id: logId,
      project_id: projectId,
      company_id: CO,
      quantity: hours.toFixed(3),
      amount_cents: amount.cents.toString(),
      source_type: "MACHINE_WORK_LOG",
      status: "POSTED",
    });

    const logs = await withCompany(dbApp, companyId(CO), (client) => client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.machine_work_logs WHERE company_id = $1 AND id = $2`,
      [CO, logId],
    ));
    expect(logs.rows[0]?.n).toBe("1");

    // Trošak pripada SAMO projektu na kojem je sat odrađen.
    const unrelated = await withCompany(dbApp, companyId(CO), (client) => client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.cost_entries WHERE company_id = $1 AND project_id = $2`,
      [CO, otherProjectId],
    ));
    expect(unrelated.rows[0]?.n).toBe("0");

    // Tuđa firma ne vidi ni sat ni trošak: RLS + izričit `company_id` u svakom upitu.
    const foreignLogs = await withCompany(dbApp, companyId(OTHER), (client) => client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.machine_work_logs
        WHERE company_id = $1 AND id = $2`,
      [CO, logId],
    ));
    const foreignCosts = await withCompany(dbApp, companyId(OTHER), (client) => client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.cost_entries
        WHERE company_id = $1 AND source_id = $2`,
      [CO, logId],
    ));
    expect(foreignLogs.rows[0]?.n).toBe("0");
    expect(foreignCosts.rows[0]?.n).toBe("0");

    const foreignBook = await bookMachineWorkLogCostInCompany(dbApp, {
      companyId: OTHER,
      actorId: other.userId,
      workLogId: logId,
    });
    expect(foreignBook).toMatchObject({ posted: 0, skipped: 1 });

    const stillOne = await withCompany(dbApp, companyId(CO), (client) => client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.cost_entries
        WHERE company_id = $1 AND source_id = $2`,
      [CO, logId],
    ));
    expect(stillOne.rows[0]?.n).toBe("1");
  });
});
