import { Prisma } from '../../../generated/client';
import { PrismaService } from '../../modules/prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import {
  parseNonNegativeMoney,
  parsePositiveQuantity,
  parsePositiveDecimal,
} from '../../common/utils/decimal-input';
import { fuelTotalCost } from './serialize-fleet';
import { lockSpendProject, recalcSpend } from './spend';
import { allowNegativeStock, stockBalance } from '../erp/stock-balance';

type Db = Prisma.TransactionClient | PrismaService;

const TRIP_FIELDS = new Set(['quantity', 'notes', 'weighQty', 'destDepotId']);
const FUEL_FIELDS = new Set(['liters', 'unitPrice', 'notes', 'projectId']);

export async function applyTripAmendment(
  prisma: Db,
  companyId: string,
  entityId: string,
  field: string,
  newValue: string,
): Promise<{ oldValue: string; ownerId: string }> {
  if (!TRIP_FIELDS.has(field)) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'TRIP field not allowed',
      400,
    );
  }
  const trip = await prisma.trip.findFirst({
    where: { id: entityId, companyId },
  });
  if (!trip) {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'Trip not found', 404);
  }
  const oldValue = readTripField(trip, field);
  if (field === 'quantity') {
    await prisma.trip.update({
      where: { id: trip.id },
      data: { quantity: parsePositiveDecimal(newValue, 'quantity', 3) },
    });
  } else if (field === 'notes') {
    await prisma.trip.update({
      where: { id: trip.id },
      data: { notes: newValue },
    });
  } else if (field === 'weighQty') {
    await prisma.trip.update({
      where: { id: trip.id },
      data: { weighQty: parsePositiveDecimal(newValue, 'weighQty', 3) },
    });
  } else {
    const depot = await prisma.depot.findFirst({
      where: { id: newValue, companyId, isActive: true },
    });
    if (!depot) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'Invalid destDepotId',
        400,
      );
    }
    await prisma.trip.update({
      where: { id: trip.id },
      data: {
        destDepotId: depot.id,
        destLat: depot.lat,
        destLng: depot.lng,
      },
    });
  }
  return { oldValue, ownerId: trip.driverId };
}

export async function applyFuelAmendment(
  prisma: Prisma.TransactionClient,
  companyId: string,
  entityId: string,
  field: string,
  newValue: string,
): Promise<{ oldValue: string; ownerId: string }> {
  if (!FUEL_FIELDS.has(field)) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'FUEL field not allowed',
      400,
    );
  }
  // Lock the fuel row first so simultaneous amendments see its latest project
  // and values before choosing the project locks and recording oldValue.
  const locked = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "FuelEntry"
    WHERE "id" = ${entityId} AND "companyId" = ${companyId}
    FOR NO KEY UPDATE`;
  if (locked.length === 0) {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'Fuel entry not found', 404);
  }
  const row = await prisma.fuelEntry.findFirst({
    where: { id: entityId, companyId },
  });
  if (!row) {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'Fuel entry not found', 404);
  }
  const oldValue = readFuelField(row, field);
  const liters =
    field === 'liters' ? parsePositiveQuantity(newValue, 'liters') : row.liters;
  const unitPrice =
    field === 'unitPrice'
      ? parseNonNegativeMoney(newValue, 'unitPrice')
      : row.unitPrice;
  const nextProjectId =
    field === 'projectId' ? newValue || null : row.projectId;
  if (field === 'projectId' && nextProjectId !== row.projectId) {
    // A linked cost is an independently entered amount. Moving only fuel would
    // leave that cost on the old project and double-count the source globally.
    const linked = await prisma.costEntry.findFirst({
      where: { companyId, source: 'FUEL', sourceId: row.id },
      select: { id: true },
    });
    if (linked) {
      throw new AppError(
        ERROR_CODES.CONFLICT,
        'Remove the linked fuel cost before changing project',
        409,
      );
    }
  }
  // Sort to avoid opposite-direction moves acquiring project locks in opposite
  // orders. Tenant-scoped locks also reject foreign/nonexistent destinations.
  const projects = [
    ...new Set(
      [row.projectId, nextProjectId].filter((id): id is string => id !== null),
    ),
  ].sort();
  for (const projectId of projects) {
    await lockSpendProject(prisma, companyId, projectId);
  }
  if (field === 'liters' || field === 'projectId') {
    // The fuel lock serializes with apply-stock. Refuse ambiguous legacy rows
    // instead of silently overwriting discrepancies or crossing tenant bounds.
    const movement = await prisma.stockMovement.findUnique({
      where: { fuelEntryId: row.id },
    });
    if (movement) {
      const [warehouse, material] = await Promise.all([
        prisma.warehouse.findFirst({
          where: { id: movement.warehouseId, companyId },
        }),
        prisma.material.findFirst({
          where: { id: movement.materialId, companyId },
        }),
      ]);
      if (
        movement.companyId !== companyId ||
        !warehouse ||
        warehouse.type !== 'CISTERN' ||
        !material ||
        !movement.qty.eq(row.liters.neg()) ||
        movement.projectId !== row.projectId
      ) {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          'Fuel stock movement requires reconciliation',
          409,
        );
      }
      const nextQty = liters.neg();
      const delta = nextQty.minus(movement.qty);
      if (delta.lt(0)) {
        const balance = await stockBalance(
          prisma,
          movement.warehouseId,
          movement.materialId,
        );
        if (
          balance.plus(delta).lt(0) &&
          !(await allowNegativeStock(prisma, companyId))
        ) {
          throw new AppError(
            ERROR_CODES.CONFLICT,
            'Stock cannot go negative',
            409,
          );
        }
      }
      await prisma.stockMovement.update({
        where: { id: movement.id },
        data: { qty: nextQty, projectId: nextProjectId },
      });
    }
  }
  await prisma.fuelEntry.update({
    where: { id: row.id },
    data: {
      liters,
      unitPrice,
      totalCost: fuelTotalCost(liters, unitPrice),
      notes: field === 'notes' ? newValue : undefined,
      projectId: field === 'projectId' ? nextProjectId : undefined,
    },
  });
  if (row.projectId) {
    await recalcSpend(prisma, row.projectId);
  }
  if (nextProjectId && nextProjectId !== row.projectId) {
    await recalcSpend(prisma, nextProjectId);
  }
  return { oldValue, ownerId: row.userId };
}

function readTripField(
  trip: {
    quantity: Prisma.Decimal;
    notes: string | null;
    weighQty: Prisma.Decimal | null;
    destDepotId: string | null;
  },
  field: string,
): string {
  if (field === 'quantity') {
    return trip.quantity.toString();
  }
  if (field === 'notes') {
    return trip.notes ?? '';
  }
  if (field === 'weighQty') {
    return trip.weighQty?.toString() ?? '';
  }
  return trip.destDepotId ?? '';
}

function readFuelField(
  row: {
    liters: Prisma.Decimal;
    unitPrice: Prisma.Decimal;
    notes: string | null;
    projectId: string | null;
  },
  field: string,
): string {
  if (field === 'liters') {
    return row.liters.toString();
  }
  if (field === 'unitPrice') {
    return row.unitPrice.toString();
  }
  if (field === 'notes') {
    return row.notes ?? '';
  }
  return row.projectId ?? '';
}
