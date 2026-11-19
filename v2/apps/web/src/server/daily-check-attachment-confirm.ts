/** R5.4: confirm + download URL for daily-check attachments. */
import type { Pool } from "pg";
import { withCompany, type CompanyId } from "@gradix/db";
import { can } from "./permissions";
import type { DailyCheckActor, DailyCheckAttachmentRow } from "./daily-check-types";
import {
  ATTACHMENT_COLUMNS,
  toAttachmentRow,
  type AllowedContentType,
  type AttachmentServiceError,
} from "./daily-check-attachment-helpers";
import { presignDownload, statObject, storageConfig } from "./storage";

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
  const config = storageConfig();
  if (!config.configured) return { code: "CONFLICT", message: config.reason };
  const row = await withCompany(pool, companyIdValue, async (client) => {
    const found = await client.query<{ object_key: string; size_bytes: string; status: string }>(
      `SELECT object_key, size_bytes, status FROM public.machine_daily_check_attachments
        WHERE id = $1 AND check_id = $2 AND company_id = $3`,
      [attachmentId, checkId, actor.companyId],
    );
    return found.rows[0] ?? null;
  });
  if (!row) return { code: "NOT_FOUND", message: "Prilog nije pronađen." };
  if (row.status === "confirmed") return { code: "CONFLICT", message: "Prilog je već potvrđen." };
  const facts = await statObject({ config, key: row.object_key });
  if (!facts.exists) {
    return { code: "VALIDATION_FAILED", message: "Datoteka nije stigla na server." };
  }
  if (facts.sizeBytes !== Number(row.size_bytes)) {
    return {
      code: "VALIDATION_FAILED",
      message: `Veličina na serveru (${facts.sizeBytes} B) ne odgovara prijavljenoj.`,
    };
  }
  return withCompany(pool, companyIdValue, async (client) => {
    await client.query(
      `UPDATE public.machine_daily_check_attachments
          SET status = 'confirmed', uploaded_at = now()
        WHERE id = $1 AND company_id = $2`,
      [attachmentId, actor.companyId],
    );
    const updated = await client.query(
      `SELECT ${ATTACHMENT_COLUMNS} FROM public.machine_daily_check_attachments WHERE id = $1 AND company_id = $2`,
      [attachmentId, actor.companyId],
    );
    return { attachment: toAttachmentRow(updated.rows[0]! as Record<string, unknown>) };
  });
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
  const config = storageConfig();
  if (!config.configured) return { code: "CONFLICT", message: config.reason };
  const row = await withCompany(pool, companyIdValue, async (client) => {
    const found = await client.query<{
      object_key: string;
      file_name: string;
      content_type: AllowedContentType;
      status: string;
    }>(
      `SELECT object_key, file_name, content_type, status FROM public.machine_daily_check_attachments
        WHERE id = $1 AND check_id = $2 AND company_id = $3`,
      [attachmentId, checkId, actor.companyId],
    );
    return found.rows[0] ?? null;
  });
  if (!row) return { code: "NOT_FOUND", message: "Prilog nije pronađen." };
  if (row.status !== "confirmed") return { code: "NOT_FOUND", message: "Prilog još nije uploadovan." };
  return presignDownload({
    config,
    key: row.object_key,
    fileName: row.file_name,
    contentType: row.content_type,
  });
}
