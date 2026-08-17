import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeService } from '../realtime/realtime.service';
import { AuthUser } from '../../common/types/auth-user';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { ProjectAccessService } from './project-access.service';
import { TasksService } from './tasks.service';
import { syncTaskStatus } from './task-status';
import { serializeTask } from './serialize-task';
import { AssigneeDto, AttachmentDto } from './tasks.dto';
import { assertStoragePath } from '../../common/utils/storage-path';

@Injectable()
export class TaskAssigneesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly tasks: TasksService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
  ) {}

  async add(actor: AuthUser, taskId: string, dto: AssigneeDto) {
    const task = await this.tasks.loadVisibleTask(actor, taskId);
    const project = await this.access.getVisibleProject(actor, task.projectId);
    await this.access.assertScopedWrite(actor, project);
    this.access.assertDispatchable(project);
    const user = await this.prisma.user.findFirst({
      where: { id: dto.userId, companyId: project.companyId },
    });
    if (!user || !user.isActive) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Inactive user cannot be assigned', 400);
    }
    await this.prisma.taskAssignment.create({
      data: { companyId: project.companyId, taskId, userId: dto.userId },
    });
    await syncTaskStatus(this.prisma, taskId);
    await this.notifications.createForUser({
      companyId: project.companyId,
      userId: dto.userId,
      type: 'TASK_DISPATCHED',
      title: 'Task assigned',
      message: 'You were assigned to a task',
      data: { taskId, projectId: task.projectId },
    });
    this.realtime.emitProject(task.projectId, 'task:assigned', {
      id: taskId,
      projectId: task.projectId,
      taskId,
    });
    return serializeTask(await this.tasks.loadVisibleTask(actor, taskId));
  }

  async remove(actor: AuthUser, taskId: string, userId: string): Promise<void> {
    const task = await this.tasks.loadVisibleTask(actor, taskId);
    const project = await this.access.getVisibleProject(actor, task.projectId);
    await this.access.assertScopedWrite(actor, project);
    const open = await this.prisma.timerSession.findFirst({
      where: { taskId, userId, closedAt: null },
    });
    if (open) {
      throw new AppError(ERROR_CODES.CONFLICT, 'Assignee has an open timer', 409);
    }
    const existing = await this.prisma.taskAssignment.findFirst({
      where: { taskId, userId },
    });
    if (!existing) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Assignee not found', 404);
    }
    await this.prisma.taskAssignment.delete({ where: { id: existing.id } });
    await syncTaskStatus(this.prisma, taskId);
  }

  async addAttachment(actor: AuthUser, taskId: string, dto: AttachmentDto) {
    const task = await this.tasks.loadVisibleTask(actor, taskId);
    const project = await this.access.getVisibleProject(actor, task.projectId);
    await this.access.assertScopedWrite(actor, project);
    assertStoragePath(dto.path, project.companyId);
    return this.prisma.taskAttachment.create({
      data: {
        companyId: project.companyId,
        taskId,
        path: dto.path,
        fileName: dto.fileName,
      },
    });
  }

  async removeAttachment(actor: AuthUser, taskId: string, id: string): Promise<void> {
    const task = await this.tasks.loadVisibleTask(actor, taskId);
    const project = await this.access.getVisibleProject(actor, task.projectId);
    await this.access.assertScopedWrite(actor, project);
    const row = await this.prisma.taskAttachment.findFirst({ where: { id, taskId } });
    if (!row) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Attachment not found', 404);
    }
    await this.prisma.taskAttachment.delete({ where: { id } });
  }
}
