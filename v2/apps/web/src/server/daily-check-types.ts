import type { EquipmentActor } from "./equipment-scope";
/** R5.4 shared types for machine daily checks. */

export type DailyCheckActor = EquipmentActor;

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
  /**
   * F4: šablon po kojem je pregled popunjen. `null` za preglede prije F4 — bez toga se ne bi
   * znalo koje su stavke bile kritične u trenutku pregleda.
   */
  template_id: string | null;
  /** `true` kad je kritična stavka pala: fotografija se traži prije potvrde. */
  photo_required: boolean;
  photo_confirmed_at: string | null;
  /** Kvar otvoren iz kritične `FAIL` stavke, ako ga ima. */
  fault_id: string | null;
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
  /**
   * F4: šablon. Kad nije poslan, servis uzima aktivni šablon kategorije mašine. Kad šablona
   * nema, pregled je slobodan (kao do F4) — ali tada nema ni kritičnih stavki, pa ni auto-kvara.
   */
  templateId?: string | null;
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
