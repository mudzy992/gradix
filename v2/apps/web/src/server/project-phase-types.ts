import type { PhaseStatus } from "@gradix/domain";

export type PhaseRow = {
  id: string;
  project_id: string;
  code: string;
  name: string;
  sort_order: number;
  weight: number;
  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  progress_pct: number;
  status: PhaseStatus;
  weighted_share: number;
  dependency_warnings: string[];
};

export type PhasesResult = {
  phases: PhaseRow[];
  progress_pct: number | null;
  progress_source: "MANUAL" | "BOQ";
};

export type PhaseInput = {
  id?: string;
  code: string;
  name: string;
  sortOrder?: number;
  weight: number;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  status?: PhaseStatus;
  progressPct?: number;
};

export type PhasePatch = Partial<PhaseInput> & { id: string };

export type PhaseDependencyInput = {
  phaseId: string;
  dependsOnPhaseId: string;
  kind?: "START_AFTER_FINISH" | "START_AFTER_START" | "FINISH_AFTER_FINISH";
};

export type PhaseServiceError = { code: string; message: string };
