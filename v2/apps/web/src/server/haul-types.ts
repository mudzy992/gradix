/** R5.3 shared types for haul service. */
export type HaulActor = {
  userId: string;
  companyId: string;
  roles: readonly string[];
};

export type QuantityUnit = "M3" | "T";

export type HaulRow = {
  id: string;
  machine_id: string;
  machine_code: string;
  machine_name: string;
  driver_worker_id: string;
  driver_name: string;
  project_id: string | null;
  project_code: string | null;
  project_name: string | null;
  segment_id: string | null;
  segment_code: string | null;
  segment_name: string | null;
  hauled_at: string;
  origin_text: string;
  destination_text: string;
  material_text: string;
  quantity: number;
  quantity_unit: QuantityUnit;
  scale_ticket_text: string | null;
  trip_count: number;
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
  segmentId?: string | null;
  hauledAt: string;
  originText: string;
  destinationText: string;
  materialText: string;
  quantity: number;
  quantityUnit: QuantityUnit;
  scaleTicketText?: string | null;
  tripCount?: number;
  note?: string | null;
};

export type MutationOutcome =
  | { outcome: "OK"; id: string }
  | { outcome: "FORBIDDEN"; code: string; message?: string }
  | { outcome: "VALIDATION_FAILED"; code: string; message: string }
  | { outcome: "CONFLICT"; code: string; message: string };
