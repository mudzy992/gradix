/**
 * --reset-pilot: briše pilot-unose demo firme; čuva RESOLVED; ne dira cmp_druga; pa seed.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyId, withCompany } from "@gradix/db";
import { resolveWorkdayConflict, type ResolveActor } from "./workday-resolve";

const run = promisify(execFile);
const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = appUrl && adminUrl ? describe : describe.skip;
const webDir = fileURLToPath(new URL("../..", import.meta.url));
const HASH = "b".repeat(64);

async function runSeed(args: string[] = []): Promise<void> {
  await run(process.execPath, ["--import", "tsx", "scripts/seed.ts", ...args], {
    cwd: webDir,
    env: { ...process.env, DATABASE_ADMIN_URL: adminUrl, SEED_PASSWORD: "seed-test-lozinka-123" },
    timeout: 120_000,
  });
}

describeDb("reset-pilot (--reset-pilot)", () => {
  const admin = new Pool({ connectionString: adminUrl, max: 2 });
  const app = new Pool({ connectionString: appUrl, max: 2 });
  const ured: ResolveActor = {
    userId: "usr_ured",
    companyId: companyId("cmp_demo"),
    roles: ["ADMIN"],
    email: "ured@demo.test",
  };

  beforeAll(async () => {
    await runSeed();
  }, 180_000);

  afterAll(async () => {
    await admin.end();
    await app.end();
  });

  it("briše otvorene pilot unose, čuva RESOLVED, ne dira drugu firmu", async () => {
    const otherBefore = await admin.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM public.sync_conflicts WHERE company_id = 'cmp_druga'",
    );
    const day = await withCompany(admin, companyId("cmp_demo"), async (client) => {
      await client.query("DELETE FROM sync_conflicts WHERE id = 'cnf_pilot_open'");
      await client.query("DELETE FROM work_entries WHERE id = 'we_pilot_tmp'");
      await client.query("DELETE FROM workdays WHERE id = 'wd_pilot_tmp'");
      const free = await client.query<{ d: string }>(
        `SELECT to_char(d::date, 'YYYY-MM-DD') AS d
           FROM generate_series('2018-01-01'::date, '2018-12-31'::date, interval '1 day') AS d
          WHERE NOT EXISTS (
            SELECT 1 FROM public.workdays w
             WHERE w.company_id = 'cmp_demo' AND w.worker_id = 'wrk_demo_amar' AND w.work_date = d::date
          )
            AND NOT EXISTS (
              SELECT 1 FROM public.work_entries e
               WHERE e.company_id = 'cmp_demo'
                 AND e.worker_id = 'wrk_demo_amar'
                 AND e.end_state IN ('OPEN', 'KNOWN_END')
                 AND e.started_at < ((d::date + time '15:00') AT TIME ZONE 'Europe/Sarajevo')
                 AND ((d::date + time '07:00') AT TIME ZONE 'Europe/Sarajevo') < COALESCE(e.ended_at, 'infinity'::timestamptz)
            )
          ORDER BY d
          LIMIT 1`,
      );
      const chosen = free.rows[0]?.d;
      if (!chosen) throw new Error("nema slobodnog dana za reset-pilot fixture");
      await client.query(
        `INSERT INTO workdays (id, company_id, worker_id, work_date, status, created_by, updated_by)
         VALUES ('wd_pilot_tmp', 'cmp_demo', 'wrk_demo_amar', $1::date, 'DRAFT', 'usr_sef', 'usr_sef')`,
        [chosen],
      );
      await client.query(
        `INSERT INTO work_entries
           (id, company_id, workday_id, worker_id, kind, started_at, ended_at, end_state, project_id, created_by, updated_by)
         VALUES ('we_pilot_tmp', 'cmp_demo', 'wd_pilot_tmp', 'wrk_demo_amar', 'WORK',
                 ($1 || 'T07:00:00+01:00')::timestamptz, ($1 || 'T15:00:00+01:00')::timestamptz,
                 'KNOWN_END', 'prj_dionica', 'usr_sef', 'usr_sef')`,
        [chosen],
      );
      await client.query(
        `INSERT INTO sync_conflicts
           (id, company_id, actor_id, local_id, work_entry_id, received_payload, payload_hash, server_version)
         VALUES ('cnf_pilot_open', 'cmp_demo', 'usr_radnik', 'pilot-open-1', 'we_pilot_tmp',
                 $1::jsonb, $2, 1)`,
        [
          JSON.stringify({
            kind: "WORK",
            startedAt: `${chosen}T07:05:00+01:00`,
            endedAt: `${chosen}T15:05:00+01:00`,
            endState: "KNOWN_END",
            projectId: "prj_dionica",
            machineId: null,
            note: null,
          }),
          HASH,
        ],
      );
      return chosen;
    });
    expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const before = await admin.query<{ status: string }>(
      "SELECT status FROM public.sync_conflicts WHERE company_id = 'cmp_demo' AND id = 'cnf_demo_1'",
    );
    if (before.rows[0]?.status !== "RESOLVED") {
      const resolved = await resolveWorkdayConflict(app, ured, {
        conflictId: "cnf_demo_1",
        kind: "ACCEPT_SERVER",
        reason: "Dupli unos istog segmenta s telefona",
        idempotencyKey: `reset-pilot-keep-${Date.now()}`,
      });
      expect(resolved.outcome).toBe("RESOLVED");
    }
    await runSeed(["--reset-pilot"]);
    expect(
      (await admin.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.sync_conflicts WHERE id = 'cnf_pilot_open'`))
        .rows[0]?.n,
    ).toBe("0");
    expect(
      (await admin.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.work_entries WHERE id = 'we_pilot_tmp'`))
        .rows[0]?.n,
    ).toBe("0");
    expect(
      (
        await admin.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM public.sync_conflicts
            WHERE company_id = 'cmp_demo' AND id = 'cnf_demo_1' AND status = 'RESOLVED'`,
        )
      ).rows[0]?.n,
    ).toBe("1");
    expect(
      (await admin.query<{ n: string }>("SELECT count(*)::text AS n FROM public.sync_conflicts WHERE company_id = 'cmp_druga'"))
        .rows[0]?.n,
    ).toBe(otherBefore.rows[0]?.n);
    expect(
      (await admin.query<{ email: string }>("SELECT email FROM public.users WHERE id = 'usr_sef'")).rows[0]?.email,
    ).toBe("sef@demo.test");
  }, 180_000);
});
