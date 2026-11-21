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
import type { TimerSession } from '../../../generated/client';
import { serializeCrewTimer, serializeTimerSelf } from './serialize-timer';

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
    await this.assertNoOpenTimer(actor, dto.machineId);
    const session = await createTimerSession({
      prisma: this.prisma,
      access: this.access,
      tasks: this.tasks,
      realtime: this.realtime,
      actor,
      dto,
      identity: { startedAt: new Date() },
    });
    return serializeTimerSelf(session);
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
    return this.pauseSession(await this.requireMine(actor));
  }

  /**
   * BE-07 (F-02): pauza je jedna transakcija (sesija + status zadatka) i jedina
   * implementacija — koristi je i `POST /timer/pause` i offline replay (`SyncPushTimerService`).
   */
  async pauseSession(session: TimerSession) {
    if (session.pausedAt) {
      throw new AppError(ERROR_CODES.CONFLICT, 'Already paused', 409);
    }
    const { updated, projectId } = await this.prisma.$transaction(
      async (tx) => {
        const updated = await tx.timerSession.update({
          where: { id: session.id },
          data: { pausedAt: new Date() },
        });
        await syncTaskStatus(tx, session.taskId);
        const task = await tx.task.findUniqueOrThrow({
          where: { id: session.taskId },
        });
        return { updated, projectId: task.projectId };
      },
    );
    this.realtime.emitProject(projectId, 'timer:paused', {
      id: session.id,
      projectId,
      taskId: session.taskId,
    });
    return serializeTimerSelf(updated);
  }

  async resume(actor: AuthUser) {
    return this.resumeSession(await this.requireMine(actor));
  }

  /** BE-07 (F-02): nastavak je jedna transakcija; dijeli se sa offline replay-em. */
  async resumeSession(session: TimerSession) {
    if (!session.pausedAt) {
      throw new AppError(ERROR_CODES.CONFLICT, 'Not paused', 409);
    }
    const now = new Date();
    const paused = applyPauseAccum(session, now);
    const { updated } = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.timerSession.update({
        where: { id: session.id },
        data: { pauseAccumMinutes: paused.pauseAccumMinutes, pausedAt: null },
      });
      await syncTaskStatus(tx, session.taskId);
      return { updated };
    });
    return serializeTimerSelf(updated);
  }

  async stop(actor: AuthUser) {
    const session = await this.requireMine(actor);
    return serializeTimerSelf(
      await this.closer.closeSession(session, actor.id, 'stop'),
    );
  }

  /**
   * Invarijante za online start: jedan otvoren timer po korisniku i po mašini.
   * (Offline sync replay namjerno prolazi kroz `createTimerSession` bez ove
   * provjere — tamo se radi o naknadnoj rekonstrukciji već zabilježenih sesija.)
   */
  private async assertNoOpenTimer(
    actor: AuthUser,
    machineId?: string,
  ): Promise<void> {
    const open = await this.prisma.timerSession.findFirst({
      where: { userId: actor.id, closedAt: null },
      select: { id: true },
    });
    if (open) {
      throw new AppError(
        ERROR_CODES.TIMER_ALREADY_OPEN,
        'Timer already open',
        409,
      );
    }
    if (!machineId) {
      return;
    }
    const busy = await this.prisma.timerSession.findFirst({
      where: { machineId, closedAt: null },
      select: { id: true },
    });
    if (busy) {
      throw new AppError(
        ERROR_CODES.MACHINE_IN_USE,
        'Machine already in use',
        409,
      );
    }
  }

  async me(actor: AuthUser) {
    const session = await this.prisma.timerSession.findFirst({
      where: { userId: actor.id, closedAt: null },
    });
    if (!session) {
      return { session: null, elapsedMinutes: 0 };
    }
    const now = new Date();
    return {
      session: serializeTimerSelf(session),
      elapsedMinutes: computeElapsedMinutes(session, now),
    };
  }

  async listByProject(actor: AuthUser, projectId: string) {
    if (
      !hasRole(
        actor,
        'ADMIN',
        'SUPER_ADMIN',
        'PLATFORM_ADMIN',
        'PROJECT_MANAGER',
        'SITE_SUPERVISOR',
      )
    ) {
      throw new AppError(ERROR_CODES.FORBIDDEN, 'Timer list not allowed', 403);
    }
    await this.access.getVisibleProject(actor, projectId);
    const now = new Date();
    const rows = await this.prisma.timerSession.findMany({
      where: { closedAt: null, task: { projectId } },
      orderBy: { startedAt: 'asc' },
    });
    return rows.map((row) => serializeCrewTimer(row, now));
  }

  async findByLocalId(actor: AuthUser, deviceId: string, localId: string) {
    // BE-07 (F-05): ranije `actor.companyId ?? ''` — platform admin bez X-Company-Id
    // nikad nije našao svoju sesiju, pa je offline replay pravio duplikat. Sada 400.
    const companyId = requireCompany(actor);
    return this.prisma.timerSession.findFirst({
      where: {
        companyId,
        userId: actor.id,
        deviceId,
        localId,
      },
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
