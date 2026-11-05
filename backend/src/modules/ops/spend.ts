import { Prisma } from '../../../generated/client';
import { PrismaService } from '../../modules/prisma/prisma.service';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';

type Tx = Prisma.TransactionClient | PrismaService;

/** All cooperating spend writers lock the tenant's project before changing source rows. */
export async function lockSpendProject(
  tx: Prisma.TransactionClient,
  companyId: string,
  projectId: string,
): Promise<void> {
  // NO KEY UPDATE remains compatible with foreign-key KEY SHARE locks.
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Project"
    WHERE "id" = ${projectId} AND "companyId" = ${companyId}
    FOR NO KEY UPDATE`;
  if (rows.length === 0) {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'Project not found', 404);
  }
}

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
  // All summands are stored at scale 2, but their sum can exceed the project column.
  if (spend.abs().gte('10000000000')) {
    throw new AppError(
      ERROR_CODES.CONFLICT,
      'Project spend exceeds supported range',
      409,
    );
  }
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
  return rows
    .map((row) => row.sourceId)
    .filter((id): id is string => Boolean(id));
}
