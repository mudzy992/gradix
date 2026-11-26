/**
 * F0.2 — JEDAN servis priloga za sve module.
 *
 * Zašto: `obligation_attachments`, `tender_attachments` i `machine_daily_check_attachments`
 * imale su isti životni ciklus (register → presigned PUT → confirm → download URL) i tri puta
 * isti kod. Svaki novi modul (servis, dnevnik, HSE, nabavka) tražio bi četvrti.
 *
 * Životni ciklus:
 *   1. `registerAttachment`  — provjeri tip iz sadržaja, šač, limit, duplikat; upiši `pending`,
 *                              vrati presigned PUT URL;
 *   2. `confirmAttachment`   — provjeri da objekat STVARNO postoji i da se veličina poklapa;
 *                              `pending` → `ready`;
 *   3. `attachmentDownloadUrl` — presigned GET, 60 s, samo za prilog svoje firme;
 *   4. `softDeleteAttachment` — `deleted` + `deleted_at`; objekat u bucketu briše worker.
 *
 * Dozvole i veza na entitet NISU ovdje: pozivalac (obaveza, tender, pregled mašine) provjerava
 * svoju dozvolu i postojanje entiteta, pa zove ovaj servis. Tako servis ostaje jedan, a pravila
 * pristupa ostaju uz modul koji ih razumije.
 */
import type { Pool, PoolClient } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import { writeAudit, type AuditAction } from "./audit";
import {
  ATTACHMENT_ENTITY_TYPES as DOMAIN_ENTITY_TYPES,
  MAX_ATTACHMENTS_PER_ENTITY,
  attachmentObjectKey,
  validateAttachmentInput,
  type AttachmentEntityType as DomainEntityType,
} from "@gradix/domain";
import {
  detectContentType,
  presignDownload,
  presignUpload,
  sanitiseFileName,
  storageConfig,
  type AllowedContentType,
} from "./storage";

/**
 * Na šta prilog može biti zakačen. Spisak je u `@gradix/domain` (isto što CHECK u bazi);
 * novi tip = nova migracija CHECK-a, novi red u `attachment-access.ts` i nova dozvola.
 */
export const ATTACHMENT_ENTITY_TYPES = DOMAIN_ENTITY_TYPES;
export type AttachmentEntityType = DomainEntityType;

export type AttachmentStatus = "pending" | "ready" | "deleted";

export type AttachmentRow = {
  id: string;
  entityType: AttachmentEntityType;
  entityId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  status: AttachmentStatus;
  createdAt: string;
};

export { attachmentObjectKey };

export type AttachmentServiceError = {
  code: "NOT_FOUND" | "VALIDATION_FAILED" | "CONFLICT" | "FORBIDDEN";
  message: string;
};

export type AttachmentRequest = {
  fileName: string;
  sizeBytes: number;
  sha256: string;
  head: Uint8Array;
};

export type AttachmentActor = {
  userId: string;
  companyId: string;
  roles: readonly string[];
};

const COLS = "id, entity_type, entity_id, file_name, content_type, size_bytes, status, created_at";

export function toAttachmentRow(row: Record<string, unknown>): AttachmentRow {
  return {
    id: String(row.id),
    entityType: String(row.entity_type) as AttachmentEntityType,
    entityId: String(row.entity_id),
    fileName: String(row.file_name),
    contentType: String(row.content_type),
    sizeBytes: Number(row.size_bytes),
    status: String(row.status) as AttachmentStatus,
    createdAt: row.created_at instanceof Date
      ? row.created_at.toISOString()
      : String(row.created_at),
  };
}

export function isAttachmentServiceError(value: unknown): value is AttachmentServiceError {
  return Boolean(value && typeof value === "object" && "code" in value && "message" in value);
}

/** Putanja u bucketu: `gx2/{firma}/{tip}/{entitet}/{prilog}` (ADR 0006). */
/**
 * Napušteni `pending` uploadi stariji od sat vremena: red se briše logički (`deleted`),
 * objekat u bucketu čisti worker. Poziva se pri svakom novom uploadu — bez workera.
 */
async function purgeStalePending(client: PoolClient, companyId: string, entityType: AttachmentEntityType, entityId: string): Promise<void> {
  await client.query(
    `UPDATE public.attachments SET status = 'deleted', deleted_at = clock_timestamp()
      WHERE company_id = $1 AND entity_type = $2 AND entity_id = $3
        AND status = 'pending' AND created_at < clock_timestamp() - interval '1 hour'`,
    [companyId, entityType, entityId],
  );
}

export async function listAttachments(
  pool: Pool,
  companyId: string,
  entityType: AttachmentEntityType,
  entityId: string,
): Promise<AttachmentRow[]> {
  return withCompany(pool, toCompanyId(companyId), async (client) => {
    const rows = await client.query(
      `SELECT ${COLS} FROM public.attachments
        WHERE company_id = $1 AND entity_type = $2 AND entity_id = $3 AND status <> 'deleted'
        ORDER BY created_at DESC`,
      [companyId, entityType, entityId],
    );
    return rows.rows.map((row) => toAttachmentRow(row as Record<string, unknown>));
  });
}

export type RegisterAttachmentResult =
  | { attachment: AttachmentRow; uploadUrl: string; uploadExpiresAt: string }
  | AttachmentServiceError;

export async function registerAttachment(
  pool: Pool,
  companyId: string,
  actor: { userId: string },
  entityType: AttachmentEntityType,
  entityId: string,
  input: AttachmentRequest,
  options: { maxPerEntity?: number; retentionUntil?: string | null } = {},
): Promise<RegisterAttachmentResult> {
  const maxPerEntity = options.maxPerEntity ?? MAX_ATTACHMENTS_PER_ENTITY;
  return withCompany(pool, toCompanyId(companyId), async (client) => {
    await purgeStalePending(client, companyId, entityType, entityId);

    const invalid = validateAttachmentInput(input);
    if (invalid) return invalid;

    const count = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.attachments
        WHERE company_id = $1 AND entity_type = $2 AND entity_id = $3 AND status = 'ready'`,
      [companyId, entityType, entityId],
    );
    if (Number(count.rows[0]!.n) >= maxPerEntity) {
      return { code: "CONFLICT", message: `Entitet može imati najviše ${maxPerEntity} priloga.` };
    }

    // Tip iz sadržaja, ne iz imena: `.exe` preimenovan u `.pdf` pada ovdje.
    const contentType = detectContentType(input.head);
    if (!contentType) {
      return {
        code: "VALIDATION_FAILED",
        message: "Datoteka nije PDF ni slika (JPG, PNG, WebP, HEIC) — provjerite sadržaj, ne samo ime.",
      };
    }

    const duplicate = await client.query(
      `SELECT id FROM public.attachments
        WHERE company_id = $1 AND entity_type = $2 AND entity_id = $3 AND sha256 = $4`,
      [companyId, entityType, entityId, input.sha256],
    );
    if (duplicate.rowCount !== 0) {
      return { code: "CONFLICT", message: "Taj prilog je već dodan." };
    }

    const config = storageConfig();
    if (!config.configured) return { code: "CONFLICT", message: config.reason };

    const id = `att_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const key = attachmentObjectKey(companyId, entityType, entityId, id);
    const upload = await presignUpload({ config, key, contentType });

    await client.query(
      `INSERT INTO public.attachments
         (id, company_id, entity_type, entity_id, object_key, file_name, content_type,
          size_bytes, sha256, status, retention_until, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10,$11)`,
      [
        id, companyId, entityType, entityId, key,
        sanitiseFileName(input.fileName), contentType, input.sizeBytes, input.sha256,
        options.retentionUntil ?? null, actor.userId,
      ],
    );

    const created = await client.query(
      `SELECT ${COLS} FROM public.attachments WHERE id = $1 AND company_id = $2`,
      [id, companyId],
    );
    return {
      attachment: toAttachmentRow(created.rows[0]! as Record<string, unknown>),
      uploadUrl: upload.url,
      uploadExpiresAt: upload.expiresAt,
    };
  });
}

/**
 * Potvrda: prilog postaje `ready` tek kad objekat STVARNO postoji i kad se veličina
 * poklapa. Bez ovoga bi u bazi stajao prilog koji se ne može otvoriti.
 */
export async function confirmAttachment(
  pool: Pool,
  companyId: string,
  actor: { userId: string },
  attachmentId: string,
  audit: { action: AuditAction; entityType: string; entityId: string },
): Promise<{ attachment: AttachmentRow } | AttachmentServiceError> {
  const config = storageConfig();
  if (!config.configured) return { code: "CONFLICT", message: config.reason };

  const row = await withCompany(pool, toCompanyId(companyId), async (client) => {
    const found = await client.query<{ object_key: string; size_bytes: string; status: string }>(
      `SELECT object_key, size_bytes, status FROM public.attachments
        WHERE id = $1 AND company_id = $2`,
      [attachmentId, companyId],
    );
    return found.rows[0] ?? null;
  });
  if (!row) return { code: "NOT_FOUND", message: "Prilog nije pronađen." };
  if (row.status === "ready") return { code: "CONFLICT", message: "Prilog je već potvrđen." };
  if (row.status === "deleted") return { code: "NOT_FOUND", message: "Prilog nije pronađen." };

  const { statObject } = await import("./storage");
  const facts = await statObject({ config, key: row.object_key });
  if (!facts.exists) {
    return { code: "VALIDATION_FAILED", message: "Datoteka nije stigla na server. Pokušajte upload ponovo." };
  }
  if (facts.sizeBytes !== Number(row.size_bytes)) {
    return {
      code: "VALIDATION_FAILED",
      message: `Veličina na serveru (${facts.sizeBytes} B) ne odgovara prijavljenoj (${Number(row.size_bytes)} B).`,
    };
  }

  return withCompany(pool, toCompanyId(companyId), async (client) => {
    await client.query(
      `UPDATE public.attachments SET status = 'ready', uploaded_at = clock_timestamp()
        WHERE id = $1 AND company_id = $2 AND status = 'pending'`,
      [attachmentId, companyId],
    );
    await writeAudit(client, {
      companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: audit.action,
      entityType: audit.entityType,
      entityId: audit.entityId,
      // Bez imena fajla: ime često sadrži ime osobe („ljekarski Amina.pdf“).
      metadata: { attachmentId },
    });
    const updated = await client.query(
      `SELECT ${COLS} FROM public.attachments WHERE id = $1 AND company_id = $2`,
      [attachmentId, companyId],
    );
    return { attachment: toAttachmentRow(updated.rows[0]! as Record<string, unknown>) };
  });
}

/** Potpisan link za preuzimanje, 60 s; samo za prilog svoje firme (RLS + provjera). */
export async function attachmentDownloadUrl(
  pool: Pool,
  companyId: string,
  attachmentId: string,
): Promise<{ url: string; expiresAt: string } | AttachmentServiceError> {
  const config = storageConfig();
  if (!config.configured) return { code: "CONFLICT", message: config.reason };

  const row = await withCompany(pool, toCompanyId(companyId), async (client) => {
    const found = await client.query<{
      object_key: string;
      file_name: string;
      content_type: AllowedContentType | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      status: string;
      entity_id: string;
    }>(
      `SELECT object_key, file_name, content_type, status, entity_id FROM public.attachments
        WHERE id = $1 AND company_id = $2`,
      [attachmentId, companyId],
    );
    return found.rows[0] ?? null;
  });
  if (!row) return { code: "NOT_FOUND", message: "Prilog nije pronađen." };
  if (row.status !== "ready") return { code: "NOT_FOUND", message: "Prilog još nije uploadovan." };

  return presignDownload({
    config,
    key: row.object_key,
    fileName: row.file_name,
    contentType: row.content_type,
  });
}

/**
 * Meko brisanje. Fizički objekat u bucketu briše worker po retenciji; red ostaje kao dokaz
 * da je prilog postojao (Modul 1: audit i retencija).
 */
export async function softDeleteAttachment(
  pool: Pool,
  companyId: string,
  actor: { userId: string },
  attachmentId: string,
  audit: { action: AuditAction; entityType: string; entityId: string },
): Promise<{ ok: true } | AttachmentServiceError> {
  return withCompany(pool, toCompanyId(companyId), async (client) => {
    const found = await client.query<{ status: string; entity_id: string }>(
      `SELECT status, entity_id FROM public.attachments WHERE id = $1 AND company_id = $2`,
      [attachmentId, companyId],
    );
    const row = found.rows[0];
    if (!row || row.status === "deleted") {
      return { code: "NOT_FOUND", message: "Prilog nije pronađen." };
    }
    await client.query(
      `UPDATE public.attachments SET status = 'deleted', deleted_at = clock_timestamp()
        WHERE id = $1 AND company_id = $2`,
      [attachmentId, companyId],
    );
    await writeAudit(client, {
      companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: audit.action,
      entityType: audit.entityType,
      entityId: audit.entityId,
      metadata: { attachmentId },
    });
    return { ok: true } as const;
  });
}
