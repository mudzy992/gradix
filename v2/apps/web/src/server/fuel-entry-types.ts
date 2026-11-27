/** R5.2 shared types for fuel-entry service. */
import type { MachineActivityActor } from "./machine-activity-scope";
export type FuelEntryActor = MachineActivityActor;

export type FuelEntryRow = {
  id: string;
  machine_id: string;
  machine_code: string;
  machine_name: string;
  driver_worker_id: string;
  driver_name: string;
  project_id: string | null;
  project_code: string | null;
  project_name: string | null;
  filled_at: string;
  liters: number;
  amount: string | null;
  currency_code: string | null;
  unit_price: string | null;
  meter_reading: number | null;
  note: string | null;
  version: number;
  created_at: string;
  /** F4: `PRICE_LIST` kad je cijena došla iz šifarnika, `MANUAL` kad ju je ured prepisao. */
  price_source: "PRICE_LIST" | "MANUAL";
  tank_id: string | null;
  /** Odstupanje potrošnje: `null` kad ga nema ili kad nema osnova za poređenje. */
  deviation_pct: number | null;
  deviation_status: "OPEN" | "EXPLAINED" | "DISMISSED" | null;
};

export type ListFilters = {
  machineId?: string;
  from?: string;
  to?: string;
  untilExclusive?: string;
  /** Internal report filters; always narrow the tenant-visible source. */
  projectIds?: readonly string[] | null;
  projectId?: string;
  team?: string;
  limit?: number;
};

export type CreateInput = {
  machineId: string;
  driverWorkerId?: string | null;
  projectId?: string | null;
  filledAt: string;
  liters: number;
  totalAmount?: string | null;
  currencyCode?: string;
  unitPriceAmount?: string | null;
  meterReading?: number | null;
  note?: string | null;
  /** F4: točenje iz cisterne; dozvoljeno samo kad je cisterna uključena u postavkama firme. */
  tankId?: string | null;
};

export type MutationOutcome =
  | { outcome: "OK"; id: string }
  | { outcome: "FORBIDDEN"; code: string; message?: string }
  | { outcome: "VALIDATION_FAILED"; code: string; message: string }
  | { outcome: "CONFLICT"; code: string; message: string };