import type { Role } from "./permissions";

export type CostRateActor = {
  userId: string;
  companyId: string;
  roles: readonly Role[];
};

export type CostRateRow = {
  id: string;
  machine_id: string;
  machine_code: string;
  machine_name: string;
  amount: string;
  currency_code: string;
  valid_from: string;
  valid_to: string | null;
  created_at: string;
};

export type UpsertRateInput = {
  id?: string;
  machineId: string;
  amount: string;
  currencyCode?: string;
  validFrom: string;
  validTo?: string | null;
};

export type MutationOutcome = {
  outcome: "OK" | "VALIDATION_FAILED" | "FORBIDDEN" | "CONFLICT";
  id?: string;
  code?: string;
  message?: string;
};

export type DbRateRow = {
  id: string;
  machine_id: string;
  machine_code: string;
  machine_name: string;
  amount_cents: string;
  currency_code: string;
  valid_from: string;
  valid_to: string | null;
  created_at: string;
};
