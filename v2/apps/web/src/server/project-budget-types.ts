import type { CostSourceType } from "@gradix/domain";

export type ServiceError = { code: string; message: string };

export type CategoryRow = {
  id: string;
  code: string;
  name: string;
  sort_order: number;
  default_for_source_type: CostSourceType | null;
  is_active: boolean;
  usage_count: number;
};

export type CategoriesResult = {
  categories: CategoryRow[];
  unmapped_sources: string[];
};

export type CategoryInput = {
  id?: string;
  code?: string;
  name?: string;
  sortOrder?: number;
  defaultForSourceType?: CostSourceType | null;
  isActive?: boolean;
};

export type BudgetLineRow = {
  id: string;
  project_id: string;
  phase_id: string | null;
  phase_name: string | null;
  category_id: string;
  category_code: string;
  category_name: string;
  amount: string;
  currency_code: string;
  revision: number;
  valid_from: string;
  note: string | null;
};

export type BudgetCategoryTotals = {
  category_id: string;
  category_code: string;
  category_name: string;
  budget: string;
  spent: string;
  used_pct: number | null;
  threshold_crossed: "80" | "100" | null;
};

export type BudgetResult = {
  revision: number;
  revisions: Array<{ revision: number; valid_from: string }>;
  lines: BudgetLineRow[];
  totals: {
    budget: string;
    currency_code: string;
    spent: string;
    pending_count: number;
    pending_amount: string | null;
    by_category: BudgetCategoryTotals[];
  };
};

export type BudgetInput = {
  revision?: number;
  validFrom?: string;
  lines: Array<{ phaseId?: string | null; categoryId: string; amount: string }>;
  note?: string | null;
};
