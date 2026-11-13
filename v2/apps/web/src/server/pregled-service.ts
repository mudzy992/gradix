/**
 * C.1 — Pregled za vlasnika, admina, vođu projekta i šefa: „šta moram danas uraditi?“.
 *
 * Pravila koja žive OVDJE, a ne u stranici ili UI-u:
 *  - broj na početnoj i lista na koju red vodi računaju ISTO stanje: rokovi se broje
 *    preko `superseded_by IS NULL` (ista aktivna obaveza koju gleda provjera dodjele),
 *    sukobi kroz `countOpenConflicts` (isti brojevi kao kartica i ekran sukoba), dani
 *    za provjeru kroz `listWorkdaysForReview` (isti opseg kao ekran radnih dana);
 *  - opseg je iz sesije (`Actor.scope`/`projectIds`), nikad iz zahtjeva: `COMPANY` vidi
 *    firmu, `PROJECTS` vidi obaveze na svojim projektima i na ljudima/mašinama koje su
 *    im dodijeljeni — bez obzira na datum dodjele, jer rok ne stari s dodjelom;
 *  - sinhronizaciju vide SAMO OWNER i ADMIN (odobreni dizajn): PM/šef ne dobijaju ni
 *    praznu listu, nego `null`, da ekran ne laže da „nema“ ono što zapravo ne smije vidjeti;
 *  - `today` je poslovni datum firme — sva stanja (isteklo / uskoro / 31–90) računaju
 *    se po njemu. Bucketi su fiksni (30 i 90 dana) jer je pitanje pregleda „šta uskoro“,
 *    a ne „kad me podsetiš“ — pragovi podsjetnika tipa ostaju stvar ekrana rokova.
 *
 * Vraća SAMO podatke; redoslijed, nazive redova, tonove i linkove sastavlja ekran.
 */
import type { Pool } from "pg";
import { withCompany, type CompanyId } from "@gradix/db";
import { visibleProjectIds, type ScopeActor } from "@gradix/domain";
import type {
  PregledAttention,
  PregledBlockedExample,
  PregledConflictExample,
  PregledObligationExample,
  PregledResponse,
  PregledReviewDayExample,
  PregledSyncRow,
} from "@gradix/contracts";
import { can } from "./permissions";
import type { Actor } from "./rbac-service";
import { countOpenConflicts, listConflicts, type ConflictListItem } from "./workday-resolve";
import {
  listWorkdaysForReview,
  resolveViewerWorkerId,
  workdayResolveScopeFor,
  workdayReviewScopeFor,
} from "./workday-review";

/** Ulaz je isto ime koje nose rute i servisi — opseg dolazi iz sesije, ne iz zahtjeva. */
export type PregledActor = Actor & ScopeActor;

/** Koliko najstarijih rokova/dana/sukoba red pokazuje kao „zašto ovaj red postoji“. */
const OLDEST_EXAMPLES = 3;

export async function buildPregled(
  pool: Pool,
  companyIdValue: CompanyId,
  actor: PregledActor,
): Promise<PregledResponse | null> {
  // Granica starog i novog pregleda je dozvola, ne lista rola ovdje (C.1).
  if (!can(actor.roles, "pregled.view")) return null;

  return withCompany(pool, companyIdValue, async (client) => {
    const company = await client.query<{ today: string; timezone: string }>(
      `SELECT (clock_timestamp() AT TIME ZONE c.timezone)::date::text AS today, c.timezone
         FROM public.companies c
        WHERE c.id = $1`,
      [companyIdValue],
    );
    const today = company.rows[0]!.today;
    const timezone = company.rows[0]!.timezone;

    /*
     * Opseg iz sesije: `null` = cijela firma (bez filtera), spisak = samo ti projekti.
     * Ista funkcija koju koriste projekti, rokovi i radni dani — da „moj opseg“ znači
     * isto na svakom ekranu.
     *
     * Svaki upit dobija SVOJE parametre (`freshParams()`): pg šalje sve zadate
     * vrijednosti u Parse poruci, pa bi zajednički niz ostavio nereferencirano mjesto
     * i Postgres odbio cijeli upit (42P18) — vidi „bind message“ lekciju iz A2.
     */
    const projectIds = visibleProjectIds(actor);
    const scoped = projectIds !== null;
    /** Otvara novi niz parametara za JEDAN upit: `mark(v)` vraća mjesto (`$n`) vrijednosti. */
    const freshParams = (leading: unknown[] = []) => {
      const values = [...leading];
      const mark = (value: unknown): string => `$${values.push(value)}`;
      return { values, mark };
    };
    const scopeBase = scoped ? [companyIdValue, projectIds] : [companyIdValue];
    const scopeParam = scoped ? "$2" : null;

    /*
     * Obaveza je „u opsegu“ kad je vezana na projekat iz opsega ILI na radnika/mašinu
     * koje je neko dodijelio na projekat iz opsega. Datum dodjele se NE gleda: rok
     * postoji i kad je čovjek juče skinut s projekta — pitanje pregleda je „šta je
     * isteklo“, a ne „ko je danas tu“.
     */
    const scopePredicate = scoped
      ? `(o.project_id = ANY(${scopeParam})
         OR EXISTS (
              SELECT 1
                FROM public.project_assignments pa
               WHERE pa.company_id = o.company_id
                 AND pa.voided_at IS NULL
                 AND pa.project_id = ANY(${scopeParam})
                 AND ((o.worker_id IS NOT NULL AND pa.worker_id = o.worker_id)
                   OR (o.machine_id IS NOT NULL AND pa.machine_id = o.machine_id))
            ))`
      : "TRUE";

    // --- 1. Rokovi: jedan prolaz, bucketi (isteklo / do 30 / 31–90) u JS. ---
    const obligations = await client.query<{
      expires_at: string;
      type_label: string;
      worker_name: string | null;
      machine_code: string | null;
    }>(
      `SELECT o.expires_at::text AS expires_at,
              t.label AS type_label,
              (w.first_name || ' ' || w.last_name) AS worker_name,
              m.code AS machine_code
         FROM public.obligations o
         JOIN public.obligation_types t ON t.company_id = o.company_id AND t.id = o.type_id
         LEFT JOIN public.workers w ON w.company_id = o.company_id AND w.id = o.worker_id
         LEFT JOIN public.machines m ON m.company_id = o.company_id AND m.id = o.machine_id
        WHERE o.company_id = $1
          AND o.superseded_by IS NULL
          AND o.expires_at IS NOT NULL
          AND ${scopePredicate}
        ORDER BY o.expires_at`,
      scopeBase,
    );

    type ObligationRow = (typeof obligations.rows)[number];
    const target = (row: { worker_name: string | null; machine_code: string | null }): string =>
      row.worker_name ?? row.machine_code ?? "Firma";
    const toExample = (row: ObligationRow): PregledObligationExample => ({
      typeLabel: row.type_label,
      target: target(row),
      expiresAt: row.expires_at,
    });
    const daysLeft = (expiresAt: string): number =>
      Math.round(
        (Date.parse(`${expiresAt}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
      );

    const expiredRows: ObligationRow[] = [];
    const expiring30Rows: ObligationRow[] = [];
    const expiring3190Rows: ObligationRow[] = [];
    for (const row of obligations.rows) {
      const left = daysLeft(row.expires_at);
      if (left < 0) expiredRows.push(row);
      else if (left <= 30) expiring30Rows.push(row);
      else if (left <= 90) expiring3190Rows.push(row);
    }

    // --- 2. Dani za provjeru: ISTI upit i opseg kao ekran „Radni dani“. ---
    const viewerWorkerId = await resolveViewerWorkerId(client, companyIdValue, actor.userId);
    const reviewScope = workdayReviewScopeFor(actor.roles, viewerWorkerId);
    const reviewRows = (await listWorkdaysForReview(client, companyIdValue, reviewScope))
      .filter((day) => day.open_entries > 0 || day.unknown_end > 0)
      .sort((a, b) => a.work_date.localeCompare(b.work_date));
    const reviewExamples: PregledReviewDayExample[] = reviewRows
      .slice(0, OLDEST_EXAMPLES)
      .map((day) => ({
        workerName: day.worker_name,
        workDate: day.work_date,
        kind: day.open_entries > 0 ? ("open" as const) : ("unknown" as const),
      }));

    // --- 3. Sukobi: isti brojevi kao kartica i ekran sukoba; primjeri najstariji. ---
    const resolveScope = workdayResolveScopeFor(actor.roles, viewerWorkerId);
    const conflictCounts = await countOpenConflicts(client, companyIdValue, resolveScope);
    let conflictOldest: ConflictListItem[] = [];
    if (conflictCounts.open > 0) {
      const listed = await listConflicts(client, companyIdValue, resolveScope, {
        status: "OPEN",
        limit: OLDEST_EXAMPLES,
      });
      conflictOldest = listed.conflicts;
    }
    const conflictExamples: PregledConflictExample[] = conflictOldest.map((conflict) => ({
      workerName: conflict.workerName ?? "—",
      createdAt: conflict.createdAt,
    }));

    // --- 4. Blokirane dodjele: ista definicija blokade kao provjera dodjele ---
    //    (aktivna obaveza tipa koji blokuje + istekla + nema važeće iznimke).
    const blockedParams = freshParams(scopeBase);
    const blockedToday = blockedParams.mark(today);
    const blocked = await client.query<{ target: string; type_label: string }>(
      `SELECT COALESCE(m.code, (w.first_name || ' ' || w.last_name)) AS target,
              t.label AS type_label
         FROM public.project_assignments a
         JOIN public.projects p ON p.company_id = a.company_id AND p.id = a.project_id
         LEFT JOIN public.workers w ON w.company_id = a.company_id AND w.id = a.worker_id
         LEFT JOIN public.machines m ON m.company_id = a.company_id AND m.id = a.machine_id
         JOIN public.obligations o
           ON o.company_id = a.company_id
          AND o.superseded_by IS NULL
          AND (o.worker_id = a.worker_id OR o.machine_id = a.machine_id)
         JOIN public.obligation_types t ON t.company_id = o.company_id AND t.id = o.type_id
        WHERE a.company_id = $1
          AND a.voided_at IS NULL
          ${scoped ? `AND a.project_id = ANY(${scopeParam})` : ""}
          AND t.blocks_assignment
          AND o.expires_at < ${blockedToday}::date
          AND NOT EXISTS (
                SELECT 1
                  FROM public.project_assignment_overrides ov
                 WHERE ov.company_id = a.company_id
                   AND ov.assignment_id = a.id
                   AND ov.obligation_id = o.id
                   AND ov.valid_until >= ${blockedToday}::date
              )`,
      blockedParams.values,
    );
    const blockedExamples: PregledBlockedExample[] = blocked.rows
      .slice(0, OLDEST_EXAMPLES)
      .map((row) => ({ target: row.target, typeLabel: row.type_label }));

    /*
     * --- 5. Sažetak: svijet u opsegu osobe. ---
     * Cijela firma: „aktivni radnici/mašine“ = `is_active` (zaposleni, ne ikad viđeni).
     * Suženi opseg: ono što je datumski važeće dodijeljeno na projekte iz opsega —
     * PM-u „31 radnik firme“ ništa ne kaže, njegovo pitanje je „ko je na mojim gradilištima“.
     */
    const summaryParams = freshParams(scopeBase);
    // `today` koriste samo sužene grane (datumski važeće dodjele); u granu cijele
    // firme bi ostao nereferenciran, a svaki zadati parametar Postgres mora znati
    // utipkati (42P18). Zato se markira samo kad ga neko stvarno cita.
    const summaryToday = scoped ? summaryParams.mark(today) : null;
    const summaryTz = summaryParams.mark(timezone);
    const summaryWeek = summaryParams.mark(weekStart(today));
    const summary = await client.query<{
      projects: number;
      workers: number;
      machines: number;
      entries: number;
    }>(
      `SELECT
         (SELECT count(*) FROM public.projects p
           WHERE p.company_id = $1 AND p.is_active ${scoped ? `AND p.id = ANY(${scopeParam})` : ""})::int AS projects,
         ${
           scoped
             ? `(SELECT count(DISTINCT a.worker_id) FROM public.project_assignments a
                  WHERE a.company_id = $1 AND a.voided_at IS NULL AND a.worker_id IS NOT NULL
                    AND a.from_date <= ${summaryToday}::date
                    AND (a.to_date IS NULL OR a.to_date >= ${summaryToday}::date)
                    AND a.project_id = ANY(${scopeParam}))::int`
             : `(SELECT count(*) FROM public.workers w WHERE w.company_id = $1 AND w.is_active)::int`
         } AS workers,
         ${
           scoped
             ? `(SELECT count(DISTINCT a.machine_id) FROM public.project_assignments a
                  WHERE a.company_id = $1 AND a.voided_at IS NULL AND a.machine_id IS NOT NULL
                    AND a.from_date <= ${summaryToday}::date
                    AND (a.to_date IS NULL OR a.to_date >= ${summaryToday}::date)
                    AND a.project_id = ANY(${scopeParam}))::int`
             : `(SELECT count(*) FROM public.machines m WHERE m.company_id = $1 AND m.is_active)::int`
         } AS machines,
         (SELECT count(*) FROM public.work_entries e
           WHERE e.company_id = $1
             AND (e.started_at AT TIME ZONE ${summaryTz}::text)::date >= ${summaryWeek}::date
             ${scoped ? `AND e.project_id = ANY(${scopeParam})` : ""})::int AS entries`,
      summaryParams.values,
    );

    /*
     * --- 6. Sinhronizacija: SAMO OWNER i ADMIN (odobreni dizajn C.1). ---
     * „Neuspješne stavke“ = odbijeni računi (REJECTED/CONFLICT u receipt-u) + nerazriješeni
     * sukobi tog autora — ista stvar koju autor vidi na telefonu kad pokuša ponovo.
     */
    let sync: PregledSyncRow[] | null = null;
    // Namjerno rola, a ne posuđena dozvola: odobreni dizajn kaže „samo OWNER i ADMIN“.
    // Da je ovo npr. `users.manage`, promjena te dozvole bi tiho pomjerila i ovu granicu.
    if (actor.roles.includes("OWNER") || actor.roles.includes("ADMIN")) {
      const receipts = await client.query<{
        user_id: string;
        name: string;
        last_sync: Date;
        failed: number;
      }>(
        `SELECT s.actor_id AS user_id,
                (u.first_name || ' ' || u.last_name) AS name,
                max(s.created_at) AS last_sync,
                count(*) FILTER (WHERE s.result->>'status' IN ('REJECTED', 'CONFLICT'))::int AS failed
           FROM public.sync_receipts s
           JOIN public.users u ON u.id = s.actor_id
          WHERE s.company_id = $1
          GROUP BY s.actor_id, u.first_name, u.last_name
          ORDER BY max(s.created_at) DESC
          LIMIT 8`,
        [companyIdValue],
      );
      const openConflicts = await client.query<{ actor_id: string; n: number }>(
        `SELECT actor_id, count(*)::int AS n
           FROM public.sync_conflicts
          WHERE company_id = $1 AND status = 'OPEN'
          GROUP BY actor_id`,
        [companyIdValue],
      );
      const conflictsByActor = new Map(openConflicts.rows.map((row) => [row.actor_id, row.n]));
      sync = receipts.rows.map((row) => ({
        userId: row.user_id,
        name: row.name,
        lastSyncAt: row.last_sync.toISOString(),
        failedItems: row.failed + (conflictsByActor.get(row.user_id) ?? 0),
      }));
    }

    const attention: PregledAttention = {
      expired: {
        count: expiredRows.length,
        oldest: expiredRows.slice(0, OLDEST_EXAMPLES).map(toExample),
      },
      conflicts: {
        count: conflictCounts.open,
        olderThanThreshold: conflictCounts.olderThanThreshold,
        thresholdDays: conflictCounts.thresholdDays,
        oldest: conflictExamples,
      },
      expiring30: {
        count: expiring30Rows.length,
        nearest: expiring30Rows.length > 0 ? toExample(expiring30Rows[0]!) : null,
      },
      reviewDays: {
        count: reviewRows.length,
        oldest: reviewExamples,
      },
      blockedAssignments: {
        count: blocked.rows.length,
        examples: blockedExamples,
      },
      expiring3190: {
        count: expiring3190Rows.length,
        nearest: expiring3190Rows.length > 0 ? toExample(expiring3190Rows[0]!) : null,
      },
    };

    return {
      today,
      timezone,
      attention,
      summary: {
        activeProjects: summary.rows[0]!.projects,
        activeWorkers: summary.rows[0]!.workers,
        activeMachines: summary.rows[0]!.machines,
        entriesThisWeek: summary.rows[0]!.entries,
      },
      sync,
      scope: scoped ? "projects" : "company",
    };
  });
}

/** Početak sedmice (ponedjeljak) poslovnog datuma firme — „unosi rada ovaj tjedan“. */
function weekStart(today: string): string {
  const date = new Date(`${today}T00:00:00Z`);
  const shift = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - shift);
  return date.toISOString().slice(0, 10);
}
