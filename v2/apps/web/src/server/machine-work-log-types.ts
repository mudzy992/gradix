/** R5.1 shared types for machine work-log service. */
export type MachineWorkLogActor = {
  userId: string;
  companyId: string;
  roles: readonly string[];
};

export type MachineWorkLogRow = {
  id: string;
  machine_id: string;
  machine_code: string;
  machine_name: string;
  worker_id: string;
  worker_name: string;
  project_id: string | null;
  project_code: string | null;
  project_name: string | null;
  started_at: string;
  ended_at: string;
  mode: string;
  meter_end: number | null;
  note: string | null;
  version: number;
  created_at: string;
};

export type ListFilters = {
  machineId?: string;
  from?: string;
  to?: string;
};

export type CreateInput = {
  machineId: string;
  /** Office roles pass explicit worker; MACHINE_OPERATOR uses linked self. */
  workerId?: string | null;
  projectId?: string | null;
  startedAt: string;
  endedAt: string;
  mode: string;
  meterEnd?: number | null;
  note?: string | null;
};

export type MutationOutcome =
  | { outcome: "OK"; id: string }
  | { outcome: "FORBIDDEN"; code: string; message?: string }
  | { outcome: "VALIDATION_FAILED"; code: string; message: string }
  | { outcome: "CONFLICT"; code: string; message: string };
