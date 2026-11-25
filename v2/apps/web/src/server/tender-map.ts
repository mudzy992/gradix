import { toAmountString, type Currency } from "@gradix/domain";
import type { TenderStatus } from "./tender-status";

/**
 * Oblik reda tendera koji ide u UI i API (F7).
 *
 * Polja su NAMJERNO ravna, a ne ugniježđena: lista tendera prikazuje rok, izvor i maržu u
 * istom redu tabele, pa bi ugniježđivanje značilo `row.deadline.deadlineAt` u svakoj ćeliji.
 *
 * `markupPct` može biti `null` — ACCOUNTANT dobija red bez marže (spec 08 §1.7/26). Zato
 * `null` znači „nema podatka ILI nema prava“, a ne „marža je nula“. Klijent maržu ne
 * prikazuje kad je `null`, pa nema lažne nule.
 */
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
  deadlineAt: string | null;
  questionsDeadlineAt: string | null;
  siteVisitAt: string | null;
  openedAt: string | null;
  source: string | null;
  portalName: string | null;
  externalRef: string | null;
  estimatedValueAmount: string | null;
  priceSource: "CALCULATED" | "MANUAL";
  markupPct: string | null;
  currentRevision: number;
  participate: boolean | null;
  decisionReason: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  /** Broj dana do roka dostave; negativan = rok prošao. `null` kad roka nema. */
  daysToDeadline: number | null;
};

export const TENDER_SELECT = `
  SELECT t.id, t.title, t.partner_id, p.name AS partner_name,
         t.submitted_value_cents, t.currency_code, t.submitted_at, t.status, t.note,
         t.converted_project_id, t.deadline_at, t.questions_deadline_at, t.site_visit_at,
         t.opened_at, t.source, t.portal_name, t.external_ref, t.estimated_value_cents,
         t.price_source, t.markup_pct, t.current_revision, t.participate,
         t.decision_reason, t.decided_at,
         d.first_name || ' ' || d.last_name AS decided_by_name,
         CASE WHEN t.deadline_at IS NULL THEN NULL
              ELSE (t.deadline_at AT TIME ZONE 'Europe/Sarajevo')::date
                   - (clock_timestamp() AT TIME ZONE 'Europe/Sarajevo')::date
         END AS days_to_deadline
    FROM public.tenders t
    JOIN public.partners p ON p.id = t.partner_id AND p.company_id = t.company_id
    LEFT JOIN public.users d ON d.id = t.decided_by
`;

function iso(value: unknown): string | null {
  return value == null ? null : new Date(String(value)).toISOString();
}

export function mapTenderRow(row: Record<string, unknown>, options: { includeMargin: boolean }): TenderRow {
  const cents = BigInt(String(row.submitted_value_cents));
  const currency = String(row.currency_code) as Currency;
  const estimated = row.estimated_value_cents == null ? null : BigInt(String(row.estimated_value_cents));
  return {
    id: String(row.id),
    title: String(row.title),
    partnerId: String(row.partner_id),
    partnerName: String(row.partner_name),
    submittedValueAmount: toAmountString({ cents, currency }),
    currencyCode: currency,
    submittedAt: iso(row.submitted_at),
    status: row.status as TenderStatus,
    note: row.note == null ? null : String(row.note),
    convertedProjectId: row.converted_project_id == null ? null : String(row.converted_project_id),
    deadlineAt: iso(row.deadline_at),
    questionsDeadlineAt: iso(row.questions_deadline_at),
    siteVisitAt: iso(row.site_visit_at),
    openedAt: iso(row.opened_at),
    source: row.source == null ? null : String(row.source),
    portalName: row.portal_name == null ? null : String(row.portal_name),
    externalRef: row.external_ref == null ? null : String(row.external_ref),
    estimatedValueAmount:
      estimated == null ? null : toAmountString({ cents: estimated, currency }),
    priceSource: String(row.price_source) as "CALCULATED" | "MANUAL",
    // Bez `tenders.price.manage` marža se ne šalje ni u odgovoru — ne skriva se u UI-u,
    // nego je nema u podatku (spec 08 §1.7/26: ACCOUNTANT ne vidi kalkulaciju ni maržu).
    markupPct: options.includeMargin && row.markup_pct != null ? String(row.markup_pct) : null,
    currentRevision: Number(row.current_revision),
    participate: row.participate == null ? null : Boolean(row.participate),
    decisionReason: row.decision_reason == null ? null : String(row.decision_reason),
    decidedByName: row.decided_by_name == null ? null : String(row.decided_by_name),
    decidedAt: iso(row.decided_at),
    daysToDeadline: row.days_to_deadline == null ? null : Number(row.days_to_deadline),
  };
}
