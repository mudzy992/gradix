/** R5.4 shared types for machine daily checks. */

export type DailyCheckActor = {
  userId: string;
  companyId: string;
  roles: readonly string[];
};

export type DailyCheckResult = "PASS" | "FAIL" | "CONDITIONAL";

export type DailyCheckRow = {
  id: string;
  machine_id: string;
  machine_code: string;
  machine_name: string;
  worker_id: string;
  worker_name: string;
  project_id: string | null;
  project_code: string | null;
  project_name: string | null;
  checked_at: string;
  result: DailyCheckResult;
  checklist_json: Record<string, unknown>;
  note: string | null;
  version: number;
  created_at: string;
};

export type ListFilters = {
  machineId?: string;
  from?: string;
  to?: string;
  result?: DailyCheckResult;
};

export type CreateInput = {
  machineId: string;
  workerId?: string | null;
  projectId?: string | null;
  checkedAt: string;
  result: DailyCheckResult;
  checklistJson?: Record<string, unknown>;
  note?: string | null;
};

export type MutationOutcome =
  | { outcome: "OK"; id: string }
  | { outcome: "FORBIDDEN"; code: string; message?: string }
  | { outcome: "VALIDATION_FAILED"; code: string; message: string }
  | { outcome: "CONFLICT"; code: string; message: string };

export type DailyCheckAttachmentRow = {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  status: "pending" | "confirmed";
  createdAt: string;
};
