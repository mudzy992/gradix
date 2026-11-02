import { Prisma, TimerSession } from '../../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { hasRole } from '../../common/scope/ops-roles';
import {
  assertNotOnHold,
  assertProjectWritable,
} from '../../common/scope/project-lock';
import { ProjectAccessService } from './project-access.service';
import { TasksService } from './tasks.service';
import { syncTaskStatus } from './task-status';
import { assertMachineForTimer } from './timer-machine';
import { StartTimerDto } from './timer.dto';

export type TimerStartIdentity = {
  startedAt: Date;
  localId?: string;
  deviceId?: string;
  isSynced?: boolean;
};

export async function createTimerSession(params: {
  prisma: PrismaService;
  access: ProjectAccessService;
  tasks: TasksService;
  realtime: RealtimeService;
  actor: AuthUser;
  dto: StartTimerDto;
  identity: TimerStartIdentity;
}): Promise<TimerSession> {
  const task = await params.tasks.loadVisibleTask(
    params.actor,
    params.dto.taskId,
  );
  const project = await params.access.getVisibleProject(
    params.actor,
    task.projectId,
  );
  assertProjectWritable(project);
  assertNotOnHold(project);
  if (task.status === 'COMPLETED' || task.status === 'CANCELLED') {
    throw new AppError(ERROR_CODES.CONFLICT, 'Task is terminal', 409);
  }
  const assigneeCount = await params.prisma.taskAssignment.count({
    where: { taskId: task.id },
  });
  if (assigneeCount < 1) {
    throw new AppError(ERROR_CODES.CONFLICT, 'Cannot start PENDING task', 409);
  }
  await assertCanStartTimer(params.prisma, params.actor, task.id, project.id);
  if (params.dto.machineId) {
    await assertMachineForTimer(
      params.prisma,
      params.dto.machineId,
      project.companyId,
      project.id,
    );
  }
  try {
    const session = await params.prisma.timerSession.create({
      data: {
        companyId: project.companyId,
        userId: params.actor.id,
        taskId: task.id,
        startedAt: params.identity.startedAt,
        lat: params.dto.lat,
        lng: params.dto.lng,
        machineId: params.dto.machineId ?? null,
        localId: params.identity.localId,
        deviceId: params.identity.deviceId,
        isSynced: params.identity.isSynced ?? true,
        approvalStatus: 'PENDING',
      },
    });
    await syncTaskStatus(params.prisma, task.id);
    params.realtime.emitProject(project.id, 'timer:started', {
      id: session.id,
      projectId: project.id,
      taskId: task.id,
    });
    return session;
  } catch (error) {
    return await mapTimerUnique(
      error,
      params.prisma,
      params.actor.id,
      params.dto.machineId,
    );
  }
}

export async function assertCanStartTimer(
  prisma: PrismaService,
  actor: AuthUser,
  taskId: string,
  projectId: string,
): Promise<void> {
  const assigned = await prisma.taskAssignment.findFirst({
    where: { taskId, userId: actor.id },
  });
  if (assigned) {
    return;
  }
  if (!hasRole(actor, 'SITE_SUPERVISOR')) {
    throw new AppError(ERROR_CODES.FORBIDDEN, 'Not assigned to task', 403);
  }
  const scoped = await prisma.projectAssignment.findFirst({
    where: { projectId, userId: actor.id },
  });
  if (!scoped && !hasRole(actor, 'ADMIN', 'SUPER_ADMIN', 'PLATFORM_ADMIN')) {
    throw new AppError(ERROR_CODES.FORBIDDEN, 'Not assigned to task', 403);
  }
}

async function mapTimerUnique(
  error: unknown,
  prisma: PrismaService,
  userId: string,
  machineId?: string,
): Promise<never> {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  ) {
    const mine = await prisma.timerSession.findFirst({
      where: { userId, closedAt: null },
    });
    if (mine) {
      throw new AppError(
        ERROR_CODES.TIMER_ALREADY_OPEN,
        'Timer already open',
        409,
      );
    }
    if (machineId) {
      throw new AppError(
        ERROR_CODES.MACHINE_IN_USE,
        'Machine already in use',
        409,
      );
    }
    throw new AppError(
      ERROR_CODES.TIMER_ALREADY_OPEN,
      'Timer already open',
      409,
    );
  }
  throw error;
}
