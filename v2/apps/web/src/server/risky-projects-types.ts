export type ServiceError = { code: string; message: string };

export type RiskyProjectRow = {
  id: string;
  code: string;
  name: string;
  status: "PLANNED" | "ACTIVE" | "PAUSED" | "FINISHED" | "CANCELLED";
  margin: string | null;
  margin_pct: number | null;
  budget_used_pct: number | null;
  progress_pct: number | null;
  risks: Array<"NEGATIVE_MARGIN" | "OVER_BUDGET" | "PENDING_COSTS">;
  pending_cost_count: number;
};

export type RiskyProjectsResult = {
  projects: RiskyProjectRow[];
  pending_cost_count: number;
};
