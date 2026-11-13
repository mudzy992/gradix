/**
 * C.1 — Pregled na DEMO podacima: indeksi i p95 (zahtjev vlasnika: „izmjeriti i izvijestiti“).
 *
 * Demo firma (seed + demo-pregled + demo-sukobi) je najbliže stvarnom obimu kakav
 * pilot ima, pa se ovdje mjere stvari koje fixture ne može pokazati:
 *  (1) p95 punog `buildPregled` poziva (sve kartice, jedan zahtjev) ispod 300 ms —
 *      za COMPANY i za PROJECTS opseg;
 *  (2) planovi upita: koji indeksi nose pristup — planovi se ispisuju u log testa
 *      (izvještaj), a test pada ako neki upit na demo podacima potra više od 50 ms
 *      ILIKO indeks kojeg dizajn računa da postoji nije u bazi.
 *
 * Namjerno bez umjetnog skaliranja: ovo je mjerenje na podacima na kojima će pilot
 * živjeti, ne benchmark. Rast pokrivaju indeksi (assert dolaze) i B2 dokaz 350/350.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyId } from "@gradix/db";
import { seedDemoPregled } from "../../scripts/demo-pregled";
import { createDemoConflicts } from "../../scripts/demo-sukobi";
import { buildPregled, type PregledActor } from "../server/pregled-service";

const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL;
const describeDb = appUrl && adminUrl ? describe : describe.skip;

/** p95 nearest-rank: vrijednost na poziciji ceil(0.95 * n) u sortiranom nizu. */
function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(0.95 * sorted.length));
  return sorted[rank - 1]!;
}

/** Plan upita → spisak čvorova i indeksa, jedan red za log. */
function planNodes(plan: Record<string, unknown>): string[] {
  const nodes: string[] = [];
  const walk = (node: Record<string, unknown>) => {
    const type = String(node["Node Type"]);
    const index = node["Index Name"] ? `(${String(node["Index Name"])})` : "";
    nodes.push(`${type}${index}`);
    for (const child of ((node["Plans"] ?? []) as Array<Record<string, unknown>>)) walk(child);
  };
  walk(plan);
  return nodes;
}

describeDb("C.1 Pregled: indeksi i p95 na demo podacima", () => {
  const admin = new Pool({ connectionString: adminUrl, max: 2 });
  const app = new Pool({ connectionString: appUrl, max: 4 });

  beforeAll(async () => {
    // Demo firma: seed (idempotentan) + C.1 podaci (blokada, dani, sync) + sukobi.
    const run = promisify(execFile);
    const webDir = fileURLToPath(new URL("../..", import.meta.url));
    await run(process.execPath, ["--import", "tsx", "scripts/seed.ts"], {
      cwd: webDir,
      env: { ...process.env, DATABASE_ADMIN_URL: adminUrl, SEED_PASSWORD: "seed-test-lozinka-123" },
      timeout: 120_000,
    });
    await seedDemoPregled(admin);
    await createDemoConflicts(admin);
  }, 180_000);

  afterAll(async () => {
    await admin.end();
    await app.end();
  });

  const owner: PregledActor = { userId: "usr_vlasnik", roles: ["OWNER"], scope: "COMPANY", projectIds: [] };

  it("p95 punog pregleda ispod 300 ms (COMPANY opseg, 30 mjerenja nakon zagrijavanja)", async () => {
    const demo = await admin.query<{ user_id: string; roles: string[]; scope: string }>(
      `SELECT m.user_id, m.roles::text[] AS roles, m.scope
         FROM public.memberships m
        WHERE m.company_id = 'cmp_demo' AND m.scope = 'PROJECTS' AND 'PROJECT_MANAGER' = ANY(m.roles) AND m.is_active
        LIMIT 1`,
    );
    const pmRow = demo.rows[0]!;
    const pmProjects = await admin.query<{ project_id: string }>(
      `SELECT DISTINCT a.project_id FROM public.project_assignments a
         JOIN public.workers w ON w.company_id = a.company_id AND w.id = a.worker_id
        WHERE a.company_id = 'cmp_demo' AND w.user_id = $1 AND a.voided_at IS NULL`, [pmRow.user_id],
    );

    const measure = async (actor: Parameters<typeof buildPregled>[2], label: string) => {
      for (let i = 0; i < 3; i += 1) await buildPregled(app, companyId("cmp_demo"), actor); // zagrijavanje
      const samples: number[] = [];
      for (let i = 0; i < 30; i += 1) {
        const started = performance.now();
        const result = await buildPregled(app, companyId("cmp_demo"), actor);
        expect(result).not.toBeNull();
        samples.push(performance.now() - started);
      }
      const value = p95(samples);
      console.log(`[C.1 p95] ${label}: p95 = ${value.toFixed(0)} ms (min ${Math.min(...samples).toFixed(0)}, max ${Math.max(...samples).toFixed(0)})`);
      return value;
    };

    const ownerP95 = await measure(owner, "OWNER, cijela firma");
    const pmP95 = await measure(
      { userId: pmRow.user_id, roles: pmRow.roles, scope: "PROJECTS", projectIds: pmProjects.rows.map((r) => r.project_id) },
      "PROJECT_MANAGER, suženi opseg",
    );
    expect(ownerP95, "p95 OWNER mora biti ispod 300 ms").toBeLessThan(300);
    expect(pmP95, "p95 PM mora biti ispod 300 ms").toBeLessThan(300);
  });

  it("planovi upita na demo podacima: indeksi postoje i nijedan upit ne prelazi 50 ms", async () => {
    // (a) Indeksi koji nose pristup — dizajn upita računa na njih; nedostatak = greška dizajna.
    const expected = [
      "obligations_company_expires_idx",
      "obligations_worker_idx",
      "obligations_machine_idx",
      "sync_receipts_company_actor_local_unique",
      "workdays_company_worker_date_idx",
      "work_entries_company_workday_idx",
      "project_assignments_project_idx",
    ];
    const indexes = await admin.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY($1)`,
      [expected],
    );
    expect(indexes.rows.map((row) => row.indexname).sort()).toEqual([...expected].sort());

    // (b) Planovi i trajanje jezgrenih upita (kopije iz pregled-service, uz napomenu da
    //     se održavaju zajedno). Format JSON + ANALYZE: stvarno vrijeme, ne procjena.
    const explain = async (label: string, sql: string, params: unknown[]) => {
      const result = await admin.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`, params);
      const root = (result.rows[0] as Record<string, unknown>)["QUERY PLAN"] as Array<Record<string, unknown>>;
      const plan = root[0]!["Plan"] as Record<string, unknown>;
      const timing = root[0]!["Execution Time"] as number;
      console.log(`[C.1 plan] ${label}: ${timing.toFixed(2)} ms — ${planNodes(plan).join(" | ")}`);
      expect(timing, `${label} ne smije trajati više od 50 ms na demo podacima`).toBeLessThan(50);
    };

    await explain(
      "rokovi (isteklo/uskoro/31-90)",
      `SELECT o.expires_at, t.label
         FROM public.obligations o
         JOIN public.obligation_types t ON t.company_id = o.company_id AND t.id = o.type_id
        WHERE o.company_id = $1 AND o.superseded_by IS NULL AND o.expires_at IS NOT NULL
        ORDER BY o.expires_at`,
      ["cmp_demo"],
    );
    await explain(
      "sinhronizacija po osobi",
      `SELECT s.actor_id, max(s.created_at) AS last,
            count(*) FILTER (WHERE s.result->>'status' IN ('REJECTED', 'CONFLICT'))::int AS failed
         FROM public.sync_receipts s
         JOIN public.users u ON u.id = s.actor_id
        WHERE s.company_id = $1
        GROUP BY s.actor_id`,
      ["cmp_demo"],
    );
    await explain(
      "dani za provjeru",
      `SELECT d.id, count(e.id) FILTER (WHERE e.end_state = 'OPEN' AND e.ended_at IS NULL) AS open_seg,
              count(e.id) FILTER (WHERE e.end_state = 'UNKNOWN_END') AS unk
         FROM public.workdays d
         JOIN public.workers w ON w.company_id = d.company_id AND w.id = d.worker_id
         LEFT JOIN public.work_entries e ON e.company_id = d.company_id AND e.workday_id = d.id
        WHERE d.company_id = $1
        GROUP BY d.id`,
      ["cmp_demo"],
    );
    await explain(
      "blokirane dodjele",
      `SELECT a.id
         FROM public.project_assignments a
         JOIN public.obligations o
           ON o.company_id = a.company_id AND o.superseded_by IS NULL
          AND (o.worker_id = a.worker_id OR o.machine_id = a.machine_id)
         JOIN public.obligation_types t ON t.company_id = o.company_id AND t.id = o.type_id
        WHERE a.company_id = $1 AND a.voided_at IS NULL AND t.blocks_assignment
          AND o.expires_at < (clock_timestamp() AT TIME ZONE 'Europe/Sarajevo')::date`,
      ["cmp_demo"],
    );
  });
});
