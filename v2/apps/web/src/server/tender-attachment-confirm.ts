/** R7.3: confirm + download URL for tender attachments. */
import type { Pool } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import { can } from "./permissions";
import type { TenderActor } from "./tender-service";
import { presignDownload, statObject, storageConfig } from "./storage";
import type { TenderAttachmentRow } from "./tender-attachment-service";

type Err = { code: "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "CONFLICT"; message: string };

const COLS = "id, tender_id, file_name, content_type, size_bytes, status, created_at";

function toRow(row: Record<string, unknown>): TenderAttachmentRow {
  return {
    id: String(row.id),
    tenderId: String(row.tender_id),
    fileName: String(row.file_name),
    contentType: String(row.content_type),
    sizeBytes: Number(row.size_bytes),
    status: String(row.status),
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

export async function confirmTenderAttachment(
  pool: Pool,
  actor: TenderActor,
  tenderId: string,
  attachmentId: string,
): Promise<{ attachment: TenderAttachmentRow } | Err> {
  if (!can(actor.roles, "tenders.manage")) {
    return { code: "FORBIDDEN", message: "Nemate pravo potvrde priloga." };
  }
  const config = storageConfig();
  if (!config.configured) return { code: "CONFLICT", message: config.reason };
  const row = await withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const found = await client.query<{ object_key: string; size_bytes: string; status: string }>(
      `SELECT object_key, size_bytes, status FROM public.tender_attachments
        WHERE id = $1 AND tender_id = $2 AND company_id = $3`,
      [attachmentId, tenderId, actor.companyId],
    );
    return found.rows[0] ?? null;
  });
  if (!row) return { code: "NOT_FOUND", message: "Prilog nije pronađen." };
  if (row.status === "ready") return { code: "CONFLICT", message: "Prilog je već potvrđen." };
  const facts = await statObject({ config, key: row.object_key });
  if (!facts.exists) return { code: "VALIDATION_FAILED", message: "Datoteka nije stigla na server." };
  if (facts.sizeBytes !== Number(row.size_bytes)) {
    return {
      code: "VALIDATION_FAILED",
      message: `Veličina na serveru (${facts.sizeBytes} B) ne odgovara prijavljenoj.`,
    };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    await client.query(
      `UPDATE public.tender_attachments SET status = 'ready', uploaded_at = now()
        WHERE id = $1 AND company_id = $2`,
      [attachmentId, actor.companyId],
    );
    const updated = await client.query(
      `SELECT ${COLS} FROM public.tender_attachments WHERE id = $1 AND company_id = $2`,
      [attachmentId, actor.companyId],
    );
    return { attachment: toRow(updated.rows[0]! as Record<string, unknown>) };
  });
}

export async function tenderAttachmentDownloadUrl(
  pool: Pool,
  actor: TenderActor,
  tenderId: string,
  attachmentId: string,
): Promise<{ url: string; expiresAt: string } | Err> {
  if (!can(actor.roles, "tenders.view")) return { code: "FORBIDDEN", message: "Nemate pravo pregleda." };
  const config = storageConfig();
  if (!config.configured) return { code: "CONFLICT", message: config.reason };
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const found = await client.query<{
      object_key: string;
      file_name: string;
      content_type: string;
      status: string;
    }>(
      `SELECT object_key, file_name, content_type, status FROM public.tender_attachments
        WHERE id = $1 AND tender_id = $2 AND company_id = $3`,
      [attachmentId, tenderId, actor.companyId],
    );
    const row = found.rows[0];
    if (!row) return { code: "NOT_FOUND", message: "Prilog nije pronađen." };
    if (row.status !== "ready") return { code: "NOT_FOUND", message: "Prilog još nije uploadovan." };
    return presignDownload({
      config,
      key: row.object_key,
      fileName: row.file_name,
      contentType: row.content_type as "application/pdf",
    });
  });
}
