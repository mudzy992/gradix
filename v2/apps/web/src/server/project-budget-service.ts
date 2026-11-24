/**
 * F5 (Modul 6 §1.2): budžet sa revizijama i šifarnik kategorija troška.
 *
 * Dvije stvari koje ovaj servis čuva kao princip:
 *
 *  1. **Budžet se nikad ne prepisuje.** Nova odluka = nova revizija (`revision + 1`, `valid_from`).
 *     Stara revizija ostaje čitljiva, pa trošak iz marta izgleda isto i kad u junu budžet promijeni.
 *     Triger `project_budget_lines_immutable` to i brani, ovdje se samo poštuje.
 *  2. **Pragovi se prate po reviziji.** Prelazak 80 % u reviziji 1 i u reviziji 2 su dva različita
 *     događaja — zato `budget_alert_events` nosi `revision` i `dedupe_key` sa njom.
 */
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import {
  COST_SOURCE_TYPES,
  FALLBACK_COST_CATEGORY_CODE,
  crossedBudgetThreshold,
  isCurrency,
  money,
  toAmountString,
  type Currency,
  type CostSourceType,
} from "@gradix/domain";
import { can } from "./permissions";
import { writeAudit } from "./audit";
import { companyToday } from "./project-service";
import type {
  BudgetCategoryTotals,
  BudgetInput,
  BudgetResult,
  CategoriesResult,
  CategoryInput,
  CategoryRow,
  ServiceError,
} from "./project-budget-types";

/* ============================================================ kategorije */

function toCategory(row: Record<string, unknown>): CategoryRow {
  return {
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    sort_order: Number(row.sort_order),
    default_for_source_type: row.default_for_source_type
      ? (String(row.default_for_source_type) as CostSourceType)
      : null,
    is_active: Boolean(row.is_active),
    usage_count: Number(row.usage_count ?? 0),
  };
}

export async function listCostCategories(
  pool: Pool,
  actor: { userId: string; companyId: string; roles: Parameters<typeof can>[0] },
): Promise<CategoriesResult | ServiceError> {
  if (!can(actor.roles, "projects.costs.view")) {
    return { code: "FORBIDDEN", message: "Nemate pravo pregleda troškova." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const rows = await client.query(
      `SELECT cc.id, cc.code, cc.name, cc.sort_order, cc.default_for_source_type, cc.is_active,
              (SELECT count(*)::int FROM public.project_budget_lines b
                WHERE b.company_id = cc.company_id AND b.category_id = cc.id) AS usage_count
         FROM public.cost_categories cc
        WHERE cc.company_id = $1
        ORDER BY cc.is_active DESC, cc.sort_order, cc.code`,
      [actor.companyId],
    );
    const mapped = new Set(
      rows.rows
        .map((row) => (row.default_for_source_type ? String(row.default_for_source_type) : null))
        .filter((value): value is string => value !== null),
    );
    return {
      categories: rows.rows.map(toCategory),
      // Izvori bez mapiranja idu na `OSTALO`; ekran ih prikazuje kao upozorenje, ne kao grešku.
      unmapped_sources: COST_SOURCE_TYPES.filter((source) => !mapped.has(source)),
    };
  });
}

export async function saveCostCategory(
  pool: Pool,
  actor: { userId: string; companyId: string; roles: Parameters<typeof can>[0] },
  input: CategoryInput,
): Promise<CategoryRow | ServiceError> {
  if (!can(actor.roles, "projects.costs.manage")) {
    return { code: "FORBIDDEN", message: "Nemate pravo uređivanja kategorija troška." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    if (input.id) {
      const existing = await client.query("SELECT 1 FROM public.cost_categories WHERE company_id = $1 AND id = $2", [
        actor.companyId,
        input.id,
      ]);
      if (!existing.rows[0]) return { code: "NOT_FOUND", message: "Kategorija nije pronađena." };
      try {
        const updated = await client.query(
          `UPDATE public.cost_categories
              SET code = coalesce($3, code), name = coalesce($4, name),
                  sort_order = coalesce($5, sort_order),
                  default_for_source_type = CASE WHEN $6::boolean THEN $7 ELSE default_for_source_type END,
                  is_active = coalesce($8, is_active),
                  updated_by = $9, updated_at = clock_timestamp()
            WHERE company_id = $1 AND id = $2
            RETURNING id, code, name, sort_order, default_for_source_type, is_active`,
          [
            actor.companyId,
            input.id,
            input.code ?? null,
            input.name ?? null,
            input.sortOrder ?? null,
            input.defaultForSourceType !== undefined,
            input.defaultForSourceType ?? null,
            input.isActive ?? null,
            actor.userId,
          ],
        );
        const row = updated.rows[0];
        if (!row) return { code: "NOT_FOUND", message: "Kategorija nije pronađena." };
        await writeAudit(client, {
          companyId: actor.companyId,
          actorId: actor.userId,
          actorEmail: null,
          action: "cost_category.updated",
          entityType: "cost_category",
          entityId: input.id,
          metadata: { code: row.code, sourceType: row.default_for_source_type },
        });
        return { ...toCategory(row), usage_count: 0 };
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (message.includes("cost_categories_default_source_unique")) {
          return {
            code: "CONFLICT",
            message: "Taj izvor već ima zadanu kategoriju — prvo je skinite s postojeće.",
          };
        }
        if (message.includes("cost_categories_company_code_unique")) {
          return { code: "CONFLICT", message: "Kategorija sa tom šifrom već postoji." };
        }
        throw error;
      }
    }
    const id = `cc_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    try {
      const inserted = await client.query(
        `INSERT INTO public.cost_categories
           (id, company_id, code, name, sort_order, default_for_source_type, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
         RETURNING id, code, name, sort_order, default_for_source_type, is_active`,
        [
          id,
          actor.companyId,
          input.code,
          input.name,
          input.sortOrder ?? 100,
          input.defaultForSourceType ?? null,
          actor.userId,
        ],
      );
      await writeAudit(client, {
        companyId: actor.companyId,
        actorId: actor.userId,
        actorEmail: null,
        action: "cost_category.created",
        entityType: "cost_category",
        entityId: id,
        metadata: { code: input.code },
      });
      return { ...toCategory(inserted.rows[0]!), usage_count: 0 };
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("cost_categories_default_source_unique")) {
        return {
          code: "CONFLICT",
          message: "Taj izvor već ima zadanu kategoriju — prvo je skinite s postojeće.",
        };
      }
      if (message.includes("cost_categories_company_code_unique")) {
        return { code: "CONFLICT", message: "Kategorija sa tom šifrom već postoji." };
      }
      throw error;
    }
  });
}

/* ============================================================ budžet */

export async function getBudget(
  pool: Pool,
  actor: { userId: string; companyId: string; roles: Parameters<typeof can>[0] },
  projectId: string,
  revision?: number,
): Promise<BudgetResult | ServiceError> {
  if (!can(actor.roles, "projects.costs.view")) {
    return { code: "FORBIDDEN", message: "Nemate pravo pregleda troškova." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), (client) =>
    budgetSnapshot(client, actor, projectId, revision),
  );
}

/**
 * Unutrašnji snimak budžeta. Izdvojen iz `getBudget` jer ga poslije upisa revizije zove ISTA
 * transakcija: novi `withCompany` bi otvorio drugu transakciju i ne bi vidio nepotvrđene linije
 * (vratio bi prazan budžet odmah nakon uspješnog upisa).
 */
async function budgetSnapshot(
  client: PoolClient,
  actor: { userId: string; companyId: string; roles: Parameters<typeof can>[0] },
  projectId: string,
  revision?: number,
): Promise<BudgetResult | ServiceError> {
  {
    const project = await client.query<{ currency_code: string | null; status: string }>(
      "SELECT currency_code, status FROM public.projects WHERE company_id = $1 AND id = $2",
      [actor.companyId, projectId],
    );
    if (!project.rows[0]) return { code: "NOT_FOUND", message: "Projekat nije pronađen." };
    const currency: Currency = isCurrency(project.rows[0].currency_code)
      ? project.rows[0].currency_code
      : "BAM";
    const today = await companyToday(client, toCompanyId(actor.companyId));
    const revisions = await client.query<{ revision: number; valid_from: string }>(
      `SELECT revision, min(valid_from)::text AS valid_from
         FROM public.project_budget_lines
        WHERE company_id = $1 AND project_id = $2
        GROUP BY revision ORDER BY revision DESC`,
      [actor.companyId, projectId],
    );
    const todayRevision = revisions.rows.find((row) => row.valid_from <= today)?.revision;
    const effectiveRevision = revision ?? todayRevision ?? revisions.rows[0]?.revision ?? 0;

    const lines = await client.query(
      `SELECT b.id, b.project_id, b.phase_id, ph.name AS phase_name, b.category_id,
              cc.code AS category_code, cc.name AS category_name, b.amount_cents::text,
              b.currency_code, b.revision, b.valid_from::text, b.note
         FROM public.project_budget_lines b
         JOIN public.cost_categories cc ON cc.company_id = b.company_id AND cc.id = b.category_id
         LEFT JOIN public.project_phases ph ON ph.company_id = b.company_id AND ph.id = b.phase_id
        WHERE b.company_id = $1 AND b.project_id = $2 AND b.revision = $3
        ORDER BY cc.sort_order, cc.code, ph.sort_order NULLS FIRST`,
      [actor.companyId, projectId, effectiveRevision],
    );

    /*
     * Trošak se poredi sa revizijom koja je važila NA DAN TROŠKA (§1.2.8): `occurred_on` mora
     * pasti u opseg `[valid_from te revizije, valid_from sljedeće)`. Bez toga bi nova revizija
     * „popravila“ i prošle mjesece i prag bi bio lažno pređen (ili lažno nepređen).
     */
    const spent = await client.query<{ category_id: string; cents: string | null }>(
      `SELECT e.category_id, coalesce(sum(e.amount_cents), 0)::text AS cents
         FROM public.cost_entries e
        WHERE e.company_id = $1 AND e.project_id = $2 AND e.status = 'POSTED'
        GROUP BY e.category_id`,
      [actor.companyId, projectId],
    );
    const pending = await client.query<{ n: string; cents: string | null }>(
      `SELECT count(*)::text AS n, sum(amount_cents)::text AS cents
         FROM public.cost_entries
        WHERE company_id = $1 AND project_id = $2 AND status = 'PENDING'`,
      [actor.companyId, projectId],
    );

    const spentByCategory = new Map<string, bigint>();
    for (const row of spent.rows) {
      spentByCategory.set(String(row.category_id), BigInt(row.cents ?? "0"));
    }
    const budgetByCategory = new Map<string, bigint>();
    const categoryMeta = new Map<string, { code: string; name: string }>();
    let budgetTotal = 0n;
    for (const line of lines.rows) {
      const cents = BigInt(String(line.amount_cents));
      budgetTotal += cents;
      const key = String(line.category_id);
      budgetByCategory.set(key, (budgetByCategory.get(key) ?? 0n) + cents);
      categoryMeta.set(key, { code: String(line.category_code), name: String(line.category_name) });
    }
    const spentTotal = [...spentByCategory.values()].reduce((acc, value) => acc + value, 0n);

    const byCategory: BudgetCategoryTotals[] = [...categoryMeta.entries()].map(([id, meta]) => {
      const budget = budgetByCategory.get(id) ?? 0n;
      const categorySpent = spentByCategory.get(id) ?? 0n;
      const crossing = crossedBudgetThreshold({ budgetCents: budget, spentCents: categorySpent, revision: effectiveRevision });
      return {
        category_id: id,
        category_code: meta.code,
        category_name: meta.name,
        budget: toAmountString({ cents: budget, currency }),
        spent: toAmountString({ cents: categorySpent, currency }),
        used_pct:
          budget > 0n ? Math.round(Number((categorySpent * 100_00n) / budget)) / 100 : null,
        threshold_crossed: crossing ? (String(crossing.thresholdPct) as "80" | "100") : null,
      };
    });

    return {
      revision: effectiveRevision,
      revisions: revisions.rows.map((row) => ({ revision: row.revision, valid_from: row.valid_from })),
      lines: lines.rows.map((row) => ({
        id: String(row.id),
        project_id: String(row.project_id),
        phase_id: row.phase_id ? String(row.phase_id) : null,
        phase_name: row.phase_name ? String(row.phase_name) : null,
        category_id: String(row.category_id),
        category_code: String(row.category_code),
        category_name: String(row.category_name),
        amount: toAmountString({ cents: BigInt(String(row.amount_cents)), currency }),
        currency_code: String(row.currency_code),
        revision: Number(row.revision),
        valid_from: String(row.valid_from),
        note: row.note ? String(row.note) : null,
      })),
      totals: {
        budget: toAmountString({ cents: budgetTotal, currency }),
        currency_code: currency,
        spent: toAmountString({ cents: spentTotal, currency }),
        pending_count: Number(pending.rows[0]?.n ?? "0"),
        pending_amount:
          pending.rows[0]?.cents === null || pending.rows[0]?.cents === undefined
            ? null
            : toAmountString({ cents: BigInt(pending.rows[0].cents), currency }),
        by_category: byCategory,
      },
    };
  }
}

/**
 * Nova revizija. `revision` se izvodi iz `max(revision) + 1` ako nije dat; ako je dat a revizija
 * već postoji, to je `BUDGET_REVISION_CONFLICT` — dvije osobe su uzele isti broj.
 */
export async function reviseBudget(
  pool: Pool,
  actor: { userId: string; companyId: string; roles: Parameters<typeof can>[0] },
  projectId: string,
  input: BudgetInput,
): Promise<BudgetResult | ServiceError> {
  if (!can(actor.roles, "projects.budget.manage")) {
    return { code: "FORBIDDEN", message: "Nemate pravo upravljanja budžetom." };
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

    // `FOR UPDATE` na projekat serijalizuje dvije istovremene revizije iste firme i projekta.
    await client.query("SELECT id FROM public.projects WHERE company_id = $1 AND id = $2 FOR UPDATE", [
      actor.companyId,
      projectId,
    ]);
    const max = await client.query<{ revision: number | null }>(
      "SELECT max(revision) AS revision FROM public.project_budget_lines WHERE company_id = $1 AND project_id = $2",
      [actor.companyId, projectId],
    );
    const next = (max.rows[0]?.revision ?? 0) + 1;
    const revision = input.revision ?? next;
    if (input.revision !== undefined && input.revision <= (max.rows[0]?.revision ?? 0)) {
      return {
        code: "BUDGET_REVISION_CONFLICT",
        message: `Revizija ${input.revision} već postoji na ovom projektu.`,
      };
    }
    const validFrom =
      input.validFrom ?? (await companyToday(client, toCompanyId(actor.companyId)));

    for (const line of input.lines) {
      const amount = money(line.amount, currency);
      try {
        await client.query(
          `INSERT INTO public.project_budget_lines
             (id, company_id, project_id, phase_id, category_id, amount_cents, currency_code,
              revision, valid_from, note, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10,$11)`,
          [
            `bl_${randomUUID().replace(/-/g, "").slice(0, 18)}`,
            actor.companyId,
            projectId,
            line.phaseId ?? null,
            line.categoryId,
            amount.cents.toString(),
            currency,
            revision,
            validFrom,
            input.note ?? null,
            actor.userId,
          ],
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (message.includes("project_budget_lines_revision_unique") || message.includes("project_budget_lines_revision_project_unique")) {
          return {
            code: "BUDGET_REVISION_CONFLICT",
            message: "Ista kategorija (i faza) već ima liniju u toj reviziji.",
          };
        }
        throw error;
      }
    }
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "project.budget_revised",
      entityType: "project_budget",
      entityId: projectId,
      metadata: { revision, lines: input.lines.length, validFrom },
      retentionClass: "FINANCIAL",
    });
    return budgetSnapshot(client, actor, projectId, revision);
  });
}

/**
 * Razlikovanje greške od reda. `"code" in value` NIJE dovoljno: red kategorije ima `code`
 * (šifru kategorije), pa bi uspješan odgovor bio protumačen kao greška. Zato `message`.
 */
export function isServiceError(value: unknown): value is ServiceError {
  return typeof value === "object" && value !== null && "message" in value;
}

export { FALLBACK_COST_CATEGORY_CODE };
export type { PoolClient };
