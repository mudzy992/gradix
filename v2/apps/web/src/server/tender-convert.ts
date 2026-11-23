/**
 * Atomska konverzija WON tender → projekat.
 * Izvor: v1/.../tenders.service.ts (updateMany claim).
 */
import type { Pool, PoolClient } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import { writeAudit } from "./audit";
import { can } from "./permissions";
import type { TenderActor } from "./tender-service";

export type ConvertOutcome =
  | { outcome: "OK"; projectId: string }
  | { outcome: "FORBIDDEN" | "CONFLICT" | "NOT_FOUND"; code?: string; message?: string };

export class ConvertClaimLost extends Error {
  constructor() {
    super("CONVERT_CLAIM_LOST");
    this.name = "ConvertClaimLost";
  }
}

async function insertProjectFromTender(
  client: PoolClient,
  companyId: string,
  actorUserId: string,
  title: string,
  note: string | null,
): Promise<string> {
  const base = title
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
  let code = `T-${base || "NEW"}`.slice(0, 32);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = attempt === 0 ? code : `${code.slice(0, 28)}-${attempt}`;
    const exists = await client.query(`SELECT 1 FROM projects WHERE company_id = $1 AND code = $2`, [
      companyId,
      candidate,
    ]);
    if (exists.rowCount === 0) {
      code = candidate;
      break;
    }
  }
  const id = `prj_${crypto.randomUUID()}`;
  await client.query(
    `INSERT INTO projects (id, company_id, code, name, status, note, is_active, created_by)
     VALUES ($1, $2, $3, $4, 'ACTIVE', $5, true, $6)`,
    [id, companyId, code, title.trim().slice(0, 200), note, actorUserId],
  );
  await writeAudit(client, {
    companyId,
    actorId: actorUserId,
    actorEmail: null,
    action: "project.created",
    entityType: "project",
    entityId: id,
    metadata: { fromTender: true, code },
  });
  return id;
}

export async function convertTenderToProject(
  pool: Pool,
  actor: TenderActor,
  tenderId: string,
): Promise<ConvertOutcome> {
  if (!can(actor.roles, "tenders.convert")) {
    return { outcome: "FORBIDDEN", code: "ROLE", message: "Nemate pravo konverzije." };
  }
  try {
    return await withCompany(pool, toCompanyId(actor.companyId), (client) =>
      convertLocked(client, actor, tenderId));
  } catch (error) {
    if (error instanceof ConvertClaimLost) {
      return {
        outcome: "CONFLICT",
        code: "ALREADY_CONVERTED",
        message: "Tender je već pretvoren u projekat.",
      };
    }
    throw error;
  }
}

async function convertLocked(
  client: PoolClient,
  actor: TenderActor,
  tenderId: string,
): Promise<ConvertOutcome> {
  const found = await client.query<{
    title: string;
    note: string | null;
    status: string;
    converted_project_id: string | null;
  }>(
    `SELECT title, note, status, converted_project_id FROM public.tenders
      WHERE id = $1 AND company_id = $2
      FOR UPDATE`,
    [tenderId, actor.companyId],
  );
    const row = found.rows[0];
    if (!row) return { outcome: "NOT_FOUND", message: "Tender nije pronađen." };
    if (row.status !== "WON") {
      return {
        outcome: "CONFLICT",
        code: "TENDER_INVALID_STATUS",
        message: "Konverzija je dozvoljena samo za status Dobijeno.",
      };
    }
    if (row.converted_project_id) {
      return {
        outcome: "CONFLICT",
        code: "ALREADY_CONVERTED",
        message: "Tender je već pretvoren u projekat.",
      };
    }
    const projectId = await insertProjectFromTender(
      client,
      actor.companyId,
      actor.userId,
      row.title,
      row.note,
    );
    const claimed = await client.query(
      `UPDATE public.tenders
          SET converted_project_id = $3, updated_by = $4, updated_at = clock_timestamp()
        WHERE id = $1 AND company_id = $2
          AND status = 'WON' AND converted_project_id IS NULL`,
      [tenderId, actor.companyId, projectId, actor.userId],
    );
  if (claimed.rowCount === 0) throw new ConvertClaimLost();
  await writeAudit(client, {
    companyId: actor.companyId,
    actorId: actor.userId,
    actorEmail: null,
    action: "tender.converted",
    entityType: "tender",
    entityId: tenderId,
    metadata: { projectId },
  });
  return { outcome: "OK", projectId };
}
