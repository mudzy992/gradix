/** Tipovi koje dijele tabovi Budžet i Predmjer (oblik odgovora servisa). */
import type { BudgetResult, CategoryRow } from "@/server/project-budget-types";
import type { PhaseRow } from "@/server/project-phase-types";

export type { BudgetResult, CategoryRow };
export type PhaseRowLite = Pick<PhaseRow, "id" | "name" | "code" | "weight" | "progress_pct" | "status">;
