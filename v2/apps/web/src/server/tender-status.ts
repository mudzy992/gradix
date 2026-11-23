/**
 * Matrica prelaza statusa tendera.
 * Izvor: v1/backend/src/modules/polish/tender-status.ts
 */
export const TENDER_STATUSES = ["DRAFT", "SUBMITTED", "WON", "LOST", "WITHDRAWN"] as const;
export type TenderStatus = (typeof TENDER_STATUSES)[number];

const NEXT: Record<TenderStatus, readonly TenderStatus[]> = {
  DRAFT: ["SUBMITTED", "WITHDRAWN"],
  SUBMITTED: ["WON", "LOST", "WITHDRAWN"],
  WON: [],
  LOST: [],
  WITHDRAWN: [],
};

export function isTenderStatus(value: string): value is TenderStatus {
  return (TENDER_STATUSES as readonly string[]).includes(value);
}

/** Isti status = no-op OK; inače mora biti u NEXT[from]. */
export function assertTenderTransition(from: TenderStatus, to: TenderStatus): void {
  if (from === to) return;
  if (!NEXT[from].includes(to)) {
    throw new Error(`TENDER_INVALID_STATUS:${from}->${to}`);
  }
}

export const TENDER_STATUS_LABEL_BS: Record<TenderStatus, string> = {
  DRAFT: "Nacrt",
  SUBMITTED: "Predano",
  WON: "Dobijeno",
  LOST: "Izgubljeno",
  WITHDRAWN: "Povučeno",
};
