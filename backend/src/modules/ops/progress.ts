import { Prisma } from '../../../generated/client';
import { PrismaService } from '../../modules/prisma/prisma.service';

type Tx = Prisma.TransactionClient | PrismaService;

export async function recalcProgress(tx: Tx, projectId: string): Promise<void> {
  const phases = await tx.projectPhase.findMany({ where: { projectId } });
  if (phases.length === 0) {
    const tasks = await tx.task.findMany({
      where: { projectId, status: { not: 'CANCELLED' } },
      select: { status: true },
    });
    const percent =
      tasks.length === 0
        ? 0
        : Math.round(
            (tasks.filter((task) => task.status === 'COMPLETED').length /
              tasks.length) *
              100,
          );
    await tx.project.update({
      where: { id: projectId },
      data: { progressPercent: percent },
    });
    return;
  }
  let sum = 0;
  for (const phase of phases) {
    const tasks = await tx.task.findMany({
      where: { phaseId: phase.id, status: { not: 'CANCELLED' } },
      select: { status: true },
    });
    const percent =
      tasks.length === 0
        ? 0
        : Math.round(
            (tasks.filter((task) => task.status === 'COMPLETED').length /
              tasks.length) *
              100,
          );
    await tx.projectPhase.update({
      where: { id: phase.id },
      data: { progressPercent: percent },
    });
    sum += percent;
  }
  await tx.project.update({
    where: { id: projectId },
    data: { progressPercent: Math.round(sum / phases.length) },
  });
}
