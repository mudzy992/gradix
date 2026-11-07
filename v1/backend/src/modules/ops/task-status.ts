import { TaskStatus } from '../../../generated/client';
import { PrismaService } from '../prisma/prisma.service';

type Tx =
  Parameters<Parameters<PrismaService['$transaction']>[0]>[0] | PrismaService;

/**
 * BE-06 — odluka o statusu zadatka izvedena iz stanja (otvoreni timer / dodjele).
 * Terminalni statusi se ne mijenjaju. Izvučeno u čistu funkciju da se testira bez baze.
 */
export function nextTaskStatus(input: {
  status: TaskStatus;
  openTimers: readonly { pausedAt: Date | null }[];
  assigneeCount: number;
}): TaskStatus {
  if (input.status === 'COMPLETED' || input.status === 'CANCELLED') {
    return input.status;
  }
  if (input.openTimers.some((session) => session.pausedAt === null)) {
    return 'IN_PROGRESS';
  }
  if (input.openTimers.length > 0) {
    return 'PAUSED';
  }
  return input.assigneeCount > 0 ? 'ASSIGNED' : 'PENDING';
}

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
  const next = nextTaskStatus({
    status: task.status,
    openTimers: task.timers,
    assigneeCount: task.assignees.length,
  });
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
