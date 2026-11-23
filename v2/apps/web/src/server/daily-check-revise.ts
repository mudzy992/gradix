/** R5.4: append-only revision of machine daily checks. */
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import { can } from "./permissions";
import type { DailyCheckActor, MutationOutcome } from "./daily-check-types";

export type ReviseInput = { reason: string; payload: Record<string, unknown> };

export async function reviseDailyCheck(
  pool: Pool,
  actor: DailyCheckActor,
  checkId: string,
  input: ReviseInput,
): Promise<MutationOutcome> {
  if (!can(actor.roles, "machines.check.revise")) return { outcome: "FORBIDDEN", code: "ROLE" };
  if (input.reason.trim().length < 10) {
    return { outcome: "VALIDATION_FAILED", code: "REASON_TOO_SHORT", message: "Razlog ≥10 znakova." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const check = await client.query<{
      id: string;
      version: number;
      result: string;
      checklist_json: Record<string, unknown>;
      note: string | null;
    }>(
      `SELECT id, version, result, checklist_json, note
         FROM public.machine_daily_checks WHERE company_id = $1 AND id = $2`,
      [actor.companyId, checkId],
    );
    if (!check.rows[0]) {
      return { outcome: "VALIDATION_FAILED", code: "NOT_FOUND", message: "Zapis ne postoji." };
    }
    const row = check.rows[0];
    const original = {
      result: row.result,
      checklistJson: row.checklist_json,
      note: row.note,
    };
    await client.query(
      `INSERT INTO public.machine_daily_check_revisions
         (id, company_id, check_id, base_version, reason, author_id, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        `mdcr_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        actor.companyId,
        row.id,
        row.version,
        input.reason.trim(),
        actor.userId,
        JSON.stringify({ original, ...input.payload }),
      ],
    );
    return { outcome: "OK", id: row.id };
  });
}
