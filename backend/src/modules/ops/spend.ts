import { Prisma } from '../../../generated/client';
import { PrismaService } from '../../modules/prisma/prisma.service';

type Tx = Prisma.TransactionClient | PrismaService;

export async function recalcSpend(tx: Tx, projectId: string): Promise<void> {
  const linkedFuel = await linkedSourceIds(tx, projectId, 'FUEL');
  const linkedService = await linkedSourceIds(tx, projectId, 'SERVICE');
  const fuel = await tx.fuelEntry.aggregate({
    where: {
      projectId,
      ...(linkedFuel.length ? { id: { notIn: linkedFuel } } : {}),
    },
    _sum: { totalCost: true },
  });
  const service = await tx.serviceRecord.aggregate({
    where: {
      projectId,
      status: 'COMPLETED',
      ...(linkedService.length ? { id: { notIn: linkedService } } : {}),
    },
    _sum: { totalCost: true },
  });
  const costs = await tx.costEntry.aggregate({
    where: { projectId },
    _sum: { amount: true },
  });
  const spend = new Prisma.Decimal(fuel._sum.totalCost ?? 0)
    .plus(service._sum.totalCost ?? 0)
    .plus(costs._sum.amount ?? 0);
  await tx.project.update({
    where: { id: projectId },
    data: { currentSpend: spend },
  });
}

async function linkedSourceIds(
  tx: Tx,
  projectId: string,
  source: 'FUEL' | 'SERVICE',
): Promise<string[]> {
  const rows = await tx.costEntry.findMany({
    where: { projectId, source, sourceId: { not: null } },
    select: { sourceId: true },
  });
  return rows.map((row) => row.sourceId).filter((id): id is string => Boolean(id));
}
