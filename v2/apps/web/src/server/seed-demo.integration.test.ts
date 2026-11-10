/**
 * Regresija (telefon, 2026-11-07): demo seed nije povezivao šefa s radničkim zapisom
 * (workers.user_id), pa je Grupa na stagingu bila zauvijek prazna. Test stvarno pokreće
 * seed (idempotentan je) i provjerava veze, ekipu od 5 i roster odgovor za šefa.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as foremanWorkersRoute } from "@/app/api/sync/foreman-workers/route";
import { ACCESS_COOKIE, issueAccessToken } from "./session";

const run = promisify(execFile);
const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = appUrl && adminUrl ? describe : describe.skip;

describeDb("demo seed: veze korisnik-radnik i šefova ekipa", () => {
  const admin = new Pool({ connectionString: adminUrl, max: 2 });

  beforeAll(async () => {
    const webDir = fileURLToPath(new URL("../..", import.meta.url));
    await run(process.execPath, ["--import", "tsx", "scripts/seed.ts"], {
      cwd: webDir,
      env: { ...process.env, DATABASE_ADMIN_URL: adminUrl, SEED_PASSWORD: "seed-test-lozinka-123" },
      timeout: 120_000,
    });
    await admin.query(
      `INSERT INTO public.sessions (id, company_id, user_id, token_hash, expires_at)
       VALUES ('ses_seed_test', 'cmp_demo', 'usr_sef', 'hash_seed_test', clock_timestamp() + interval '1 day')
       ON CONFLICT (id) DO NOTHING`,
    );
  }, 180_000);

  afterAll(async () => {
    await admin.query("DELETE FROM public.sessions WHERE id = 'ses_seed_test'");
    await admin.end();
  });

  it("šef i radnik su povezani s radničkim zapisima", async () => {
    const links = await admin.query<{ id: string; user_id: string | null }>(
      "SELECT id, user_id FROM public.workers WHERE id = ANY($1)",
      [["wrk_demo_mario", "wrk_demo_amar", "wrk_demo_nedim", "wrk_demo_selmir", "wrk_demo_haris"]],
    );
    const byId = new Map(links.rows.map((row) => [row.id, row.user_id]));
    expect(byId.get("wrk_demo_mario")).toBe("usr_sef");
    expect(byId.get("wrk_demo_amar")).toBe("usr_radnik");
    expect(byId.size).toBe(5);
  });

  it("roster za šefa vraća ekipu od 5 na demo projektu", async () => {
    const today = await admin.query<{ d: string }>(
      "SELECT (clock_timestamp() AT TIME ZONE timezone)::date::text AS d FROM public.companies WHERE id = 'cmp_demo'",
    );
    const cookie = `${ACCESS_COOKIE}=${issueAccessToken({ sub: "usr_sef", sid: "ses_seed_test", companyId: "cmp_demo" })}`;
    const response = await foremanWorkersRoute(new NextRequest(
      `http://interni/api/sync/foreman-workers?projectId=prj_dionica&workDate=${today.rows[0]!.d}`,
      { headers: { cookie } },
    ));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { workers: { id: string }[] } };
    expect(body.data.workers.map((w) => w.id).sort()).toEqual(
      ["wrk_demo_amar", "wrk_demo_haris", "wrk_demo_mario", "wrk_demo_nedim", "wrk_demo_selmir"].sort(),
    );
  });
});
