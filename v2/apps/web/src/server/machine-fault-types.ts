/** R5.5 shared types for machine faults. */

export type FaultActor = {
  userId: string;
  companyId: string;
  roles: readonly string[];
};

export type FaultPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type FaultStatus =
  | "OPEN"
  | "WAITING_APPROVAL"
  | "APPROVED"
  | "IN_PROGRESS"
  | "DONE"
  | "CANCELLED";

export type FaultRow = {
  id: string;
  machine_id: string;
  machine_code: string;
  machine_name: string;
  reporter_worker_id: string | null;
  reporter_name: string | null;
  project_id: string | null;
  project_code: string | null;
  project_name: string | null;
  partner_id: string | null;
  partner_name: string | null;
  reported_at: string;
  title: string;
  description: string | null;
  priority: FaultPriority;
  status: FaultStatus;
  estimated_cost: string | null;
  currency_code: string | null;
  downtime_minutes: number | null;
  version: number;
  created_at: string;
  approval_request_id: string | null;
  approval_status: string | null;
};

export type ListFilters = {
  machineId?: string;
  status?: FaultStatus;
  from?: string;
  to?: string;
};

export type CreateInput = {
  machineId: string;
  reporterWorkerId?: string | null;
  projectId?: string | null;
  partnerId?: string | null;
  reportedAt: string;
  title: string;
  description?: string | null;
  priority: FaultPriority;
  estimatedCostAmount?: string | null;
  currencyCode?: string | null;
  downtimeMinutes?: number | null;
};

export type MutationOutcome =
  | { outcome: "OK"; id: string }
  | { outcome: "FORBIDDEN"; code: string; message?: string }
  | { outcome: "VALIDATION_FAILED"; code: string; message: string }
  | { outcome: "CONFLICT"; code: string; message: string };

export type PartnerRow = {
  id: string;
  code: string;
  name: string;
  kind: "VENDOR" | "SERVICE" | "OTHER" | "CLIENT";
  note: string | null;
  active: boolean;
};

export type PartnerCreateInput = {
  code: string;
  name: string;
  kind: "VENDOR" | "SERVICE" | "OTHER" | "CLIENT";
  note?: string | null;
};
