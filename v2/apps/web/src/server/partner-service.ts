/** R5.5: partners list/create for machine fault FK. */
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import { can } from "./permissions";
import type { FaultActor, MutationOutcome, PartnerCreateInput, PartnerRow } from "./machine-fault-types";

const KINDS = ["VENDOR", "SERVICE", "OTHER"] as const;

export async function listPartners(pool: Pool, actor: FaultActor): Promise<PartnerRow[]> {
  if (!can(actor.roles, "partners.view")) return [];
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const result = await client.query<{
      id: string;
      code: string;
      name: string;
      kind: string;
      note: string | null;
      active: boolean;
    }>(
      `SELECT id, code, name, kind, note, active
         FROM public.partners
        WHERE company_id = $1 AND active
        ORDER BY code
        LIMIT 500`,
      [actor.companyId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      kind: row.kind as PartnerRow["kind"],
      note: row.note,
      active: row.active,
    }));
  });
}

export async function createPartner(
  pool: Pool,
  actor: FaultActor,
  input: PartnerCreateInput,
): Promise<MutationOutcome> {
  if (!can(actor.roles, "partners.manage")) return { outcome: "FORBIDDEN", code: "ROLE" };
  if (!KINDS.includes(input.kind)) {
    return { outcome: "VALIDATION_FAILED", code: "KIND", message: "Vrsta partnera nije validna." };
  }
  if (!input.code?.trim() || !input.name?.trim()) {
    return { outcome: "VALIDATION_FAILED", code: "REQUIRED", message: "Šifra i naziv su obavezni." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const id = `ptr_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    try {
      await client.query(
        `INSERT INTO public.partners (id, company_id, code, name, kind, note)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          id, actor.companyId, input.code.trim(), input.name.trim(),
          input.kind, input.note ?? null,
        ],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("partners_company_code_unique")) {
        return { outcome: "CONFLICT", code: "CODE_EXISTS", message: "Šifra partnera već postoji." };
      }
      throw error;
    }
    return { outcome: "OK", id };
  });
}
