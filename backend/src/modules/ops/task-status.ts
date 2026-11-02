import { TaskStatus } from '../../../generated/client';
import { PrismaService } from '../prisma/prisma.service';

type Tx =
  Parameters<Parameters<PrismaService['$transaction']>[0]>[0] | PrismaService;

export async function syncTaskStatus(
  tx: Tx,
  taskId: string,
): Promise<TaskStatus> {
  const task = await tx.task.findUniqueOrThrow({
    where: { id: taskId },
    include: {
      assignees: true,
      timers: { where: { closedAt: null } },
    },
  });
  if (task.status === 'COMPLETED' || task.status === 'CANCELLED') {
    return task.status;
  }
  const running = task.timers.some((session) => session.pausedAt === null);
  const next: TaskStatus = running
    ? 'IN_PROGRESS'
    : task.timers.length > 0
      ? 'PAUSED'
      : task.assignees.length > 0
        ? 'ASSIGNED'
        : 'PENDING';
  if (next !== task.status) {
    await tx.task.update({ where: { id: taskId }, data: { status: next } });
  }
  return next;
}

export async function addTaskMinutes(
  tx: Tx,
  taskId: string,
  minutes: number,
): Promise<void> {
  await tx.task.update({
    where: { id: taskId },
    data: { totalTimeSpentMinutes: { increment: minutes } },
  });
}
