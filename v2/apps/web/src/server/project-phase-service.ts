/**
 * F5 (Modul 6 §1.1): faze, zavisnosti i napredak.
 *
 * Ukupni napredak se NE čuva — računa se iz faza (`Σ progress × weight / Σ weight`) jer bi
 * sačuvan broj mogao odstupiti od faza iz kojih je nastao, a onda dva ekrana pokazuju dvije
 * istine o istom projektu.
 *
 * Zavisnost faza je **upozorenje**, nikad blokada (§1.1.4): pomjeranje datuma prije završetka
 * zavisne faze vraća `dependencyWarnings` uz uspješan odgovor. Blokada bi tjerala ljude da
 * lažno pomjeraju datume da bi „prošlo“, a to je gori podatak od upozorenja.
 */
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import { projectProgress, projectMargin, estimateAtCompletion, type PhaseStatus } from "@gradix/domain";
import { can } from "./permissions";
import { writeAudit } from "./audit";
import { companyToday } from "./project-service";
import type {
  PhaseDependencyInput,
  PhaseInput,
  PhasePatch,
  PhaseRow,
  PhasesResult,
  PhaseServiceError,
} from "./project-phase-types";

type DbPhase = {
  id: string;
  project_id: string;
  code: string;
  name: string;
  sort_order: number;
  weight: number;
  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  progress_pct: number;
  status: string;
};

type DbDependency = {
  phase_id: string;
  depends_on_phase_id: string;
};

async function loadPhases(client: PoolClient, companyId: string, projectId: string): Promise<DbPhase[]> {
  const result = await client.query<DbPhase>(
    `SELECT id, project_id, code, name, sort_order, weight,
            planned_start::text, planned_end::text, actual_start::text, actual_end::text,
            progress_pct, status
       FROM public.project_phases
      WHERE company_id = $1 AND project_id = $2
      ORDER BY sort_order, code`,
    [companyId, projectId],
  );
  return result.rows;
}

async function loadDependencies(
  client: PoolClient,
  companyId: string,
  projectId: string,
): Promise<DbDependency[]> {
  const result = await client.query<DbDependency>(
    `SELECT d.phase_id, d.depends_on_phase_id
       FROM public.phase_dependencies d
       JOIN public.project_phases p
         ON p.company_id = d.company_id AND p.id = d.phase_id
      WHERE d.company_id = $1 AND p.project_id = $2`,
    [companyId, projectId],
  );
  return result.rows;
}

/**
 * Za svaku fazu: koje zavisnosti JOŠ nijesu završene. Upozorenje se vezuje na fazu koja čeka
 * (`phase_id`), a ne na onu koja kasni — jer čovjek koji pomjera datum radi na fazi koja čeka.
 */
function dependencyWarnings(
  phases: DbPhase[],
  dependencies: DbDependency[],
): Map<string, string[]> {
  const byId = new Map(phases.map((phase) => [phase.id, phase]));
  const warnings = new Map<string, string[]>();
  for (const dependency of dependencies) {
    const waiting = byId.get(dependency.phase_id);
    const prerequisite = byId.get(dependency.depends_on_phase_id);
    if (!waiting || !prerequisite) continue;
    if (prerequisite.status === "DONE" || prerequisite.status === "CANCELLED") continue;
    const list = warnings.get(waiting.id) ?? [];
    list.push(
      `Zavisi od faze „${prerequisite.code} — ${prerequisite.name}“ koja još nije završena.`,
    );
    warnings.set(waiting.id, list);
  }
  return warnings;
}

function toRows(
  phases: DbPhase[],
  dependencies: DbDependency[],
  progressPct: number | null,
): PhaseRow[] {
  const warnings = dependencyWarnings(phases, dependencies);
  const totalWeight = phases
    .filter((phase) => phase.status !== "CANCELLED")
    .reduce((acc, phase) => acc + phase.weight, 0);
  return phases.map((phase) => {
    // `weighted_share` = koliko ova faza nosi u ukupnom procentu (pri svom trenutnom napretku).
    const weightedShare =
      phase.status === "CANCELLED" || totalWeight === 0
        ? 0
        : Math.round(((phase.progress_pct * phase.weight) / totalWeight) * 100) / 100;
    return {
      id: phase.id,
      project_id: phase.project_id,
      code: phase.code,
      name: phase.name,
      sort_order: phase.sort_order,
      weight: phase.weight,
      planned_start: phase.planned_start,
      planned_end: phase.planned_end,
      actual_start: phase.actual_start,
      actual_end: phase.actual_end,
      progress_pct: phase.progress_pct,
      status: phase.status as PhaseStatus,
      weighted_share: weightedShare,
      dependency_warnings: warnings.get(phase.id) ?? [],
    };
  });
  void progressPct;
}

async function projectProgressSource(
  client: PoolClient,
  companyId: string,
  projectId: string,
): Promise<"MANUAL" | "BOQ"> {
  const result = await client.query<{ progress_source: string }>(
    "SELECT progress_source FROM public.projects WHERE company_id = $1 AND id = $2",
    [companyId, projectId],
  );
  return result.rows[0]?.progress_source === "BOQ" ? "BOQ" : "MANUAL";
}

async function snapshot(
  client: PoolClient,
  companyId: string,
  projectId: string,
): Promise<PhasesResult> {
  const phases = await loadPhases(client, companyId, projectId);
  const dependencies = await loadDependencies(client, companyId, projectId);
  const progressSource = await projectProgressSource(client, companyId, projectId);
  let progressPct: number | null = null;
  if (progressSource === "MANUAL") {
    progressPct = projectProgress(
      phases.map((phase) => ({
        weight: phase.weight,
        progressPct: phase.progress_pct,
        status: phase.status as PhaseStatus,
      })),
    );
  } else {
    const boq = await client.query<{
      quantity_planned: string;
      quantity_executed: string;
      unit_price_cents: string;
    }>(
      `SELECT quantity_planned::text, quantity_executed::text, unit_price_cents::text
         FROM public.project_boq_items WHERE company_id = $1 AND project_id = $2`,
      [companyId, projectId],
    );
    const { boqProgress } = await import("@gradix/domain");
    progressPct = boqProgress(
      boq.rows.map((item) => ({
        quantityPlanned: Number(item.quantity_planned),
        quantityExecuted: Number(item.quantity_executed),
        unitPriceCents: BigInt(item.unit_price_cents),
      })),
    );
    // Kod `BOQ` se napredak faza izvodi iz predmjera po fazi, pa pojedinačne % ne diramo.
  }
  return { phases: toRows(phases, dependencies, progressPct), progress_pct: progressPct, progress_source: progressSource };
}

export async function listPhases(
  pool: Pool,
  actor: { userId: string; companyId: string; roles: Parameters<typeof can>[0] },
  projectId: string,
): Promise<PhasesResult | PhaseServiceError> {
  if (!can(actor.roles, "projects.view")) {
    return { code: "FORBIDDEN", message: "Nemate pravo pregleda projekata." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const project = await client.query("SELECT 1 FROM public.projects WHERE company_id = $1 AND id = $2", [
      actor.companyId,
      projectId,
    ]);
    if (!project.rows[0]) return { code: "NOT_FOUND", message: "Projekat nije pronađen." };
    return snapshot(client, actor.companyId, projectId);
  });
}

export async function createPhase(
  pool: Pool,
  actor: { userId: string; companyId: string; roles: Parameters<typeof can>[0] },
  projectId: string,
  input: PhaseInput,
): Promise<PhasesResult | PhaseServiceError> {
  if (!can(actor.roles, "projects.manage")) {
    return { code: "FORBIDDEN", message: "Nemate pravo upravljanja projektom." };
  }
  if (!Number.isInteger(input.weight) || input.weight < 1) {
    // Zaseban kod: ekran tada traži TEŽINU, a ne popravku cijelog unosa (§1.1.2).
    return { code: "PHASE_WEIGHT_REQUIRED", message: "Težina faze je obavezna i mora biti ≥ 1." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const project = await client.query("SELECT 1 FROM public.projects WHERE company_id = $1 AND id = $2", [
      actor.companyId,
      projectId,
    ]);
    if (!project.rows[0]) return { code: "NOT_FOUND", message: "Projekat nije pronađen." };
    const id = `ph_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    try {
      await client.query(
        `INSERT INTO public.project_phases
           (id, company_id, project_id, code, name, sort_order, weight, planned_start, planned_end,
            progress_pct, status, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$9::date,$10,$11,$12,$12)`,
        [
          id,
          actor.companyId,
          projectId,
          input.code,
          input.name,
          input.sortOrder ?? 0,
          input.weight,
          input.plannedStart ?? null,
          input.plannedEnd ?? null,
          input.progressPct ?? 0,
          input.status ?? "PLANNED",
          actor.userId,
        ],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("project_phases_project_code_unique")) {
        return { code: "CONFLICT", message: "Faza sa tom šifrom već postoji na projektu." };
      }
      if (message.includes("project_phases_done_check")) {
        return {
          code: "VALIDATION_FAILED",
          message: "Završena faza mora imati 100 % i stvarni datum završetka.",
        };
      }
      throw error;
    }
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "project.phase_created",
      entityType: "project_phase",
      entityId: id,
      metadata: { projectId, code: input.code, weight: input.weight },
    });
    return snapshot(client, actor.companyId, projectId);
  });
}

export async function updatePhase(
  pool: Pool,
  actor: { userId: string; companyId: string; roles: Parameters<typeof can>[0] },
  projectId: string,
  input: PhasePatch,
): Promise<PhasesResult | PhaseServiceError> {
  if (!can(actor.roles, "projects.manage")) {
    return { code: "FORBIDDEN", message: "Nemate pravo upravljanja projektom." };
  }
  if (input.weight !== undefined && (!Number.isInteger(input.weight) || input.weight < 1)) {
    return { code: "PHASE_WEIGHT_REQUIRED", message: "Težina faze mora biti ≥ 1." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const phase = await client.query<{ id: string; status: string; progress_pct: number }>(
      `SELECT id, status, progress_pct FROM public.project_phases
        WHERE company_id = $1 AND project_id = $2 AND id = $3`,
      [actor.companyId, projectId, input.id],
    );
    if (!phase.rows[0]) return { code: "NOT_FOUND", message: "Faza nije pronađena." };

    const sets: string[] = [];
    const params: unknown[] = [actor.companyId, projectId, input.id];
    const set = (column: string, value: unknown, cast = "") => {
      params.push(value);
      sets.push(`${column} = $${params.length}${cast}`);
    };
    if (input.code !== undefined) set("code", input.code);
    if (input.name !== undefined) set("name", input.name);
    if (input.sortOrder !== undefined) set("sort_order", input.sortOrder);
    if (input.weight !== undefined) set("weight", input.weight);
    if (input.plannedStart !== undefined) set("planned_start", input.plannedStart, "::date");
    if (input.plannedEnd !== undefined) set("planned_end", input.plannedEnd, "::date");
    if (input.progressPct !== undefined) set("progress_pct", Math.round(input.progressPct));
    if (input.status !== undefined) {
      set("status", input.status);
      /*
       * `DONE` je 100 % + datum (§ baza). Popunjavamo ga OVDJE, a ne u ekranu: inače bi svaki
       * klijent morao znati isto pravilo, a mobilni bi ga zaboravio.
       */
      if (input.status === "DONE") {
        if (input.progressPct === undefined) {
          params.push(100);
          sets.push(`progress_pct = $${params.length}`);
        }
        params.push(await companyToday(client, toCompanyId(actor.companyId)));
        sets.push(`actual_end = coalesce(actual_end, $${params.length}::date)`);
      }
      if (input.status === "ACTIVE" && phase.rows[0].status === "PLANNED") {
        params.push(await companyToday(client, toCompanyId(actor.companyId)));
        sets.push(`actual_start = coalesce(actual_start, $${params.length}::date)`);
      }
    }
    if (sets.length === 0) return snapshot(client, actor.companyId, projectId);
    params.push(actor.userId);
    sets.push(`updated_by = $${params.length}`, "updated_at = clock_timestamp()");
    try {
      await client.query(
        `UPDATE public.project_phases SET ${sets.join(", ")}
          WHERE company_id = $1 AND project_id = $2 AND id = $3`,
        params,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("project_phases_done_check")) {
        return {
          code: "VALIDATION_FAILED",
          message: "Završena faza mora imati 100 % i stvarni datum završetka.",
        };
      }
      throw error;
    }
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "project.phase_updated",
      entityType: "project_phase",
      entityId: input.id,
      metadata: { projectId, fields: sets.length },
    });
    return snapshot(client, actor.companyId, projectId);
  });
}

export async function addPhaseDependency(
  pool: Pool,
  actor: { userId: string; companyId: string; roles: Parameters<typeof can>[0] },
  projectId: string,
  input: PhaseDependencyInput,
): Promise<PhasesResult | PhaseServiceError> {
  if (!can(actor.roles, "projects.manage")) {
    return { code: "FORBIDDEN", message: "Nemate pravo upravljanja projektom." };
  }
  if (input.phaseId === input.dependsOnPhaseId) {
    return { code: "VALIDATION_FAILED", message: "Faza ne može zavisiti od same sebe." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    /*
     * Ciklus se provjerava OVDJE, ne trigerom: rekurzivni triger bi dao poruku „constraint“ ili
     * beskonačnu petlju, a čovjeku treba rečenica koja kaže šta je problem.
     */
    const cycle = await client.query(
      `WITH RECURSIVE lanac(id) AS (
         SELECT $3::text
         UNION
         SELECT d.depends_on_phase_id
           FROM public.phase_dependencies d
           JOIN lanac l ON l.id = d.phase_id
          WHERE d.company_id = $1
       )
       SELECT 1 FROM lanac WHERE id = $2 LIMIT 1`,
      [actor.companyId, input.phaseId, input.dependsOnPhaseId],
    );
    if (cycle.rows[0]) {
      return { code: "VALIDATION_FAILED", message: "Ta zavisnost pravi ciklus između faza." };
    }
    await client.query(
      `INSERT INTO public.phase_dependencies
         (id, company_id, phase_id, depends_on_phase_id, kind, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (company_id, phase_id, depends_on_phase_id) DO NOTHING`,
      [
        `phd_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        actor.companyId,
        input.phaseId,
        input.dependsOnPhaseId,
        input.kind ?? "START_AFTER_FINISH",
        actor.userId,
      ],
    );
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "project.phase_dependency_added",
      entityType: "project_phase_dependency",
      entityId: input.phaseId,
      metadata: { dependsOnPhaseId: input.dependsOnPhaseId },
    });
    return snapshot(client, actor.companyId, projectId);
  });
}

/** Ručni % po fazi (§3 `PUT /api/projects/:id/progress`). */
export async function setPhaseProgress(
  pool: Pool,
  actor: { userId: string; companyId: string; roles: Parameters<typeof can>[0] },
  projectId: string,
  phases: Array<{ id: string; progressPct: number }>,
): Promise<PhasesResult | PhaseServiceError> {
  if (!can(actor.roles, "projects.manage")) {
    return { code: "FORBIDDEN", message: "Nemate pravo upravljanja projektom." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const source = await projectProgressSource(client, actor.companyId, projectId);
    if (source === "BOQ") {
      return {
        code: "VALIDATION_FAILED",
        message: "Projekat računa napredak iz predmjera — ručni % nije dozvoljen.",
      };
    }
    for (const phase of phases) {
      if (phase.progressPct < 0 || phase.progressPct > 100) {
        return { code: "VALIDATION_FAILED", message: "Napredak mora biti između 0 i 100." };
      }
      const updated = await client.query(
        `UPDATE public.project_phases
            SET progress_pct = $4,
                status = CASE
                  WHEN $4 >= 100 AND status <> 'CANCELLED' THEN 'DONE'
                  WHEN $4 > 0 AND status = 'PLANNED' THEN 'ACTIVE'
                  WHEN $4 < 100 AND status = 'DONE' THEN 'ACTIVE'
                  ELSE status END,
                actual_end = CASE WHEN $4 >= 100 THEN coalesce(actual_end, current_date) ELSE actual_end END,
                updated_by = $5, updated_at = clock_timestamp()
          WHERE company_id = $1 AND project_id = $2 AND id = $3`,
        [actor.companyId, projectId, phase.id, Math.round(phase.progressPct), actor.userId],
      );
      if (updated.rowCount === 0) return { code: "NOT_FOUND", message: "Faza nije pronađena." };
    }
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "project.progress_set",
      entityType: "project_phase",
      entityId: projectId,
      metadata: { phases: phases.length },
    });
    return snapshot(client, actor.companyId, projectId);
  });
}

/** Marža i EAC za jedan projekat — izvoz za pregled i detalj (koristi ih i servis profitabilnosti). */
export async function projectFinancials(
  client: PoolClient,
  companyId: string,
  projectId: string,
): Promise<{
  currency: "BAM" | "EUR" | "USD";
  contractValueCents: bigint | null;
  approvedAmendmentCents: bigint;
  postedCostCents: bigint;
  pendingCount: number;
  progressPct: number | null;
  byCategory: Array<{ category_code: string; posted: bigint; budget: bigint | null }>;
}> {
  const project = await client.query<{ contract_value_cents: string | null; currency_code: string | null }>(
    "SELECT contract_value_cents::text, currency_code FROM public.projects WHERE company_id = $1 AND id = $2",
    [companyId, projectId],
  );
  const currency =
    project.rows[0]?.currency_code === "EUR" || project.rows[0]?.currency_code === "USD"
      ? (project.rows[0]!.currency_code as "EUR" | "USD")
      : "BAM";
  const amendments = await client.query<{ cents: string | null }>(
    `SELECT coalesce(sum(amount_cents), 0)::text AS cents FROM public.project_amendments
      WHERE company_id = $1 AND project_id = $2 AND status = 'APPROVED'`,
    [companyId, projectId],
  );
  const costs = await client.query<{ cents: string | null; pending: string }>(
    `SELECT coalesce(sum(amount_cents) FILTER (WHERE status = 'POSTED'), 0)::text AS cents,
            count(*) FILTER (WHERE status = 'PENDING')::text AS pending
       FROM public.cost_entries WHERE company_id = $1 AND project_id = $2`,
    [companyId, projectId],
  );
  const byCategory = await client.query<{ code: string; posted: string | null; budget: string | null }>(
    `SELECT cc.code,
            coalesce((SELECT sum(e.amount_cents) FROM public.cost_entries e
                       WHERE e.company_id = $1 AND e.project_id = $2 AND e.category_id = cc.id
                         AND e.status = 'POSTED'), 0)::text AS posted,
            (SELECT sum(b.amount_cents) FROM public.project_budget_lines b
              WHERE b.company_id = $1 AND b.project_id = $2 AND b.category_id = cc.id
                AND b.revision = (SELECT max(revision) FROM public.project_budget_lines
                                   WHERE company_id = $1 AND project_id = $2))::text AS budget
       FROM public.cost_categories cc
      WHERE cc.company_id = $1
      ORDER BY cc.sort_order, cc.code`,
    [companyId, projectId],
  );
  const phases = await loadPhases(client, companyId, projectId);
  const progressPct = projectProgress(
    phases.map((phase) => ({
      weight: phase.weight,
      progressPct: phase.progress_pct,
      status: phase.status as PhaseStatus,
    })),
  );
  return {
    currency,
    contractValueCents:
      project.rows[0]?.contract_value_cents === null || project.rows[0]?.contract_value_cents === undefined
        ? null
        : BigInt(project.rows[0]!.contract_value_cents),
    approvedAmendmentCents: BigInt(amendments.rows[0]?.cents ?? "0"),
    postedCostCents: BigInt(costs.rows[0]?.cents ?? "0"),
    pendingCount: Number(costs.rows[0]?.pending ?? "0"),
    progressPct,
    byCategory: byCategory.rows.map((row) => ({
      category_code: row.code,
      posted: BigInt(row.posted ?? "0"),
      budget: row.budget === null ? null : BigInt(row.budget),
    })),
  };
}

export { projectMargin, estimateAtCompletion };
