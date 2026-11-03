import { Injectable } from '@nestjs/common';
import { TimerSession } from '../../../generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeService } from '../realtime/realtime.service';
import { applyPauseAccum, computeDurationMinutes } from './timer-math';
import { addTaskMinutes, syncTaskStatus } from './task-status';
import { recalcProgress } from './progress';
import { addMachineHours } from './machine-hours';

@Injectable()
export class TimerForceCloseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
  ) {}

  async closeSession(
    session: TimerSession,
    actorId: string,
    reason: 'stop' | 'complete' | 'cancel' | 'force' | 'auto',
    closedAt = new Date(),
  ): Promise<TimerSession> {
    if (session.closedAt) {
      return session;
    }
    const paused = applyPauseAccum(session, closedAt);
    const durationMinutes = computeDurationMinutes(
      session.startedAt,
      closedAt,
      paused.pauseAccumMinutes,
    );
    // BE-07 (F-01): zatvaranje timera je jedna transakcija — sesija, minuti na zadatku,
    // sati na mašini, status zadatka i progres projekta. Ranije je pad u sredini (npr. na
    // `addTaskMinutes`) ostavljao zatvoren timer bez minuta na zadatku (izgubljene zarade).
    const { updated, projectId } = await this.prisma.$transaction(
      async (tx) => {
        const updated = await tx.timerSession.update({
          where: { id: session.id },
          data: {
            closedAt,
            pausedAt: null,
            pauseAccumMinutes: paused.pauseAccumMinutes,
            durationMinutes,
          },
        });
        await addTaskMinutes(tx, session.taskId, durationMinutes);
        await addMachineHours(tx, session.machineId, durationMinutes);
        const task = await tx.task.findUniqueOrThrow({
          where: { id: session.taskId },
        });
        if (reason !== 'complete' && reason !== 'cancel') {
          await syncTaskStatus(tx, session.taskId);
        }
        await recalcProgress(tx, task.projectId);
        return { updated, projectId: task.projectId };
      },
    );
    if (reason === 'force' || reason === 'auto') {
      const action =
        reason === 'auto' ? 'TIMER_AUTO_CLOSED' : 'TIMER_FORCE_CLOSED';
      await this.audit.write({
        companyId: session.companyId,
        actorId,
        action,
        entityType: 'TimerSession',
        entityId: session.id,
        payload: { durationMinutes },
      });
      await this.notifications.createForUser({
        companyId: session.companyId,
        userId: session.userId,
        type: action,
        title: reason === 'auto' ? 'Timer auto-closed' : 'Timer force-closed',
        message: 'Your open timer was closed',
        data: { timerId: session.id, taskId: session.taskId },
      });
    }
    this.realtime.emitProject(projectId, 'timer:stopped', {
      id: session.id,
      projectId,
      taskId: session.taskId,
    });
    return updated;
  }

  async closeOpenForTask(
    taskId: string,
    actorId: string,
    reason: 'complete' | 'cancel',
  ): Promise<void> {
    const open = await this.prisma.timerSession.findMany({
      where: { taskId, closedAt: null },
    });
    for (const session of open) {
      await this.closeSession(session, actorId, reason);
    }
  }

  async closeOpenForUser(userId: string, actorId: string): Promise<void> {
    const open = await this.prisma.timerSession.findMany({
      where: { userId, closedAt: null },
    });
    for (const session of open) {
      await this.closeSession(session, actorId, 'force');
    }
  }

  async closeOpenForMachine(machineId: string, actorId: string): Promise<void> {
    const open = await this.prisma.timerSession.findMany({
      where: { machineId, closedAt: null },
    });
    for (const session of open) {
      await this.closeSession(session, actorId, 'force');
    }
  }

  async closeOpenForCompany(companyId: string, actorId: string): Promise<void> {
    const open = await this.prisma.timerSession.findMany({
      where: { companyId, closedAt: null },
    });
    for (const session of open) {
      await this.closeSession(session, actorId, 'force');
    }
  }
}
