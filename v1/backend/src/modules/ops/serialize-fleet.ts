import { FuelEntry, Prisma, Trip } from '../../../generated/client';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';

export function serializeTrip(row: Trip) {
  return {
    id: row.id,
    companyId: row.companyId,
    driverId: row.driverId,
    projectId: row.projectId,
    machineId: row.machineId,
    materialId: row.materialId,
    quantity: row.quantity.toString(),
    originText: row.originText,
    originLat: row.originLat?.toString() ?? null,
    originLng: row.originLng?.toString() ?? null,
    destDepotId: row.destDepotId,
    destLat: row.destLat?.toString() ?? null,
    destLng: row.destLng?.toString() ?? null,
    weighTicketPath: row.weighTicketPath,
    weighQty: row.weighQty?.toString() ?? null,
    notes: row.notes,
    loadedAt: row.loadedAt,
    unloadedAt: row.unloadedAt,
    isSynced: row.isSynced,
    localId: row.localId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function serializeFuel(row: FuelEntry) {
  return {
    id: row.id,
    companyId: row.companyId,
    machineId: row.machineId,
    userId: row.userId,
    projectId: row.projectId,
    liters: row.liters.toString(),
    unitPrice: row.unitPrice.toString(),
    totalCost: row.totalCost.toString(),
    notes: row.notes,
    receiptPath: row.receiptPath,
    isSynced: row.isSynced,
    localId: row.localId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function fuelTotalCost(
  liters: Prisma.Decimal,
  unitPrice: Prisma.Decimal,
): Prisma.Decimal {
  const total = liters.mul(unitPrice).toDecimalPlaces(2);
  if (total.gte('10000000000')) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'Fuel totalCost must fit numeric(12,2)',
      400,
    );
  }
  return total;
}
