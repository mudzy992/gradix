/**
 * `budget.thresholds` — pragovi budžeta 80 % i 100 %, po kategoriji i ukupno (spec 06 §1.7.26–27).
 *
 * Zašto worker, a ne servis pri svakom knjiženju: prag je POSLJEDICA zbira, ne pojedinačnog
 * troška. Knjiženje bi tada moralo da računa cijeli budžet projekta u transakciji koja upisuje
 * trošak — a to je isti zbir koji ovaj posao već radi. Uz to, storno troška može spustiti potrošnju
 * ISPOD praga, pa prag nije „dogadjaj“ nego STANJE koje se provjerava.
 *
 * Deduplikacija (tri sloja, svaki rješava drugi problem):
 *   1. `budget_alert_events` UNIQUE `(company_id, dedupe_key)` — jedno upozorenje po pragu po
 *      reviziji po opsegu. Ponovni prolaz posla NE pravi novo upozorenje.
 *   2. `notifications` UNIQUE `(company_id, dedupe_key)` — ista poruka ne ide dvaput u inbox kad
 *      upozorenje ide dvama primateljima (PM i OWNER) kroz `role_target`.
 *   3. `resolved_at` — kad potrošnja padne ispod praga (nova revizija ili storno), upozorenje se
 *      zatvara; ako kasnije opet pređe prag, NOVI red nastaje sa istim `dedupe_key`, pa je
 *      obavještenje moguće ponovo (i to je tačno: rizik se vratio).
 *
 * Kome ide: `PROJECT_MANAGER` i `OWNER` (§1.7.26). Osoba koja vodi projekat i osoba koja
 * odgovara novcem — ne „svi u uredu“, jer bi upozorenje postalo šum.
 */
import type { Pool, PoolClient } from "pg";
import { budgetAlertDedupeKey, crossedBudgetThreshold } from "@gradix/domain";
import type { JobLogger } from "./jobs";

export type BudgetThresholdOutcome = {
  companiesScanned: number;
  projectsChecked: number;
  alertsFired: number;
  alertsResolved: number;
  notificationsCreated: number;
};

type ProjectRow = {
  id: string;
  code: string;
  name: string;
  revision: number | null;
  budget_cents: string | null;
  posted_cents: string | null;
};

type CategoryRow = {
  code: string;
  name: string;
  budget_cents: string | null;
  posted_cents: string | null;
};

/**
 * Izračunaj šta je pređeno i upiši upozorenja za JEDAN projekat.
 *
 * Izdvojeno od prolaza po firmama da bi se moglo testirati nad fiksnim podacima bez baze
 * (`evaluateThresholds` je čista funkcija; `applyThresholds` piše).
 */
export type ThresholdCandidate = {
  scope: string;
  scopeLabel: string;
  budgetCents: bigint;
  spentCents: bigint;
  /** Revizija budžeta — dio `dedupe_key`-a. */
  revision: number;
  thresholdPct: 80 | 100;
  usedPct: number;
};

export function evaluateThresholds(input: {
  total: { budgetCents: bigint | null; spentCents: bigint };
  categories: Array<{ code: string; name: string; budgetCents: bigint | null; spentCents: bigint }>;
  /** Revizija na koju se prag odnosi — dio `dedupe_key`-a, pa ulazi i u sam izračun. */
  revision?: number;
}): ThresholdCandidate[] {
  const revision = input.revision ?? 1;
  const candidates: ThresholdCandidate[] = [];
  const totalCrossing =
    input.total.budgetCents === null
      ? null
      : crossedBudgetThreshold({
          budgetCents: input.total.budgetCents,
          spentCents: input.total.spentCents,
          revision,
        });
  if (totalCrossing && input.total.budgetCents !== null) {
    candidates.push({
      scope: "TOTAL",
      scopeLabel: "ukupno",
      budgetCents: input.total.budgetCents,
      spentCents: input.total.spentCents,
      revision,
      thresholdPct: totalCrossing.thresholdPct,
      usedPct: totalCrossing.usedPct,
    });
  }
  for (const category of input.categories) {
    if (category.budgetCents === null) continue;
    const crossing = crossedBudgetThreshold({
      budgetCents: category.budgetCents,
      spentCents: category.spentCents,
      revision,
    });
    if (!crossing) continue;
    candidates.push({
      scope: category.code,
      scopeLabel: category.name,
      budgetCents: category.budgetCents,
      spentCents: category.spentCents,
      revision,
      thresholdPct: crossing.thresholdPct,
      usedPct: crossing.usedPct,
    });
  }
  return candidates;
}

/** Novac se u bazi drži u centima; prikaz u poruci je decimalni string (bez Intl-a). */
export function centsToText(cents: bigint): string {
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  const whole = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole.toString()}.${fraction}`;
}

/** Naslov poruke: prag u riječima, ne „80“ — osoba koja vidi broj bez konteksta ne zna šta znači. */
export function alertTitle(candidate: ThresholdCandidate, projectCode: string): string {
  const which = candidate.thresholdPct === 100 ? "Budžet prekoračen" : "Budžet pri 80 %";
  return `${which}: ${projectCode} · ${candidate.scopeLabel}`;
}

export function alertBody(candidate: ThresholdCandidate): string {
  return (
    `Potrošeno ${centsToText(candidate.spentCents)} od ${centsToText(candidate.budgetCents)} ` +
    `(${candidate.usedPct.toFixed(1)} %). Upozorenje se ne ponavlja dok se potrošnja ne spusti ` +
    `ispod praga ili ne dođe nova revizija budžeta.`
  );
}

async function loadProjects(client: PoolClient, companyId: string): Promise<ProjectRow[]> {
  const result = await client.query<ProjectRow>(
    `SELECT p.id, p.code, p.name,
            (SELECT max(b.revision) FROM public.project_budget_lines b
              WHERE b.company_id = p.company_id AND b.project_id = p.id) AS revision,
            (SELECT sum(b.amount_cents)::text FROM public.project_budget_lines b
              WHERE b.company_id = p.company_id AND b.project_id = p.id
                AND b.revision = (SELECT max(revision) FROM public.project_budget_lines
                                   WHERE company_id = p.company_id AND project_id = p.id)) AS budget_cents,
            (SELECT coalesce(sum(e.amount_cents), 0)::text FROM public.cost_entries e
              WHERE e.company_id = p.company_id AND e.project_id = p.id
                AND e.status = 'POSTED') AS posted_cents
       FROM public.projects p
      WHERE p.company_id = $1 AND p.is_active AND p.status <> 'FINISHED'
      ORDER BY p.id`,
    [companyId],
  );
  return result.rows;
}

async function loadCategories(client: PoolClient, companyId: string, projectId: string): Promise<CategoryRow[]> {
  const result = await client.query<CategoryRow>(
    `SELECT cc.code, cc.name,
            (SELECT sum(b.amount_cents)::text FROM public.project_budget_lines b
              WHERE b.company_id = $1 AND b.project_id = $2 AND b.category_id = cc.id
                AND b.revision = (SELECT max(revision) FROM public.project_budget_lines
                                   WHERE company_id = $1 AND project_id = $2)) AS budget_cents,
            (SELECT coalesce(sum(e.amount_cents), 0)::text FROM public.cost_entries e
              WHERE e.company_id = $1 AND e.project_id = $2 AND e.category_id = cc.id
                AND e.status = 'POSTED') AS posted_cents
       FROM public.cost_categories cc
      WHERE cc.company_id = $1 AND cc.is_active
      ORDER BY cc.sort_order, cc.code`,
    [companyId, projectId],
  );
  return result.rows;
}

/**
 * Jedan prolaz za firmu. Vraća brojeve koji idu u log — posao bez brojeva ne može se provjeriti.
 */
export async function scanBudgetThresholds(
  pool: Pool,
  options: { logger: JobLogger; onlyCompanyId?: string },
): Promise<BudgetThresholdOutcome> {
  const outcome: BudgetThresholdOutcome = {
    companiesScanned: 0,
    projectsChecked: 0,
    alertsFired: 0,
    alertsResolved: 0,
    notificationsCreated: 0,
  };

  const companies = await pool.query<{ id: string }>(
    options.onlyCompanyId
      ? "SELECT id FROM public.companies WHERE id = $1"
      : "SELECT id FROM public.companies WHERE is_active ORDER BY id",
    options.onlyCompanyId ? [options.onlyCompanyId] : [],
  );

  for (const company of companies.rows) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Tenant se postavlja PO FIRMI: posao nikad ne miješa dvije firme u istoj transakciji.
      await client.query("SELECT set_config('app.company_id', $1, true)", [company.id]);

      const projects = await loadProjects(client, company.id);
      for (const project of projects) {
        outcome.projectsChecked += 1;
        // Bez budžeta nema ni praga — nema šta da se pređe.
        if (project.revision === null || project.budget_cents === null) continue;

        const categories = await loadCategories(client, company.id, project.id);
        const candidates = evaluateThresholds({
          total: {
            budgetCents: BigInt(project.budget_cents),
            spentCents: BigInt(project.posted_cents ?? "0"),
          },
          revision: project.revision,
          categories: categories.map((category) => ({
            code: category.code,
            name: category.name,
            budgetCents: category.budget_cents === null ? null : BigInt(category.budget_cents),
            spentCents: BigInt(category.posted_cents ?? "0"),
          })),
        });

        const active = new Set(candidates.map((candidate) => candidate.scope));
        /*
         * Zatvaranje upozorenja koja više nisu tačna: potrošnja je pala ispod praga (storno) ili je
         * došla nova revizija. Bez ovoga bi staro upozorenje stajalo vječno i posao bi izgledao
         * pokvaren — a i osoba bi gledala rizik koji više ne postoji.
         */
        const stale = await client.query<{ id: string; scope: string; revision: number }>(
          `SELECT id, scope, revision FROM public.budget_alert_events
            WHERE company_id = $1 AND project_id = $2 AND resolved_at IS NULL`,
          [company.id, project.id],
        );
        for (const alert of stale.rows) {
          const stillRelevant =
            alert.revision === project.revision && active.has(String(alert.scope));
          if (stillRelevant) continue;
          await client.query(
            `UPDATE public.budget_alert_events
                SET resolved_at = clock_timestamp()
              WHERE company_id = $1 AND id = $2 AND resolved_at IS NULL`,
            [company.id, alert.id],
          );
          /*
           * `resolved_by` ostaje NULL: upozorenje nije zatvorio ČOVJEK nego stanje (potrošnja je
           * pala ispod praga ili je došla nova revizija). Izmišljati korisnika koji ga je zatvorio
           * bilo bi laganje u auditu — zato F5.3 dozvoljava `resolved_at` bez `resolved_by`.
           */
          outcome.alertsResolved += 1;
        }

        for (const candidate of candidates) {
          const dedupeKey = budgetAlertDedupeKey({
            projectId: project.id,
            revision: project.revision,
            scope: candidate.scope,
            thresholdPct: candidate.thresholdPct,
          });
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO public.budget_alert_events
               (id, company_id, project_id, revision, scope, threshold_pct, dedupe_key)
             VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6)
             ON CONFLICT (company_id, dedupe_key) DO NOTHING
             RETURNING id`,
            [company.id, project.id, project.revision, candidate.scope, candidate.thresholdPct, dedupeKey],
          );
          if ((inserted.rowCount ?? 0) === 0) continue;
          outcome.alertsFired += 1;

          const notificationKey = `budget:${dedupeKey}`;
          const severity = candidate.thresholdPct === 100 ? "CRITICAL" : "WARN";
          const created = await client.query(
            `INSERT INTO public.notifications
               (id, company_id, user_id, role_target, kind, title, body, href, severity,
                source_type, source_id, dedupe_key)
             VALUES (gen_random_uuid()::text, $1, NULL, 'PROJECT_MANAGER', 'budget.threshold',
                     $2, $3, $4, $5, 'project', $6, $7)
             ON CONFLICT (company_id, dedupe_key) DO NOTHING`,
            [
              company.id,
              alertTitle(candidate, project.code),
              alertBody(candidate),
              `/ured/projekti/${project.id}`,
              severity,
              project.id,
              `${notificationKey}:pm`,
            ],
          );
          if ((created.rowCount ?? 0) > 0) outcome.notificationsCreated += 1;

          /*
           * OWNER dobija SVOJU poruku (drugi `dedupe_key`): primaoci su različiti ljudi, a
           * `dedupe_key` je po primаocu — isti ključ bi drugom primaocu ukinuo poruku.
           */
          const ownerCreated = await client.query(
            `INSERT INTO public.notifications
               (id, company_id, user_id, role_target, kind, title, body, href, severity,
                source_type, source_id, dedupe_key)
             VALUES (gen_random_uuid()::text, $1, NULL, 'OWNER', 'budget.threshold',
                     $2, $3, $4, $5, 'project', $6, $7)
             ON CONFLICT (company_id, dedupe_key) DO NOTHING`,
            [
              company.id,
              alertTitle(candidate, project.code),
              alertBody(candidate),
              `/ured/projekti/${project.id}`,
              severity,
              project.id,
              `${notificationKey}:owner`,
            ],
          );
          if ((ownerCreated.rowCount ?? 0) > 0) outcome.notificationsCreated += 1;
        }
      }

      await client.query("COMMIT");
      outcome.companiesScanned += 1;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      options.logger.error("budget.thresholds: firma preskočena", {
        companyId: company.id,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      client.release();
    }
  }

  options.logger.info("budget.thresholds", { ...outcome });
  return outcome;
}
