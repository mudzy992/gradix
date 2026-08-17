import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeService } from '../realtime/realtime.service';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { ProjectAccessService } from './project-access.service';
import { TasksService } from './tasks.service';
import { TimerForceCloseService } from './timer-force-close.service';
import { recalcProgress } from './progress';
import { serializeTask } from './serialize-task';

@Injectable()
export class TaskLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly tasks: TasksService,
    private readonly closer: TimerForceCloseService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
  ) {}

  async complete(actor: AuthUser, id: string) {
    const task = await this.tasks.loadVisibleTask(actor, id);
    const project = await this.access.getVisibleProject(actor, task.projectId);
    await this.access.assertScopedWrite(actor, project);
    if (task.status === 'PENDING') {
      throw new AppError(ERROR_CODES.CONFLICT, 'PENDING cannot be completed', 409);
    }
    if (task.status === 'COMPLETED' || task.status === 'CANCELLED') {
      throw new AppError(ERROR_CODES.CONFLICT, 'Task is terminal', 409);
    }
    await this.closer.closeOpenForTask(task.id, actor.id, 'complete');
    const updated = await this.prisma.task.update({
      where: { id },
      data: { status: 'COMPLETED' },
      include: { assignees: true },
    });
    await recalcProgress(this.prisma, task.projectId);
    await this.audit.write({
      companyId: task.companyId,
      actorId: actor.id,
      action: 'TASK_COMPLETED',
      entityType: 'Task',
      entityId: id,
      payload: {},
    });
    for (const assignee of updated.assignees) {
      await this.notifications.createForUser({
        companyId: task.companyId,
        userId: assignee.userId,
        type: 'TASK_COMPLETED',
        title: 'Task completed',
        message: task.title,
        data: { taskId: id, projectId: task.projectId },
      });
    }
    this.realtime.emitProject(task.projectId, 'task:updated', {
      id,
      projectId: task.projectId,
      taskId: id,
    });
    return serializeTask(updated);
  }

  async cancel(actor: AuthUser, id: string) {
    const task = await this.tasks.loadVisibleTask(actor, id);
    const project = await this.access.getVisibleProject(actor, task.projectId);
    await this.access.assertScopedWrite(actor, project);
    if (task.status === 'COMPLETED' || task.status === 'CANCELLED') {
      throw new AppError(ERROR_CODES.CONFLICT, 'Task is terminal', 409);
    }
    await this.closer.closeOpenForTask(task.id, actor.id, 'cancel');
    const updated = await this.prisma.task.update({
      where: { id },
      data: { status: 'CANCELLED' },
      include: { assignees: true },
    });
    await recalcProgress(this.prisma, task.projectId);
    await this.audit.write({
      companyId: task.companyId,
      actorId: actor.id,
      action: 'TASK_CANCELLED',
      entityType: 'Task',
      entityId: id,
      payload: {},
    });
    this.realtime.emitProject(task.projectId, 'task:updated', {
      id,
      projectId: task.projectId,
      taskId: id,
    });
    return serializeTask(updated);
  }
}
