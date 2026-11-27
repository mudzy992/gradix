/**
 * F5 (Modul 6 §1.4–1.5): predmjer, aneksi i zatvaranje projekta.
 *
 * Tri pravila koja ovaj fajl drži:
 *
 *  - **Predmjer daje % samo kad je `progress_source = BOQ`.** Kod `MANUAL` se količine ne
 *    miješaju u napredak — miješanje dva metra je najčešći izvor „100 %“ projekta koji traje.
 *  - **Samo `APPROVED` aneks mijenja vrijednost i rok.** `DRAFT` i `SUBMITTED` su pregovor, ne
 *    ugovor; da ulaze u maržu, svaki nacrt bi „popravio“ profitabilnost bez ijednog potpisa.
 *  - **Zatvaranje je čin sa dokazom.** Kontrolna lista mora biti zelena (ili `PENDING` svjesno
 *    prihvaćen uz razlog), snapshot se zamrzava, a ponovno otvaranje traži razlog i ide u audit.
 */
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import {
  boqProgress,
  closeChecklist,
  isCurrency,
  money,
  projectMargin,
  estimateAtCompletion,
  toAmountString,
  type CloseChecklist,
  type Currency,
} from "@gradix/domain";
import { can } from "./permissions";
import { writeAudit } from "./audit";
import { companyToday } from "./project-service";
import { projectFinancials } from "./project-phase-service";
import type {
  AmendmentInput,
  AmendmentRow,
  AmendmentsResult,
  BoqInput,
  BoqResult,
  CloseSnapshotRow,
  ProfitabilityResult,
  ServiceError,
} from "./project-finance-types";

/* ============================================================ predmjer */

export async function getBoq(
  pool: Pool,
  actor: { userId: string; companyId: string; roles: Parameters<typeof can>[0] },
  projectId: string,
): Promise<BoqResult | ServiceError> {
  if (!can(actor.roles, "projects.costs.view")) {
    return { code: "FORBIDDEN", message: "Nemate pravo pregleda troškova." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), (client) =>
    boqSnapshot(client, actor.companyId, projectId),
  );
}

async function boqSnapshot(
  client: PoolClient,
  companyId: string,
  projectId: string,
): Promise<BoqResult | ServiceError> {
  const project = await client.query<{ progress_source: string; currency_code: string | null }>(
    "SELECT progress_source, currency_code FROM public.projects WHERE company_id = $1 AND id = $2",
    [companyId, projectId],
  );
  if (!project.rows[0]) return { code: "NOT_FOUND", message: "Projekat nije pronađen." };
  const currency: Currency = isCurrency(project.rows[0].currency_code)
    ? project.rows[0].currency_code
    : "BAM";
  const items = await client.query(
    `SELECT b.id, b.project_id, b.phase_id, ph.name AS phase_name, b.code, b.description, b.unit,
            b.quantity_planned::text, b.quantity_executed::text, b.unit_price_cents::text, b.sort_order
       FROM public.project_boq_items b
       LEFT JOIN public.project_phases ph ON ph.company_id = b.company_id AND ph.id = b.phase_id
      WHERE b.company_id = $1 AND b.project_id = $2
      ORDER BY b.sort_order, b.code`,
    [companyId, projectId],
  );
  let plannedCents = 0n;
  let executedCents = 0n;
  const rows = items.rows.map((row) => {
    const plannedQty = Number(row.quantity_planned);
    const executedQty = Number(row.quantity_executed);
    const priceCents = BigInt(String(row.unit_price_cents));
    plannedCents += BigInt(Math.round(plannedQty * 1000)) * priceCents;
    executedCents += BigInt(Math.round(Math.min(executedQty, plannedQty) * 1000)) * priceCents;
    // Zaokruživanje po liniji: `planned × price` je već cijeli cent, pa nema „izgubljenog“ centa.
    const totalPlanned = BigInt(Math.round(plannedQty * 1000)) * priceCents;
    const totalExecuted = BigInt(Math.round(Math.min(executedQty, plannedQty) * 1000)) * priceCents;
    return {
      id: String(row.id),
      project_id: String(row.project_id),
      phase_id: row.phase_id ? String(row.phase_id) : null,
      phase_name: row.phase_name ? String(row.phase_name) : null,
      code: String(row.code),
      description: String(row.description),
      unit: String(row.unit),
      quantity_planned: plannedQty,
      quantity_executed: executedQty,
      unit_price: toAmountString({ cents: priceCents, currency }),
      total_planned: toAmountString({ cents: totalPlanned, currency }),
      total_executed: toAmountString({ cents: totalExecuted, currency }),
      sort_order: Number(row.sort_order),
    };
  });
  const progressSource = project.rows[0].progress_source === "BOQ" ? "BOQ" : "MANUAL";
  return {
    items: rows,
    progress_source: progressSource,
    progress_pct:
      progressSource === "BOQ"
        ? boqProgress(
            items.rows.map((row) => ({
              quantityPlanned: Number(row.quantity_planned),
              quantityExecuted: Number(row.quantity_executed),
              unitPriceCents: BigInt(String(row.unit_price_cents)),
            })),
          )
        : null,
    totals: {
      planned: toAmountString({ cents: plannedCents, currency }),
      executed: toAmountString({ cents: executedCents, currency }),
      currency_code: currency,
    },
  };
}

export async function saveBoqItem(
  pool: Pool,
  actor: { userId: string; companyId: string; roles: Parameters<typeof can>[0] },
  projectId: string,
  input: BoqInput,
): Promise<BoqResult | ServiceError> {
  if (!can(actor.roles, "projects.manage")) {
    return { code: "FORBIDDEN", message: "Nemate pravo upravljanja projektom." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const project = await client.query<{ currency_code: string | null }>(
      "SELECT currency_code FROM public.projects WHERE company_id = $1 AND id = $2",
      [actor.companyId, projectId],
    );
    if (!project.rows[0]) return { code: "NOT_FOUND", message: "Projekat nije pronađen." };
    const currency: Currency = isCurrency(project.rows[0].currency_code)
      ? project.rows[0].currency_code
      : "BAM";
    const priceCents = money(input.unitPrice, currency).cents;
    if (input.id) {
      await client.query(
        `UPDATE public.project_boq_items
            SET phase_id = $4, code = $5, description = $6, unit = $7,
                quantity_planned = $8, unit_price_cents = $9,
                quantity_executed = coalesce($10, quantity_executed),
                sort_order = coalesce($11, sort_order), updated_by = $12,
                updated_at = clock_timestamp()
          WHERE company_id = $1 AND project_id = $2 AND id = $3`,
        [
          actor.companyId, projectId, input.id, input.phaseId ?? null, input.code, input.description,
          input.unit, input.quantityPlanned, priceCents.toString(),
          input.quantityExecuted ?? null, input.sortOrder ?? null, actor.userId,
        ],
      );
    } else {
      await client.query(
        `INSERT INTO public.project_boq_items
           (id, company_id, project_id, phase_id, code, description, unit, quantity_planned,
            unit_price_cents, quantity_executed, sort_order, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)`,
        [
          `boq_${randomUUID().replace(/-/g, "").slice(0, 18)}`,
          actor.companyId, projectId, input.phaseId ?? null, input.code, input.description,
          input.unit, input.quantityPlanned, priceCents.toString(), input.quantityExecuted ?? 0,
          input.sortOrder ?? 0, actor.userId,
        ],
      );
    }
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "project.boq_item_saved",
      entityType: "project_boq_item",
      entityId: input.id ?? projectId,
      metadata: { projectId, code: input.code },
    });
    return boqSnapshot(client, actor.companyId, projectId);
  });
}

/** `MANUAL` ↔ `BOQ`. Zabrana miješanja (§1.4.19) je u domeni, ne samo u ekranu. */
export async function setProgressSource(
  pool: Pool,
  actor: { userId: string; companyId: string; roles: Parameters<typeof can>[0] },
  projectId: string,
  source: "MANUAL" | "BOQ",
): Promise<BoqResult | ServiceError> {
  if (!can(actor.roles, "projects.manage")) {
    return { code: "FORBIDDEN", message: "Nemate pravo upravljanja projektom." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    if (source === "BOQ") {
      // Prelazak na BOQ sa ručno unesenim procentima bi tiho obrisao ljudski rad; zato se
      // dozvoljava samo kad predmjer ima bar jednu stavku (inače bi napredak pao na `null`).
      const items = await client.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM public.project_boq_items WHERE company_id = $1 AND project_id = $2",
        [actor.companyId, projectId],
      );
      if (Number(items.rows[0]?.n ?? "0") === 0) {
        return {
          code: "VALIDATION_FAILED",
          message: "Predmjer je prazan — dodaj stavke prije prelaska na računanje iz količina.",
        };
      }
    }
    await client.query(
      `UPDATE public.projects SET progress_source = $3, updated_at = clock_timestamp()
        WHERE company_id = $1 AND id = $2`,
      [actor.companyId, projectId, source],
    );
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "project.progress_source_changed",
      entityType: "project",
      entityId: projectId,
      metadata: { progressSource: source },
    });
    return boqSnapshot(client, actor.companyId, projectId);
  });
}

/* ============================================================ aneksi */

export async function listAmendments(
  pool: Pool,
  actor: { userId: string; companyId: string; roles: Parameters<typeof can>[0] },
  projectId: string,
): Promise<AmendmentsResult | ServiceError> {
  if (!can(actor.roles, "projects.view")) {
    return { code: "FORBIDDEN", message: "Nemate pravo pregleda projekata." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), (client) =>
    amendmentsSnapshot(client, actor.companyId, projectId),
  );
}

async function amendmentsSnapshot(
  client: PoolClient,
  companyId: string,
  projectId: string,
): Promise<AmendmentsResult | ServiceError> {
  const project = await client.query<{ currency_code: string | null }>(
    "SELECT currency_code FROM public.projects WHERE company_id = $1 AND id = $2",
    [companyId, projectId],
  );
  if (!project.rows[0]) return { code: "NOT_FOUND", message: "Projekat nije pronađen." };
  const currency: Currency = isCurrency(project.rows[0].currency_code)
    ? project.rows[0].currency_code
    : "BAM";
  const rows = await client.query(
    `SELECT a.id, a.project_id, a.code, a.title, a.kind, a.amount_cents::text, a.currency_code,
            a.extension_days, a.status, a.approved_at::text, a.document_id, a.note,
            COALESCE(u.first_name || ' ' || u.last_name, u.email) AS approved_by_name
       FROM public.project_amendments a
       LEFT JOIN public.users u ON u.id = a.approved_by
      WHERE a.company_id = $1 AND a.project_id = $2
      ORDER BY a.created_at DESC, a.code`,
    [companyId, projectId],
  );
  const amendments: AmendmentRow[] = rows.rows.map((row) => ({
    id: String(row.id),
    project_id: String(row.project_id),
    code: String(row.code),
    title: String(row.title),
    kind: String(row.kind) as AmendmentRow["kind"],
    amount:
      row.amount_cents === null
        ? null
        : toAmountString({ cents: BigInt(String(row.amount_cents)), currency }),
    currency_code: row.currency_code ? String(row.currency_code) : null,
    extension_days: row.extension_days === null ? null : Number(row.extension_days),
    status: String(row.status) as AmendmentRow["status"],
    approved_at: row.approved_at ? new Date(String(row.approved_at)).toISOString() : null,
    approved_by_name: row.approved_by_name ? String(row.approved_by_name) : null,
    document_id: row.document_id ? String(row.document_id) : null,
    note: row.note ? String(row.note) : null,
  }));
  let approvedCents = 0n;
  let approvedDays = 0;
  for (const amendment of amendments) {
    if (amendment.status !== "APPROVED") continue;
    if (amendment.amount !== null) approvedCents += money(amendment.amount, currency).cents;
    approvedDays += amendment.extension_days ?? 0;
  }
  return {
    amendments,
    approved_amount: toAmountString({ cents: approvedCents, currency }),
    approved_extension_days: approvedDays,
    currency_code: currency,
  };
}

export async function saveAmendment(
  pool: Pool,
  actor: { userId: string; companyId: string; roles: Parameters<typeof can>[0] },
  projectId: string,
  input: AmendmentInput,
): Promise<AmendmentRow | ServiceError> {
  if (!can(actor.roles, "projects.manage")) {
    return { code: "FORBIDDEN", message: "Nemate pravo upravljanja projektom." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const project = await client.query<{ currency_code: string | null }>(
      "SELECT currency_code FROM public.projects WHERE company_id = $1 AND id = $2",
      [actor.companyId, projectId],
    );
    if (!project.rows[0]) return { code: "NOT_FOUND", message: "Projekat nije pronađen." };
    const currency: Currency = isCurrency(project.rows[0].currency_code)
      ? project.rows[0].currency_code
      : "BAM";
    const amountCents = input.amount ? money(input.amount, currency).cents : null;
    if (input.id) {
      const existing = await client.query<{ status: string }>(
        `SELECT status FROM public.project_amendments
          WHERE company_id = $1 AND project_id = $2 AND id = $3`,
        [actor.companyId, projectId, input.id],
      );
      if (!existing.rows[0]) return { code: "NOT_FOUND", message: "Aneks nije pronađen." };
      if (existing.rows[0].status === "APPROVED") {
        // Odobren aneks se ne prepisuje: on je već dio ugovorene vrijednosti.
        return {
          code: "CONFLICT",
          message: "Odobren aneks se ne mijenja — upiši novi aneks ili ga odbij prije izmjene.",
        };
      }
      await client.query(
        `UPDATE public.project_amendments
            SET code = $4, title = $5, kind = $6, amount_cents = $7, currency_code = $8,
                extension_days = $9, note = $10, document_id = $11,
                updated_by = $12, updated_at = clock_timestamp()
          WHERE company_id = $1 AND project_id = $2 AND id = $3`,
        [
          actor.companyId, projectId, input.id, input.code, input.title, input.kind,
          amountCents === null ? null : amountCents.toString(),
          amountCents === null ? null : currency,
          input.extensionDays ?? null, input.note ?? null, input.documentId ?? null, actor.userId,
        ],
      );
    } else {
      try {
        await client.query(
          `INSERT INTO public.project_amendments
             (id, company_id, project_id, code, title, kind, amount_cents, currency_code,
              extension_days, status, note, document_id, created_by, updated_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'DRAFT',$10,$11,$12,$12)`,
          [
            `amd_${randomUUID().replace(/-/g, "").slice(0, 18)}`,
            actor.companyId, projectId, input.code, input.title, input.kind,
            amountCents === null ? null : amountCents.toString(),
            amountCents === null ? null : currency,
            input.extensionDays ?? null, input.note ?? null, input.documentId ?? null, actor.userId,
          ],
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (message.includes("project_amendments_project_code_unique")) {
          return { code: "CONFLICT", message: "Aneks sa tom šifrom već postoji." };
        }
        throw error;
      }
    }
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "project.amendment_created",
      entityType: "project_amendment",
      entityId: input.id ?? projectId,
      metadata: { projectId, code: input.code, kind: input.kind },
      retentionClass: "FINANCIAL",
    });
    const snapshot = await amendmentsSnapshot(client, actor.companyId, projectId);
    if ("code" in snapshot) return snapshot;
    const saved = snapshot.amendments.find((amendment) => amendment.code === input.code);
    if (!saved) return { code: "INTERNAL", message: "Aneks nije sačuvan." };
    return saved;
  });
}

export async function decideAmendment(
  pool: Pool,
  actor: { userId: string; companyId: string; roles: Parameters<typeof can>[0] },
  projectId: string,
  amendmentId: string,
  action: "SUBMIT" | "APPROVE" | "REJECT",
  reason: string | null,
): Promise<AmendmentsResult | ServiceError> {
  if (!can(actor.roles, "projects.manage")) {
    return { code: "FORBIDDEN", message: "Nemate pravo upravljanja projektom." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const existing = await client.query<{ status: string }>(
      `SELECT status FROM public.project_amendments
        WHERE company_id = $1 AND project_id = $2 AND id = $3 FOR UPDATE`,
      [actor.companyId, projectId, amendmentId],
    );
    if (!existing.rows[0]) return { code: "NOT_FOUND", message: "Aneks nije pronađen." };
    const status = existing.rows[0].status;
    const allowed: Record<typeof action, string[]> = {
      SUBMIT: ["DRAFT"],
      APPROVE: ["SUBMITTED", "DRAFT"],
      REJECT: ["SUBMITTED", "DRAFT"],
    };
    if (!allowed[action].includes(status)) {
      return {
        code: "CONFLICT",
        message: `Aneks u stanju ${status} ne može preći u ${action}.`,
      };
    }
    if (action === "APPROVE") {
      await client.query(
        `UPDATE public.project_amendments
            SET status = 'APPROVED', approved_at = clock_timestamp(), approved_by = $4,
                updated_by = $4, updated_at = clock_timestamp()
          WHERE company_id = $1 AND project_id = $2 AND id = $3`,
        [actor.companyId, projectId, amendmentId, actor.userId],
      );
    } else if (action === "REJECT") {
      await client.query(
        `UPDATE public.project_amendments
            SET status = 'REJECTED', approved_at = NULL, approved_by = NULL,
                note = coalesce($4, note), updated_by = $5, updated_at = clock_timestamp()
          WHERE company_id = $1 AND project_id = $2 AND id = $3`,
        [actor.companyId, projectId, amendmentId, reason, actor.userId],
      );
    } else {
      await client.query(
        `UPDATE public.project_amendments
            SET status = 'SUBMITTED', updated_by = $4, updated_at = clock_timestamp()
          WHERE company_id = $1 AND project_id = $2 AND id = $3`,
        [actor.companyId, projectId, amendmentId, actor.userId],
      );
    }
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "project.amendment_decided",
      entityType: "project_amendment",
      entityId: amendmentId,
      metadata: { projectId, decision: action, reason },
      retentionClass: "FINANCIAL",
    });
    return amendmentsSnapshot(client, actor.companyId, projectId);
  });
}

/* ============================================================ profitabilnost */

export async function getProfitability(
  pool: Pool,
  actor: { userId: string; companyId: string; roles: Parameters<typeof can>[0] },
  projectId: string,
): Promise<ProfitabilityResult | ServiceError> {
  if (!can(actor.roles, "projects.costs.view")) {
    return { code: "FORBIDDEN", message: "Nemate pravo pregleda troškova." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const financials = await projectFinancials(client, actor.companyId, projectId);
    const margin = projectMargin({
      contractValueCents: financials.contractValueCents,
      approvedAmendmentCents: financials.approvedAmendmentCents,
      postedCostCents: financials.postedCostCents,
      currency: financials.currency,
    });
    const eac = estimateAtCompletion({
      postedCostCents: financials.postedCostCents,
      progressPct: financials.progressPct,
      currency: financials.currency,
    });
    const currency = financials.currency;
    const fmt = (cents: bigint | null) =>
      cents === null ? null : toAmountString({ cents, currency });
    return {
      project_id: projectId,
      currency_code: currency,
      contract_value: fmt(financials.contractValueCents),
      approved_amendments: fmt(financials.approvedAmendmentCents)!,
      contract_with_amendments: fmt(margin.contractWithAmendments?.cents ?? null),
      posted_cost: fmt(financials.postedCostCents)!,
      margin: fmt(margin.margin?.cents ?? null),
      margin_pct: margin.marginPct,
      pending_cost_count: financials.pendingCount,
      eac: {
        kind: "EAC_ESTIMATE" as const,
        amount: fmt(eac.amount?.cents ?? null),
        progress_pct: financials.progressPct,
        reason: eac.reason,
      },
      by_category: financials.byCategory.map((row) => ({
        category_id: row.category_code,
        category_code: row.category_code,
        category_name: row.category_code,
        budget: fmt(row.budget),
        posted: fmt(row.posted)!,
      })),
    };
  });
}

/* ============================================================ zatvaranje */

async function buildChecklist(
  client: PoolClient,
  companyId: string,
  projectId: string,
  pendingAcceptedReason: string | null,
): Promise<CloseChecklist> {
  const counts = await client.query<{
    assignments: string;
    faults: string;
    obligations: string;
    pending: string;
    phases: string;
  }>(
    `SELECT
       (SELECT count(*) FROM public.project_assignments a
         WHERE a.company_id = $1 AND a.project_id = $2 AND a.voided_at IS NULL
           AND (a.to_date IS NULL OR a.to_date >= current_date))::text AS assignments,
       (SELECT count(*) FROM public.machine_faults f
          JOIN public.project_assignments a
            ON a.company_id = f.company_id AND a.machine_id = f.machine_id
         WHERE f.company_id = $1 AND a.project_id = $2
           AND f.status NOT IN ('RESOLVED', 'CLOSED'))::text AS faults,
       (SELECT count(*) FROM public.obligations o
         WHERE o.company_id = $1 AND o.project_id = $2 AND o.superseded_by IS NULL)::text AS obligations,
       (SELECT count(*) FROM public.cost_entries e
         WHERE e.company_id = $1 AND e.project_id = $2 AND e.status = 'PENDING')::text AS pending,
       (SELECT count(*) FROM public.project_phases p
         WHERE p.company_id = $1 AND p.project_id = $2
           AND p.status IN ('PLANNED', 'ACTIVE'))::text AS phases`,
    [companyId, projectId],
  );
  const row = counts.rows[0];
  return closeChecklist({
    openAssignments: Number(row?.assignments ?? "0"),
    openFaults: Number(row?.faults ?? "0"),
    openObligations: Number(row?.obligations ?? "0"),
    pendingCosts: Number(row?.pending ?? "0"),
    pendingAcceptedReason,
    openPhases: Number(row?.phases ?? "0"),
  });
}

export async function closeChecklistFor(
  pool: Pool,
  actor: { userId: string; companyId: string; roles: Parameters<typeof can>[0] },
  projectId: string,
): Promise<CloseChecklist | ServiceError> {
  if (!can(actor.roles, "projects.manage")) {
    return { code: "FORBIDDEN", message: "Nemate pravo upravljanja projektom." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), (client) =>
    buildChecklist(client, actor.companyId, projectId, null),
  );
}

export async function closeProject(
  pool: Pool,
  actor: { userId: string; companyId: string; roles: Parameters<typeof can>[0] },
  projectId: string,
  pendingCostsReason: string | null,
): Promise<CloseSnapshotRow | ServiceError> {
  if (!can(actor.roles, "projects.manage")) {
    return { code: "FORBIDDEN", message: "Nemate pravo upravljanja projektom." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const project = await client.query<{ status: string }>(
      "SELECT status FROM public.projects WHERE company_id = $1 AND id = $2 FOR UPDATE",
      [actor.companyId, projectId],
    );
    if (!project.rows[0]) return { code: "NOT_FOUND", message: "Projekat nije pronađen." };
    if (project.rows[0].status === "FINISHED") {
      return { code: "CONFLICT", message: "Projekat je već zatvoren." };
    }
    const checklist = await buildChecklist(client, actor.companyId, projectId, pendingCostsReason);
    if (!checklist.complete) {
      return {
        code: "PROJECT_CLOSE_CHECKLIST_INCOMPLETE",
        message: `Kontrolna lista nije kompletna: ${checklist.blockers.join(", ")}.`,
      };
    }
    const financials = await projectFinancials(client, actor.companyId, projectId);
    const margin = projectMargin({
      contractValueCents: financials.contractValueCents,
      approvedAmendmentCents: financials.approvedAmendmentCents,
      postedCostCents: financials.postedCostCents,
      currency: financials.currency,
    });
    const budget = await client.query<{ cents: string | null }>(
      `SELECT sum(amount_cents)::text AS cents FROM public.project_budget_lines
        WHERE company_id = $1 AND project_id = $2
          AND revision = (SELECT max(revision) FROM public.project_budget_lines
                           WHERE company_id = $1 AND project_id = $2)`,
      [actor.companyId, projectId],
    );
    const currency = financials.currency;
    const payload = {
      posted_cost: toAmountString({ cents: financials.postedCostCents, currency }),
      budget:
        budget.rows[0]?.cents === null || budget.rows[0]?.cents === undefined
          ? null
          : toAmountString({ cents: BigInt(budget.rows[0].cents), currency }),
      margin: margin.margin === null ? null : toAmountString(margin.margin),
      progress_pct: financials.progressPct,
      by_category: financials.byCategory.map((row) => ({
        category_code: row.category_code,
        posted: toAmountString({ cents: row.posted, currency }),
        budget: row.budget === null ? null : toAmountString({ cents: row.budget, currency }),
      })),
      pending_cost_count: financials.pendingCount,
    };
    const snapshotId = `pcs_${randomUUID().replace(/-/g, "").slice(0, 18)}`;
    await client.query(
      `INSERT INTO public.project_close_snapshots (id, company_id, project_id, closed_by, payload)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [snapshotId, actor.companyId, projectId, actor.userId, JSON.stringify(payload)],
    );
    await client.query(
      `UPDATE public.projects
          SET status = 'FINISHED', closed_at = clock_timestamp(), closed_by = $3,
              reopened_at = NULL, reopen_reason = NULL, updated_at = clock_timestamp()
        WHERE company_id = $1 AND id = $2`,
      [actor.companyId, projectId, actor.userId],
    );
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "project.closed",
      entityType: "project_close",
      entityId: snapshotId,
      metadata: {
        projectId,
        pendingAccepted: pendingCostsReason ? true : false,
        postedCost: payload.posted_cost,
      },
      retentionClass: "FINANCIAL",
    });
    return {
      id: snapshotId,
      project_id: projectId,
      closed_at: new Date().toISOString(),
      closed_by_name: null,
      payload,
    };
  });
}

export async function reopenProject(
  pool: Pool,
  actor: { userId: string; companyId: string; roles: Parameters<typeof can>[0] },
  projectId: string,
  reason: string,
): Promise<CloseChecklist | ServiceError> {
  if (!can(actor.roles, "projects.manage")) {
    return { code: "FORBIDDEN", message: "Nemate pravo upravljanja projektom." };
  }
  if (reason.trim().length < 10) {
    return { code: "VALIDATION_FAILED", message: "Razlog ponovnog otvaranja mora imati ≥10 znakova." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const project = await client.query<{ status: string }>(
      "SELECT status FROM public.projects WHERE company_id = $1 AND id = $2 FOR UPDATE",
      [actor.companyId, projectId],
    );
    if (!project.rows[0]) return { code: "NOT_FOUND", message: "Projekat nije pronađen." };
    if (project.rows[0].status !== "FINISHED") {
      return { code: "CONFLICT", message: "Samo zatvoren projekat se može ponovno otvoriti." };
    }
    await client.query(
      `UPDATE public.projects
          SET status = 'ACTIVE', closed_at = NULL, closed_by = NULL,
              reopened_at = clock_timestamp(), reopen_reason = $3,
              updated_at = clock_timestamp()
        WHERE company_id = $1 AND id = $2`,
      [actor.companyId, projectId, reason.trim()],
    );
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "project.reopened",
      entityType: "project",
      entityId: projectId,
      metadata: { reason: reason.trim() },
      retentionClass: "FINANCIAL",
    });
    // Snapshot ostaje kao istorija: ponovno otvaranje ne briše dokaz da je projekat bio zatvoren.
    return buildChecklist(client, actor.companyId, projectId, null);
  });
}

/**
 * Ista zamka kao kod kategorija: `AmendmentRow` ima `code` (šifru aneksa), pa `"code" in value`
 * ne razlikuje grešku od reda. Provjerava se `message`, kao u `project-service`.
 */
export function isServiceError(value: unknown): value is ServiceError {
  return typeof value === "object" && value !== null && "message" in value;
}

export { companyToday };
