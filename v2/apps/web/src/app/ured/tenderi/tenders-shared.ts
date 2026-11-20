import type { TenderStatus } from "@gradix/contracts";

export const STATUS_LABEL: Record<TenderStatus, string> = {
  DRAFT: "Nacrt",
  SUBMITTED: "Predano",
  WON: "Dobijeno",
  LOST: "Izgubljeno",
  WITHDRAWN: "Povučeno",
};

export const STATUS_OPTIONS: TenderStatus[] = [
  "DRAFT",
  "SUBMITTED",
  "WON",
  "LOST",
  "WITHDRAWN",
];

export function formatTenderValue(amount: string, currency: string): string {
  return `${amount} ${currency}`;
}
