import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { hasRole } from '../../common/scope/ops-roles';
import { ProjectAccessService } from './project-access.service';
import { TasksService } from './tasks.service';
import { TimerForceCloseService } from './timer-force-close.service';
import { applyPauseAccum, computeElapsedMinutes } from './timer-math';
import { syncTaskStatus } from './task-status';
import { StartTimerDto } from './timer.dto';
import { parseOfflineStartedAt, rejectOnlineClientClock } from './timer-clock';
import { createTimerSession } from './timer-create';
import { readMaxOpenHours } from './timer-settings';
import { requireCompany } from '../users/users-helpers';

@Injectable()
export class TimerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly tasks: TasksService,
    private readonly closer: TimerForceCloseService,
    private readonly realtime: RealtimeService,
  ) {}

  async start(actor: AuthUser, dto: StartTimerDto) {
    rejectOnlineClientClock(dto);
    return createTimerSession({
      prisma: this.prisma,
      access: this.access,
      tasks: this.tasks,
      realtime: this.realtime,
      actor,
      dto,
      identity: { startedAt: new Date() },
    });
  }

  async startOffline(
    actor: AuthUser,
    dto: StartTimerDto,
    startedAtRaw: unknown,
    localId: string,
    deviceId: string,
  ) {
    const now = new Date();
    const maxHours = await readMaxOpenHours(this.prisma, requireCompany(actor));
    const startedAt = parseOfflineStartedAt(startedAtRaw, now, maxHours);
    return createTimerSession({
      prisma: this.prisma,
      access: this.access,
      tasks: this.tasks,
      realtime: this.realtime,
      actor,
      dto,
      identity: { startedAt, localId, deviceId, isSynced: true },
    });
  }

  async pause(actor: AuthUser) {
    const session = await this.requireMine(actor);
    if (session.pausedAt) {
      throw new AppError(ERROR_CODES.CONFLICT, 'Already paused', 409);
    }
    const updated = await this.prisma.timerSession.update({
      where: { id: session.id },
      data: { pausedAt: new Date() },
    });
    await syncTaskStatus(this.prisma, session.taskId);
    const task = await this.prisma.task.findUniqueOrThrow({ where: { id: session.taskId } });
    this.realtime.emitProject(task.projectId, 'timer:paused', {
      id: session.id,
      projectId: task.projectId,
      taskId: session.taskId,
    });
    return updated;
  }

  async resume(actor: AuthUser) {
    const session = await this.requireMine(actor);
    if (!session.pausedAt) {
      throw new AppError(ERROR_CODES.CONFLICT, 'Not paused', 409);
    }
    const now = new Date();
    const paused = applyPauseAccum(session, now);
    const updated = await this.prisma.timerSession.update({
      where: { id: session.id },
      data: { pauseAccumMinutes: paused.pauseAccumMinutes, pausedAt: null },
    });
    await syncTaskStatus(this.prisma, session.taskId);
    return updated;
  }

  async stop(actor: AuthUser) {
    const session = await this.requireMine(actor);
    return this.closer.closeSession(session, actor.id, 'stop');
  }

  async me(actor: AuthUser) {
    const session = await this.prisma.timerSession.findFirst({
      where: { userId: actor.id, closedAt: null },
    });
    if (!session) {
      return { session: null, elapsedMinutes: 0 };
    }
    return { session, elapsedMinutes: computeElapsedMinutes(session, new Date()) };
  }

  async listByProject(actor: AuthUser, projectId: string) {
    if (!hasRole(actor, 'ADMIN', 'SUPER_ADMIN', 'PLATFORM_ADMIN', 'PROJECT_MANAGER', 'SITE_SUPERVISOR')) {
      throw new AppError(ERROR_CODES.FORBIDDEN, 'Timer list not allowed', 403);
    }
    await this.access.getVisibleProject(actor, projectId);
    return this.prisma.timerSession.findMany({
      where: { closedAt: null, task: { projectId } },
    });
  }

  async findByLocalId(actor: AuthUser, deviceId: string, localId: string) {
    return this.prisma.timerSession.findFirst({
      where: { companyId: actor.companyId ?? '', userId: actor.id, deviceId, localId },
    });
  }

  async requireMine(actor: AuthUser) {
    const session = await this.prisma.timerSession.findFirst({
      where: { userId: actor.id, closedAt: null },
    });
    if (!session) {
      throw new AppError(ERROR_CODES.CONFLICT, 'No open timer', 409);
    }
    return session;
  }
}
