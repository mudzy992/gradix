import { toAmountString, type Currency } from "@gradix/domain";
import type { TenderStatus } from "./tender-status";

export type TenderRow = {
  id: string;
  title: string;
  partnerId: string;
  partnerName: string;
  submittedValueAmount: string;
  currencyCode: string;
  submittedAt: string | null;
  status: TenderStatus;
  note: string | null;
  convertedProjectId: string | null;
};

export const TENDER_SELECT = `
  SELECT t.id, t.title, t.partner_id, p.name AS partner_name,
         t.submitted_value_cents, t.currency_code, t.submitted_at, t.status, t.note,
         t.converted_project_id
    FROM public.tenders t
    JOIN public.partners p ON p.id = t.partner_id AND p.company_id = t.company_id
`;

export function mapTenderRow(row: Record<string, unknown>): TenderRow {
  const cents = BigInt(String(row.submitted_value_cents));
  const currency = String(row.currency_code) as Currency;
  return {
    id: String(row.id),
    title: String(row.title),
    partnerId: String(row.partner_id),
    partnerName: String(row.partner_name),
    submittedValueAmount: toAmountString({ cents, currency }),
    currencyCode: currency,
    submittedAt: row.submitted_at ? new Date(String(row.submitted_at)).toISOString() : null,
    status: row.status as TenderStatus,
    note: row.note == null ? null : String(row.note),
    convertedProjectId: row.converted_project_id == null ? null : String(row.converted_project_id),
  };
}
