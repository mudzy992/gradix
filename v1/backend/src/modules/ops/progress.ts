import { Prisma } from '../../../generated/client';
import { PrismaService } from '../prisma/prisma.service';

type Tx = Prisma.TransactionClient | PrismaService;

type TaskStatusRow = { status: string };

/**
 * BE-05: procenti su izvučeni u čiste funkcije (testiraju se bez baze), a upiti su svedeni
 * na **dva** umjesto `1 + 2×N` (ranije je svaka faza tražila svoje zadatke).
 */
export function taskPercent(tasks: readonly TaskStatusRow[]): number {
  const counted = tasks.filter((task) => task.status !== 'CANCELLED');
  if (counted.length === 0) {
    return 0;
  }
  const completed = counted.filter(
    (task) => task.status === 'COMPLETED',
  ).length;
  return Math.round((completed / counted.length) * 100);
}

export function averagePercent(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sum = values.reduce((total, value) => total + value, 0);
  return Math.round(sum / values.length);
}

export async function recalcProgress(tx: Tx, projectId: string): Promise<void> {
  const phases = await tx.projectPhase.findMany({
    where: { projectId },
    select: { id: true },
  });

  if (phases.length === 0) {
    const tasks = await tx.task.findMany({
      where: { projectId },
      select: { status: true },
    });
    await tx.project.update({
      where: { id: projectId },
      data: { progressPercent: taskPercent(tasks) },
    });
    return;
  }

  const phaseIds = phases.map((phase) => phase.id);
  const tasks = await tx.task.findMany({
    where: { projectId, phaseId: { in: phaseIds } },
    select: { phaseId: true, status: true },
  });

  const byPhase = new Map<string, TaskStatusRow[]>();
  for (const task of tasks) {
    if (!task.phaseId) {
      continue;
    }
    const list = byPhase.get(task.phaseId) ?? [];
    list.push({ status: task.status });
    byPhase.set(task.phaseId, list);
  }

  const percents: number[] = [];
  for (const phase of phases) {
    const percent = taskPercent(byPhase.get(phase.id) ?? []);
    await tx.projectPhase.update({
      where: { id: phase.id },
      data: { progressPercent: percent },
    });
    percents.push(percent);
  }

  await tx.project.update({
    where: { id: projectId },
    data: { progressPercent: averagePercent(percents) },
  });
}
