/**
 * F7 — predloženi tim i faze tendera (spec 08 §1.6/22.6).
 *
 * Tim se NE upisuje kao dodjela sada: on je predlog koji konverzija prenosi sa napomenom
 * „predlog iz tendera“. Zato ovaj servis samo čuva listu ljudi i faza uz tender; posljedica
 * (dodjele na projektu) nastaje tek u konverziji i potvrđuje je PM.
 */
import type { Pool } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import { randomUUID } from "node:crypto";
import { can } from "./permissions";
import type { TenderActor } from "./tender-service";

export type TenderTeamMember = { workerId: string; name: string; role: string };
export type TenderPhaseRow = {
  id: string;
  code: string;
  name: string;
  weight: number;
  plannedStart: string | null;
  plannedEnd: string | null;
};

export type TeamError = { code: "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "CONFLICT"; message: string };

export async function listTenderTeam(
  pool: Pool,
  actor: TenderActor,
  tenderId: string,
): Promise<{ team: TenderTeamMember[]; phases: TenderPhaseRow[] } | TeamError> {
  if (!can(actor.roles, "tenders.view")) return { code: "FORBIDDEN", message: "Nemate pravo pregleda." };
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const tender = await client.query(`SELECT 1 FROM public.tenders WHERE id = $1 AND company_id = $2`, [
      tenderId,
      actor.companyId,
    ]);
    if ((tender.rowCount ?? 0) === 0) return { code: "NOT_FOUND" as const, message: "Tender nije pronađen." };

    const team = await client.query<{ worker_id: string; role: string; first_name: string; last_name: string }>(
      `SELECT tt.worker_id, tt.role, w.first_name, w.last_name
         FROM public.tender_team tt
         JOIN public.workers w ON w.company_id = tt.company_id AND w.id = tt.worker_id
        WHERE tt.company_id = $1 AND tt.tender_id = $2
        ORDER BY CASE tt.role WHEN 'PM' THEN 0 WHEN 'SUPERVISOR' THEN 1 ELSE 2 END, w.last_name`,
      [actor.companyId, tenderId],
    );
    const phases = await client.query(
      `SELECT id, code, name, weight, planned_start::text, planned_end::text
         FROM public.tender_phases
        WHERE company_id = $1 AND tender_id = $2
        ORDER BY sort_order, code`,
      [actor.companyId, tenderId],
    );

    return {
      team: team.rows.map((row) => ({
        workerId: String(row.worker_id),
        name: `${row.first_name} ${row.last_name}`.trim(),
        role: String(row.role),
      })),
      phases: phases.rows.map((row) => ({
        id: String(row.id),
        code: String(row.code),
        name: String(row.name),
        weight: Number(row.weight),
        plannedStart: row.planned_start == null ? null : String(row.planned_start),
        plannedEnd: row.planned_end == null ? null : String(row.planned_end),
      })),
    };
  });
}

export async function addTenderTeamMember(
  pool: Pool,
  actor: TenderActor,
  tenderId: string,
  input: { workerId: string; role: "PM" | "SUPERVISOR" | "MEMBER" },
): Promise<{ outcome: "OK"; workerId: string } | (TeamError & { outcome: "FORBIDDEN" | "VALIDATION_FAILED" | "CONFLICT" | "NOT_FOUND" })> {
  if (!can(actor.roles, "tenders.manage")) return { outcome: "FORBIDDEN", code: "FORBIDDEN", message: "Nemate pravo." };
  if (!["PM", "SUPERVISOR", "MEMBER"].includes(input.role)) {
    return { outcome: "VALIDATION_FAILED", code: "VALIDATION_FAILED", message: "Nepoznata uloga u timu." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const worker = await client.query(`SELECT 1 FROM public.workers WHERE id = $1 AND company_id = $2`, [
      input.workerId,
      actor.companyId,
    ]);
    if ((worker.rowCount ?? 0) === 0) {
      return { outcome: "NOT_FOUND" as const, code: "NOT_FOUND" as const, message: "Radnik nije pronađen." };
    }
    try {
      await client.query(
        `INSERT INTO public.tender_team (id, company_id, tender_id, worker_id, role, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          `ttm_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
          actor.companyId,
          tenderId,
          input.workerId,
          input.role,
          actor.userId,
        ],
      );
    } catch (error) {
      const code = typeof error === "object" && error !== null ? (error as { code?: string }).code : undefined;
      if (code === "23505") {
        return {
          outcome: "CONFLICT" as const,
          code: "CONFLICT" as const,
          message:
            input.role === "PM"
              ? "Tender već ima vođu projekta — jedan tender ima jednog odgovornog."
              : "Taj radnik je već u predloženom timu.",
        };
      }
      throw error;
    }
    return { outcome: "OK" as const, workerId: input.workerId };
  });
}

export async function removeTenderTeamMember(
  pool: Pool,
  actor: TenderActor,
  tenderId: string,
  workerId: string,
): Promise<{ outcome: "OK" } | (TeamError & { outcome: "FORBIDDEN" | "NOT_FOUND" })> {
  if (!can(actor.roles, "tenders.manage")) return { outcome: "FORBIDDEN", code: "FORBIDDEN", message: "Nemate pravo." };
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const deleted = await client.query(
      `DELETE FROM public.tender_team WHERE company_id = $1 AND tender_id = $2 AND worker_id = $3`,
      [actor.companyId, tenderId, workerId],
    );
    if ((deleted.rowCount ?? 0) === 0) {
      return { outcome: "NOT_FOUND" as const, code: "NOT_FOUND" as const, message: "Član nije u timu." };
    }
    return { outcome: "OK" as const };
  });
}

export async function addTenderPhase(
  pool: Pool,
  actor: TenderActor,
  tenderId: string,
  input: { code: string; name: string; weight: number; plannedStart?: string | null; plannedEnd?: string | null },
): Promise<{ outcome: "OK"; id: string } | (TeamError & { outcome: "FORBIDDEN" | "VALIDATION_FAILED" | "CONFLICT" })> {
  if (!can(actor.roles, "tenders.manage")) return { outcome: "FORBIDDEN", code: "FORBIDDEN", message: "Nemate pravo." };
  if (!input.code.trim() || !input.name.trim()) {
    return { outcome: "VALIDATION_FAILED", code: "VALIDATION_FAILED", message: "Oznaka i naziv faze su obavezni." };
  }
  // Težina ≥ 1 je pravilo iz `project_phases`: faza bez težine tiho ispada iz napretka.
  if (!Number.isInteger(input.weight) || input.weight < 1) {
    return { outcome: "VALIDATION_FAILED", code: "VALIDATION_FAILED", message: "Težina faze mora biti cijeli broj ≥ 1." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const sort = await client.query<{ next: string }>(
      `SELECT (COALESCE(MAX(sort_order), 0) + 10)::text AS next FROM public.tender_phases
        WHERE company_id = $1 AND tender_id = $2`,
      [actor.companyId, tenderId],
    );
    const id = `tph_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    try {
      await client.query(
        `INSERT INTO public.tender_phases
           (id, company_id, tender_id, code, name, weight, planned_start, planned_end, sort_order, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8::date,$9,$10,$10)`,
        [
          id,
          actor.companyId,
          tenderId,
          input.code.trim().toUpperCase(),
          input.name.trim(),
          input.weight,
          input.plannedStart || null,
          input.plannedEnd || null,
          Number(sort.rows[0]?.next ?? "10"),
          actor.userId,
        ],
      );
    } catch (error) {
      const code = typeof error === "object" && error !== null ? (error as { code?: string }).code : undefined;
      if (code === "23505") {
        return { outcome: "CONFLICT" as const, code: "CONFLICT" as const, message: "Faza sa tom oznakom već postoji." };
      }
      throw error;
    }
    return { outcome: "OK" as const, id };
  });
}
