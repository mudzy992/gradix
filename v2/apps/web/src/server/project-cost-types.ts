import type { Role } from "./permissions";

export type ProjectCostActor = {
  userId: string;
  companyId: string;
  roles: readonly Role[];
};

export type ProjectCostEntryRow = {
  id: string;
  project_id: string;
  project_code: string;
  project_name: string;
  source_type: "MACHINE_WORK_LOG";
  source_id: string;
  machine_id: string;
  machine_code: string;
  machine_name: string;
  hours: string;
  rate: string;
  amount: string;
  currency_code: string;
  booked_at: string;
  note: string | null;
};

export type ListCostFilters = {
  projectId?: string;
  from?: string;
  to?: string;
};

export type BookInput = {
  from?: string;
  to?: string;
  workLogIds?: string[];
  note?: string | null;
};

export type BookOutcome = {
  outcome: "OK" | "VALIDATION_FAILED" | "FORBIDDEN" | "CONFLICT";
  booked?: number;
  skippedExisting?: number;
  skippedNoRate?: number;
  code?: string;
  message?: string;
};

export type DbEntryRow = {
  id: string;
  project_id: string;
  project_code: string;
  project_name: string;
  source_type: string;
  source_id: string;
  machine_id: string;
  machine_code: string;
  machine_name: string;
  hours: string;
  rate_cents: string;
  amount_cents: string;
  currency_code: string;
  booked_at: string;
  note: string | null;
};

export type DbWorkLogRow = {
  id: string;
  machine_id: string;
  project_id: string | null;
  started_at: string;
  ended_at: string;
};
