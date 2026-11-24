/** R5.4 → F0.2: confirm + download URL kroz zajednički `attachment-service`. */
import type { Pool } from "pg";
import { withCompany, type CompanyId } from "@gradix/db";
import { can } from "./permissions";
import type { DailyCheckActor, DailyCheckAttachmentRow } from "./daily-check-types";
import type { AttachmentServiceError } from "./daily-check-attachment-helpers";
import {
  attachmentDownloadUrl,
  confirmAttachment,
  isAttachmentServiceError,
} from "./attachment-service";

function toRow(row: {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  status: string;
  createdAt: string;
}): DailyCheckAttachmentRow {
  return {
    id: row.id,
    fileName: row.fileName,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    status: row.status === "ready" ? "confirmed" : (row.status as "pending" | "confirmed"),
    createdAt: row.createdAt,
  };
}

async function belongs(pool: Pool, companyId: string, checkId: string, attachmentId: string): Promise<boolean> {
  return withCompany(pool, companyId as CompanyId, async (client) => {
    const found = await client.query(
      `SELECT 1 FROM public.attachments
        WHERE id = $1 AND company_id = $2 AND entity_type = 'MACHINE_DAILY_CHECK' AND entity_id = $3`,
      [attachmentId, companyId, checkId],
    );
    return found.rowCount !== 0;
  });
}

export async function confirmDailyCheckAttachment(
  pool: Pool,
  companyIdValue: CompanyId,
  actor: DailyCheckActor,
  checkId: string,
  attachmentId: string,
): Promise<{ attachment: DailyCheckAttachmentRow } | AttachmentServiceError> {
  if (!can(actor.roles, "machines.check.create")) {
    return { code: "FORBIDDEN", message: "Nemate pravo potvrde priloga." };
  }
  if (!(await belongs(pool, companyIdValue, checkId, attachmentId))) {
    return { code: "NOT_FOUND", message: "Prilog nije pronađen." };
  }
  const result = await confirmAttachment(
    pool,
    companyIdValue,
    { userId: actor.userId },
    attachmentId,
    { action: "attachment.confirmed", entityType: "machine_daily_check", entityId: checkId },
  );
  if (isAttachmentServiceError(result)) return result;
  return { attachment: toRow(result.attachment) };
}

export async function dailyCheckAttachmentDownloadUrl(
  pool: Pool,
  companyIdValue: CompanyId,
  actor: DailyCheckActor,
  checkId: string,
  attachmentId: string,
): Promise<{ url: string; expiresAt: string } | AttachmentServiceError> {
  if (!can(actor.roles, "machines.check.view")) {
    return { code: "FORBIDDEN", message: "Nemate pravo pregleda." };
  }
  if (!(await belongs(pool, companyIdValue, checkId, attachmentId))) {
    return { code: "NOT_FOUND", message: "Prilog nije pronađen." };
  }
  const result = await attachmentDownloadUrl(pool, companyIdValue, attachmentId);
  if (isAttachmentServiceError(result)) return result;
  return result;
}
