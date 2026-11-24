export type ServiceError = { code: string; message: string };

export type BoqItemRow = {
  id: string;
  project_id: string;
  phase_id: string | null;
  phase_name: string | null;
  code: string;
  description: string;
  unit: string;
  quantity_planned: number;
  quantity_executed: number;
  unit_price: string;
  total_planned: string;
  total_executed: string;
  sort_order: number;
};

export type BoqResult = {
  items: BoqItemRow[];
  progress_source: "MANUAL" | "BOQ";
  progress_pct: number | null;
  totals: { planned: string; executed: string; currency_code: string };
};

export type BoqInput = {
  id?: string;
  phaseId?: string | null;
  code: string;
  description: string;
  unit: string;
  quantityPlanned: number;
  unitPrice: string;
  quantityExecuted?: number;
  sortOrder?: number;
};

export type AmendmentRow = {
  id: string;
  project_id: string;
  code: string;
  title: string;
  kind: "SCOPE" | "TIME" | "PRICE" | "OTHER";
  amount: string | null;
  currency_code: string | null;
  extension_days: number | null;
  status: "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";
  approved_at: string | null;
  approved_by_name: string | null;
  document_id: string | null;
  note: string | null;
};

export type AmendmentsResult = {
  amendments: AmendmentRow[];
  approved_amount: string;
  approved_extension_days: number;
  currency_code: string;
};

export type AmendmentInput = {
  id?: string;
  code: string;
  title: string;
  kind: "SCOPE" | "TIME" | "PRICE" | "OTHER";
  amount?: string | null;
  extensionDays?: number | null;
  note?: string | null;
  documentId?: string | null;
};

export type ProfitabilityResult = {
  project_id: string;
  currency_code: string;
  contract_value: string | null;
  approved_amendments: string;
  contract_with_amendments: string | null;
  posted_cost: string;
  margin: string | null;
  margin_pct: number | null;
  pending_cost_count: number;
  eac: {
    kind: "EAC_ESTIMATE";
    amount: string | null;
    progress_pct: number | null;
    reason: "NO_PROGRESS" | null;
  };
  by_category: Array<{
    category_id: string;
    category_code: string;
    category_name: string;
    budget: string | null;
    posted: string;
  }>;
};

export type CloseSnapshotRow = {
  id: string;
  project_id: string;
  closed_at: string;
  closed_by_name: string | null;
  payload: {
    posted_cost: string;
    budget: string | null;
    margin: string | null;
    progress_pct: number | null;
    by_category: Array<{ category_code: string; posted: string; budget: string | null }>;
    pending_cost_count: number;
  };
};
