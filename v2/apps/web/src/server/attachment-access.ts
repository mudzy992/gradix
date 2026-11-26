/**
 * F0.2 — pristup prilozima po tipu entiteta, na JEDNOM mjestu.
 *
 * `attachment-service` ne zna ništa o obavezama, tenderima ni pregledima; zna samo tabelu
 * `attachments`. Ovaj modul je granica: za svaki `entity_type` kaže koja dozvola treba za
 * čitanje i za pisanje i u kojoj tabeli entitet živi. Kad Modul 9 doda foto uz servisni nalog,
 * ovdje se doda jedan red — servis, rute i testovi ostaju isti.
 *
 * Dozvole su NAMJERNO različite po modulu: prilog uz obavezu je medicinski nalaz
 * (`obligations.attachments.view`), prilog uz pregled mašine je foto sa gradilišta
 * (`machines.check.view`). Jedna zajednička dozvola „attachments.view“ bi otvorila nalaze
 * svakome ko smije vidjeti foto.
 */
import type { Pool } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import type { AttachmentEntityType } from "@gradix/domain";
import type { Permission } from "./permissions";

export type AttachmentEntityAccess = {
  /** Tabela u kojoj entitet živi (ima `id` i `company_id`). */
  table: string;
  /** Naziv za poruke korisniku. */
  label: string;
  read: Permission;
  write: Permission;
};

export const ATTACHMENT_ACCESS: Record<AttachmentEntityType, AttachmentEntityAccess> = {
  OBLIGATION: {
    table: "obligations",
    label: "Obaveza",
    read: "obligations.attachments.view",
    write: "obligations.manage",
  },
  TENDER: {
    table: "tenders",
    label: "Tender",
    read: "tenders.view",
    write: "tenders.manage",
  },
  MACHINE_DAILY_CHECK: {
    table: "machine_daily_checks",
    label: "Dnevni pregled",
    read: "machines.check.view",
    write: "machines.check.create",
  },
  /*
   * F5: račun sa gradilišta. Čita ga onaj ko vidi troškove, a prilaže onaj ko smije knjižiti —
   * radnik na terenu prilaže kroz svoj nalog (mobile), pa je `projects.costs.book` prava granica:
   * isti ljudi koji smiju unijeti iznos smiju i priložiti dokaz.
   */
  PROJECT: {
    table: "projects",
    label: "Projekat",
    read: "projects.costs.view",
    write: "projects.costs.book",
  },
};

/** `true` ako entitet postoji u OVOJ firmi; RLS ne pušta tuđi red, pa je odgovor `false`. */
export async function attachmentEntityExists(
  pool: Pool,
  companyId: string,
  entityType: AttachmentEntityType,
  entityId: string,
): Promise<boolean> {
  const access = ATTACHMENT_ACCESS[entityType];
  return withCompany(pool, toCompanyId(companyId), async (client) => {
    const found = await client.query(
      `SELECT 1 FROM public.${access.table} WHERE id = $1 AND company_id = $2`,
      [entityId, companyId],
    );
    return found.rowCount !== 0;
  });
}

/** Prilog pripada BAŠ tom entitetu — inače bi se link mogao „prebaciti“ na drugi id. */
export async function attachmentBelongsTo(
  pool: Pool,
  companyId: string,
  entityType: AttachmentEntityType,
  entityId: string,
  attachmentId: string,
): Promise<boolean> {
  return withCompany(pool, toCompanyId(companyId), async (client) => {
    const found = await client.query(
      `SELECT 1 FROM public.attachments
        WHERE id = $1 AND company_id = $2 AND entity_type = $3 AND entity_id = $4`,
      [attachmentId, companyId, entityType, entityId],
    );
    return found.rowCount !== 0;
  });
}

/**
 * Prilog → njegov entitet. Ruta za `confirm`/`url`/`delete` zna samo id priloga, pa dozvola
 * i audit trag moraju izaći iz reda u bazi, ne iz tijela zahtjeva: klijent ne bira dozvolu.
 */
export async function attachmentTarget(
  pool: Pool,
  companyId: string,
  attachmentId: string,
): Promise<{ entityType: AttachmentEntityType | "REPORT_JOB"; entityId: string } | null> {
  return withCompany(pool, toCompanyId(companyId), async (client) => {
    const found = await client.query<{ entity_type: string; entity_id: string }>(
      `SELECT entity_type, entity_id FROM public.attachments WHERE id = $1 AND company_id = $2`,
      [attachmentId, companyId],
    );
    const row = found.rows[0];
    if (!row) return null;
    return {
      entityType: row.entity_type as AttachmentEntityType | "REPORT_JOB",
      entityId: row.entity_id,
    };
  });
}
