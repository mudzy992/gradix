/** R5.5 sync payload types for machine faults. */
import { isOffsetDateTime } from "./r4-sync-time";

/** Default approval threshold: 500.00 in company currency (cents). */
export const FAULT_COST_APPROVAL_THRESHOLD_CENTS = 50_000n;

export type R4FaultPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type R4FaultStatus =
  | "OPEN"
  | "WAITING_APPROVAL"
  | "APPROVED"
  | "IN_PROGRESS"
  | "DONE"
  | "CANCELLED";

export type R4FaultPayload = {
  machineId: string;
  projectId: string | null;
  partnerId: string | null;
  reportedAt: string;
  title: string;
  description: string | null;
  priority: R4FaultPriority;
  estimatedCostAmount: string | null;
  currencyCode: string | null;
  downtimeMinutes: number | null;
};

export type R4FaultPushItem = {
  localId: string;
  entityType: "machine_fault";
  faultId: string;
  deviceSentAt: string;
  fault: R4FaultPayload;
};

const PRIORITIES: readonly R4FaultPriority[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

export function needsFaultCostApproval(estimatedCostCents: bigint | null): boolean {
  return estimatedCostCents !== null && estimatedCostCents >= FAULT_COST_APPROVAL_THRESHOLD_CENTS;
}

export function validFaultPayload(fault: R4FaultPayload): boolean {
  if (!fault || typeof fault !== "object") return false;
  if (typeof fault.machineId !== "string" || fault.machineId.length < 1 || fault.machineId.length > 128) {
    return false;
  }
  if (fault.projectId !== null
    && (typeof fault.projectId !== "string" || fault.projectId.length < 1 || fault.projectId.length > 128)) {
    return false;
  }
  if (fault.partnerId !== null
    && (typeof fault.partnerId !== "string" || fault.partnerId.length < 1 || fault.partnerId.length > 128)) {
    return false;
  }
  if (!isOffsetDateTime(fault.reportedAt)) return false;
  if (typeof fault.title !== "string" || fault.title.trim().length < 1 || fault.title.length > 200) {
    return false;
  }
  if (fault.description !== null
    && (typeof fault.description !== "string" || fault.description.length > 4000)) {
    return false;
  }
  if (!PRIORITIES.includes(fault.priority)) return false;
  const hasAmount = fault.estimatedCostAmount !== null;
  const hasCurrency = fault.currencyCode !== null;
  if (hasAmount !== hasCurrency) return false;
  if (hasCurrency && (typeof fault.currencyCode !== "string" || fault.currencyCode.length !== 3)) {
    return false;
  }
  if (hasAmount && (typeof fault.estimatedCostAmount !== "string" || fault.estimatedCostAmount.length < 1)) {
    return false;
  }
  if (fault.downtimeMinutes !== null
    && (!Number.isInteger(fault.downtimeMinutes) || fault.downtimeMinutes < 0)) {
    return false;
  }
  return true;
}
