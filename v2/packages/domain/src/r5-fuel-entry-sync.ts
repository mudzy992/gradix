/** R5.2 sync payload types for fuel entries. */
import { isOffsetDateTime } from "./r4-sync-time";
import { isCurrency, money, type Currency } from "./money";

export type R4FuelEntryPayload = {
  machineId: string;
  projectId: string | null;
  filledAt: string;
  liters: number;
  totalAmount: string | null;
  currencyCode: Currency;
  unitPriceAmount: string | null;
  meterReading: number | null;
  note: string | null;
};

export type R4FuelEntryPushItem = {
  localId: string;
  entityType: "fuel_entry";
  fuelEntryId: string;
  deviceSentAt: string;
  entry: R4FuelEntryPayload;
};

export function validFuelEntryPayload(entry: R4FuelEntryPayload): boolean {
  if (!entry || typeof entry !== "object") return false;
  if (typeof entry.machineId !== "string" || entry.machineId.length < 1 || entry.machineId.length > 128) return false;
  if (entry.projectId !== null && (typeof entry.projectId !== "string" || entry.projectId.length < 1 || entry.projectId.length > 128)) {
    return false;
  }
  if (!isOffsetDateTime(entry.filledAt)) return false;
  if (typeof entry.liters !== "number" || !Number.isFinite(entry.liters) || entry.liters <= 0) return false;
  if (!isCurrency(entry.currencyCode)) return false;
  if (entry.totalAmount !== null) {
    try {
      const total = money(entry.totalAmount, entry.currencyCode);
      if (total.cents < 0n) return false;
    } catch {
      return false;
    }
  }
  if (entry.unitPriceAmount !== null) {
    try {
      money(entry.unitPriceAmount, entry.currencyCode);
    } catch {
      return false;
    }
  }
  if (entry.meterReading !== null && (typeof entry.meterReading !== "number" || !Number.isFinite(entry.meterReading) || entry.meterReading < 0)) {
    return false;
  }
  if (entry.note !== null && (typeof entry.note !== "string" || entry.note.length > 2000)) return false;
  return true;
}