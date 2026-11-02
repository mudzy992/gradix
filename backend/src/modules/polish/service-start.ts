import {
  Machine,
  MachineStatus,
  ServiceRecord,
} from '../../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { TimerForceCloseService } from '../ops/timer-force-close.service';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { serializeService } from './serialize-service';

export async function startServiceRecord(input: {
  prisma: PrismaService;
  closer: TimerForceCloseService;
  record: ServiceRecord;
  machine: Machine;
  actorId: string;
}) {
  if (
    input.record.status !== 'PLANNED' &&
    input.record.status !== 'SCHEDULED'
  ) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'Service cannot start',
      400,
    );
  }
  if (input.machine.status === 'DECOMMISSIONED') {
    throw new AppError(ERROR_CODES.CONFLICT, 'Machine is decommissioned', 409);
  }
  if (input.machine.status === 'IN_SERVICE') {
    throw new AppError(
      ERROR_CODES.MACHINE_IN_SERVICE,
      'Machine is in service',
      409,
    );
  }
  const previous: MachineStatus =
    input.machine.status === 'ACTIVE' ? 'ACTIVE' : 'IDLE';
  await input.closer.closeOpenForMachine(input.machine.id, input.actorId);
  await input.prisma.machine.update({
    where: { id: input.machine.id },
    data: { status: 'IN_SERVICE' },
  });
  const updated = await input.prisma.serviceRecord.update({
    where: { id: input.record.id },
    data: {
      status: 'IN_PROGRESS',
      startedAt: new Date(),
      previousMachineStatus: previous,
    },
  });
  return serializeService(updated);
}
