/** R5.5 + R7.1: partners list/create/update; kind uključuje CLIENT. */
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import { can } from "./permissions";
import type { FaultActor, MutationOutcome, PartnerCreateInput, PartnerRow } from "./machine-fault-types";

export const PARTNER_KINDS = ["VENDOR", "SERVICE", "OTHER", "CLIENT"] as const;
export type PartnerKind = (typeof PARTNER_KINDS)[number];

export type PartnerPatchInput = {
  name?: string;
  kind?: PartnerKind;
  note?: string | null;
  active?: boolean;
};

export async function listPartners(
  pool: Pool,
  actor: FaultActor,
  opts?: { includeInactive?: boolean },
): Promise<PartnerRow[]> {
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
        WHERE company_id = $1
          AND ($2::boolean OR active)
        ORDER BY code
        LIMIT 500`,
      [actor.companyId, opts?.includeInactive === true],
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
  if (!(PARTNER_KINDS as readonly string[]).includes(input.kind)) {
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
        [id, actor.companyId, input.code.trim(), input.name.trim(), input.kind, input.note ?? null],
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

export async function updatePartner(
  pool: Pool,
  actor: FaultActor,
  partnerId: string,
  input: PartnerPatchInput,
): Promise<MutationOutcome> {
  if (!can(actor.roles, "partners.manage")) return { outcome: "FORBIDDEN", code: "ROLE" };
  if (input.kind !== undefined && !(PARTNER_KINDS as readonly string[]).includes(input.kind)) {
    return { outcome: "VALIDATION_FAILED", code: "KIND", message: "Vrsta partnera nije validna." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const existing = await client.query(`SELECT 1 FROM public.partners WHERE id = $1 AND company_id = $2`, [
      partnerId,
      actor.companyId,
    ]);
    if (existing.rowCount === 0) {
      return { outcome: "VALIDATION_FAILED", code: "NOT_FOUND", message: "Partner nije pronađen." };
    }
    await client.query(
      `UPDATE public.partners
          SET name = COALESCE($3, name),
              kind = COALESCE($4, kind),
              note = CASE WHEN $5::boolean THEN $6 ELSE note END,
              active = COALESCE($7, active),
              updated_at = clock_timestamp()
        WHERE id = $1 AND company_id = $2`,
      [
        partnerId,
        actor.companyId,
        input.name?.trim() ?? null,
        input.kind ?? null,
        input.note !== undefined,
        input.note === undefined ? null : input.note,
        input.active ?? null,
      ],
    );
    return { outcome: "OK", id: partnerId };
  });
}
