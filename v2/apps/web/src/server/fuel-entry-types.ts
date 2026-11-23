/** R5.2 shared types for fuel-entry service. */
export type FuelEntryActor = {
  userId: string;
  companyId: string;
  roles: readonly string[];
};

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
};

export type ListFilters = {
  machineId?: string;
  from?: string;
  to?: string;
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
};

export type MutationOutcome =
  | { outcome: "OK"; id: string }
  | { outcome: "FORBIDDEN"; code: string; message?: string }
  | { outcome: "VALIDATION_FAILED"; code: string; message: string }
  | { outcome: "CONFLICT"; code: string; message: string };