import type { Role } from "./permissions";
import type { HoursCsvRow } from "./hours-csv";

export type HoursExportActor = {
  userId: string;
  companyId: string;
  roles: Role[];
  scope?: string;
  projectIds?: readonly string[];
};

export type HoursExportFilters = {
  from: string;
  to: string;
  projectId?: string;
  team?: string;
  /** Internal bounded report query; existing list/CSV stays unlimited. */
  maxSegments?: number;
};

export type HoursExportRow = HoursCsvRow & {
  workerId: string;
  projectId: string;
  projectCode: string;
};
