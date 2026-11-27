/** Siguran nastavak offline fotografije: staging PUT, provjera bajtova, kopija u trajni ključ. */
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import type { Pool } from "pg";
import { writeAudit } from "./audit";
import { can } from "./permissions";
import { detectContentType, presignDownload, presignUpload, sha256Hex, storageConfig, type AllowedContentType } from "./storage";
import { hseRecordAllowed, type HseActor } from "./hse-scope";

export type HsePhotoResult =
  | { outcome: "OK"; status: "pending" | "confirmed"; uploadUrl: string | null }
  | { outcome: "NOT_FOUND" | "FORBIDDEN" | "VALIDATION_FAILED" | "STORAGE_UNAVAILABLE"; message: string };

export async function hsePhotoDownload(pool: Pool, actor: HseActor, incidentId: string, sha256: string):
Promise<{ url: string; expiresAt: string } | null> {
  if (!/^[a-f0-9]{64}$/.test(sha256)) return null;
  const config = storageConfig();
  if (!config.configured) return null;
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    if (!await hseRecordAllowed(client, actor, "incident", incidentId)) return null;
    const found = await client.query<{ object_key: string; file_name: string; content_type: AllowedContentType }>(
      `SELECT object_key, file_name, content_type FROM public.hse_attachments
        WHERE company_id = $1 AND entity_type = 'INCIDENT' AND entity_id = $2 AND sha256 = $3 AND status = 'confirmed'`,
      [actor.companyId, incidentId, sha256],
    );
    const row = found.rows[0];
    if (!row) return null;
    return presignDownload({ config, key: row.object_key, fileName: row.file_name, contentType: row.content_type });
  });
}

export async function resumeHsePhoto(
  pool: Pool, actor: HseActor, incidentId: string, sha256: string, action: "UPLOAD_URL" | "CONFIRM",
): Promise<HsePhotoResult> {
  if (!/^[a-f0-9]{64}$/.test(sha256)) return { outcome: "VALIDATION_FAILED", message: "Kontrolni zbir nije ispravan." };
  const config = storageConfig();
  if (!config.configured) return { outcome: "STORAGE_UNAVAILABLE", message: config.reason };
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    if (!await hseRecordAllowed(client, actor, "incident", incidentId)) return { outcome: "NOT_FOUND", message: "Prijava ili fotografija nije pronađena." };
    const found = await client.query<{
      id: string; object_key: string; content_type: AllowedContentType; size_bytes: string;
      status: "pending" | "confirmed"; reporter_user_id: string | null;
    }>(
      `SELECT a.id, a.object_key, a.content_type, a.size_bytes::text, a.status, i.reporter_user_id
         FROM public.hse_attachments a JOIN public.hse_incidents i ON i.company_id = a.company_id AND i.id = a.entity_id
        WHERE a.company_id = $1 AND a.entity_type = 'INCIDENT' AND a.entity_id = $2 AND a.sha256 = $3
        FOR UPDATE OF a`, [actor.companyId, incidentId, sha256],
    );
    const row = found.rows[0];
    if (!row) return { outcome: "NOT_FOUND", message: "Prijava ili fotografija nije pronađena." };
    if (row.reporter_user_id !== actor.userId && !can(actor.roles, "hse.investigate")) {
      return { outcome: "FORBIDDEN", message: "Fotografiju može poslati prijavitelj ili osoba koja vodi istragu." };
    }
    if (row.status === "confirmed") return { outcome: "OK", status: "confirmed", uploadUrl: null };
    const stagingKey = `${row.object_key}.upload`;
    if (action === "UPLOAD_URL") {
      const upload = await presignUpload({ config, key: stagingKey, contentType: row.content_type });
      return { outcome: "OK", status: "pending", uploadUrl: upload.url };
    }
    let chunks: Buffer[] = [];
    try {
      const object = await config.client.send(new GetObjectCommand({ Bucket: config.bucket, Key: stagingKey }));
      const size = Number(row.size_bytes);
      if (Number(object.ContentLength) !== size || !object.Body) return { outcome: "VALIDATION_FAILED", message: "Veličina fotografije se ne poklapa." };
      let total = 0;
      for await (const chunk of object.Body as AsyncIterable<Uint8Array>) {
        total += chunk.length;
        if (total > size || total > 10_485_760) throw new Error("PHOTO_TOO_LARGE");
        chunks.push(Buffer.from(chunk));
      }
      if (total !== size) return { outcome: "VALIDATION_FAILED", message: "Fotografija nije potpuno prenesena." };
      const bytes = Buffer.concat(chunks);
      chunks = [];
      if (sha256Hex(bytes) !== sha256 || detectContentType(bytes.subarray(0, 32)) !== row.content_type) {
        return { outcome: "VALIDATION_FAILED", message: "Sadržaj ili kontrolni zbir fotografije nije ispravan." };
      }
      // Potpisani URL može mijenjati samo staging; potvrđeni dokaz ne može pregaziti stari URL.
      await config.client.send(new PutObjectCommand({ Bucket: config.bucket, Key: row.object_key, Body: bytes, ContentType: row.content_type }));
      // Ne blokiraj potvrdu ako privremeni objekt trenutno nije moguće obrisati.
      await config.client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: stagingKey })).catch(() => undefined);
    } catch {
      return { outcome: "STORAGE_UNAVAILABLE", message: "Fotografija nije dostupna; pokušajte upload ponovo." };
    }
    await client.query(
      "UPDATE public.hse_attachments SET status = 'confirmed', uploaded_at = clock_timestamp() WHERE company_id = $1 AND id = $2 AND status = 'pending'",
      [actor.companyId, row.id],
    );
    await writeAudit(client, { companyId: actor.companyId, actorId: actor.userId, actorEmail: null,
      action: "hse.photo_confirmed", entityType: "hse_incident", entityId: incidentId,
      metadata: { attachmentId: row.id, sha256 }, retentionClass: "ACCESS" });
    return { outcome: "OK", status: "confirmed", uploadUrl: null };
  });
}
