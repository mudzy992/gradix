/** R5.3 sync payload types for hauls. */
import { isOffsetDateTime } from "./r4-sync-time";

export type R4HaulQuantityUnit = "M3" | "T";

export type R4HaulPayload = {
  machineId: string;
  projectId: string | null;
  segmentId: string | null;
  hauledAt: string;
  originText: string;
  destinationText: string;
  materialText: string;
  quantity: number;
  quantityUnit: R4HaulQuantityUnit;
  scaleTicketText: string | null;
  tripCount: number;
  note: string | null;
};

export type R4HaulPushItem = {
  localId: string;
  entityType: "haul";
  haulId: string;
  deviceSentAt: string;
  haul: R4HaulPayload;
};

export function validHaulPayload(haul: R4HaulPayload): boolean {
  if (!haul || typeof haul !== "object") return false;
  if (typeof haul.machineId !== "string" || haul.machineId.length < 1 || haul.machineId.length > 128) {
    return false;
  }
  if (haul.projectId !== null
    && (typeof haul.projectId !== "string" || haul.projectId.length < 1 || haul.projectId.length > 128)) {
    return false;
  }
  if (haul.segmentId !== null
    && (typeof haul.segmentId !== "string" || haul.segmentId.length < 1 || haul.segmentId.length > 128)) {
    return false;
  }
  if (!isOffsetDateTime(haul.hauledAt)) return false;
  if (typeof haul.originText !== "string" || haul.originText.trim().length < 1 || haul.originText.length > 200) {
    return false;
  }
  if (typeof haul.destinationText !== "string"
    || haul.destinationText.trim().length < 1 || haul.destinationText.length > 200) {
    return false;
  }
  if (typeof haul.materialText !== "string"
    || haul.materialText.trim().length < 1 || haul.materialText.length > 200) {
    return false;
  }
  if (typeof haul.quantity !== "number" || !Number.isFinite(haul.quantity) || haul.quantity <= 0) {
    return false;
  }
  if (haul.quantityUnit !== "M3" && haul.quantityUnit !== "T") return false;
  if (haul.scaleTicketText !== null
    && (typeof haul.scaleTicketText !== "string" || haul.scaleTicketText.length > 120)) {
    return false;
  }
  if (!Number.isInteger(haul.tripCount) || haul.tripCount < 1) return false;
  if (haul.note !== null && (typeof haul.note !== "string" || haul.note.length > 2000)) return false;
  return true;
}
