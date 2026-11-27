import type { CostSourceType } from "@gradix/domain";
import type { Role } from "./permissions";

export type CostActor = {
  userId: string;
  companyId: string;
  roles: readonly Role[];
  scope?: "COMPANY" | "PROJECTS" | "SELF";
  projectIds?: string[] | null;
};

/** Red u ledgeru, u obliku koji ide preko API-ja (iznos je decimalni string ili `null`). */
export type CostEntryRow = {
  id: string;
  project_id: string;
  project_code: string;
  project_name: string;
  phase_id: string | null;
  phase_name: string | null;
  category_id: string;
  category_code: string;
  category_name: string;
  source_type: CostSourceType;
  source_id: string;
  source_href: string | null;
  machine_id: string | null;
  machine_code: string | null;
  occurred_on: string;
  /** `null` kad je `PENDING` — nikad `"0.00"`. */
  amount: string | null;
  currency_code: string;
  quantity: string | null;
  unit: string | null;
  status: "POSTED" | "PENDING" | "REVERSED";
  reversed_by: string | null;
  reverses_id: string | null;
  note: string | null;
  booked_at: string;
};

export type CostEntryFilters = {
  projectId?: string;
  from?: string;
  to?: string;
  categoryId?: string;
  phaseId?: string;
  status?: "POSTED" | "PENDING" | "REVERSED";
};

export type CostListResult = {
  entries: CostEntryRow[];
  posted: string;
  currency: string;
  /** Broj zapisa bez cijene — odvojeno od zbira (§1.3.15). */
  pendingCount: number;
  /** Količine `PENDING` zapisa po jedinici (`h`, `l`, `t`…), jer se ne sabiraju. */
  pendingByUnit: Array<{ unit: string; quantity: string }>;
};

export type CostPostInput = {
  clientGeneratedId?: string;
  projectId: string;
  categoryId: string;
  occurredOn: string;
  amount: string;
  currencyCode?: "BAM" | "EUR" | "USD";
  phaseId?: string | null;
  quantity?: number;
  unit?: string | null;
  note?: string | null;
  attachmentId?: string | null;
};

export type ManualCostInput = CostPostInput;

export type CostPostOutcome = {
  outcome: "OK" | "VALIDATION_FAILED" | "FORBIDDEN" | "CONFLICT";
  id?: string;
  code?: string;
  message?: string;
  approvalRequired?: boolean;
  approvalStatus?: "PENDING" | "APPROVED" | "REJECTED";
};

export type CostReverseInput = {
  reason: string;
  replacement?: {
    amount?: string;
    occurredOn?: string;
    categoryId?: string;
    phaseId?: string | null;
    note?: string | null;
  } | null;
};

export type CostReverseOutcome = {
  outcome: "OK" | "VALIDATION_FAILED" | "FORBIDDEN" | "CONFLICT";
  id?: string;
  replaced_by?: string;
  code?: string;
  message?: string;
};
