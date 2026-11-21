import {
  Machine,
  MachineStatus,
  Prisma,
  ServiceRecord,
} from '../../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { TimerForceCloseService } from '../ops/timer-force-close.service';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { serializeService } from './serialize-service';

/**
 * BE-15 (F-01): start servisa je bio „provjeri pa upiši“ kroz dva odvojena upisa —
 * dva paralelna klika su oba prošla provjeru (mašina dva puta `IN_SERVICE`, dva
 * servisa `IN_PROGRESS`), a pad između upisa je ostavljao mašinu u servisu bez
 * zapisa. Sada su oba prelaza **atomska claims** (`updateMany` sa uslovom) unutar
 * jedne transakcije: ko izgubi trku dobija `409`, a ne dupli zapis.
 */
export async function startServiceRecord(input: {
  prisma: PrismaService;
  closer: TimerForceCloseService;
  record: ServiceRecord;
  machine: Machine;
  actorId: string;
}) {
  if (input.record.status === 'IN_PROGRESS') {
    throw new AppError(
      ERROR_CODES.CONFLICT,
      'Service is already in progress',
      409,
    );
  }
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
  // Zatvaranje otvorenih timera mašine ima svoje transakcije (BE-13), pa ide prije.
  await input.closer.closeOpenForMachine(input.machine.id, input.actorId);
  const updated = await input.prisma.$transaction(async (tx) => {
    const machineClaim = await tx.machine.updateMany({
      where: {
        id: input.machine.id,
        status: { notIn: ['IN_SERVICE', 'DECOMMISSIONED'] },
      },
      data: { status: 'IN_SERVICE' },
    });
    if (machineClaim.count === 0) {
      throw new AppError(
        ERROR_CODES.MACHINE_IN_SERVICE,
        'Machine is in service',
        409,
      );
    }
    const recordClaim = await tx.serviceRecord.updateMany({
      where: { id: input.record.id, status: { in: ['PLANNED', 'SCHEDULED'] } },
      data: {
        status: 'IN_PROGRESS',
        startedAt: new Date(),
        previousMachineStatus: previous,
      },
    });
    if (recordClaim.count === 0) {
      throw new AppError(
        ERROR_CODES.CONFLICT,
        'Service is already in progress',
        409,
      );
    }
    return tx.serviceRecord.findUniqueOrThrow({
      where: { id: input.record.id },
    });
  });
  return serializeService(updated);
}

/** Mašina se vraća u stanje koje joj daje otvorena dodjela (BE-15: u transakciji). */
export async function restoreMachine(
  tx: Prisma.TransactionClient,
  machineId: string,
): Promise<void> {
  const active = await tx.machineAssignment.findFirst({
    where: { machineId, endedAt: null },
  });
  await tx.machine.update({
    where: { id: machineId },
    data: { status: active ? 'ACTIVE' : 'IDLE' },
  });
}
