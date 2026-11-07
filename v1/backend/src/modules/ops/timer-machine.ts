import { PrismaService } from '../../modules/prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';

export async function assertMachineForTimer(
  prisma: PrismaService,
  machineId: string,
  companyId: string,
  projectId: string,
): Promise<void> {
  const machine = await prisma.machine.findFirst({
    where: { id: machineId, companyId },
  });
  if (!machine) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Invalid machineId', 400);
  }
  if (machine.status === 'DECOMMISSIONED') {
    throw new AppError(ERROR_CODES.CONFLICT, 'Machine is decommissioned', 409);
  }
  if (machine.status === 'IN_SERVICE') {
    throw new AppError(
      ERROR_CODES.MACHINE_IN_SERVICE,
      'Machine is in service',
      409,
    );
  }
  if (machine.status === 'IDLE') {
    return;
  }
  const active = await prisma.machineAssignment.findFirst({
    where: { machineId, endedAt: null },
  });
  if (machine.status === 'ACTIVE' && active?.projectId === projectId) {
    return;
  }
  throw new AppError(
    ERROR_CODES.VALIDATION_FAILED,
    'Machine not available for this project',
    400,
  );
}
