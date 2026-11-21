import { Prisma } from '../../../generated/client';
import { PrismaService } from '../../modules/prisma/prisma.service';

type Tx = Prisma.TransactionClient | PrismaService;

export async function addMachineHours(
  tx: Tx,
  machineId: string | null,
  durationMinutes: number,
): Promise<void> {
  if (!machineId || durationMinutes === 0) {
    return;
  }
  const hours = new Prisma.Decimal(durationMinutes).div(60);
  await tx.machine.update({
    where: { id: machineId },
    data: { currentWorkingHours: { increment: hours } },
  });
}
