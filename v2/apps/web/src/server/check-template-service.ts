/**
 * F4 (Modul 5 §1.5) — šabloni dnevnog pregleda po kategoriji mašine.
 *
 * Zašto šablon: bez njega radnik na terenu popunjava slobodna polja, pa se pregledi između
 * mašina ne mogu porediti, a „kritično" ne postoji kao pojam — svaki nalaz je isti nalaz.
 *
 * Stavka je `{ key, label, required, critical }`:
 *  - `required` — mora biti popunjena da bi pregled bio potpun;
 *  - `critical` — `FAIL` na njoj traži FOTOGRAFIJU i otvara `machine_fault` (spec 05 §1.5.22).
 *
 * Jedan AKTIVAN šablon po kategoriji: dva aktiva bi značila da radnik ne zna koji je „pravi".
 * Stariji se deaktiviraju (`is_active = false`), ne brišu — pregledi ih referenciraju.
 */
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import { writeAudit } from "./audit";
import { can, type Role } from "./permissions";

export type CheckActor = { userId: string; companyId: string; roles: readonly Role[] };

export type CheckTemplateItem = { key: string; label: string; required: boolean; critical: boolean };

export type CheckTemplateView = {
  id: string;
  category_id: string | null;
  category_name: string | null;
  name: string;
  items: CheckTemplateItem[];
  is_active: boolean;
  created_at: string;
};

export type CheckTemplateInput = {
  id?: string;
  categoryId?: string | null;
  name: string;
  items: CheckTemplateItem[];
  isActive?: boolean;
};

export type CheckOutcome =
  | { outcome: "OK"; data: CheckTemplateView }
  | { outcome: "FORBIDDEN"; code: string; message?: string }
  | { outcome: "VALIDATION_FAILED"; code: string; message: string }
  | { outcome: "CONFLICT"; code: string; message: string };

const toTemplate = (row: {
  id: string;
  category_id: string | null;
  category_name: string | null;
  name: string;
  items: CheckTemplateItem[] | string;
  is_active: boolean;
  created_at: string;
}): CheckTemplateView => ({
  id: row.id,
  category_id: row.category_id,
  category_name: row.category_name,
  name: row.name,
  items: typeof row.items === "string" ? (JSON.parse(row.items) as CheckTemplateItem[]) : row.items,
  is_active: row.is_active,
  created_at: row.created_at,
});

const TEMPLATE_SELECT = `SELECT t.id, t.category_id, c.name AS category_name, t.name, t.items,
         t.is_active, t.created_at::text
    FROM public.check_templates t
    LEFT JOIN public.equipment_categories c ON c.company_id = t.company_id AND c.id = t.category_id`;

/**
 * Provjera stavki prije upisa.
 *
 * Duplikat `key` je greška, ne „posljednji pobjeđuje": rezultat pregleda je mapa `key → ishod`, pa
 * bi dva ista ključa tiho pregazila jedan drugi — a kritična stavka bi mogla nestati iz pregleda.
 */
export function validateItems(items: readonly CheckTemplateItem[]): string | null {
  if (items.length === 0) return "Šablon mora imati najmanje jednu stavku.";
  if (items.length > 60) return "Šablon može imati najviše 60 stavki.";
  const seen = new Set<string>();
  for (const item of items) {
    const key = item.key.trim();
    if (key.length === 0 || key.length > 40) return "Ključ stavke je obavezan (do 40 znakova).";
    if (item.label.trim().length === 0) return "Naziv stavke je obavezan.";
    if (seen.has(key)) return `Ključ „${key}" se ponavlja — svaka stavka mora imati svoj ključ.`;
    seen.add(key);
  }
  return null;
}

export async function listCheckTemplates(
  pool: Pool,
  actor: CheckActor,
  filters: { categoryId?: string; includeInactive?: boolean } = {},
): Promise<CheckTemplateView[]> {
  if (!can(actor.roles, "machines.check.view")) return [];
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const params: unknown[] = [actor.companyId];
    const conditions = ["t.company_id = $1"];
    if (!filters.includeInactive) conditions.push("t.is_active");
    if (filters.categoryId) {
      params.push(filters.categoryId);
      conditions.push(`t.category_id = $${params.length}`);
    }
    const result = await client.query(
      `${TEMPLATE_SELECT}
        WHERE ${conditions.join(" AND ")}
        ORDER BY t.category_id NULLS LAST, t.name`,
      params,
    );
    return result.rows.map(toTemplate);
  });
}

/**
 * Aktivni šablon za kategoriju mašine — ulaz u unos pregleda.
 *
 * Vraća i `null` kategoriju kao rezervu: firma može imati opšti šablon koji važi za sve mašine
 * koje nemaju svoj. Bez te rezerve bi mašina bez šablona ostala bez ijedne provjerljive stavke.
 */
export async function templateForCategory(
  client: PoolClient,
  companyId: string,
  categoryId: string | null,
): Promise<{ id: string; items: CheckTemplateItem[] } | null> {
  const result = await client.query<{ id: string; items: CheckTemplateItem[] | string }>(
    `SELECT id, items FROM public.check_templates
      WHERE company_id = $1 AND is_active
        AND (category_id = $2 OR ($2 IS NULL AND category_id IS NULL) OR category_id IS NULL)
      ORDER BY (category_id IS NOT NULL) DESC, created_at DESC
      LIMIT 1`,
    [companyId, categoryId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    items: typeof row.items === "string" ? (JSON.parse(row.items) as CheckTemplateItem[]) : row.items,
  };
}

export async function createCheckTemplate(
  pool: Pool,
  actor: CheckActor,
  input: CheckTemplateInput,
): Promise<CheckOutcome> {
  if (!can(actor.roles, "machines.check.manage")) return { outcome: "FORBIDDEN", code: "ROLE" };
  const invalid = validateItems(input.items);
  if (invalid) return { outcome: "VALIDATION_FAILED", code: "ITEMS", message: invalid };
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    if (input.categoryId) {
      const category = await client.query<{ id: string }>(
        "SELECT id FROM public.equipment_categories WHERE company_id = $1 AND id = $2",
        [actor.companyId, input.categoryId],
      );
      if (!category.rows[0]) {
        return { outcome: "VALIDATION_FAILED", code: "CATEGORY", message: "Kategorija nije pronađena." };
      }
      /*
       * Novi aktivan šablon za kategoriju deaktivira prethodni. Alternativa — odbiti unos —
       * tjera korisnika da prvo ručno ugasi stari, a to je korak koji se zaboravi i onda imamo
       * dva aktiva šablona (i baza bi odbila upis bez objašnjenja).
       */
      if (input.isActive !== false) {
        await client.query(
          `UPDATE public.check_templates SET is_active = false, updated_at = clock_timestamp()
            WHERE company_id = $1 AND category_id = $2 AND is_active`,
          [actor.companyId, input.categoryId],
        );
      }
    }
    const id = `ctp_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    await client.query(
      `INSERT INTO public.check_templates
         (id, company_id, category_id, name, items, is_active, created_by)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)`,
      [
        id, actor.companyId, input.categoryId ?? null, input.name.trim(),
        JSON.stringify(input.items), input.isActive ?? true, actor.userId,
      ],
    );
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "check_template.created",
      entityType: "check_template",
      entityId: id,
      metadata: {
        categoryId: input.categoryId ?? null,
        itemCount: input.items.length,
        criticalCount: input.items.filter((item) => item.critical).length,
      },
    });
    const created = await client.query(
      `${TEMPLATE_SELECT} WHERE t.company_id = $1 AND t.id = $2`,
      [actor.companyId, id],
    );
    return { outcome: "OK", data: toTemplate(created.rows[0]) };
  });
}

export async function updateCheckTemplate(
  pool: Pool,
  actor: CheckActor,
  input: CheckTemplateInput,
): Promise<CheckOutcome> {
  if (!can(actor.roles, "machines.check.manage")) return { outcome: "FORBIDDEN", code: "ROLE" };
  if (!input.id) {
    return { outcome: "VALIDATION_FAILED", code: "ID", message: "Nedostaje id šablona." };
  }
  const invalid = validateItems(input.items);
  if (invalid) return { outcome: "VALIDATION_FAILED", code: "ITEMS", message: invalid };
  const templateId: string = input.id;
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const updated = await client.query<{ id: string }>(
      `UPDATE public.check_templates
          SET category_id = $3, name = $4, items = $5::jsonb,
              is_active = COALESCE($6, is_active), updated_at = clock_timestamp()
        WHERE company_id = $1 AND id = $2
        RETURNING id`,
      [
        actor.companyId, templateId, input.categoryId ?? null, input.name.trim(),
        JSON.stringify(input.items), input.isActive ?? null,
      ],
    );
    if (!updated.rows[0]) {
      return { outcome: "VALIDATION_FAILED", code: "NOT_FOUND", message: "Šablon nije pronađen." };
    }
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "check_template.updated",
      entityType: "check_template",
      entityId: templateId,
      metadata: { itemCount: input.items.length, isActive: input.isActive ?? null },
    });
    const row = await client.query(
      `${TEMPLATE_SELECT} WHERE t.company_id = $1 AND t.id = $2`,
      [actor.companyId, templateId],
    );
    return { outcome: "OK", data: toTemplate(row.rows[0]) };
  });
}

/**
 * Kritične `FAIL` stavke iz popunjenog pregleda.
 *
 * Ulaz u tok „kritično → fotografija + kvar". Izvlači se iz `checklist_json` po KLJUČU iz
 * šablona, a ne po `result` polju cijelog pregleda: pregled može biti `CONDITIONAL` uz jednu
 * kritičnu `FAIL` stavku, i to je upravo slučaj koji mora otvoriti kvar.
 */
export function criticalFailures(
  templateItems: readonly CheckTemplateItem[],
  checklist: Record<string, string>,
): CheckTemplateItem[] {
  return templateItems.filter(
    (item) => item.critical && String(checklist[item.key] ?? "").toUpperCase() === "FAIL",
  );
}
