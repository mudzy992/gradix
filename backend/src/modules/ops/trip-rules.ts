import { Machine } from '../../../generated/client';
import { PrismaService } from '../../modules/prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';

export async function assertTruckForTrip(
  prisma: PrismaService,
  machine: Machine,
  projectId: string,
  driverId: string,
): Promise<void> {
  if (machine.type !== 'TRUCK') {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Trip machine must be TRUCK', 400);
  }
  if (machine.status === 'DECOMMISSIONED') {
    throw new AppError(ERROR_CODES.CONFLICT, 'Machine is decommissioned', 409);
  }
  const assignedToDriver = await prisma.machineAssignment.findFirst({
    where: { machineId: machine.id, userId: driverId, endedAt: null },
  });
  if (assignedToDriver && assignedToDriver.projectId === projectId) {
    return;
  }
  if (machine.status === 'IDLE') {
    return;
  }
  const onProject = await prisma.machineAssignment.findFirst({
    where: { machineId: machine.id, projectId, endedAt: null },
  });
  if (onProject) {
    return;
  }
  throw new AppError(ERROR_CODES.FORBIDDEN, 'Truck not available for this trip', 403);
}

export function assertSyncedImmutable(isSynced: boolean): void {
  if (isSynced) {
    throw new AppError(ERROR_CODES.TRIP_IMMUTABLE, 'Synced trip cannot be edited', 403);
  }
}
