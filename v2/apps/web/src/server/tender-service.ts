/**
 * R7 tender CRUD. Izvor: v1/.../tenders.service.ts (status + convert claim).
 */
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { companyId as toCompanyId, withCompany } from "@gradix/db";
import { isCurrency, money, type Currency } from "@gradix/domain";
import { writeAudit } from "./audit";
import { can, type Role } from "./permissions";
import { assertTenderTransition, isTenderStatus, type TenderStatus } from "./tender-status";
import { mapTenderRow, TENDER_SELECT, type TenderRow } from "./tender-map";

export type { TenderRow } from "./tender-map";
export type TenderActor = { userId: string; companyId: string; roles: Role[] };

export type TenderCreateInput = {
  title: string;
  partnerId: string;
  submittedValueAmount: string;
  currencyCode: string;
  note?: string | null;
};

export type TenderPatchInput = {
  title?: string;
  partnerId?: string;
  submittedValueAmount?: string;
  currencyCode?: string;
  status?: TenderStatus;
  note?: string | null;
};

type Outcome =
  | { outcome: "OK"; id?: string; tender?: TenderRow }
  | { outcome: "FORBIDDEN" | "VALIDATION_FAILED" | "CONFLICT" | "NOT_FOUND"; code?: string; message?: string };

export async function listTenders(pool: Pool, actor: TenderActor, status?: string): Promise<TenderRow[]> {
  if (!can(actor.roles, "tenders.view")) return [];
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const result = await client.query(
      `${TENDER_SELECT}
        WHERE t.company_id = $1 AND ($2::text IS NULL OR t.status = $2)
        ORDER BY t.created_at DESC LIMIT 500`,
      [actor.companyId, status && isTenderStatus(status) ? status : null],
    );
    return result.rows.map((row) => mapTenderRow(row));
  });
}

export async function getTender(pool: Pool, actor: TenderActor, id: string): Promise<TenderRow | null> {
  if (!can(actor.roles, "tenders.view")) return null;
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const result = await client.query(`${TENDER_SELECT} WHERE t.company_id = $1 AND t.id = $2`, [
      actor.companyId,
      id,
    ]);
    return result.rows[0] ? mapTenderRow(result.rows[0]) : null;
  });
}

export async function createTender(
  pool: Pool,
  actor: TenderActor,
  input: TenderCreateInput,
): Promise<Outcome> {
  if (!can(actor.roles, "tenders.manage")) return { outcome: "FORBIDDEN", code: "ROLE" };
  if (!input.title?.trim() || !input.partnerId) {
    return { outcome: "VALIDATION_FAILED", message: "Naslov i naručilac su obavezni." };
  }
  if (!isCurrency(input.currencyCode)) {
    return { outcome: "VALIDATION_FAILED", message: "Nepodržana valuta." };
  }
  let value;
  try {
    value = money(input.submittedValueAmount, input.currencyCode);
  } catch {
    return { outcome: "VALIDATION_FAILED", message: "Neispravan iznos." };
  }
  if (value.cents < 0n) return { outcome: "VALIDATION_FAILED", message: "Iznos ne smije biti negativan." };
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const partner = await client.query(
      `SELECT 1 FROM public.partners WHERE id = $1 AND company_id = $2 AND active`,
      [input.partnerId, actor.companyId],
    );
    if (partner.rowCount === 0) {
      return { outcome: "VALIDATION_FAILED", message: "Naručilac (partner) nije pronađen." };
    }
    const id = `tnd_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    await client.query(
      `INSERT INTO public.tenders (
         id, company_id, title, partner_id, submitted_value_cents, currency_code,
         status, note, created_by, updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,'DRAFT',$7,$8,$8)`,
      [
        id, actor.companyId, input.title.trim(), input.partnerId,
        value.cents.toString(), value.currency, input.note?.trim() || null, actor.userId,
      ],
    );
    await writeAudit(client, {
      companyId: actor.companyId, actorId: actor.userId, actorEmail: null,
      action: "tender.created", entityType: "tender", entityId: id,
      metadata: { title: input.title.trim() },
    });
    return { outcome: "OK", id };
  });
}

export async function patchTender(
  pool: Pool,
  actor: TenderActor,
  id: string,
  input: TenderPatchInput,
): Promise<Outcome> {
  if (!can(actor.roles, "tenders.manage")) return { outcome: "FORBIDDEN", code: "ROLE" };
  return withCompany(pool, toCompanyId(actor.companyId), async (client) => {
    const current = await client.query<{ status: string }>(
      `SELECT status FROM public.tenders WHERE id = $1 AND company_id = $2`,
      [id, actor.companyId],
    );
    const before = current.rows[0];
    if (!before || !isTenderStatus(before.status)) {
      return { outcome: "NOT_FOUND", message: "Tender nije pronađen." };
    }
    if (input.status !== undefined) {
      try {
        assertTenderTransition(before.status, input.status);
      } catch {
        return { outcome: "CONFLICT", code: "TENDER_INVALID_STATUS", message: "Nedozvoljen prelaz statusa." };
      }
    }
    let cents: string | null = null;
    let currency: string | null = null;
    if (input.submittedValueAmount !== undefined || input.currencyCode !== undefined) {
      const cur = (input.currencyCode ?? "BAM") as Currency;
      if (!isCurrency(cur)) return { outcome: "VALIDATION_FAILED", message: "Nepodržana valuta." };
      try {
        const value = money(input.submittedValueAmount ?? "0.00", cur);
        cents = value.cents.toString();
        currency = value.currency;
      } catch {
        return { outcome: "VALIDATION_FAILED", message: "Neispravan iznos." };
      }
    }
    const nextStatus = input.status ?? before.status;
    const setSubmittedAt = before.status === "DRAFT" && nextStatus === "SUBMITTED";
    await client.query(
      `UPDATE public.tenders SET
         title = COALESCE($3, title), partner_id = COALESCE($4, partner_id),
         submitted_value_cents = COALESCE($5::bigint, submitted_value_cents),
         currency_code = COALESCE($6, currency_code), status = $7,
         note = CASE WHEN $8::boolean THEN $9 ELSE note END,
         submitted_at = CASE WHEN $10::boolean THEN COALESCE(submitted_at, clock_timestamp()) ELSE submitted_at END,
         updated_by = $11, updated_at = clock_timestamp()
       WHERE id = $1 AND company_id = $2`,
      [
        id, actor.companyId, input.title?.trim() ?? null, input.partnerId ?? null,
        cents, currency, nextStatus, input.note !== undefined,
        input.note === undefined ? null : input.note, setSubmittedAt, actor.userId,
      ],
    );
    await writeAudit(client, {
      companyId: actor.companyId, actorId: actor.userId, actorEmail: null,
      action: "tender.updated", entityType: "tender", entityId: id,
      metadata: { status: nextStatus },
    });
    return { outcome: "OK", id };
  });
}
