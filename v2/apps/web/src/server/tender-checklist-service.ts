/**
 * F7 — kontrolna lista dokumenata i bankarske garancije (spec 08 §1.4).
 *
 * Pravila koja žive OVDJE:
 *
 *  - **Checklista je jedina kapija predaje.** `SUBMITTED` traži da svaka `required` stavka bude
 *    `ATTACHED` ili `NOT_APPLICABLE` sa razlogom; baza to ne može sama provjeriti jer zavisi
 *    od stanja više redova, pa se provjera radi tu i u `tender-service.changeStatus`.
 *  - **Garancija je stavka checkliste, ne druga tabela.** Ponudbena garancija je upravo jedan od
 *    dokumenata koji se prilažu; dva odvojena spiska za istu stvar bi se razišla (neko doda
 *    garanciju, a checklista i dalje kaže „nema“).
 *  - **Šifarnik nastaje LENJO** (`ensureChecklistTemplates`): isti razlog kao komponente obračuna
 *    (F6) — `created_by` pokazuje na stvarnog korisnika, pa firma koja nikad ne otvori tender
 *    ne smije imati redove koji drže RESTRICT vezu ka `users`.
 *  - **Povrat garancije je činjenica sa datumom** (`returned_at`), ne brisanje reda: novac i
 *    obaveza prema banci se zatvaraju kad banka vrati original, a to se mora vidjeti.
 */
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import { blockingChecklistItems, isCurrency, toAmountString, type Currency } from "@gradix/domain";
import { writeAudit } from "./audit";
import { can } from "./permissions";
import type { TenderActor } from "./tender-service";

export type ChecklistError = {
  outcome: "FORBIDDEN" | "VALIDATION_FAILED" | "CONFLICT" | "NOT_FOUND";
  code?: string;
  message: string;
};

export type TenderChecklistItemRow = {
  id: string;
  code: string;
  label: string;
  required: boolean;
  status: "MISSING" | "ATTACHED" | "NOT_APPLICABLE";
  attachmentId: string | null;
  validUntil: string | null;
  note: string | null;
  guaranteeType: "BID" | "PERFORMANCE" | "ADVANCE" | "WARRANTY" | null;
  bank: string | null;
  amount: string | null;
  returnedAt: string | null;
  sortOrder: number;
};

/**
 * Zadane stavke kontrolne liste. Nije u migraciji (vidi `ensureChecklistTemplates`) — ovo je
 * JEDAN izvor istine za firmu koja nikad nije imala tender.
 */
export const DEFAULT_CHECKLIST_TEMPLATES: ReadonlyArray<{
  code: string;
  label: string;
  required: boolean;
  sortOrder: number;
}> = [
  { code: "BID_GUARANTEE", label: "Ponudbena garancija (bankarska)", required: true, sortOrder: 10 },
  { code: "COMPANY_DOCS", label: "Dokazi o registraciji firme", required: true, sortOrder: 20 },
  { code: "TAX_CERTIFICATE", label: "Potvrda o izmirenim porezima", required: true, sortOrder: 30 },
  { code: "BID_FORM", label: "Ponudbeni obrazac (potpisan i pečaćen)", required: true, sortOrder: 40 },
  { code: "BOQ_SIGNED", label: "Predmjer sa jediničnim cijenama", required: true, sortOrder: 50 },
  { code: "REFERENCES", label: "Spisak referentnih poslova", required: false, sortOrder: 60 },
  { code: "HSE_STATEMENT", label: "Izjava o zaštiti na radu", required: false, sortOrder: 70 },
];

/** Lenjo punjenje šifarnika kontrolne liste za firmu (idempotentno). */
export async function ensureChecklistTemplates(
  client: PoolClient,
  companyId: string,
  userId: string,
): Promise<void> {
  const existing = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM public.tender_checklist_templates WHERE company_id = $1`,
    [companyId],
  );
  if (Number(existing.rows[0]?.n ?? "0") > 0) return;
  for (const template of DEFAULT_CHECKLIST_TEMPLATES) {
    await client.query(
      `INSERT INTO public.tender_checklist_templates
         (id, company_id, code, label, required, sort_order, is_active, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,true,$7,$7)
       ON CONFLICT (company_id, code) DO NOTHING`,
      [
        `tct_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        companyId,
        template.code,
        template.label,
        template.required,
        template.sortOrder,
        userId,
      ],
    );
  }
}

async function tenderCurrency(
  client: PoolClient,
  companyId: string,
  tenderId: string,
): Promise<Currency | null> {
  const row = await client.query<{ currency_code: string }>(
    `SELECT currency_code FROM public.tenders WHERE id = $1 AND company_id = $2`,
    [tenderId, companyId],
  );
  const code = row.rows[0]?.currency_code;
  return code && isCurrency(code) ? code : null;
}

function mapItem(row: Record<string, unknown>, currency: Currency): TenderChecklistItemRow {
  return {
    id: String(row.id),
    code: String(row.code),
    label: String(row.label),
    required: Boolean(row.required),
    status: String(row.status) as TenderChecklistItemRow["status"],
    attachmentId: row.attachment_id == null ? null : String(row.attachment_id),
    validUntil: row.valid_until == null ? null : String(row.valid_until).slice(0, 10),
    note: row.note == null ? null : String(row.note),
    guaranteeType: (row.guarantee_type == null
      ? null
      : String(row.guarantee_type)) as TenderChecklistItemRow["guaranteeType"],
    bank: row.bank == null ? null : String(row.bank),
    amount:
      row.amount_cents == null
        ? null
        : toAmountString({ cents: BigInt(String(row.amount_cents)), currency }),
    returnedAt: row.returned_at == null ? null : new Date(String(row.returned_at)).toISOString(),
    sortOrder: Number(row.sort_order),
  };
}

export async function listTenderChecklist(
  pool: Pool,
  actor: TenderActor,
  tenderId: string,
): Promise<
  { items: TenderChecklistItemRow[]; blocking: string[] } | ChecklistError
> {
  if (!can(actor.roles, "tenders.view")) {
    return { outcome: "FORBIDDEN", message: "Nemate pravo pregleda." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const currency = await tenderCurrency(client, actor.companyId, tenderId);
    if (!currency) return { outcome: "NOT_FOUND", message: "Tender nije pronađen." } as ChecklistError;
    const rows = await client.query(
      `SELECT id, code, label, required, status, attachment_id, valid_until, note,
              guarantee_type, bank, amount_cents, returned_at, sort_order
         FROM public.tender_checklist_items
        WHERE company_id = $1 AND tender_id = $2
        ORDER BY sort_order, code`,
      [actor.companyId, tenderId],
    );
    const items = rows.rows.map((row) => mapItem(row, currency));
    const blocking = blockingChecklistItems(
      items.map((item) => ({
        code: item.code,
        label: item.label,
        required: item.required,
        status: item.status,
        note: item.note,
      })),
    ).map((item) => item.label);
    return { items, blocking };
  });
}

/**
 * Popunjava checklistu iz šifarnika pri prvom otvaranju tendera. Idempotentno: stavke koje
 * već postoje se ne diraju, pa ponovni poziv ne prepisuje ono što je čovjek unio.
 */
export async function seedTenderChecklist(
  client: PoolClient,
  actor: TenderActor,
  tenderId: string,
): Promise<void> {
  await ensureChecklistTemplates(client, actor.companyId, actor.userId);
  await client.query(
    `INSERT INTO public.tender_checklist_items
       (id, company_id, tender_id, code, label, required, status, sort_order, created_by, updated_by)
     SELECT 'tci_' || replace(gen_random_uuid()::text, '-', ''),
            t.company_id, $2, t.code, t.label, t.required, 'MISSING', t.sort_order, $3, $3
       FROM public.tender_checklist_templates t
      WHERE t.company_id = $1 AND t.is_active
     ON CONFLICT (company_id, tender_id, code) DO NOTHING`,
    [actor.companyId, tenderId, actor.userId],
  );
}

export type TenderChecklistPatch = {
  status?: "MISSING" | "ATTACHED" | "NOT_APPLICABLE";
  attachmentId?: string | null;
  validUntil?: string | null;
  note?: string | null;
  guaranteeType?: "BID" | "PERFORMANCE" | "ADVANCE" | "WARRANTY" | null;
  bank?: string | null;
  amount?: string | null;
};

export async function patchTenderChecklistItem(
  pool: Pool,
  actor: TenderActor,
  tenderId: string,
  itemId: string,
  input: TenderChecklistPatch,
): Promise<{ outcome: "OK"; id: string } | ChecklistError> {
  if (!can(actor.roles, "tenders.manage")) {
    return { outcome: "FORBIDDEN", message: "Nemate pravo izmjene kontrolne liste." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const currency = await tenderCurrency(client, actor.companyId, tenderId);
    if (!currency) return { outcome: "NOT_FOUND", message: "Tender nije pronađen." } as ChecklistError;

    const current = await client.query<{
      status: string;
      attachment_id: string | null;
      guarantee_type: string | null;
      valid_until: string | null;
      note: string | null;
    }>(
      `SELECT status, attachment_id, guarantee_type, valid_until, note
         FROM public.tender_checklist_items
        WHERE id = $1 AND company_id = $2 AND tender_id = $3`,
      [itemId, actor.companyId, tenderId],
    );
    const before = current.rows[0];
    if (!before) return { outcome: "NOT_FOUND", message: "Stavka nije pronađena." } as ChecklistError;

    const nextStatus = input.status ?? (before.status as TenderChecklistItemRow["status"]);
    const nextAttachment =
      input.attachmentId !== undefined ? input.attachmentId : before.attachment_id;
    const nextNote = input.note !== undefined ? input.note : before.note;
    const nextGuaranteeType =
      input.guaranteeType !== undefined ? input.guaranteeType : before.guarantee_type;
    const nextValidUntil = input.validUntil !== undefined ? input.validUntil : before.valid_until;

    /* `ATTACHED` bez priloga ne postoji (§1.4/16): tvrdnja bez dokaza. Provjera je ovdje jer
       poruka mora reći „izaberite prilog“, a ne „provjera u bazi nije prošla“. */
    if (nextStatus === "ATTACHED" && !nextAttachment) {
      return {
        outcome: "VALIDATION_FAILED",
        message: "Za status „priloženo“ izaberite prilog.",
      } as ChecklistError;
    }
    if (nextStatus === "NOT_APPLICABLE" && (nextNote ?? "").trim().length < 3) {
      return {
        outcome: "VALIDATION_FAILED",
        message: "Za „nije primjenjivo“ upišite razlog (najmanje 3 znaka).",
      } as ChecklistError;
    }
    /* Garancija bez roka nema podsjetnik ni povrat (§1.4/18). */
    if (nextGuaranteeType && !nextValidUntil) {
      return {
        outcome: "VALIDATION_FAILED",
        code: "TENDER_DEADLINE_REQUIRED",
        message: "Garancija mora imati datum važenja (rok za povrat).",
      } as ChecklistError;
    }

    if (nextAttachment) {
      const attachment = await client.query(
        `SELECT 1 FROM public.attachments
          WHERE id = $1 AND company_id = $2 AND entity_type = 'TENDER' AND entity_id = $3
            AND status = 'ready'`,
        [nextAttachment, actor.companyId, tenderId],
      );
      if ((attachment.rowCount ?? 0) === 0) {
        return {
          outcome: "VALIDATION_FAILED",
          message: "Prilog nije pronađen na ovom tenderu ili još nije potvrđen.",
        } as ChecklistError;
      }
    }

    let amountCents: string | null = null;
    if (input.amount !== undefined) {
      if (input.amount === null) {
        amountCents = null;
      } else if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(input.amount.trim())) {
        return { outcome: "VALIDATION_FAILED", message: "Neispravan iznos garancije." } as ChecklistError;
      } else {
        const [whole = "0", fraction = ""] = input.amount.trim().split(".");
        amountCents = (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))).toString();
      }
    }

    await client.query(
      `UPDATE public.tender_checklist_items SET
         status = $4,
         attachment_id = $5,
         note = $6,
         guarantee_type = $7,
         valid_until = $8::date,
         bank = CASE WHEN $9::boolean THEN $10 ELSE bank END,
         amount_cents = CASE WHEN $11::boolean THEN $12::bigint ELSE amount_cents END,
         updated_by = $13, updated_at = clock_timestamp()
       WHERE id = $1 AND company_id = $2 AND tender_id = $3`,
      [
        itemId,
        actor.companyId,
        tenderId,
        nextStatus,
        nextStatus === "MISSING" ? null : nextAttachment,
        nextNote,
        nextGuaranteeType,
        nextValidUntil,
        input.bank !== undefined,
        input.bank?.trim() || null,
        input.amount !== undefined,
        amountCents,
        actor.userId,
      ],
    );

    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "tender.checklist_updated",
      entityType: "tender",
      entityId: tenderId,
      metadata: { itemId, status: nextStatus },
    });
    return { outcome: "OK" as const, id: itemId };
  });
}

export type TenderGuaranteeInput = {
  code: string;
  label: string;
  guaranteeType: "BID" | "PERFORMANCE" | "ADVANCE" | "WARRANTY";
  bank?: string | null;
  amount?: string | null;
  validUntil: string;
  note?: string | null;
};

/** Nova bankarska garancija: red u checklisti sa `guarantee_type` (§1.4/18). */
export async function createTenderGuarantee(
  pool: Pool,
  actor: TenderActor,
  tenderId: string,
  input: TenderGuaranteeInput,
): Promise<{ outcome: "OK"; id: string } | ChecklistError> {
  if (!can(actor.roles, "tenders.manage")) {
    return { outcome: "FORBIDDEN", message: "Nemate pravo unosa garancije." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.validUntil)) {
    return {
      outcome: "VALIDATION_FAILED",
      code: "TENDER_DEADLINE_REQUIRED",
      message: "Garancija mora imati datum važenja.",
    };
  }
  let amountCents: string | null = null;
  if (input.amount) {
    if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(input.amount.trim())) {
      return { outcome: "VALIDATION_FAILED", message: "Neispravan iznos garancije." };
    }
    const [whole = "0", fraction = ""] = input.amount.trim().split(".");
    amountCents = (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))).toString();
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    if (!(await tenderCurrency(client, actor.companyId, tenderId))) {
      return { outcome: "NOT_FOUND", message: "Tender nije pronađen." } as ChecklistError;
    }
    const id = `tci_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    try {
      await client.query(
        `INSERT INTO public.tender_checklist_items
           (id, company_id, tender_id, code, label, required, status, valid_until, note,
            guarantee_type, bank, amount_cents, sort_order, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,true,'MISSING',$6::date,$7,$8,$9,$10,900,$11,$11)`,
        [
          id,
          actor.companyId,
          tenderId,
          input.code.trim().toUpperCase(),
          input.label.trim(),
          input.validUntil,
          input.note?.trim() || null,
          input.guaranteeType,
          input.bank?.trim() || null,
          amountCents,
          actor.userId,
        ],
      );
    } catch (error) {
      if (typeof error === "object" && error !== null && (error as { code?: string }).code === "23505") {
        return {
          outcome: "CONFLICT",
          message: `Garancija sa oznakom „${input.code.trim().toUpperCase()}“ već postoji na ovom tenderu.`,
        } as ChecklistError;
      }
      throw error;
    }
    return { outcome: "OK" as const, id };
  });
}

/** Povrat garancije: `returned_at` je činjenica (novac je vraćen), ne brisanje reda. */
export async function returnTenderGuarantee(
  pool: Pool,
  actor: TenderActor,
  tenderId: string,
  itemId: string,
): Promise<{ outcome: "OK"; id: string } | ChecklistError> {
  if (!can(actor.roles, "tenders.manage")) {
    return { outcome: "FORBIDDEN", message: "Nemate pravo evidentiranja povrata." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const found = await client.query<{ guarantee_type: string | null; returned_at: string | null }>(
      `SELECT guarantee_type, returned_at FROM public.tender_checklist_items
        WHERE id = $1 AND company_id = $2 AND tender_id = $3`,
      [itemId, actor.companyId, tenderId],
    );
    const row = found.rows[0];
    if (!row) return { outcome: "NOT_FOUND", message: "Stavka nije pronađena." } as ChecklistError;
    if (!row.guarantee_type) {
      return { outcome: "VALIDATION_FAILED", message: "Ova stavka nije garancija." } as ChecklistError;
    }
    if (row.returned_at) return { outcome: "OK" as const, id: itemId };

    await client.query(
      `UPDATE public.tender_checklist_items
          SET returned_at = clock_timestamp(), updated_by = $4, updated_at = clock_timestamp()
        WHERE id = $1 AND company_id = $2 AND tender_id = $3`,
      [itemId, actor.companyId, tenderId, actor.userId],
    );
    await writeAudit(client, {
      companyId: actor.companyId,
      actorId: actor.userId,
      actorEmail: null,
      action: "tender.guarantee_returned",
      entityType: "tender",
      entityId: tenderId,
      metadata: { itemId },
    });
    return { outcome: "OK" as const, id: itemId };
  });
}

/* ------------------------------------------------------------------ šifarnik */

export async function listChecklistTemplates(
  pool: Pool,
  actor: TenderActor,
): Promise<Array<{ id: string; code: string; label: string; required: boolean; sortOrder: number; isActive: boolean }> | ChecklistError> {
  if (!can(actor.roles, "tenders.manage")) {
    return { outcome: "FORBIDDEN", message: "Nemate pravo pregleda šifarnika." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    await ensureChecklistTemplates(client, actor.companyId, actor.userId);
    const rows = await client.query(
      `SELECT id, code, label, required, sort_order, is_active
         FROM public.tender_checklist_templates
        WHERE company_id = $1 ORDER BY sort_order, code`,
      [actor.companyId],
    );
    return rows.rows.map((row) => ({
      id: String(row.id),
      code: String(row.code),
      label: String(row.label),
      required: Boolean(row.required),
      sortOrder: Number(row.sort_order),
      isActive: Boolean(row.is_active),
    }));
  });
}

export async function upsertChecklistTemplate(
  pool: Pool,
  actor: TenderActor,
  input: { code: string; label: string; required?: boolean; sortOrder?: number; isActive?: boolean },
): Promise<{ outcome: "OK"; id: string } | ChecklistError> {
  if (!can(actor.roles, "tenders.manage")) {
    return { outcome: "FORBIDDEN", message: "Nemate pravo izmjene šifarnika." };
  }
  const code = input.code.trim().toUpperCase();
  if (!code || !input.label.trim()) {
    return { outcome: "VALIDATION_FAILED", message: "Oznaka i naziv stavke su obavezni." };
  }
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const id = `tct_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const saved = await client.query<{ id: string }>(
      `INSERT INTO public.tender_checklist_templates
         (id, company_id, code, label, required, sort_order, is_active, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
       ON CONFLICT (company_id, code) DO UPDATE SET
         label = EXCLUDED.label,
         required = EXCLUDED.required,
         sort_order = EXCLUDED.sort_order,
         is_active = EXCLUDED.is_active,
         updated_by = EXCLUDED.updated_by,
         updated_at = clock_timestamp()
       RETURNING id`,
      [
        id,
        actor.companyId,
        code,
        input.label.trim(),
        input.required ?? true,
        input.sortOrder ?? 100,
        input.isActive ?? true,
        actor.userId,
      ],
    );
    return { outcome: "OK" as const, id: saved.rows[0]!.id };
  });
}
