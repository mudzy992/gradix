/**
 * Administratorska naredba: pravi NOVE demo sukobe u demo firmi.
 *
 * Zašto postoji: razriješeni sukob se NE može vratiti na OPEN (guard
 * nepromjenjivosti u bazi to ispravno brani), pa se potrošena demo fikstura
 * ne „osvježava" — prave se novi sukobi, postojeći se ne diraju.
 *
 * Sigurnost:
 *  - radi SAMO za firmu označenu kao demo (slug `niskogradnja-demo`, ista
 *    oznaka koju koristi `remove-demo.ts`); za svaku drugu firmu staje
 *    prije bilo kakvog upisa;
 *  - pokreće se ručno, pod administratorskom rolom baze (DATABASE_ADMIN_URL),
 *    nikad iz aplikacije i nikad automatski.
 *
 * Svaki poziv pravi 3 nova sukoba: (1) preklopljen unos radnika i šefa,
 * (2) unos sa odstupanjem sata telefona (+6 min), (3) sukob stariji od
 * praga podsjetnika firme.
 *
 * Pokretanje (vidi docs/COOLIFY.md):
 *   DATABASE_ADMIN_URL=... pnpm --filter @gradix/web exec tsx scripts/demo-sukobi.ts
 */
import { Pool } from "pg";
import { pathToFileURL } from "node:url";
import { companyId, withCompany } from "@gradix/db";

export const DEMO_COMPANY_SLUG = "niskogradnja-demo";

export type DemoConflictSpec = {
  suffix: string;
  dateOffsetDays: number;
  createdDaysAgo: number;
  skewMinutes: number | null;
};

export const DEMO_CONFLICT_SPECS: DemoConflictSpec[] = [
  { suffix: "preklop", dateOffsetDays: 1, createdDaysAgo: 1, skewMinutes: null },
  { suffix: "sat", dateOffsetDays: 2, createdDaysAgo: 1, skewMinutes: 6 },
  { suffix: "star", dateOffsetDays: 10, createdDaysAgo: -1, skewMinutes: null },
];

function sarajevoDate(offsetDays: number): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Sarajevo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const date = new Date(Date.UTC(get("year"), get("month") - 1, get("day") - offsetDays));
  return date.toISOString().slice(0, 10);
}

export async function createDemoConflicts(
  pool: Pool,
  slug: string = DEMO_COMPANY_SLUG,
): Promise<{ created: string[] }> {
  if (slug !== DEMO_COMPANY_SLUG) {
    throw new Error(
      `Odbijeno: naredba radi samo za demo firmu (slug ${DEMO_COMPANY_SLUG}), traženo je „${slug}". Ništa nije mijenjano.`,
    );
  }

  const company = await pool.query<{ id: string; conflict_reminder_days: number }>(
    "SELECT id, conflict_reminder_days FROM public.companies WHERE slug = $1",
    [slug],
  );
  const companyRow = company.rows[0];
  if (!companyRow) throw new Error(`Demo firma (slug ${slug}) ne postoji. Prvo pokrenite seed.`);
  const companyIdValue = companyRow.id;
  const threshold = companyRow.conflict_reminder_days;
  const runId = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  const created: string[] = [];

  await withCompany(pool, companyId(companyIdValue), async (client) => {
    const actors = await client.query<{ worker_id: string; user_id: string; role: string }>(
      `SELECT w.id AS worker_id, w.user_id, m.roles[1] AS role
         FROM public.workers w
         JOIN public.memberships m ON m.user_id = w.user_id AND m.company_id = w.company_id AND m.is_active
        WHERE w.company_id = $1 AND w.user_id IS NOT NULL AND w.is_active
        ORDER BY w.id`,
      [companyIdValue],
    );
    const workerActor = actors.rows.find((row) => row.role === "WORKER") ?? actors.rows[0];
    const foremanActor =
      actors.rows.find((row) => row.role === "SITE_SUPERVISOR") ?? actors.rows[actors.rows.length - 1];
    if (!workerActor || !foremanActor) {
      throw new Error("Demo firma nema povezane radnike s korisničkim nalozima. Prvo pokrenite seed.");
    }

    const machine = await client.query<{ id: string }>(
      "SELECT id FROM public.machines WHERE company_id = $1 ORDER BY code LIMIT 1",
      [companyIdValue],
    );
    const project = await client.query<{ id: string }>(
      "SELECT id FROM public.projects WHERE company_id = $1 ORDER BY code LIMIT 1",
      [companyIdValue],
    );
    const machineId = machine.rows[0]?.id ?? null;
    const projectId = project.rows[0]?.id ?? null;

    // Datumi se biraju tako da radnik taj dan još nema unos (zaštita od
    // preklapanja bi inače odbila cijelu naredbu); ide se unazad od željenog
    // pomaka dok se ne nađe slobodan dan.
    const busy = await client.query<{ day: string }>(
      `SELECT DISTINCT work_date::text AS day FROM public.workdays
        WHERE company_id = $1 AND worker_id = $2`,
      [companyIdValue, workerActor.worker_id],
    );
    const busyDays = new Set(busy.rows.map((row) => row.day));

    for (const spec of DEMO_CONFLICT_SPECS) {
      let dateOffset = spec.dateOffsetDays;
      let date = sarajevoDate(dateOffset);
      while (busyDays.has(date) && dateOffset < 90) {
        dateOffset += 1;
        date = sarajevoDate(dateOffset);
      }
      busyDays.add(date);
      const createdDaysAgo = spec.createdDaysAgo >= 0 ? spec.createdDaysAgo : threshold + 2;
      const conflictId = `cnf_uzivo_${spec.suffix}_${runId}`;
      const workdayId = `wd_uzivo_${spec.suffix}_${runId}`;
      const entryId = `we_uzivo_${spec.suffix}_${runId}`;

      await client.query(
        `INSERT INTO public.workdays (id, company_id, worker_id, work_date, status, created_by, updated_by)
         VALUES ($1, $2, $3, $4::date, 'DRAFT', $5, $5)
         ON CONFLICT DO NOTHING`,
        [workdayId, companyIdValue, workerActor.worker_id, date, foremanActor.user_id],
      );
      await client.query(
        `INSERT INTO public.work_entries
           (id, company_id, workday_id, worker_id, kind, started_at, ended_at, end_state, project_id, machine_id, created_by, updated_by)
         VALUES ($1, $2, $3, $4, 'WORK',
                 ($5 || 'T07:30:00+01:00')::timestamptz, ($5 || 'T15:30:00+01:00')::timestamptz,
                 'KNOWN_END', $6, $7, $8, $8)`,
        [entryId, companyIdValue, workdayId, workerActor.worker_id, date, projectId, machineId, foremanActor.user_id],
      );
      const received = {
        kind: "WORK",
        startedAt: `${date}T08:00:00+01:00`,
        endedAt: `${date}T16:00:00+01:00`,
        endState: "KNOWN_END",
        projectId,
        machineId,
        note: null,
        ...(spec.skewMinutes !== null ? { deviceClockSkewMinutes: spec.skewMinutes } : {}),
      };
      await client.query(
        `INSERT INTO public.sync_conflicts
           (id, company_id, actor_id, local_id, work_entry_id, received_payload, payload_hash, server_version, created_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 1, clock_timestamp() - make_interval(days => $8))`,
        [
          conflictId, companyIdValue, workerActor.user_id, `uzivo-${spec.suffix}-${runId}`,
          entryId, JSON.stringify(received), "b".repeat(64), createdDaysAgo,
        ],
      );
      created.push(conflictId);
    }
  });

  return { created };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  if (!adminUrl) throw new Error("Potreban DATABASE_ADMIN_URL");
  const slugArg = process.argv[2];
  const pool = new Pool({ connectionString: adminUrl });
  try {
    const { created } = await createDemoConflicts(pool, slugArg ?? DEMO_COMPANY_SLUG);
    console.log(`Demo sukobi napravljeni (${created.length}): ${created.join(", ")}`);
  } finally {
    await pool.end();
  }
}
